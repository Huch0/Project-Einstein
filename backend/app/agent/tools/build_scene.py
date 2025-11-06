"""
Tool 4: build_physics_scene - Agent-Based Scene Construction (v0.5)

Uses a reasoning-capable model to author a complete physics scene directly from the uploaded diagram.
"""

from __future__ import annotations

import base64
import io
import math
import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, get_args, get_origin

from openai import AsyncOpenAI
from pydantic import BaseModel, Field

from app.agent.agent_context import get_context_store
from app.agent.tools.scene_editor import SCENE_EDIT_TOOL_MAP, SCENE_EDIT_TOOL_SPECS
from app.logging_utils import get_logger, ensure_scene_log_dir
from app.models.settings import settings
from app.routers.diagram import get_uploaded_image_bytes

try:  # Pillow is optional during testing environments
    from PIL import Image, ImageDraw
except ImportError:  # pragma: no cover - diagnostics fallback only
    Image = None  # type: ignore[assignment]
    ImageDraw = None  # type: ignore[assignment]

logger = get_logger("agent_scene_builder")


class BuildSceneInput(BaseModel):
    """Input schema for iterative scene construction."""

    conversation_id: str = Field(
        description="Conversation identifier retaining scene state"
    )
    image_id: str = Field(description="Identifier for the uploaded diagram image")
    image: dict[str, Any] = Field(
        description="Image metadata (width_px, height_px, etc.)"
    )
    options: dict[str, Any] = Field(
        default_factory=dict, description="Builder configuration overrides"
    )
    segments: list[dict[str, Any]] = Field(
        default_factory=list, description="Optional segmentation outputs"
    )
    entities: list[dict[str, Any]] = Field(
        default_factory=list, description="Optional labeled entities"
    )


BODY_FILL_COLORS = {
    "dynamic": (79, 70, 229, 120),
    "static": (156, 163, 175, 120),
    "kinematic": (16, 185, 129, 120),
    "default": (59, 130, 246, 120),
}

BODY_OUTLINE_COLOR = (255, 255, 255, 180)
CONSTRAINT_COLOR = (234, 179, 8, 220)
TEXT_COLOR = (255, 255, 255, 220)
DEFAULT_RENDER_SIZE = (1024, 768)


def _meters_to_pixels(
    value: tuple[float, float] | list[float],
    origin_px: tuple[float, float],
    scale_m_per_px: float,
) -> tuple[float, float]:
    scale = scale_m_per_px or 0.01
    return (
        origin_px[0] + float(value[0]) / scale,
        origin_px[1] - float(value[1]) / scale,
    )


def _rectangle_corners(
    center_px: tuple[float, float],
    width_px: float,
    height_px: float,
    angle_rad: float,
) -> list[tuple[float, float]]:
    half_w = width_px / 2.0
    half_h = height_px / 2.0
    cos_a = math.cos(angle_rad)
    sin_a = math.sin(angle_rad)
    corners = []
    for dx, dy in [
        (-half_w, -half_h),
        (half_w, -half_h),
        (half_w, half_h),
        (-half_w, half_h),
    ]:
        x = center_px[0] + dx * cos_a - dy * sin_a
        y = center_px[1] + dx * sin_a + dy * cos_a
        corners.append((x, y))
    return corners


