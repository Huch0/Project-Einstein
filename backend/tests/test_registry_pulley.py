from __future__ import annotations

from app.sim.registry import build_scene_v2, resolve_kind


def make_segments():
    return [
        {"id": 1, "bbox": [100, 200, 80, 80]},
        {"id": 2, "bbox": [900, 500, 80, 80]},
        {"id": 3, "bbox": [800, 150, 100, 100]},
        {"id": 4, "bbox": [0, 260, 1200, 20]},
    ]


def make_request_v02():
    return {
        "image": {"width_px": 1280, "height_px": 720},
        "segments": make_segments(),
        "labels": {
            "version": "v0.2",
            "entities": [
                {"segment_id": "1", "type": "mass", "props": {"mass_kg": 2.0}},
                {"segment_id": "2", "type": "mass", "props": {"mass_kg": 4.0}},
                {"segment_id": "3", "type": "pulley", "props": {"wheel_radius_m": 0.1}},
                {"segment_id": "4", "type": "surface", "props": {"mu_k": 0.5}},
            ],
        },
        "mapping": {"origin_mode": "anchor_centered", "scale_m_per_px": 0.001},
        "defaults": {"gravity_m_s2": 9.81},
    }


def make_request_v01():
    # No version, using 'label' for compatibility
    r = make_request_v02()
    ents = r["labels"]["entities"]
    for e in ents:
        e["label"] = e.pop("type")
    r["labels"].pop("version")
    return r


def test_resolve_kind_deterministic():
    ents = make_request_v02()["labels"]["entities"]
    kind = resolve_kind(ents)
    assert kind == "pulley.single_fixed_v0"


def test_build_scene_v2_v02_labels():
    req = make_request_v02()
    res = build_scene_v2(req)
    scene = res["scene"]
    assert res["meta"]["resolver"] == "v2"
    assert res["meta"]["scene_kind"] == "pulley.single_fixed_v0"
    assert scene["kind"] == "pulley.single_fixed_v0"
    # Rope length must be computed if omitted
    constraint = scene["constraints"][0]
    assert constraint.get("rope_length_m") is not None


def test_build_scene_v2_v01_compat():
    req = make_request_v01()
    res = build_scene_v2(req)
    scene = res["scene"]
    assert scene["kind"] == "pulley.single_fixed_v0"
