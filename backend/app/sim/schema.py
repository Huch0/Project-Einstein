"""Simulation scene schema (v0.4.0) for Project Einstein.

Flexible schema supporting any combination of bodies and constraints.
No rigid scene-kind restrictions - universal physics builder approach.

v0.4 Changes:
- Removed scene_kind field (composition over classification)
- Bodies list can have any count (not limited to 2)
- Constraints support multiple types (rope, spring, hinge, fixed, distance)
- Dynamic constraint inference by GPT-5 Agent
"""
from __future__ import annotations

from typing import Literal, Optional, Union
from pydantic import BaseModel, Field, field_validator

SCENE_SCHEMA_VERSION = "0.4.0"


class WorldSettings(BaseModel):
  gravity_m_s2: float = Field(9.81, description="Positive magnitude of gravitational acceleration (applied downward along -y in 2D).")
  air_resistance_coeff: float = Field(0.0, ge=0.0, description="Linear drag coefficient (simple F = -c v model).")
  time_step_s: float = Field(0.016, gt=0.0, le=0.1, description="Fixed integrator timestep in seconds.")
  seed: int | None = Field(None, description="Optional deterministic seed for any stochastic processes (not used yet).")


class Material(BaseModel):
  name: str = Field("default", description="Material identifier.")
  friction: float = Field(0.0, ge=0.0, description="Coefficient of kinetic friction (not yet applied for ideal pulley).")
  restitution: float = Field(0.0, ge=0.0, le=1.0, description="Bounciness (unused in pulley v0).")


class Body(BaseModel):
  id: str
  type: Literal["dynamic", "static", "kinematic"] = "dynamic"
  mass_kg: float = Field(..., gt=0.0)
  position_m: tuple[float, float] = Field(..., description="(x,y) position in meters.")
  velocity_m_s: tuple[float, float] = (0.0, 0.0)
  angle_rad: float = Field(0.0, description="Rotation angle in radians.")
  angular_velocity_rad_s: float = Field(0.0, description="Angular velocity in rad/s.")
  collider: dict = Field(default_factory=lambda: {"type": "rectangle", "width_m": 0.1, "height_m": 0.1})
  material: Material = Field(default_factory=Material)

  @field_validator("position_m")
  @classmethod
  def _validate_pos(cls, v: tuple[float, float]):  # type: ignore[override]
    if len(v) != 2:
      raise ValueError("position_m must be length-2 (x,y)")
    return v

  @field_validator("velocity_m_s")
  @classmethod
  def _validate_vel(cls, v: tuple[float, float]):  # type: ignore[override]
    if len(v) != 2:
      raise ValueError("velocity_m_s must be length-2 (vx,vy)")
    return v


class PulleyConstraint(BaseModel):
  """Ideal fixed pulley constraint (legacy, kept for backward compatibility)."""
  id: str = "pulley_1"
  type: Literal["ideal_fixed_pulley"] = "ideal_fixed_pulley"
  body_a: str = Field(..., description="ID of first mass (left side).")
  body_b: str = Field(..., description="ID of second mass (right side).")
  pulley_anchor_m: tuple[float, float] = Field((0.0, 2.0), description="(x,y) position of pulley wheel center.")
  rope_length_m: Optional[float] = Field(None, gt=0.0, description="Optional explicit rope length; if omitted computed from initial geometry.")
  rope_mass_kg: float = Field(0.0, ge=0.0, description="Mass of rope (0 for massless ideal rope). Not used if 0.")
  wheel_radius_m: float = Field(0.1, gt=0.0, description="Pulley wheel radius (currently cosmetic in ideal model).")

  @field_validator("pulley_anchor_m")
  @classmethod
  def _validate_anchor(cls, v: tuple[float, float]):  # type: ignore[override]
    if len(v) != 2:
      raise ValueError("pulley_anchor_m must be length-2 (x,y)")
    return v


class RopeConstraint(BaseModel):
  """Rope constraint - connects two bodies with inextensible rope."""
  type: Literal["rope"] = "rope"
  body_a: Optional[str] = Field(None, description="First body ID (null for world anchor)")
  body_b: Optional[str] = Field(None, description="Second body ID")
  point_a_m: Optional[tuple[float, float]] = Field(None, description="Attachment point on body A (local coords)")
  point_b_m: Optional[tuple[float, float]] = Field(None, description="Attachment point on body B (local coords)")
  length_m: float = Field(..., gt=0.0, description="Rope length in meters")
  stiffness: float = Field(1.0, ge=0.0, le=1.0, description="Stiffness (1.0 = ideal inextensible)")


