from __future__ import annotations

from app.sim.registry import build_scene_v2
from app.sim.analytic import simulate_ramp_scene


def make_segments():
    return [
        {"id": 1, "bbox": [200, 300, 80, 80]},
        {"id": 2, "bbox": [600, 200, 300, 30]},  # ramp seg (bbox used only for center)
    ]


def make_request():
    return {
        "image": {"width_px": 1280, "height_px": 720},
        "segments": make_segments(),
        "labels": {
            "version": "v0.2",
            "entities": [
                {"segment_id": "1", "type": "mass", "props": {"mass_kg": 2.0}},
                {"segment_id": "2", "type": "ramp", "props": {"angle_deg": 30, "mu_k": 0.2}},
            ],
        },
        "mapping": {"origin_mode": "anchor_centered", "scale_m_per_px": 0.001},
        "defaults": {"gravity_m_s2": 9.81},
    }


def test_build_scene_v2_ramp():
    req = make_request()
    res = build_scene_v2(req)
    scene = res["scene"]
    assert res["meta"]["scene_kind"] == "ramp.block_v0"
    assert scene["kind"] == "ramp.block_v0"
    cons = scene["constraints"][0]
    assert cons["type"] == "ramp_plane"
    assert "angle_deg" in cons


def test_simulate_ramp_scene_frames():
    req = make_request()
    scene = build_scene_v2(req)["scene"]
    sim = simulate_ramp_scene(scene, total_time_s=0.5)
    frames = sim["frames"]
    assert len(frames) > 0
    # position should increase downslope (x,y both increase for 30deg)
    p0 = frames[0]["positions"]["m1"]
    pN = frames[-1]["positions"]["m1"]
    assert pN[0] > p0[0] and pN[1] > p0[1]