def _draw_body(
    draw,
    body: dict[str, Any],
    *,
    origin_px: tuple[float, float],
    scale_m_per_px: float,
) -> tuple[float, float]:
    position = body.get("position_m") or (0.0, 0.0)
    center_px = _meters_to_pixels(position, origin_px, scale_m_per_px)
    collider = body.get("collider", {})
    collider_type = collider.get("type") or "rectangle"
    body_type = body.get("type", "default")
    fill = BODY_FILL_COLORS.get(body_type, BODY_FILL_COLORS["default"])

    if collider_type == "rectangle":
        width_m = float(collider.get("width_m") or 0.1)
        height_m = float(collider.get("height_m") or 0.1)
        width_px = max(width_m / (scale_m_per_px or 0.01), 2.0)
        height_px = max(height_m / (scale_m_per_px or 0.01), 2.0)
        angle_rad = float(body.get("angle_rad") or 0.0)
        corners = _rectangle_corners(center_px, width_px, height_px, angle_rad)
        draw.polygon(corners, fill=fill, outline=BODY_OUTLINE_COLOR)
    elif collider_type == "circle":
        radius_m = float(collider.get("radius_m") or 0.05)
        radius_px = max(radius_m / (scale_m_per_px or 0.01), 1.5)
        bbox = [
            center_px[0] - radius_px,
            center_px[1] - radius_px,
            center_px[0] + radius_px,
            center_px[1] + radius_px,
        ]
        draw.ellipse(bbox, fill=fill, outline=BODY_OUTLINE_COLOR)
    elif collider_type == "polygon":
        points = collider.get("points_m") or collider.get("polygon_m") or []
        if points:
            polygon_points = [
                _meters_to_pixels(point, origin_px, scale_m_per_px) for point in points
            ]
            draw.polygon(polygon_points, fill=fill, outline=BODY_OUTLINE_COLOR)

    body_id = body.get("id")
    if body_id:
        draw.text((center_px[0] + 4, center_px[1] + 4), str(body_id), fill=TEXT_COLOR)

    return center_px


def _draw_constraint(
    draw,
    constraint: dict[str, Any],
    *,
    body_positions_px: dict[str, tuple[float, float]],
    origin_px: tuple[float, float],
    scale_m_per_px: float,
) -> None:
    body_a = constraint.get("body_a")
    body_b = constraint.get("body_b")
    if not body_a or not body_b:
        return

    start = body_positions_px.get(body_a)
    end = body_positions_px.get(body_b)
    if not start or not end:
        return

    anchor_a = constraint.get("anchor_a_m")
    anchor_b = constraint.get("anchor_b_m")
    if anchor_a:
        offset_a = (
            float(anchor_a[0]) / (scale_m_per_px or 0.01),
            -float(anchor_a[1]) / (scale_m_per_px or 0.01),
        )
        start = (start[0] + offset_a[0], start[1] + offset_a[1])
    if anchor_b:
        offset_b = (
            float(anchor_b[0]) / (scale_m_per_px or 0.01),
            -float(anchor_b[1]) / (scale_m_per_px or 0.01),
        )
        end = (end[0] + offset_b[0], end[1] + offset_b[1])

    draw.line([start, end], fill=CONSTRAINT_COLOR, width=3)


def _render_scene_image(
    scene: dict[str, Any],
    image_meta: dict[str, Any],
    *,
    label: str,
    log_timestamp: str,
) -> tuple[Optional[bytes], Optional[Path]]:
    if Image is None or ImageDraw is None:
        return None, None

    width = int(image_meta.get("width_px") or DEFAULT_RENDER_SIZE[0])
    height = int(image_meta.get("height_px") or DEFAULT_RENDER_SIZE[1])
    canvas = Image.new("RGBA", (width, height), (15, 23, 42, 255))
    draw = ImageDraw.Draw(canvas, "RGBA")

    mapping = scene.get("mapping") or {}
    scale = float(mapping.get("scale_m_per_px") or 0.01)
    origin = mapping.get("origin_px") or (width / 2.0, height / 2.0)
    origin_px = (float(origin[0]), float(origin[1]))

    body_positions_px: dict[str, tuple[float, float]] = {}
    for body in scene.get("bodies", []):
        center = _draw_body(draw, body, origin_px=origin_px, scale_m_per_px=scale)
        body_id = body.get("id")
        if body_id:
            body_positions_px[str(body_id)] = center

    for constraint in scene.get("constraints", []):
        _draw_constraint(
            draw,
            constraint,
            body_positions_px=body_positions_px,
            origin_px=origin_px,
            scale_m_per_px=scale,
        )

    buffer = io.BytesIO()
    try:
        canvas.save(buffer, format="PNG")
    except Exception as exc:  # pragma: no cover - PIL save errors
        logger.warning("[build_scene] Failed to render scene image: %s", exc)
        return None, None

    image_bytes = buffer.getvalue()
    buffer.close()

    log_dir, _ = ensure_scene_log_dir()
    filename = f"{log_timestamp}_{label}.png"
    output_path = log_dir / filename
    try:
        output_path.write_bytes(image_bytes)
    except OSError as exc:  # pragma: no cover - filesystem issues
        logger.warning("[build_scene] Unable to persist render image: %s", exc)
        output_path = None

    return image_bytes, output_path