class SpringConstraint(BaseModel):
  """Spring constraint - elastic connection between bodies."""
  type: Literal["spring"] = "spring"
  body_a: Optional[str] = Field(None, description="First body ID (null for world anchor)")
  body_b: Optional[str] = Field(None, description="Second body ID")
  point_a_m: Optional[tuple[float, float]] = Field(None, description="Attachment point on body A")
  point_b_m: Optional[tuple[float, float]] = Field(None, description="Attachment point on body B")
  length_m: float = Field(0.5, gt=0.0, description="Rest length in meters")
  stiffness: float = Field(100.0, gt=0.0, description="Spring constant (N/m)")
  damping: float = Field(0.0, ge=0.0, description="Damping coefficient")


class HingeConstraint(BaseModel):
  """Hinge constraint - rotational joint."""
  type: Literal["hinge"] = "hinge"
  body_a: Optional[str] = Field(None, description="First body ID")
  body_b: Optional[str] = Field(None, description="Second body ID")
  point_a_m: tuple[float, float] = Field(..., description="Hinge point on body A")
  point_b_m: tuple[float, float] = Field(..., description="Hinge point on body B")
  angle_limits: Optional[tuple[float, float]] = Field(None, description="(min, max) angle limits in radians")


class DistanceConstraint(BaseModel):
  """Distance constraint - maintains fixed distance between bodies."""
  type: Literal["distance"] = "distance"
  body_a: Optional[str] = Field(None, description="First body ID")
  body_b: Optional[str] = Field(None, description="Second body ID")
  point_a_m: Optional[tuple[float, float]] = Field(None, description="Attachment point on body A")
  point_b_m: Optional[tuple[float, float]] = Field(None, description="Attachment point on body B")
  length_m: float = Field(..., gt=0.0, description="Distance in meters")


# Union type for all constraint types
Constraint = Union[PulleyConstraint, RopeConstraint, SpringConstraint, HingeConstraint, DistanceConstraint]


class Scene(BaseModel):
  """Flexible physics scene schema (v0.4).
  
  Supports any combination of bodies and constraints.
  No scene_kind restrictions - universal builder approach.
  """
  version: str = Field(SCENE_SCHEMA_VERSION, description="Schema version.")
  world: WorldSettings = Field(default_factory=WorldSettings)
  bodies: list[Body] = Field(..., description="List of physics bodies (any count)")
  constraints: list[dict] = Field(default_factory=list, description="List of constraints (any type)")
  notes: Optional[str] = Field(None, description="Free-form description or source of problem statement.")

  def body_ids(self) -> set[str]:
    return {b.id for b in self.bodies}

  def validate_references(self) -> None:
    """Validate that constraint body references exist."""
    ids = self.body_ids()
    for constraint in self.constraints:
      body_a = constraint.get("body_a")
      body_b = constraint.get("body_b")
      missing = []
      if body_a and body_a not in ids:
        missing.append(body_a)
      if body_b and body_b not in ids:
        missing.append(body_b)
      if missing:
        raise ValueError(f"Constraint references unknown body ids: {missing}")

  def normalize(self) -> "Scene":
    """Validate and normalize scene data."""
    self.validate_references()
    return self


def example_pulley_scene(
  mass_a_kg: float = 2.0,
  mass_b_kg: float = 5.0,
  gravity: float = 9.81,
  wheel_radius_m: float = 0.1,
  vertical_offset_m: float = 0.5,
) -> Scene:
  """Produce a canonical example pulley scene.

  mass_b > mass_a so system accelerates with b descending.
  """
  scene = Scene(
    bodies=[
      Body(id="m1", mass_kg=mass_a_kg, position_m=(-0.5, 0.5 + vertical_offset_m)),
      Body(id="m2", mass_kg=mass_b_kg, position_m=(0.5, 1.5 + vertical_offset_m)),
    ],
    constraints=[
      PulleyConstraint(body_a="m1", body_b="m2", wheel_radius_m=wheel_radius_m, pulley_anchor_m=(0.0, 2.0 + vertical_offset_m)),
    ],
    world=WorldSettings(gravity_m_s2=gravity),
    notes="Example single fixed ideal pulley problem (two masses).",
  )
  return scene.normalize()


__all__ = [
  "SCENE_SCHEMA_VERSION",
  "WorldSettings",
  "Material",
  "Body",
  "PulleyConstraint",
  "RopeConstraint",
  "SpringConstraint",
  "HingeConstraint",
  "DistanceConstraint",
  "Constraint",
  "Scene",
  "example_pulley_scene",
]