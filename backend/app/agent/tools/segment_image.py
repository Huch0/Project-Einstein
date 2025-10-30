"""
Tool 1: segment_image - SAM/SAM2 Segmentation

Extracts object boundaries from physics diagram images using SAM.
"""

import base64
import uuid
from typing import Literal

from pydantic import BaseModel, Field

from app.pipeline.sam_detector import SamClient


class SegmentImageInput(BaseModel):
    """Input schema for segment_image tool."""
    
    image_data: str = Field(
        description="Base64 encoded image, file path, or image_id"
    )
    mode: Literal["bbox", "polygon", "mask"] = Field(
        default="polygon",
        description="Output mode: bbox only, polygon outline, or full mask"
    )
    sam_server_url: str = Field(
        default="http://localhost:9001/segment",
        description="SAM server endpoint URL"
    )


class Segment(BaseModel):
    """Single segment from SAM."""
    
    id: int | str
    bbox: tuple[float, float, float, float] = Field(
        description="Bounding box [x, y, width, height] in pixels"
    )
    polygon_px: list[list[float]] | None = Field(
        default=None,
        description="Precise polygon outline [[x,y], ...] in pixels"
    )
    mask_path: str | None = Field(
        default=None,
        description="S3/local path to mask image if requested"
    )


class ImageMetadata(BaseModel):
    """Image metadata."""
    
    width_px: int
    height_px: int
    image_id: str = Field(default_factory=lambda: str(uuid.uuid4()))


class SegmentImageOutput(BaseModel):
    """Output schema for segment_image tool."""
    
    segments: list[Segment]
    image: ImageMetadata


async def segment_image(input_data: SegmentImageInput) -> SegmentImageOutput:
    """
    Extract object boundaries from physics diagram using SAM.
    
    Args:
        input_data: Segmentation configuration
        
    Returns:
        Segments with bounding boxes, polygons, and image metadata
        
    Example:
        >>> result = await segment_image(SegmentImageInput(
        ...     image_data="base64_encoded_image",
        ...     mode="polygon"
        ... ))
        >>> print(f"Found {len(result.segments)} segments")
    """
    # Handle base64 encoded images
    if input_data.image_data.startswith("data:image"):
        # Extract base64 data from data URL
        image_bytes = base64.b64decode(
            input_data.image_data.split(",", 1)[1]
        )
    elif input_data.image_data.startswith("/") or ":\\" in input_data.image_data:
        # File path
        with open(input_data.image_data, "rb") as f:
            image_bytes = f.read()
    else:
        # Assume raw base64
        image_bytes = base64.b64decode(input_data.image_data)
    
    # Call SAM detector
    sam_client = SamClient(
        mode="http" if "localhost" in input_data.sam_server_url or "127.0.0.1" in input_data.sam_server_url else "stub",
        http_url=input_data.sam_server_url
    )
    detections = sam_client.segment(image_bytes)
    
    # Convert to tool output format
    segments = []
    for det in detections:
        segment = Segment(
            id=det.id,
            bbox=det.bbox,
            polygon_px=[[p[0], p[1]] for p in det.polygon_px] if det.polygon_px else None,
            mask_path=det.mask_path
        )
        segments.append(segment)
    
    # Get image dimensions from first detection or decode image
    if detections:
        # SAM detector should include image size in metadata
        # For now, estimate from bbox bounds
        max_x = max(seg.bbox[0] + seg.bbox[2] for seg in segments)
        max_y = max(seg.bbox[1] + seg.bbox[3] for seg in segments)
        width_px = int(max_x)
        height_px = int(max_y)
    else:
        # Fallback: decode image to get size
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(image_bytes))
        width_px, height_px = img.size
    
    image_meta = ImageMetadata(
        width_px=width_px,
        height_px=height_px
    )
    
    return SegmentImageOutput(
        segments=segments,
        image=image_meta
    )
