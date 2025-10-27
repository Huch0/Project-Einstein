from __future__ import annotations

from dataclasses import dataclass, field
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
    props: Dict[str, Any] = field(default_factory=dict)


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
        out.append(
            LabeledEntity(
                id=surface.id,
                label="surface",
                bbox_px=surface.bbox,
                confidence=0.6,
                props={"friction_k": 0.5, "gravity_m_s2": 10.0},
            )
        )
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
            out.append(
                LabeledEntity(
                    id=best_sq.id,
                    label="pulley",
                    bbox_px=best_sq.bbox,
                    confidence=0.6,
                    props={"wheel_radius_m": 0.1},
                )
            )
            used.add(best_sq.id)

        # masses: next two largest remaining
        rem = [s for s in h if s.id not in used]
        # Sort by x to assign mass guesses 3kg (left) and 6kg (right) per the attached diagram
        rem_sorted = sorted(rem, key=lambda s: s.bbox[0])
        if rem_sorted:
            out.append(
                LabeledEntity(
                    id=rem_sorted[0].id,
                    label="mass",
                    bbox_px=rem_sorted[0].bbox,
                    confidence=0.6,
                    props={"mass_guess_kg": 3.0},
                )
            )
        if len(rem_sorted) > 1:
            out.append(
                LabeledEntity(
                    id=rem_sorted[1].id,
                    label="mass",
                    bbox_px=rem_sorted[1].bbox,
                    confidence=0.6,
                    props={"mass_guess_kg": 6.0},
                )
            )
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
        # Use prompts from YAML configuration
        import json
        from app.agent.prompts import get_labeler_system_prompt, get_labeler_user_prompt
        
        segments_compact = [{"id": str(s.id), "bbox": s.bbox} for s in segments]
        segments_json = json.dumps(segments_compact, indent=2)
        
        # Load prompts from YAML
        system_prompt = get_labeler_system_prompt()
        user_prompt = get_labeler_user_prompt(segments_json)
        
        # Prepare input for GPT-5 Responses API
        input_payload = {
            "instruction": system_prompt,
            "user_request": user_prompt,
            "segments": segments_compact,
        }
        
        try:
            # Use Responses API for GPT-5
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
        except Exception as e:
            print(f"[OpenAILabeler] GPT-5 API call failed: {e}, falling back to stub")
            print(f"[OpenAILabeler] GPT-5 API call failed: {e}, falling back to stub")
            return StubLabeler().label(segments)

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
        except Exception as e:
            print(f"[OpenAILabeler] JSON parse failed: {e}, falling back to stub")
            return StubLabeler().label(segments)
            
        out: List[LabeledEntity] = []
        by_id = {str(s.id): s for s in segments}
        for it in items:
            sid = str(it.get("id"))
            lab = it.get("label", "unknown")
            props = it.get("props") or {}
            seg = by_id.get(sid)
            if seg is None:
                # try raw id
                seg = by_id.get(str(it.get("segment_id", sid)))
            if seg is None:
                continue
            out.append(LabeledEntity(id=seg.id, label=lab, bbox_px=seg.bbox, confidence=0.7, props=props))
        
        # If no entities parsed, fallback to stub
        if not out:
            print(f"[OpenAILabeler] No entities parsed from GPT-5 response, using stub")
            return StubLabeler().label(segments)
            
        return out


def get_labeler() -> BaseLabeler:
    if settings.LABELER_MODE == "openai":
        return OpenAILabeler(api_key=settings.OPENAI_API_KEY, model=settings.LABELER_MODEL)
    return StubLabeler()
