from __future__ import annotations

from typing import Any, Dict, List

from app.sim.builders import REGISTRY, get as get_builder  # noqa: F401
# Import known builders to populate registry
from app.sim.builders import pulley_single_fixed_v0  # noqa: F401
from app.sim.builders import ramp_block_v0  # noqa: F401

# SceneKind resolver rules (deterministic)

def resolve_kind(entities: List[Dict[str, Any]]) -> str:
    def etype(e: Dict[str, Any]) -> str:
        if "type" in e and e["type"]:
            return str(e["type"]).lower()
        return str(e.get("label", "")).lower()

    counts = {
        "mass": sum(1 for e in entities if etype(e) == "mass"),
        "pulley": sum(1 for e in entities if etype(e) == "pulley"),
        "ramp": sum(1 for e in entities if etype(e) == "ramp"),
        "pendulum_pivot": sum(1 for e in entities if etype(e) == "pendulum_pivot"),
        "spring": sum(1 for e in entities if etype(e) == "spring"),
    }
    if counts["mass"] >= 2 and counts["pulley"] >= 1:
        return "pulley.single_fixed_v0"
    if counts["mass"] == 1 and counts["ramp"] == 1:
        return "ramp.block_v0"
    if counts["mass"] == 1 and counts["pendulum_pivot"] == 1:
        return "pendulum.single_v0"
    if counts["mass"] == 1 and counts["spring"] >= 1:
        return "spring_mass.single_v0"
    # default error: provide suggestion
    raise ValueError(
        "Unable to resolve SceneKind. Provide ≥2 mass + 1 pulley, or 1 mass + 1 ramp, or 1 mass + 1 pendulum_pivot, or 1 mass + 1 spring."
    )


def build_scene_v2(request: Dict[str, Any]) -> Dict[str, Any]:
    labels = request.get("labels") or {}
    entities: List[Dict[str, Any]] = labels.get("entities") or []
    # back-compat: if no version, accept v0.1 {label}
    kind = request.get("scene_kind")
    if not kind or kind == "auto":
        kind = resolve_kind(entities)
    builder = REGISTRY.get(kind)
    if not builder:
        raise ValueError(f"No builder registered for kind: {kind}")
    warnings = builder.validate(request)
    result = builder.build(request)
    # merge warnings
    if warnings:
        w = list(result.get("warnings") or [])
        result["warnings"] = list({*w, *warnings})
    return result