def _strip_optional(annotation: Any) -> Any:
    args = get_args(annotation)
    if not args:
        return annotation
    non_none = [arg for arg in args if arg is not type(None)]
    if len(non_none) == 1 and len(non_none) != len(args):
        return non_none[0]
    return annotation


def _primitive_schema(annotation: Any) -> dict[str, Any]:
    annotation = _strip_optional(annotation)
    mapping = {
        float: "number",
        int: "number",
        str: "string",
        bool: "boolean",
    }
    if annotation in mapping:
        return {"type": mapping[annotation]}
    return {"type": "string"}


def _infer_array_items(annotation: Any) -> dict[str, Any]:
    annotation = _strip_optional(annotation)
    origin = get_origin(annotation)
    if origin in (list, List):
        args = [arg for arg in get_args(annotation) if arg is not Ellipsis]
        if args:
            return _primitive_schema(args[0])
        return {"type": "string"}
    if origin in (tuple, Tuple):
        args = [arg for arg in get_args(annotation) if arg is not Ellipsis]
        if not args:
            return {"type": "string"}
        if all(arg == args[0] for arg in args[1:]):
            return _primitive_schema(args[0])
        return {"anyOf": [_primitive_schema(arg) for arg in args]}
    return {"type": "string"}


def _normalize_tool_schema(schema: dict[str, Any], spec: Any) -> dict[str, Any]:
    properties = schema.get("properties", {})
    fields = getattr(spec.input_model, "model_fields", {})

    for name, prop_schema in properties.items():
        if not isinstance(prop_schema, dict):
            continue
        field_info = fields.get(name)
        annotation = field_info.annotation if field_info else Any

        def _apply_array_fixes(node: dict[str, Any]) -> None:
            if node.get("type") == "array":
                if "items" not in node:
                    node["items"] = _infer_array_items(annotation)
                node.pop("prefixItems", None)
            elif "prefixItems" in node and "items" not in node:
                node["items"] = {"anyOf": node["prefixItems"] or [{"type": "string"}]}
                node.pop("prefixItems", None)

        _apply_array_fixes(prop_schema)

        if "anyOf" in prop_schema and isinstance(prop_schema["anyOf"], list):
            for entry in prop_schema["anyOf"]:
                if isinstance(entry, dict):
                    _apply_array_fixes(entry)

    return schema


# output=[
#     ResponseReasoningItem(
#         id="rs_0c9df890f325f51800690ca0d4e7a48193ac8059014ab3da94",
#         summary=[],
#         type="reasoning",
#         content=None,
#         encrypted_content=None,
#         status=None,
#     ),
#     ResponseFunctionToolCall(
#         arguments='{"conversation_id":"scene1","gravity_m_s2":-9.81,"time_step_s":0.016}',
#         call_id="call_bJZrY1IRyv371AiyJc3SImZ5",
#         name="set_world",
#         type="function_call",
#         id="fc_0c9df890f325f51800690ca1234e508193951eaaaa5b2751e7",
#         status="completed",
#     ),
# ],
def _extract_tool_calls(response: Any) -> list[Any]:
    tool_calls: list[Any] = []
    direct_calls = getattr(response, "function_calls", None)
    if direct_calls:
        tool_calls.extend(list(direct_calls))

    output_items = getattr(response, "output", None)
    if output_items:
        for item in output_items:
            item_type = getattr(item, "type", None) or getattr(item, "kind", None)
            if item_type is None and isinstance(item, dict):
                item_type = item.get("type") or item.get("kind")
            if item_type == "function_call":
                tool_calls.append(item)

    return tool_calls


