"""Scene editing tools enabling incremental simulation construction."""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, model_validator

from app.agent.agent_context import ConversationContext, get_context_store
from app.logging_utils import get_logger

logger = get_logger("scene_editor")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_context(conversation_id: str) -> ConversationContext:
    store = get_context_store()
    context = store.get_context(conversation_id)
    if not context:
        raise ValueError(f"Conversation {conversation_id} not found")
    return context


def _ensure_scene_initialized(context: ConversationContext) -> None:
    if not context.scene_state:
        context.reset_scene_state()


def _snapshot_after_update(
    context: ConversationContext,
    *,
    note: str | None = None,
) -> dict[str, Any]:
    store = get_context_store()
    scene = context.record_scene_snapshot(note)
    store.update_context(context)
    return scene


def _material_dict(
    *,
    friction: float | None = None,
    restitution: float | None = None,
    density: float | None = None,
) -> dict[str, Any] | None:
    material: dict[str, Any] = {}
    if friction is not None:
        material["friction"] = friction
    if restitution is not None:
        material["restitution"] = restitution
    if density is not None:
        material["density_kg_m3"] = density
    return material or None


def _clamp_block_to_image_bounds(
    context: "ConversationContext",
    position_m: tuple[float, float],
    size_m: tuple[float, float],
) -> tuple[list[float], tuple[float, float], list[str]]:
    """Ensure rectangular blocks remain inside the uploaded image bounds."""

    mapping = (context.scene_state or {}).get("mapping") or context.mapping or {}
    image_meta = context.image_metadata or {}

    origin = mapping.get("origin_px")
    scale = float(mapping.get("scale_m_per_px") or 0.0)
    width_px = float(image_meta.get("width_px") or 0.0)
    height_px = float(image_meta.get("height_px") or 0.0)

    if not origin or scale <= 0.0 or width_px <= 0.0 or height_px <= 0.0:
        return [float(position_m[0]), float(position_m[1])], (
            float(size_m[0]),
            float(size_m[1]),
        ), []

    origin_x = float(origin[0])
    origin_y = float(origin[1])
    margin_px = 2.0

    width_m = float(size_m[0])
    height_m = float(size_m[1])

    max_width_px = max(width_px - margin_px * 2.0, 2.0)
    max_height_px = max(height_px - margin_px * 2.0, 2.0)

    width_px_value = max(width_m / scale, 1e-6)
    height_px_value = max(height_m / scale, 1e-6)
    adjustments: list[str] = []

    if width_px_value > max_width_px:
        width_px_value = max_width_px
        width_m = width_px_value * scale
        adjustments.append("width_clamped")

    if height_px_value > max_height_px:
        height_px_value = max_height_px
        height_m = height_px_value * scale
        adjustments.append("height_clamped")

    half_w_px = width_px_value / 2.0
    half_h_px = height_px_value / 2.0

    center_x_px = origin_x + float(position_m[0]) / scale
    center_y_px = origin_y - float(position_m[1]) / scale

    min_center_x = margin_px + half_w_px
    max_center_x = width_px - margin_px - half_w_px
    min_center_y = margin_px + half_h_px
    max_center_y = height_px - margin_px - half_h_px

    if min_center_x > max_center_x:
        center_x_px = width_px / 2.0
    else:
        clamped_x = min(max(center_x_px, min_center_x), max_center_x)
        if abs(clamped_x - center_x_px) > 1e-6:
            adjustments.append("position_x_clamped")
        center_x_px = clamped_x

    if min_center_y > max_center_y:
        center_y_px = height_px / 2.0
    else:
        clamped_y = min(max(center_y_px, min_center_y), max_center_y)
        if abs(clamped_y - center_y_px) > 1e-6:
            adjustments.append("position_y_clamped")
        center_y_px = clamped_y

    adjusted_position = [
        (center_x_px - origin_x) * scale,
        (origin_y - center_y_px) * scale,
    ]

    return adjusted_position, (width_m, height_m), adjustments


# ---------------------------------------------------------------------------
# Pydantic models shared by tools
# ---------------------------------------------------------------------------


class SceneEditOutput(BaseModel):
    scene: dict[str, Any]
    message: str
    updated_body_ids: list[str] = Field(default_factory=list)
    updated_constraint_ids: list[str] = Field(default_factory=list)


