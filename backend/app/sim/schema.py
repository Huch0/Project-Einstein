"""Simulation scene schema (v0.1.0) for Project Einstein.

Defines a minimal set of types required to model an idealized single fixed pulley
system with two masses connected by a massless, inextensible rope over a frictionless
pulley. This establishes the baseline contract shared between backend validation and
frontend execution.

Roadmap: expand to multiple bodies, arbitrary constraints, springs, compound shapes.
"""
from __future__ import annotations

from typing import Literal, Optional
from pydantic import BaseModel, Field, field_validator

SCENE_SCHEMA_VERSION = "0.1.0"


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
  type: Literal["dynamic"] = "dynamic"  # future: static, kinematic
  mass_kg: float = Field(..., gt=0.0)
  position_m: tuple[float, float] = Field(..., description="(x,y) position in meters.")
  velocity_m_s: tuple[float, float] = (0.0, 0.0)
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


class Scene(BaseModel):
  version: str = Field(SCENE_SCHEMA_VERSION, description="Schema version.")
  kind: Literal["pulley.single_fixed_v0"] = "pulley.single_fixed_v0"
  world: WorldSettings = Field(default_factory=WorldSettings)
  bodies: list[Body]
  constraints: list[PulleyConstraint]
  notes: Optional[str] = Field(None, description="Free-form description or source of problem statement.")

  @field_validator("bodies")
  @classmethod
  def _require_two_bodies(cls, v: list[Body]):  # type: ignore[override]
    if len(v) != 2:
      raise ValueError("Pulley scene requires exactly two bodies.")
    return v

  @field_validator("constraints")
  @classmethod
  def _one_constraint(cls, v: list[PulleyConstraint]):  # type: ignore[override]
    if len(v) != 1:
      raise ValueError("Pulley scene requires exactly one pulley constraint.")
    return v

  def body_ids(self) -> set[str]:
    return {b.id for b in self.bodies}

  def validate_references(self) -> None:
    ids = self.body_ids()
    pulley = self.constraints[0]
    missing = [bid for bid in (pulley.body_a, pulley.body_b) if bid not in ids]
    if missing:
      raise ValueError(f"Pulley references unknown body ids: {missing}")

  def compute_rope_length_if_needed(self) -> None:
    pulley = self.constraints[0]
    if pulley.rope_length_m is not None:
      return
    # Compute simple length: distance from body A to anchor plus anchor to body B (piecewise, ignoring wrap)
    import math
    a = next(b for b in self.bodies if b.id == pulley.body_a)
    b = next(b for b in self.bodies if b.id == pulley.body_b)
    ax, ay = a.position_m
    bx, by = b.position_m
    cx, cy = pulley.pulley_anchor_m
    length = math.dist((ax, ay), (cx, cy)) + math.dist((bx, by), (cx, cy))
    pulley.rope_length_m = length

  def normalize(self) -> "Scene":
    self.validate_references()
    self.compute_rope_length_if_needed()
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
  "Scene",
  "example_pulley_scene",
]