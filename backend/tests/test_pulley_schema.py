from app.sim.schema import example_pulley_scene, Scene


def test_example_pulley_scene_validates_and_computes_rope():
  scene = example_pulley_scene()
  assert isinstance(scene, Scene)
  pulley = scene.constraints[0]
  assert pulley.rope_length_m is not None
  # Deterministic length given default positions
  # (not asserting exact float to avoid brittle test; check positive and plausible range)
  assert 1.0 < pulley.rope_length_m < 10.0


def test_invalid_missing_body_reference():
  from app.sim.schema import Scene, Body, PulleyConstraint, WorldSettings
  scene = Scene(
    bodies=[Body(id="m1", mass_kg=1.0, position_m=(0.0, 0.5)), Body(id="m2", mass_kg=2.0, position_m=(1.0, 0.5))],
    constraints=[PulleyConstraint(body_a="m1", body_b="mX")],
    world=WorldSettings(),
  )
  try:
    scene.normalize()
    assert False, "Expected failure due to unknown body id"
  except ValueError as e:
    assert "unknown body ids" in str(e).lower()