class BuildSceneOutput(BaseModel):
    scene: dict[str, Any]
    warnings: list[str] = Field(default_factory=list)
    meta: dict[str, Any] = Field(default_factory=dict)
    detections: list[dict[str, Any]] = Field(default_factory=list)


MAX_TOOL_ITERATIONS_DEFAULT = 12


def _tool_definitions() -> list[dict[str, Any]]:
    tool_defs: list[dict[str, Any]] = []
    for spec in SCENE_EDIT_TOOL_SPECS:
        schema = spec.input_model.model_json_schema()
        schema = _normalize_tool_schema(schema, spec)
        tool_defs.append(
            {
                "type": "function",
                "name": spec.name,
                "description": spec.description,
                "parameters": {
                    "type": "object",
                    "properties": schema.get("properties", {}),
                    "required": schema.get("required", []),
                },
            }
        )
    return tool_defs


def _system_prompt() -> str:
    return (
        "You are an iterative physics scene architect tasked with matching the uploaded diagram. "
        "Use the available scene editing tools to add, adjust, and remove elements. "
        "After each tool call you will receive an updated scene snapshot (including a data URL for the render). "
        "Continue refining until the scene accurately reflects the diagram, then respond with a concise summary "
        "and any remaining mismatches or warnings."
    )


def _initial_mapping(
    image_meta: dict[str, Any], options: dict[str, Any]
) -> dict[str, Any]:
    mapping_options = options.get("mapping") or {}
    default_scale = float(
        mapping_options.get("scale_m_per_px") or options.get("scale_m_per_px") or 0.01
    )
    width = float(image_meta.get("width_px") or 800)
    height = float(image_meta.get("height_px") or 600)
    origin = mapping_options.get("origin_px")
    if isinstance(origin, (list, tuple)) and len(origin) >= 2:
        origin_px = [float(origin[0]), float(origin[1])]
    else:
        origin_px = [width / 2.0, height / 2.0]
    return {
        "origin_px": origin_px,
        "scale_m_per_px": default_scale,
    }


def _initial_world(options: dict[str, Any]) -> dict[str, Any]:
    world = options.get("world") or {}
    gravity = float(world.get("gravity_m_s2") or options.get("gravity_m_s2") or 9.81)
    time_step = float(world.get("time_step_s") or options.get("time_step_s") or 0.016)
    return {
        "gravity_m_s2": gravity,
        "time_step_s": time_step,
    }


