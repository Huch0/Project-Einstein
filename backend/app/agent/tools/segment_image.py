"""
Tool 1: segment_image - SAM/SAM2 Segmentation

Extracts object boundaries from physics diagram images using SAM.
Standalone implementation - no dependency on pipeline/sam_detector.py.
"""

import base64
import json
import uuid
import http.client
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, Field


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


# ===========================
# SAM Segmentation Helpers
# ===========================

def _segment_via_http(image_bytes: bytes, sam_server_url: str) -> list[dict]:
    """
    Call external SAM server via HTTP POST.
    
    Args:
        image_bytes: Raw image data
        sam_server_url: Full URL to SAM endpoint
        
    Returns:
        List of raw segment dictionaries with id, bbox, polygon_px
        
    Raises:
        ConnectionError: If SAM server unreachable
        ValueError: If server returns invalid response
    """
    parsed = urlparse(sam_server_url)
    host = parsed.hostname or "localhost"
    port = parsed.port or 9001
    path = parsed.path or "/segment"
    
    # Prepare multipart body
    boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="image"; filename="diagram.jpg"\r\n'
        f"Content-Type: image/jpeg\r\n\r\n"
    ).encode() + image_bytes + f"\r\n--{boundary}--\r\n".encode()
    
    headers = {
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "Content-Length": str(len(body))
    }
    
    try:
        conn = http.client.HTTPConnection(host, port, timeout=30)
        conn.request("POST", path, body, headers)
        response = conn.getresponse()
        
        if response.status != 200:
            raise ValueError(f"SAM server error: {response.status} {response.reason}")
        
        data = json.loads(response.read().decode())
        conn.close()
        
        # Expected format: {"segments": [{id, bbox, polygon_px}, ...]}
        return data.get("segments", [])
        
    except (ConnectionRefusedError, TimeoutError) as e:
        raise ConnectionError(f"SAM server unreachable at {host}:{port}") from e


def _segment_stub(image_bytes: bytes) -> list[dict]:
    """
    Generate deterministic test segments without SAM server.
    
    Simulates typical pulley system layout:
    - 2 masses (left and right)
    - 1 pulley (top center)
    - 1 surface (bottom)
    
    Args:
        image_bytes: Ignored (for signature compatibility)
        
    Returns:
        List of 4 segments with realistic physics diagram layout
    """
    # Assume 800x600 image for consistent test data
    W, H = 800, 600
    
    segments = [
        {
            "id": 1,
            "bbox": [100, 350, 80, 80],  # Mass A (left, suspended)
            "polygon_px": [
                [100, 350], [180, 350], [180, 430], [100, 430]
            ],
            "mask_path": None
        },
        {
            "id": 2,
            "bbox": [620, 350, 80, 80],  # Mass B (right, suspended)
            "polygon_px": [
                [620, 350], [700, 350], [700, 430], [620, 430]
            ],
            "mask_path": None
        },
        {
            "id": 3,
            "bbox": [360, 80, 80, 80],  # Pulley (top center)
            "polygon_px": [
                [400, 90],   # Top
                [430, 110],  # Right
                [430, 140],
                [400, 160],  # Bottom
                [370, 140],  # Left
                [370, 110]
            ],
            "mask_path": None
        },
        {
            "id": 4,
            "bbox": [0, 550, W, 50],  # Ground surface (bottom)
            "polygon_px": [
                [0, 550], [W, 550], [W, 600], [0, 600]
            ],
            "mask_path": None
        }
    ]
    
    return segments


async def segment_image(input_data: SegmentImageInput) -> SegmentImageOutput:
    """
    Extract object boundaries from physics diagram using SAM.
    
    Supports two modes:
    - http: Calls external SAM server via HTTP
    - stub: Returns deterministic test segments
    
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
    
    # Determine mode based on URL
    use_http = (
        "localhost" in input_data.sam_server_url 
        or "127.0.0.1" in input_data.sam_server_url
    )
    
    # Call SAM (HTTP or stub)
    if use_http:
        raw_segments = _segment_via_http(image_bytes, input_data.sam_server_url)
    else:
        raw_segments = _segment_stub(image_bytes)
    
    # Convert to tool output format
    segments = []
    for seg in raw_segments:
        segment = Segment(
            id=seg["id"],
            bbox=tuple(seg["bbox"]),
            polygon_px=seg.get("polygon_px"),
            mask_path=seg.get("mask_path")
        )
        segments.append(segment)
    
    # Get image dimensions
    if segments:
        # Estimate from bbox bounds
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
