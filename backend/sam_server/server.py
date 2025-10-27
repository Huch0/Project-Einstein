from __future__ import annotations

import io
from typing import List, Dict, Any

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from PIL import Image

# Segment Anything imports
# Install: pip install git+https://github.com/facebookresearch/segment-anything.git
from segment_anything import sam_model_registry, SamPredictor
import torch
import numpy as np

MODEL_VARIANT = "vit_b"  # vit_b, vit_l, vit_h
CHECKPOINT_PATH = "weights/sam_vit_b.pth"  # update if using another variant
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

app = FastAPI(title="SAM HTTP Server", version="0.1.0")


@app.on_event("startup")
async def load_model():
    global predictor
    try:
        sam = sam_model_registry[MODEL_VARIANT](checkpoint=CHECKPOINT_PATH)
        sam.to(device=DEVICE)
        predictor = SamPredictor(sam)
    except Exception as e:
        raise RuntimeError(f"Failed to load SAM model: {e}")


@app.post("/segment")
async def segment(request: Request):
    try:
        body = await request.body()
        if not body:
            raise HTTPException(status_code=400, detail="Empty body")
        # Open image from bytes
        image = Image.open(io.BytesIO(body)).convert("RGB")
        image_np = np.array(image)

        # Predict using SAM
        predictor.set_image(image_np)
        # We can use automatic mask generation or point prompts; here, use auto-mask as a demo
        # Note: The official 'automatic_mask_generator' is another helper; we'll approximate by grid prompts
        # For simplicity, let's place a few coarse points and merge results
        H, W = image_np.shape[:2]
        points = [
            (int(W*0.25), int(H*0.25)),
            (int(W*0.5), int(H*0.5)),
            (int(W*0.75), int(H*0.75)),
        ]
        masks = []
        for (x, y) in points:
            input_points = torch.tensor([[x, y]], device=DEVICE)
            input_labels = torch.tensor([1], device=DEVICE)  # positive point
            mask, score, _ = predictor.predict(point_coords=input_points.cpu().numpy(), point_labels=input_labels.cpu().numpy(), multimask_output=True)
            # mask: (N, H, W)
            if mask is not None:
                for m in mask:
                    masks.append(m)

        # Convert masks to bounding boxes and convex polygons
        segments = []
        seg_id = 1
        for m in masks:
            ys, xs = np.where(m)
            if ys.size == 0 or xs.size == 0:
                continue
            x0, x1 = int(xs.min()), int(xs.max())
            y0, y1 = int(ys.min()), int(ys.max())
            w, h = x1 - x0 + 1, y1 - y0 + 1
            # Build convex hull polygon in pixel coords
            pts = np.stack([xs, ys], axis=1)
            if len(pts) > 5000:
                # Subsample to bound complexity
                idx = np.random.choice(len(pts), 5000, replace=False)
                pts = pts[idx]
            hull = _convex_hull_mono(pts)
            polygon = [[int(px), int(py)] for px, py in hull]
            segments.append({"id": seg_id, "bbox": [x0, y0, w, h], "mask_path": None, "polygon_px": polygon})
            seg_id += 1

        # Optionally, deduplicate overlapping boxes (simple IoU threshold)
        segments = dedup_segments(segments)

        return JSONResponse({"segments": segments})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def dedup_segments(segments: List[Dict[str, Any]], iou_thresh: float = 0.5) -> List[Dict[str, Any]]:
    out = []
    for seg in segments:
        keep = True
        for s in out:
            if iou(seg["bbox"], s["bbox"]) > iou_thresh:
                keep = False
                break
        if keep:
            out.append(seg)
    return out


def iou(a: List[int], b: List[int]) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ax2, ay2 = ax + aw, ay + ah
    bx2, by2 = bx + bw, by + bh
    inter_x1, inter_y1 = max(ax, bx), max(ay, by)
    inter_x2, inter_y2 = min(ax2, bx2), min(ay2, by2)
    inter_w, inter_h = max(0, inter_x2 - inter_x1), max(0, inter_y2 - inter_y1)
    inter_area = inter_w * inter_h
    if inter_area == 0:
        return 0.0
    area_a = aw * ah
    area_b = bw * bh
    return inter_area / float(area_a + area_b - inter_area)

def _cross(o, a, b):
    return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])

def _convex_hull_mono(points: np.ndarray):
    # points: Nx2 array (x,y)
    pts = points[np.lexsort((points[:,1], points[:,0]))]
    lower = []
    for p in pts:
        while len(lower) >= 2 and _cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append((int(p[0]), int(p[1])))
    upper = []
    for p in reversed(pts):
        while len(upper) >= 2 and _cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append((int(p[0]), int(p[1])))
    hull = lower[:-1] + upper[:-1]
    # Deduplicate consecutive duplicates
    dedup = []
    for pt in hull:
        if not dedup or pt != dedup[-1]:
            dedup.append(pt)
    return dedup