class CreateBlockInput(BaseModel):
    conversation_id: str
    body_id: str | None = Field(default=None, description="Optional explicit id")
    position_m: tuple[float, float]
    size_m: tuple[float, float]
    body_type: Literal["dynamic", "static", "kinematic"] = "dynamic"
    angle_rad: float | None = Field(default=None, description="Rotation angle in radians")
    velocity_m_s: tuple[float, float] | None = None
    mass_kg: float | None = None
    friction: float | None = None
    restitution: float | None = None
    density_kg_m3: float | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def _validate_size(self) -> "CreateBlockInput":
        width, height = self.size_m
        if width <= 0 or height <= 0:
            raise ValueError("Block dimensions must be positive")
        return self


class ModifyBlockInput(BaseModel):
    conversation_id: str
    body_id: str
    position_m: tuple[float, float] | None = None
    size_m: tuple[float, float] | None = None
    body_type: Literal["dynamic", "static", "kinematic"] | None = None
    angle_rad: float | None = None
    mass_kg: float | None = None
    velocity_m_s: tuple[float, float] | None = None
    friction: float | None = None
    restitution: float | None = None
    density_kg_m3: float | None = None
    notes: str | None = None


class RemoveBlockInput(BaseModel):
    conversation_id: str
    body_id: str


class CreatePulleyInput(BaseModel):
    conversation_id: str
    pulley_id: str | None = None
    center_m: tuple[float, float]
    radius_m: float = Field(gt=0.0)
    axle_radius_m: float | None = Field(default=None, description="Optional visual axle radius")
    axle_body_id: str | None = None
    notes: str | None = None


class CreateRopeInput(BaseModel):
    conversation_id: str
    constraint_id: str | None = None
    body_a: str
    body_b: str
    anchor_a_m: Optional[tuple[float, float]] = Field(default=None, description="Anchor offset on body A")
    anchor_b_m: Optional[tuple[float, float]] = Field(default=None, description="Anchor offset on body B")
    length_m: float | None = Field(default=None, ge=0.0)
    stiffness: float | None = Field(default=None, ge=0.0)
    damping: float | None = Field(default=None, ge=0.0)
    notes: str | None = None


class SetWorldInput(BaseModel):
    conversation_id: str
    gravity_m_s2: float
    time_step_s: float


class SetMappingInput(BaseModel):
    conversation_id: str
    origin_px: tuple[float, float]
    scale_m_per_px: float = Field(gt=0.0)


# ---------------------------------------------------------------------------
# Tool implementations
# ---------------------------------------------------------------------------


async def create_block(input_data: CreateBlockInput) -> SceneEditOutput:
    context = _get_context(input_data.conversation_id)
    _ensure_scene_initialized(context)

    body_id = input_data.body_id or f"block_{len(context.scene_state.get('bodies', {})) + 1}"
    material = _material_dict(
        friction=input_data.friction,
        restitution=input_data.restitution,
        density=input_data.density_kg_m3,
    )

    position_adjusted, size_adjusted, adjustments = _clamp_block_to_image_bounds(
        context,
        tuple(input_data.position_m),
        tuple(input_data.size_m),
    )

    body: dict[str, Any] = {
        "id": body_id,
        "type": input_data.body_type,
        "position_m": position_adjusted,
        "collider": {
            "type": "rectangle",
            "width_m": size_adjusted[0],
            "height_m": size_adjusted[1],
        },
        "notes": input_data.notes,
    }
    if input_data.velocity_m_s is not None:
        body["velocity_m_s"] = list(input_data.velocity_m_s)

    if input_data.mass_kg is not None:
        body["mass_kg"] = input_data.mass_kg
    if input_data.angle_rad is not None:
        body["angle_rad"] = input_data.angle_rad
    if material:
        body["material"] = material

    if adjustments:
        body.setdefault("meta", {})["image_boundary_adjustments"] = adjustments

    context.apply_scene_updates(bodies={body_id: body})
    scene = _snapshot_after_update(context, note=f"create_block:{body_id}")
    logger.info("[scene_editor] Created block %s", body_id)
    message = f"Block '{body_id}' created"
    if adjustments:
        message += f" (clamped: {', '.join(adjustments)})"
    return SceneEditOutput(
        scene=scene,
        message=message,
        updated_body_ids=[body_id],
    )