async def build_physics_scene(input_data: BuildSceneInput) -> BuildSceneOutput:
    if not settings.OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is not configured")

    context_store = get_context_store()
    context = context_store.get_context(input_data.conversation_id)
    if not context:
        raise RuntimeError(f"Conversation {input_data.conversation_id} not found")

    mapping = _initial_mapping(input_data.image, input_data.options)
    world = _initial_world(input_data.options)
    context.reset_scene_state(world=world, mapping=mapping)
    context.update_pipeline_state(
        image_id=input_data.image_id,
        image_metadata=input_data.image,
        mapping=mapping,
        scene=None,
        detections=[],
        entities=[],
        entity_summary={},
    )
    context_store.update_context(context)

    try:
        image_bytes = get_uploaded_image_bytes(input_data.image_id)
    except ValueError as exc:
        raise RuntimeError(str(exc)) from exc

    diagram_b64 = base64.b64encode(image_bytes).decode("utf-8")

    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    tool_defs = _tool_definitions()
    transcript_segments: List[Dict] = []
    transcript_segments.append(
        {
            "role": "system",
            "content": [{"type": "input_text", "text": _system_prompt()}],
        }
    )

    logger.info(
        "[build_scene] Starting iterative scene build (conversation_id=%s, image_id=%s)",
        input_data.conversation_id,
        input_data.image_id,
    )
    # image_data = {
    #     "image_id": input_data.image_id,
    #     "image_metadata": input_data.image,
    #     "diagram_data_url": f"data:image/png;base64,{diagram_b64}",
    #     "goal": (
    #         "Replicate the diagram using the editing tools. Use create_block for masses or surfaces, "
    #         "create_pulley for wheels, and create_rope to connect bodies. Call set_mapping or set_world if "
    #         "scale or gravity need adjustments."
    #     ),
    # }.dump()

    initial_payload = {
        "role": "user",
        "content": [
            {
                "type": "input_text",
                "text": "Replicate the diagram using the editing tools. Use create_block for masses or surfaces, create_pulley for wheels, and create_rope to connect bodies. Call set_mapping or set_world if scale or gravity need adjustments. Here is the diagram to replicate:",
            },
            {"type": "input_image", "image_url": f"data:image/png;base64,{diagram_b64}"},
        ],
    }

    transcript_segments.append(initial_payload)

    max_iterations = int(
        input_data.options.get("max_tool_iterations", MAX_TOOL_ITERATIONS_DEFAULT)
    )
    temperature = float(input_data.options.get("temperature", 0.2))

    tool_records: list[dict[str, Any]] = []
    final_summary = ""
    scene_log_timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    final_render_bytes: Optional[bytes] = None
    final_render_path: Optional[Path] = None

    for iteration in range(max_iterations):
        logger.info(
            "[build_scene] Iteration %s prompt length=%s chars",
            iteration + 1,
            len(transcript_segments),
        )
        # logger.debug(f"full prompt: {transcript_segments}")
        response = await client.responses.create(
            model=settings.INIT_SIM_SCENE_MODEL or settings.LABELER_MODEL,
            input=transcript_segments,
            tools=tool_defs,
            reasoning={"effort": "medium"},
            text={"verbosity": "medium"},
        )

        assistant_text = getattr(response, "output_text", "") or ""
        tool_calls = _extract_tool_calls(response)

        logger.info(
            "[build_scene] Iteration %s response tool_calls=%s assistant_preview=%s",
            iteration + 1,
            len(tool_calls),
            assistant_text[:200].replace("\n", " ").strip() if assistant_text else "",
        )

        logger.debug(f"raw response: {response}")

        if tool_calls:
            for tool_call in tool_calls:
                tool_name = getattr(tool_call, "name", None) or (
                    tool_call.get("name") if isinstance(tool_call, dict) else None
                )
                raw_arguments = (
                    getattr(tool_call, "arguments", "")
                    or (
                        tool_call.get("arguments")
                        if isinstance(tool_call, dict)
                        else ""
                    )
                ) or "{}"
                try:
                    arguments = (
                        json.loads(raw_arguments)
                        if isinstance(raw_arguments, str)
                        else raw_arguments
                    )
                except json.JSONDecodeError as exc:
                    raise RuntimeError(
                        f"Tool call arguments invalid JSON: {raw_arguments}"
                    ) from exc

                arguments["conversation_id"] = input_data.conversation_id
                logger.debug(f"aruguments for tool {tool_name}: {arguments}")

                spec = SCENE_EDIT_TOOL_MAP.get(tool_name)
                if not spec:
                    raise RuntimeError(f"Unsupported tool '{tool_name}'")

                try:
                    tool_input = spec.input_model.model_validate(arguments)
                    tool_output = await spec.function(tool_input)
                    result_dict = tool_output.model_dump()
                except Exception as exc:
                    error_msg = f"Tool {tool_name} failed: {exc}"
                    transcript_segments.append(
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "input_text",
                                    "text": f"TOOL_ERROR:{tool_name}\n{error_msg}",
                                }
                            ],
                        }
                    )
                    logger.warning("[build_scene] %s", error_msg)
                    context.add_tool_call(
                        tool_name=tool_name or "unknown",
                        arguments=arguments,
                        result=None,
                        error=str(exc),
                    )
                    tool_records.append(
                        {
                            "tool": tool_name,
                            "arguments": arguments,
                            "error": str(exc),
                        }
                    )
                    continue

                current_scene = result_dict.get("scene") or context.scene_snapshot()
                render_bytes, render_path = _render_scene_image(
                    current_scene,
                    input_data.image,
                    label=f"iter-{iteration + 1}-{tool_name}",
                    log_timestamp=scene_log_timestamp,
                )
                if render_path:
                    context.last_scene_render_path = str(render_path)
                    result_dict["render_image_path"] = str(render_path)
                    final_render_path = render_path
                if render_bytes:
                    # TODO: check base64 encoding input
                    encoded = base64.b64encode(render_bytes).decode("utf-8")
                    final_render_bytes = render_bytes

                transcript_segments.append(
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "input_text",
                                "text": f"ASSISTANT_TOOL_CALL:{tool_name}\n{json.dumps(arguments)}",
                            },
                            {
                                "type": "input_text",
                                "text": f"TOOL_RESULT:{tool_name}\n{json.dumps(result_dict)}",
                            },
                            {
                                "type": "input_image",
                                "image_url": f"data:image/png;base64,{encoded}",
                            }
                        ],
                    }
                )

                tool_records.append(
                    {
                        "tool": tool_name,
                        "arguments": arguments,
                        "result": {
                            "message": result_dict.get("message"),
                            "updated_body_ids": result_dict.get("updated_body_ids"),
                            "updated_constraint_ids": result_dict.get(
                                "updated_constraint_ids"
                            ),
                            "render_image_path": result_dict.get("render_image_path"),
                        },
                    }
                )
                context.add_tool_call(
                    tool_name=tool_name or "unknown",
                    arguments=arguments,
                    result=result_dict,
                )
                context_store.update_context(context)

            continue

        if assistant_text.strip():
            final_summary = assistant_text.strip()
            transcript_segments.append(
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": f"ASSISTANT_FINAL_SUMMARY\n{final_summary}",
                        }
                    ],
                }
            )
            break
        logger.warning(
            "[build_scene] Iteration %s produced neither tool calls nor assistant text",
            iteration + 1,
        )
    else:
        final_summary = (
            final_summary or "Iteration limit reached; returning best scene."
        )

    final_scene = context.scene_snapshot()
    render_bytes, render_path = _render_scene_image(
        final_scene,
        input_data.image,
        label="final",
        log_timestamp=scene_log_timestamp,
    )
    if render_bytes:
        final_render_bytes = render_bytes
    if render_path:
        final_render_path = render_path
        context.last_scene_render_path = str(render_path)

    meta = {
        "builder": "agent_iterative_v1",
        "body_count": len(final_scene.get("bodies", [])),
        "constraint_count": len(final_scene.get("constraints", [])),
        "tool_iterations": len(tool_records),
        "tool_records": tool_records,
        "scene_log_timestamp": scene_log_timestamp,
        "assistant_summary": final_summary,
        "transcript_segments": transcript_segments,
    }
    if final_render_path:
        meta["render_image_path"] = str(final_render_path)
    if final_render_bytes:
        meta["render_image_base64"] = base64.b64encode(final_render_bytes).decode(
            "utf-8"
        )

    warnings: list[str] = []
    if not tool_records:
        warnings.append(
            "Builder completed without invoking scene editing tools; verify prompts and tool availability."
        )
    context.update_pipeline_state(scene=final_scene, mapping=context.mapping)
    context_store.update_context(context)

    logger.info(
        "[build_scene] Completed scene (bodies=%s, constraints=%s, tool_iterations=%s)",
        meta["body_count"],
        meta["constraint_count"],
        meta["tool_iterations"],
    )

    return BuildSceneOutput(
        scene=final_scene,
        warnings=warnings,
        meta=meta,
        detections=[],
    )
