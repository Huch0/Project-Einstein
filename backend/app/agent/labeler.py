from __future__ import annotations

from dataclasses import dataclass
from typing import List, Literal, Optional, Dict, Any

from app.models.settings import settings

Label = Literal["mass", "pulley", "rope", "surface", "unknown"]


@dataclass
class SegmentIn:
    id: str | int
    bbox: list[int]  # [x,y,w,h]
    mask_path: Optional[str] = None


@dataclass
class LabeledEntity:
    id: str | int
    label: Label
    bbox_px: list[int]
    confidence: float = 0.5


class BaseLabeler:
    def label(self, segments: List[SegmentIn]) -> List[LabeledEntity]:
        raise NotImplementedError


class StubLabeler(BaseLabeler):
    def label(self, segments: List[SegmentIn]) -> List[LabeledEntity]:
        # Simple geometry-based heuristic
        if not segments:
            return []
        h = sorted(segments, key=lambda s: s.bbox[2] * s.bbox[3], reverse=True)
        out: List[LabeledEntity] = []
        used: set[int | str] = set()

        # surface: thinnest (min height)
        surface = min(segments, key=lambda s: s.bbox[3])
        out.append(LabeledEntity(id=surface.id, label="surface", bbox_px=surface.bbox, confidence=0.6))
        used.add(surface.id)

        # pulley: most square among top-half
        best_sq, best_err = None, None
        # Need approximate image height; infer from max y+h
        img_h = max((s.bbox[1] + s.bbox[3] for s in segments), default=0)
        for s in segments:
            if s.id in used:
                continue
            x, y, w, hh = s.bbox
            if img_h and y > img_h * 0.55:
                continue
            if hh == 0:
                continue
            err = abs(1 - (w / hh))
            if best_err is None or err < best_err:
                best_err = err
                best_sq = s
        if best_sq is not None:
            out.append(LabeledEntity(id=best_sq.id, label="pulley", bbox_px=best_sq.bbox, confidence=0.6))
            used.add(best_sq.id)

        # masses: next two largest remaining
        rem = [s for s in h if s.id not in used]
        if rem:
            out.append(LabeledEntity(id=rem[0].id, label="mass", bbox_px=rem[0].bbox, confidence=0.6))
        if len(rem) > 1:
            out.append(LabeledEntity(id=rem[1].id, label="mass", bbox_px=rem[1].bbox, confidence=0.6))
        return out


class OpenAILabeler(BaseLabeler):
    def __init__(self, api_key: Optional[str], model: str):
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is required for OpenAI labeler")
        # Lazy import to avoid hard dependency if not used
        from openai import OpenAI  # type: ignore

        self.client = OpenAI(api_key=api_key)
        self.model = model

    def label(self, segments: List[SegmentIn]) -> List[LabeledEntity]:
        # Build a compact prompt with bbox stats; Responses API for GPT-5
        import json
        segments_compact = [{"id": str(s.id), "bbox": s.bbox} for s in segments]
        instruction = (
            "You are labeling physics diagram segments. "
            "Allowed labels: mass, pulley, rope, surface. "
            "Return a strict JSON object with key 'entities' containing a list of {id,label}. "
            "Do not include any extra commentary or code fences."
        )
        input_payload = {
            "instruction": instruction,
            "segments": segments_compact,
        }
        resp = self.client.responses.create(
            model=self.model,
            input=json.dumps(input_payload),
            reasoning={"effort": "minimal"},
            text={"verbosity": "low"},
        )
        # Prefer the convenience accessor if available
        content = getattr(resp, "output_text", None)
        if not content:
            # Fallback to first text item
            try:
                content = resp.output[0].content[0].text
            except Exception:
                content = "{}"

        def _clean_json_text(t: str) -> str:
            t = t.strip()
            if t.startswith("```"):
                # remove triple backticks and optional language tag
                t = t.strip("`")
                # after stripping, it may still contain a leading language tag like 'json\n{...}'
                if t.lower().startswith("json\n"):
                    t = t[5:]
            return t.strip()

        content = _clean_json_text(content)
        try:
            data: Dict[str, Any] = json.loads(content)
            items = data.get("entities") or data.get("labels") or []
        except Exception:
            items = []
        out: List[LabeledEntity] = []
        by_id = {str(s.id): s for s in segments}
        for it in items:
            sid = str(it.get("id"))
            lab = it.get("label", "unknown")
            seg = by_id.get(sid)
            if seg is None:
                # try raw id
                seg = by_id.get(str(it.get("segment_id", sid)))
            if seg is None:
                continue
            out.append(LabeledEntity(id=seg.id, label=lab, bbox_px=seg.bbox, confidence=0.7))
        return out


def get_labeler() -> BaseLabeler:
    if settings.LABELER_MODE == "openai":
        return OpenAILabeler(api_key=settings.OPENAI_API_KEY, model=settings.LABELER_MODEL)
    return StubLabeler()