async def modify_block(input_data: ModifyBlockInput) -> SceneEditOutput:
    context = _get_context(input_data.conversation_id)
    _ensure_scene_initialized(context)

    bodies = context.scene_state.setdefault("bodies", {})
    if input_data.body_id not in bodies:
        raise ValueError(f"Body '{input_data.body_id}' not found")

    body = bodies[input_data.body_id]

    if input_data.position_m is not None:
        body["position_m"] = list(input_data.position_m)
    if input_data.size_m is not None:
        width, height = input_data.size_m
        if width <= 0 or height <= 0:
            raise ValueError("size_m must be positive")
        body.setdefault("collider", {})
        body["collider"].update({
            "type": "rectangle",
            "width_m": width,
            "height_m": height,
        })
    if input_data.body_type is not None:
        body["type"] = input_data.body_type
    if input_data.angle_rad is not None:
        body["angle_rad"] = input_data.angle_rad
    if input_data.velocity_m_s is not None:
        body["velocity_m_s"] = list(input_data.velocity_m_s)
    if input_data.mass_kg is not None:
        body["mass_kg"] = input_data.mass_kg
    if input_data.notes is not None:
        body["notes"] = input_data.notes

    material = body.setdefault("material", {})
    if input_data.friction is not None:
        material["friction"] = input_data.friction
    if input_data.restitution is not None:
        material["restitution"] = input_data.restitution
    if input_data.density_kg_m3 is not None:
        material["density_kg_m3"] = input_data.density_kg_m3
    if not material:
        body.pop("material", None)

    adjustments: list[str] = []
    collider = body.get("collider", {})
    if collider.get("type") == "rectangle":
        position_tuple = tuple(body.get("position_m", (0.0, 0.0)))  # type: ignore[arg-type]
        size_tuple = (
            float(collider.get("width_m") or 0.0),
            float(collider.get("height_m") or 0.0),
        )
        position_adjusted, size_adjusted, adjustments = _clamp_block_to_image_bounds(
            context,
            (float(position_tuple[0]), float(position_tuple[1])),
            size_tuple,
        )
        body["position_m"] = position_adjusted
        collider["width_m"], collider["height_m"] = size_adjusted

    if adjustments:
        body.setdefault("meta", {})["image_boundary_adjustments"] = adjustments
    elif isinstance(body.get("meta"), dict):
        body["meta"].pop("image_boundary_adjustments", None)  # type: ignore[index]

    context.apply_scene_updates(bodies={input_data.body_id: body})
    scene = _snapshot_after_update(context, note=f"modify_block:{input_data.body_id}")
    logger.info("[scene_editor] Modified block %s", input_data.body_id)
    message = f"Block '{input_data.body_id}' updated"
    if adjustments:
        message += f" (clamped: {', '.join(adjustments)})"
    return SceneEditOutput(
        scene=scene,
        message=message,
        updated_body_ids=[input_data.body_id],
    )


async def remove_block(input_data: RemoveBlockInput) -> SceneEditOutput:
    context = _get_context(input_data.conversation_id)
    _ensure_scene_initialized(context)

    context.remove_scene_entities(body_ids=[input_data.body_id])
    scene = _snapshot_after_update(context, note=f"remove_block:{input_data.body_id}")
    logger.info("[scene_editor] Removed block %s", input_data.body_id)
    return SceneEditOutput(
        scene=scene,
        message=f"Block '{input_data.body_id}' removed",
        updated_body_ids=[input_data.body_id],
    )


async def create_pulley(input_data: CreatePulleyInput) -> SceneEditOutput:
    context = _get_context(input_data.conversation_id)
    _ensure_scene_initialized(context)

    pulley_id = input_data.pulley_id or f"pulley_{len(context.scene_state.get('bodies', {})) + 1}"
    bodies = context.scene_state.setdefault("bodies", {})

    pulley_body = {
        "id": pulley_id,
        "type": "static",
        "position_m": list(input_data.center_m),
        "velocity_m_s": [0.0, 0.0],
        "collider": {
            "type": "circle",
            "radius_m": input_data.radius_m,
        },
        "notes": input_data.notes or "pulley",
        "meta": {"category": "pulley"},
    }

    updates: dict[str, dict[str, Any]] = {pulley_id: pulley_body}
    axle_id = None
    if input_data.axle_radius_m:
        axle_id = input_data.axle_body_id or f"{pulley_id}_axle"
        axle_body = {
            "id": axle_id,
            "type": "static",
            "position_m": list(input_data.center_m),
            "velocity_m_s": [0.0, 0.0],
            "collider": {
                "type": "circle",
                "radius_m": max(0.01, input_data.axle_radius_m),
            },
            "notes": "axle",
            "meta": {"category": "axle", "parent": pulley_id},
        }
        updates[axle_id] = axle_body

    context.apply_scene_updates(bodies=updates)
    scene = _snapshot_after_update(context, note=f"create_pulley:{pulley_id}")
    logger.info("[scene_editor] Created pulley %s", pulley_id)
    updated_ids = [pulley_id] + ([axle_id] if axle_id else [])
    return SceneEditOutput(
        scene=scene,
        message=f"Pulley '{pulley_id}' created",
        updated_body_ids=updated_ids,
    )


