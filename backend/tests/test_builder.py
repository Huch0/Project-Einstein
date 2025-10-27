from app.sim.builder import build_scene
from app.sim.schema import Scene


def test_builder_minimal_scene_positions():
    req = {
        "image": {"width_px": 200, "height_px": 100},
        "segments": [
            {"id": 1, "bbox": [20, 40, 20, 20]},  # left mass center=(30,50)
            {"id": 2, "bbox": [160, 40, 20, 20]}, # right mass center=(170,50)
            {"id": 3, "bbox": [100, 10, 20, 20]}, # pulley center=(110,20)
        ],
        "labels": {"entities": [
            {"segment_id": "1", "label": "mass", "props": {"mass_guess_kg": 2.0}},
            {"segment_id": "2", "label": "mass", "props": {"mass_guess_kg": 4.0}},
            {"segment_id": "3", "label": "pulley"},
        ]},
        "mapping": {"origin_mode": "anchor_centered", "scale_m_per_px": 0.01},  # 100px = 1m
        "defaults": {"gravity_m_s2": 9.81},
    }
    out = build_scene(req)
    scene = Scene.model_validate(out["scene"]).normalize()
    # Image center is (100,50). Mass centers are (30,50) and (170,50): so x_m are -0.7m and +0.7m, y=0
    bmap = {b.id: b for b in scene.bodies}
    assert abs(bmap["m1"].position_m[0] - (-0.7)) < 1e-6
    assert abs(bmap["m2"].position_m[0] - (0.7)) < 1e-6
    assert abs(bmap["m1"].position_m[1] - 0.0) < 1e-6
    assert abs(bmap["m2"].position_m[1] - 0.0) < 1e-6
    # Pulley anchor y: (20-50)*0.01 = -0.3 m
    pulley = scene.constraints[0]
    assert abs(pulley.pulley_anchor_m[0] - 0.1) < 1e-6  # (110-100)*0.01
    assert abs(pulley.pulley_anchor_m[1] - (-0.3)) < 1e-6
    # Rope length computed
    assert pulley.rope_length_m and pulley.rope_length_m > 0