async def create_rope(input_data: CreateRopeInput) -> SceneEditOutput:
    context = _get_context(input_data.conversation_id)
    _ensure_scene_initialized(context)

    constraint_id = input_data.constraint_id or f"rope_{len(context.scene_state.get('constraints', {})) + 1}"
    constraint = {
        "id": constraint_id,
        "type": "rope",
        "body_a": input_data.body_a,
        "body_b": input_data.body_b,
        "notes": input_data.notes,
    }
    if input_data.anchor_a_m is not None:
        constraint["anchor_a"] = list(input_data.anchor_a_m)
    if input_data.anchor_b_m is not None:
        constraint["anchor_b"] = list(input_data.anchor_b_m)
    if input_data.length_m is not None:
        constraint["rope_length_m"] = input_data.length_m
    if input_data.stiffness is not None:
        constraint.setdefault("tuning", {})["stiffness"] = input_data.stiffness
    if input_data.damping is not None:
        constraint.setdefault("tuning", {})["damping"] = input_data.damping

    context.apply_scene_updates(constraints={constraint_id: constraint})
    scene = _snapshot_after_update(context, note=f"create_rope:{constraint_id}")
    logger.info("[scene_editor] Created rope constraint %s", constraint_id)
    return SceneEditOutput(
        scene=scene,
        message=f"Rope '{constraint_id}' created",
        updated_constraint_ids=[constraint_id],
    )


async def set_world(input_data: SetWorldInput) -> SceneEditOutput:
    context = _get_context(input_data.conversation_id)
    _ensure_scene_initialized(context)

    world = context.scene_state.setdefault("world", {})
    world.update({
        "gravity_m_s2": input_data.gravity_m_s2,
        "time_step_s": input_data.time_step_s,
    })

    context.scene_state["world"] = world
    scene = _snapshot_after_update(context, note="set_world")
    logger.info("[scene_editor] Updated world settings")
    return SceneEditOutput(
        scene=scene,
        message="World settings updated",
    )


async def set_mapping(input_data: SetMappingInput) -> SceneEditOutput:
    context = _get_context(input_data.conversation_id)
    _ensure_scene_initialized(context)

    mapping = {
        "origin_px": list(input_data.origin_px),
        "scale_m_per_px": input_data.scale_m_per_px,
    }
    context.scene_state["mapping"] = mapping
    context.mapping = mapping

    scene = _snapshot_after_update(context, note="set_mapping")
    logger.info("[scene_editor] Updated mapping settings")
    return SceneEditOutput(
        scene=scene,
        message="Mapping updated",
    )


# ---------------------------------------------------------------------------
# Tool registry for build_scene orchestrator
# ---------------------------------------------------------------------------


class SceneToolSpec(BaseModel):
    name: str
    description: str
    input_model: type[BaseModel]
    function: Any


SCENE_EDIT_TOOL_SPECS: list[SceneToolSpec] = [
    SceneToolSpec(
        name="create_block",
        description="Create a rectangular body. Use body_type='static' for surfaces.",
        input_model=CreateBlockInput,
        function=create_block,
    ),
    SceneToolSpec(
        name="modify_block",
        description="Update block position, size, material, or type for an existing body.",
        input_model=ModifyBlockInput,
        function=modify_block,
    ),
    SceneToolSpec(
        name="remove_block",
        description="Delete a block body from the scene by id.",
        input_model=RemoveBlockInput,
        function=remove_block,
    ),
    SceneToolSpec(
        name="create_pulley",
        description="Create a pulley body (and optional axle) at the given position with radius in meters.",
        input_model=CreatePulleyInput,
        function=create_pulley,
    ),
    SceneToolSpec(
        name="create_rope",
        description="Add a rope constraint between two bodies with optional anchors and length.",
        input_model=CreateRopeInput,
        function=create_rope,
    ),
    SceneToolSpec(
        name="set_world",
        description="Configure gravity and time step for the scene.",
        input_model=SetWorldInput,
        function=set_world,
    ),
    SceneToolSpec(
        name="set_mapping",
        description="Set pixel-to-meter mapping using origin_px and scale_m_per_px.",
        input_model=SetMappingInput,
        function=set_mapping,
    ),
]


SCENE_EDIT_TOOL_MAP: dict[str, SceneToolSpec] = {spec.name: spec for spec in SCENE_EDIT_TOOL_SPECS}