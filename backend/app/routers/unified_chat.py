"""
Unified Chat Router (v0.4)

Supports two modes:
- Tutor Mode: Scaffolded conversation with GPT (educational guidance)
- Agent Mode: Tool-enabled simulation pipeline orchestration

Features:
- Server-Sent Events (SSE) streaming for real-time progress
- Conversation context management
- Tool execution with progress updates
"""

from __future__ import annotations

import json
import asyncio
import traceback
import base64
import io
import logging
from copy import deepcopy
from pathlib import Path
from time import perf_counter
from typing import Any, AsyncGenerator, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, status, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
import openai
from PIL import Image

from app.models.settings import settings
from app.agent.tool_registry import get_registry
from app.agent.agent_context import ConversationContext, get_context_store
from app.agent.prompts import get_agent_system_prompt, get_tutor_system_prompt
from app.chat.repository import ChatRepository
from app.chat.schemas import ConversationState
from app.agent.tools.scene_editor import SCENE_EDIT_TOOL_SPECS
from app.logging_utils import get_logger, format_for_log


router = APIRouter(prefix="/chat", tags=["chat"])
logger = logging.getLogger("unified_chat")


# ===========================
# Pydantic Schemas
# ===========================

class ChatRequest(BaseModel):
    """Unified chat request for Tutor/Agent modes."""
    
    message: str = Field(
        description="User message"
    )
    conversation_id: str | None = Field(
        default=None,
        description="Conversation ID (optional for first message)"
    )
    mode: Literal["tutor", "agent"] = Field(
        default="tutor",
        description="Chat mode: 'tutor' for scaffolded conversation, 'agent' for tool-enabled"
    )
    attachments: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Attachments (images, files) for Agent mode"
    )
    context: dict[str, Any] | None = Field(
        default=None,
        description="Additional context (simulation box metadata, etc.)"
    )
    stream: bool = Field(
        default=False,
        description="Enable Server-Sent Events streaming"
    )


class ChatResponse(BaseModel):
    """Chat response (non-streaming)."""
    
    message: str = Field(
        description="Assistant's response"
    )
    conversation_id: str = Field(
        description="Conversation ID"
    )
    mode: Literal["tutor", "agent"] = Field(
        description="Mode used for this response"
    )
    tool_calls: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Tool calls made (Agent mode only)"
    )
    state: dict[str, Any] = Field(
        default_factory=dict,
        description="Pipeline state snapshot (Agent mode only)"
    )


# ===========================
# Repository Initialization
# ===========================

_chat_repository = ChatRepository()


SCENE_EDIT_TOOL_NAMES = [spec.name for spec in SCENE_EDIT_TOOL_SPECS]
SCENE_EDIT_TOOL_NAMESET = set(SCENE_EDIT_TOOL_NAMES)
SCENE_EDIT_TOOL_LIST = ", ".join(SCENE_EDIT_TOOL_NAMES)

TOOL_LOGGER = get_logger("agent.tools")

ACTION_KEYWORDS = [
    "apply",
    "change",
    "changes",
    "update",
    "adjust",
    "modify",
    "tweak",
    "set",
    "configure",
    "increase",
    "decrease",
    "tune",
    "override",
    "적용",
    "변경",
    "수정",
    "바꿔",
    "조정",
    "설정",
    "맞춰",
]


def _requires_simulation_action(text: str | None) -> bool:
    if not text:
        return False
    lowered = text.lower()
    for keyword in ACTION_KEYWORDS:
        if keyword in lowered or keyword in text:
            return True
    return False

MAX_IMAGE_EDGE_PX = 1400


# ===========================
# Helper Functions
# ===========================


def _response_item_type(item: Any) -> str | None:
    if item is None:
        return None
    if isinstance(item, dict):
        return item.get("type")
    return getattr(item, "type", None)


def _response_attr(item: Any, attr: str, default: Any = None) -> Any:
    if item is None:
        return default
    if isinstance(item, dict):
        return item.get(attr, default)
    return getattr(item, attr, default)


def _extract_responses_text(response: Any) -> str:
    """Return concatenated assistant text from a Responses API result."""
    if response is None:
        return ""

    texts: list[str] = []
    output_items = getattr(response, "output", None)
    if isinstance(output_items, list):
        for item in output_items:
            item_type = _response_item_type(item)
            if item_type == "text":
                text_value = _response_attr(item, "text", "")
                if text_value:
                    texts.append(text_value)
            elif item_type == "message":
                contents = _response_attr(item, "content", []) or []
                for content in contents:
                    content_type = _response_item_type(content)
                    if content_type in {"text", "output_text"}:
                        text_value = _response_attr(content, "text", "")
                        if text_value:
                            texts.append(text_value)
        if texts:
            return "".join(texts)

    output_text = getattr(response, "output_text", None)
    if isinstance(output_text, str):
        return output_text
    return ""


def _summarize_tool_outcomes(tool_calls_made: list[dict[str, Any]]) -> str:
    if not tool_calls_made:
        return ""
    snippets: list[str] = []
    for call in tool_calls_made:
        name = call.get("name", "tool")
        if call.get("error"):
            snippets.append(f"{name} failed: {call['error']}")
        elif call.get("result"):
            snippets.append(f"{name} completed")
        else:
            snippets.append(f"{name} finished")
    limited = snippets[:4]
    if len(snippets) > 4:
        limited.append(f"… +{len(snippets) - 4} more")
    return "; ".join(limited)


def _compose_final_message(
    candidate_text: str | None,
    assistant_text: str | None,
    tool_calls_made: list[dict[str, Any]]
) -> str:
    for text in (candidate_text, assistant_text):
        if text and text.strip():
            return text.strip()

    summary = _summarize_tool_outcomes(tool_calls_made)
    if summary:
        return (
            f"I finished running the requested tools ({summary}). "
            "Let me know if you'd like me to adjust anything else."
        )

    return (
        "I'm ready to help with the scene edits, but I wasn't able to produce a "
        "detailed summary. Please let me know what you'd like me to adjust next."
    )


def _normalize_message_text(value: Any) -> str | None:
    """Convert arbitrary OpenAI payloads into trimmed text."""
    if value is None:
        return None
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    if isinstance(value, (list, tuple)):
        parts = [part for part in value if isinstance(part, str)]
        if not parts:
            return None
        joined = "".join(parts).strip()
        return joined or None
    text = str(value).strip()
    return text or None


def _ensure_final_message_text(
    candidate: Any,
    assistant_text: Any,
    tool_calls_made: list[dict[str, Any]]
) -> str:
    """Guarantee the assistant reply is never blank."""
    normalized_candidate = _normalize_message_text(candidate)
    normalized_assistant = _normalize_message_text(assistant_text)
    if not normalized_candidate and not normalized_assistant:
        summary = _summarize_tool_outcomes(tool_calls_made)
        logger.warning(
            "[Agent] Final message fallback triggered (tools=%d summary=%s)",
            len(tool_calls_made),
            summary or "none",
        )
    return _compose_final_message(
        normalized_candidate,
        normalized_assistant,
        tool_calls_made,
    )


def _hydrate_context_from_attached_boxes(
    context: ConversationContext,
    context_store,
    context_data: dict[str, Any] | None,
) -> str | None:
    """Copy scene state from an attached simulation box into this context."""
    if not context_data or (context.scene or context.scene_state):
        return None

    candidates: list[dict[str, Any]] = []
    sim_box = context_data.get("simulation_box")
    if isinstance(sim_box, dict):
        candidates.append(sim_box)

    boxes = context_data.get("boxes")
    if isinstance(boxes, list):
        for box in boxes:
            if isinstance(box, dict) and box not in candidates:
                candidates.append(box)

    for box in candidates:
        if box.get("type") != "simulation":
            continue
        source_conversation = box.get("conversationId")
        if not source_conversation or source_conversation == context.conversation_id:
            continue

        source_context = context_store.get_context(source_conversation)
        if not source_context:
            logger.warning(
                "[AgentContext] Attached simulation box references missing context %s",
                source_conversation,
            )
            continue

        snapshot = deepcopy(source_context.scene) if source_context.scene else None
        if snapshot is None and source_context.scene_state:
            state = source_context.scene_state
            bodies = state.get("bodies")
            constraints = state.get("constraints")
            snapshot = {
                "version": "0.6-iterative",
                "world": deepcopy(state.get("world", {})),
                "bodies": list(deepcopy(bodies).values()) if isinstance(bodies, dict) else deepcopy(bodies),
                "constraints": list(deepcopy(constraints).values()) if isinstance(constraints, dict) else deepcopy(constraints),
                "mapping": deepcopy(state.get("mapping")),
            }

        context.image_id = source_context.image_id
        context.image_metadata = deepcopy(source_context.image_metadata)
        context.mapping = deepcopy(source_context.mapping)
        context.segments = deepcopy(source_context.segments)
        context.entities = deepcopy(source_context.entities)
        context.frames = deepcopy(source_context.frames)
        context.scene_state = deepcopy(source_context.scene_state)
        context.scene = snapshot
        if not context.mapping and snapshot and isinstance(snapshot, dict):
            context.mapping = deepcopy(snapshot.get("mapping"))

        logger.info(
            "[AgentContext] Hydrated context %s from simulation conversation %s",
            context.conversation_id,
            source_conversation,
        )
        return source_conversation

    return None


def _log_context_debug(
    source: str,
    conversation_id: str,
    context: ConversationContext,
    context_data: dict[str, Any] | None,
):
    """Emit detailed diagnostics for context + attached boxes."""
    try:
        scene = context.scene or context.scene_state or {}
        body_count = 0
        constraint_count = 0
        if isinstance(scene, dict):
            bodies = scene.get("bodies")
            constraints = scene.get("constraints")
            if isinstance(bodies, list):
                body_count = len(bodies)
            elif isinstance(bodies, dict):
                body_count = len(bodies)
            if isinstance(constraints, list):
                constraint_count = len(constraints)
            elif isinstance(constraints, dict):
                constraint_count = len(constraints)

        logger.info(
            "[AgentContext][%s] convo=%s scene=%s bodies=%d constraints=%d entities=%d frames=%d messages=%d",
            source,
            conversation_id,
            bool(context.scene or context.scene_state),
            body_count,
            constraint_count,
            len(context.entities),
            len(context.frames),
            len(context.messages),
        )

        if context_data:
            sim_box = context_data.get("simulation_box")
            boxes = context_data.get("boxes") or []
            logger.info(
                "[AgentContext][%s] attached_context boxes=%d sim_box=%s sim_conversation=%s",
                source,
                len(boxes),
                sim_box.get("id") if isinstance(sim_box, dict) else None,
                sim_box.get("conversationId") if isinstance(sim_box, dict) else None,
            )
            if boxes:
                box_ids = [
                    (box.get("id"), box.get("conversationId"))
                    for box in boxes
                    if isinstance(box, dict)
                ]
                logger.info(
                    "[AgentContext][%s] box_map=%s",
                    source,
                    box_ids,
                )
            if (not context.scene and not context.scene_state) and sim_box:
                logger.warning(
                    "[AgentContext][%s] context missing scene while simulation box %s references conversation %s",
                    source,
                    sim_box.get("id"),
                    sim_box.get("conversationId"),
                )
    except Exception as exc:
        logger.warning("[AgentContext] context debug logging failed: %s", exc)

def _compress_image_bytes(image_bytes: bytes, mime_type: str) -> tuple[bytes, str]:
    """Resize/re-encode images when necessary while preserving diagram legibility."""
    try:
        with Image.open(io.BytesIO(image_bytes)) as img:
            max_edge = max(img.size or (1, 1))

            # Keep original bytes if already within limits
            if max_edge <= MAX_IMAGE_EDGE_PX:
                return image_bytes, mime_type

            # Downscale proportionally when oversized to keep context size manageable
            scale = MAX_IMAGE_EDGE_PX / max_edge
            new_size = (
                max(1, int(img.width * scale)),
                max(1, int(img.height * scale))
            )
            img = img.resize(new_size, Image.LANCZOS)

            # Preserve crisp text (use PNG whenever source had alpha or was PNG)
            original_format = (img.format or "PNG").upper()
            prefer_png = mime_type.endswith("png") or original_format == "PNG" or img.mode in ("RGBA", "LA")
            target_format = "PNG" if prefer_png else "JPEG"

            buffer = io.BytesIO()
            save_kwargs: dict[str, Any] = {"optimize": True}
            if target_format == "JPEG":
                img = img.convert("RGB")
                save_kwargs["quality"] = 88
            img.save(buffer, format=target_format, **save_kwargs)
            mime_type = f"image/{target_format.lower()}"
            return buffer.getvalue(), mime_type
    except Exception as exc:
        logger.warning(f"Image compression skipped: {exc}")
    return image_bytes, mime_type


def encode_image_to_base64(image_path: str) -> tuple[str, str] | None:
    """
    Encode image to base64 for OpenAI Vision API.
    
    Args:
        image_path: Path to image file or data URL
    
    Returns:
        Tuple of (base64_string, mime_type) or None if failed
    """
    try:
        mime_type = "image/png"

        # Handle data URLs (data:image/png;base64,...)
        if image_path.startswith("data:"):
            # Extract mime type and base64 data
            header, base64_data = image_path.split(",", 1)
            mime_type = header.split(":")[1].split(";")[0]
            image_bytes = base64.b64decode(base64_data)
            image_bytes, mime_type = _compress_image_bytes(image_bytes, mime_type)
            base64_data = base64.b64encode(image_bytes).decode("utf-8")
            return base64_data, mime_type
        
        # Handle file paths
        path = Path(image_path)
        if not path.exists():
            logger.warning(f"Image file not found: {image_path}")
            return None
        
        # Determine mime type from extension
        mime_types = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gif": "image/gif",
            ".webp": "image/webp"
        }
        mime_type = mime_types.get(path.suffix.lower(), "image/png")
        
        # Read and encode image
        with open(path, "rb") as image_file:
            image_bytes = image_file.read()
        image_bytes, mime_type = _compress_image_bytes(image_bytes, mime_type)
        base64_data = base64.b64encode(image_bytes).decode("utf-8")
        return base64_data, mime_type
    
    except Exception as e:
        logger.error(f"Failed to encode image: {e}")
        return None


def _collect_unique_image_contents(context_data: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Return deduplicated OpenAI image payloads from context boxes."""
    if not context_data:
        return []

    image_contents: list[dict[str, Any]] = []
    seen_paths: set[str] = set()

    def _maybe_add(image_path: str | None):
        if not image_path or image_path in seen_paths:
            return
        seen_paths.add(image_path)
        encoded = encode_image_to_base64(image_path)
        if not encoded:
            return
        base64_data, mime_type = encoded
        image_contents.append({
            "type": "image_url",
            "image_url": {
                "url": f"data:{mime_type};base64,{base64_data}"
            }
        })

    image_box = context_data.get("image_box")
    if isinstance(image_box, dict):
        _maybe_add(image_box.get("imagePath"))

    boxes = context_data.get("boxes")
    if isinstance(boxes, list):
        for box in boxes:
            if isinstance(box, dict) and box.get("type") == "image":
                _maybe_add(box.get("imagePath"))

    return image_contents


def _normalize_response_content_item(item: Any, role: str) -> dict[str, Any]:
    """Convert chat-style content items to Responses API format with role awareness."""
    text_type = "output_text" if role == "assistant" else "input_text"
    if isinstance(item, dict):
        item_type = item.get("type", "text")
        if item_type in {"text", "input_text"}:
            return {"type": text_type, "text": item.get("text", "")}
        if item_type in {"output_text", "refusal"} and role == "assistant":
            return {"type": item_type, "text": item.get("text", "")}
        if item_type in {"image_url", "input_image"}:
            image_payload = item.get("image_url") or item.get("image_url", {})
            if isinstance(image_payload, dict):
                url_value = image_payload.get("url") or image_payload.get("image_url")
            else:
                url_value = image_payload
            if isinstance(url_value, str) and url_value:
                return {"type": "input_image", "image_url": url_value}
            if isinstance(item.get("url"), str):
                return {"type": "input_image", "image_url": item["url"]}
    return {"type": text_type, "text": str(item)}


def _messages_to_responses_input(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert ChatCompletions-style messages into Responses API payloads."""
    converted: list[dict[str, Any]] = []
    for message in messages:
        role = message.get("role", "user")
        content = message.get("content")
        if isinstance(content, list):
            converted.append({
                "role": role,
                "content": [_normalize_response_content_item(item, role) for item in content]
            })
        elif isinstance(content, str):
            converted.append({
                "role": role,
                "content": [{"type": "output_text" if role == "assistant" else "input_text", "text": content}]
            })
        else:
            converted.append({
                "role": role,
                "content": [{"type": "output_text" if role == "assistant" else "input_text", "text": json.dumps(content)}]
            })
    return converted


def _flatten_messages_for_text(messages: list[dict[str, Any]]) -> str:
    """Create a text-only transcript (omits raw base64) for logging/prompts."""
    lines: list[str] = []
    for message in messages:
        role = message.get("role", "user")
        content = message.get("content")
        if isinstance(content, list):
            text_parts: list[str] = []
            image_count = 0
            for item in content:
                if isinstance(item, dict):
                    item_type = item.get("type")
                    if item_type in {"text", "input_text"}:
                        text_parts.append(item.get("text", ""))
                    elif item_type in {"image_url", "input_image"}:
                        image_count += 1
            if image_count:
                text_parts.append(f"[{image_count} image(s) attached]")
            text_value = " ".join(part for part in text_parts if part)
        elif isinstance(content, str):
            text_value = content
        elif content is None:
            text_value = ""
        else:
            text_value = json.dumps(content)
        lines.append(f"{role}: {text_value.strip()}")
    return "\n".join(lines)


def _scene_state_summary(context: ConversationContext) -> str:
    scene = context.scene or {}
    scene_state = context.scene_state or {}

    bodies: list[dict[str, Any]] = []
    if scene.get("bodies"):
        bodies = list(scene.get("bodies", []))
    else:
        body_map = scene_state.get("bodies")
        if isinstance(body_map, dict):
            bodies = list(body_map.values())
        elif isinstance(body_map, list):
            bodies = list(body_map)

    constraints: list[dict[str, Any]] = []
    if scene.get("constraints"):
        constraints = list(scene.get("constraints", []))
    else:
        constraint_map = scene_state.get("constraints")
        if isinstance(constraint_map, dict):
            constraints = list(constraint_map.values())
        elif isinstance(constraint_map, list):
            constraints = list(constraint_map)

    world = scene.get("world") or scene_state.get("world") or {}
    mapping = (
        scene.get("mapping")
        or scene_state.get("mapping")
        or context.mapping
        or {}
    )

    lines: list[str] = []

    if bodies:
        body_snippets: list[str] = []
        for body in bodies[:6]:
            body_id = body.get("id", "?")
            body_type = body.get("type", "dynamic")
            pos = body.get("position_m") or []
            pos_txt = ""
            if isinstance(pos, (list, tuple)) and len(pos) == 2:
                pos_txt = f"@({float(pos[0]):.2f},{float(pos[1]):.2f})"
            body_snippets.append(f"{body_id}:{body_type}{(' ' + pos_txt) if pos_txt else ''}")
        snippet = ", ".join(body_snippets)
        if len(bodies) > 6:
            snippet += ", ..."
        lines.append(f"Bodies ({len(bodies)}): {snippet}")

    if constraints:
        constraint_snippets: list[str] = []
        for constraint in constraints[:6]:
            constraint_id = constraint.get("id", "?")
            constraint_type = constraint.get("type", "constraint")
            constraint_snippets.append(f"{constraint_id}:{constraint_type}")
        snippet = ", ".join(constraint_snippets)
        if len(constraints) > 6:
            snippet += ", ..."
        lines.append(f"Constraints ({len(constraints)}): {snippet}")

    if world:
        gravity = world.get("gravity_m_s2")
        dt = world.get("time_step_s")
        lines.append(
            f"World: gravity={gravity if gravity is not None else 9.81} m/s², dt={dt if dt is not None else 0.016} s"
        )

    if mapping:
        origin = mapping.get("origin_px")
        scale = mapping.get("scale_m_per_px")
        lines.append(f"Mapping: origin_px={origin}, scale={scale}")

    return "\n".join(lines)


def _append_scene_state_hint(message: str, context: ConversationContext) -> str:
    summary = _scene_state_summary(context)
    if summary:
        return f"{message}\n\n[SCENE_STATE]\n{summary}"
    return message


def _pipeline_instruction(context: ConversationContext) -> str:
    guidance: list[str] = [
        "The segmentation → labeling → building → simulation pipeline now runs outside of chat (via /init_sim + Convert Simulation).",
        "During chat-based refinement you MUST NOT call label_segments, validate_scene_entities, build_physics_scene, simulate_physics, or analyze_simulation.",
    ]

    if not context.scene:
        guidance.append(
            "If no scene is available yet, ask the user to run initialization/Convert Simulation before requesting edits."
        )
    else:
        guidance.append(
            "Use the exposed scene editing tools to adjust the existing scene and clearly describe every change before calling a tool."
        )
        guidance.append(
            "For body-specific properties (position, velocity, mass, friction, labels) ALWAYS use modify_block or modify_circle (matching the collider shape); reserve set_world only for global gravity/time step."
        )

    joined = " ".join(guidance)
    return (
        "\n\n[INSTRUCTION: "
        f"{joined}"
        " Only make edits when the user requests changes or when physics corrections are required.]"
    )


def _editing_catalog_instruction(context: ConversationContext) -> str:
    if not SCENE_EDIT_TOOL_LIST:
        return ""
    return (
        "\n\n[INSTRUCTION: The simulation can be refined incrementally. "
        f"Whenever the user requests geometric changes, consider scene editing tools ({SCENE_EDIT_TOOL_LIST}). "
        f"Include conversation_id='{context.conversation_id}' in tool inputs and clearly describe the edits in plain language.]"
    )


def _ensure_scene_tool_conversation(tool_name: str, tool_args: dict[str, Any], context: ConversationContext) -> dict[str, Any]:
    """Force scene-edit tools to target the active conversation context."""
    if tool_name not in SCENE_EDIT_TOOL_NAMESET:
        return tool_args

    provided = tool_args.get("conversation_id")
    if provided and provided != context.conversation_id:
        logger.warning(
            "[Agent] Overriding conversation_id for %s (provided=%s, active=%s)",
            tool_name,
            provided,
            context.conversation_id,
        )
    tool_args["conversation_id"] = context.conversation_id
    return tool_args


# ===========================
# Tutor Mode: Guided Chat
# ===========================

async def _handle_tutor_mode(
    message: str,
    conversation_id: str,
    history: list[dict[str, str]],
    context_data: dict[str, Any] | None = None
) -> str:
    """
    Tutor mode: Scaffolded conversation without tool calls.
    
    Args:
        message: User message
        conversation_id: Conversation ID
        history: Conversation history
        context_data: Additional context (simulation box metadata, etc.)
    
    Uses OpenAI API (GPT-5 Responses or GPT-4 Chat Completions).
    """
    client = openai.AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    
    # Prepare system prompt (with context if provided)
    system_prompt = get_tutor_system_prompt()
    
    if context_data and context_data.get("simulation_box"):
        sim_box = context_data["simulation_box"]
        context_info = f"\n\n[Current Simulation Context]\n"
        context_info += f"Box: {sim_box.get('name', sim_box.get('id'))}\n"
        
        if sim_box.get("objects"):
            objects_summary = ", ".join([
                f"{obj.get('type', 'unknown')}" 
                for obj in sim_box["objects"][:5]
            ])
            context_info += f"Objects: {objects_summary}\n"
        
        if sim_box.get("parameters"):
            params = sim_box["parameters"]
            if params.get("world"):
                context_info += f"Gravity: {params['world'].get('gravity_m_s2', 9.81)} m/s²\n"
        
        context_info += "\nWhen answering, you can reference this simulation if relevant."
        system_prompt += context_info
    
    if context_data and context_data.get("image_box"):
        img_box = context_data["image_box"]
        context_info = f"\n\n[Current Image Context]\n"
        context_info += f"Box: {img_box.get('name', img_box.get('id'))}\n"
        if img_box.get("imagePath"):
            context_info += f"Image attached for analysis.\n"
        system_prompt += context_info
    
    # Collect images from context
    image_contents = _collect_unique_image_contents(context_data)
    
    # Prepare messages with Tutor mode system prompt
    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(history)
    
    # Add user message with images if present
    if image_contents:
        user_content = [
            {"type": "text", "text": message},
            *image_contents
        ]
        messages.append({"role": "user", "content": user_content})
    else:
        messages.append({"role": "user", "content": message})
    
    # Check if using GPT-5
    is_gpt5 = settings.OPENAI_MODEL.startswith("gpt-5") or settings.OPENAI_MODEL.startswith("o1")
    
    if is_gpt5:
        responses_input = _messages_to_responses_input(messages)
        response = await client.responses.create(
            model=settings.OPENAI_MODEL,
            input=responses_input,
            text={"verbosity": "medium"}
        )
        
        # Extract text from response
        assistant_message = ""
        if hasattr(response, "output_text"):
            assistant_message = response.output_text
        else:
            try:
                assistant_message = response.output[0].content[0].text
            except Exception:
                assistant_message = "Sorry, I couldn't process that request."
    
    return assistant_message


# ===========================
# Agent Mode: Tool-Enabled
# ===========================

async def _handle_agent_mode(
    message: str,
    conversation_id: str,
    attachments: list[dict[str, Any]],
    context_store,
    context_data: dict[str, Any] | None = None
) -> tuple[str, list[dict[str, Any]], dict[str, Any]]:
    """
    Agent mode: Tool-enabled conversation.
    
    Args:
        message: User message
        conversation_id: Conversation ID
        attachments: File attachments
        context_store: Context store instance
        context_data: Additional context (simulation box metadata, etc.)
    
    Returns: (assistant_message, tool_calls_made, state_snapshot)
    """
    registry = get_registry()
    
    # Get or create context
    context = context_store.get_context(conversation_id)
    if not context:
        context = context_store.create_context(conversation_id)
        logger.info(f"[Agent] Created new conversation: {conversation_id}")

    hydrated_from = _hydrate_context_from_attached_boxes(context, context_store, context_data)
    if hydrated_from:
        logger.info(
            "[Agent] Loaded scene state for conversation %s from attached simulation %s",
            conversation_id,
            hydrated_from,
        )

    _log_context_debug("handle_agent_mode", conversation_id, context, context_data)
    
    # Add user message
    context.add_message("user", message)
    requires_action = _requires_simulation_action(message)
    requires_action = _requires_simulation_action(message)
    latest_user_index = next(
        (idx for idx in range(len(context.messages) - 1, -1, -1) if context.messages[idx]["role"] == "user"),
        None,
    )
    latest_user_index = next(
        (idx for idx in range(len(context.messages) - 1, -1, -1) if context.messages[idx]["role"] == "user"),
        None,
    )
    latest_user_index = next(
        (idx for idx in range(len(context.messages) - 1, -1, -1) if context.messages[idx]["role"] == "user"),
        None,
    )
    latest_user_index = next(
        (idx for idx in range(len(context.messages) - 1, -1, -1) if context.messages[idx]["role"] == "user"),
        None,
    )
    latest_user_index = next(
        (idx for idx in range(len(context.messages) - 1, -1, -1) if context.messages[idx]["role"] == "user"),
        None,
    )
    latest_user_index = next(
        (idx for idx in range(len(context.messages) - 1, -1, -1) if context.messages[idx]["role"] == "user"),
        None,
    )
    
    # Enhance message with explicit tool call hints for GPT-5
    enhanced_message = message
    # Add simulation box context if provided
    if context_data and context_data.get("simulation_box"):
        sim_box = context_data["simulation_box"]
        box_context = f"\n\n[CONTEXT: User is referring to simulation box '{sim_box.get('name', sim_box.get('id'))}'."
        
        if sim_box.get("objects"):
            box_context += f" It contains {len(sim_box['objects'])} objects: {', '.join([obj.get('type', 'unknown') for obj in sim_box['objects'][:5]])}."
        
        if sim_box.get("parameters"):
            params = sim_box["parameters"]
            if params.get("world"):
                box_context += f" World settings: gravity={params['world'].get('gravity_m_s2', 9.81)} m/s²."
        
        box_context += "]"
        enhanced_message += box_context
        logger.info(f"[Agent] Added simulation box context: {sim_box.get('name', sim_box.get('id'))}")
    
    # Detect intent and add explicit tool call instructions
    enhanced_message = _append_scene_state_hint(enhanced_message, context)

    pipeline_hint = _pipeline_instruction(context)
    if pipeline_hint:
        enhanced_message += pipeline_hint

    if context.scene or context.scene_state:
        edit_hint = _editing_catalog_instruction(context)
        if edit_hint:
            enhanced_message += edit_hint
    
    if requires_action:
        enhanced_message += (
            "\n\n[CRITICAL ACTION REQUEST: The user explicitly asked to apply or modify the simulation. "
            "Invoke the appropriate scene editing or simulation tool before composing your reply. "
            "Do not skip tool calls unless the user cancelled the request.]"
        )

    if enhanced_message != message:
        logger.info(f"[Agent] Enhanced message with tool call hint: {enhanced_message[:100]}...")
    
    # Process attachments
    for attachment in attachments:
        if attachment.get("type") == "image":
            image_id = attachment.get("id", "uploaded_image")
            context.update_pipeline_state(
                image_id=image_id,
                image_metadata={"uploaded": True}
            )
            logger.info(f"[Agent] Attached image: {image_id}")
    
    image_contents = _collect_unique_image_contents(context_data)
    if image_contents:
        logger.info(f"[Agent] Added {len(image_contents)} unique image context(s)")
    
    # Prepare OpenAI request
    system_prompt = get_agent_system_prompt()
    messages = [{"role": "system", "content": system_prompt}]
    
    # Add conversation history with optional augmentation for the latest user turn
    for idx, msg in enumerate(context.messages):
        content = msg.get("content", "")
        if latest_user_index is not None and idx == latest_user_index and msg.get("role") == "user":
            content = enhanced_message
            if image_contents:
                messages.append({
                    "role": "user",
                    "content": [
                        {"type": "text", "text": content},
                        *image_contents
                    ]
                })
                continue
        messages.append({
            "role": msg.get("role"),
            "content": content
        })
    
    # Detect if we're using GPT-5 (or o1 models) - use Responses API
    is_gpt5 = settings.OPENAI_MODEL.startswith("gpt-5") or settings.OPENAI_MODEL.startswith("o1")
    
    # Log user messages for debugging
    user_messages = [m for m in messages if m["role"] == "user"]
    logger.info(f"[Agent] User messages: {[m['content'][:100] if isinstance(m['content'], str) else 'multipart' for m in user_messages]}")
    logger.info(f"[Agent] Context state: image_id={context.image_id}, segments={len(context.segments)}, entities={len(context.entities)}")
    
    client = openai.AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    
    # Detect if we're using GPT-5 (or o1 models) - use Responses API
    is_gpt5 = settings.OPENAI_MODEL.startswith("gpt-5") or settings.OPENAI_MODEL.startswith("o1")
    model_to_use = settings.OPENAI_MODEL
    
    # Always use the configured model (GPT-5)
    if image_contents:
        logger.info(f"[Agent] Images detected, using {model_to_use} with vision")
    
    # Get appropriate tool schemas
    if is_gpt5:
        tools = registry.get_gpt5_function_schemas()
    else:
        tools = registry.get_openai_function_schemas()
    
    logger.info(f"[Agent] Available tools: {[t.get('name') or t.get('function', {}).get('name') for t in tools]}")
    
    conversation_text = _flatten_messages_for_text(messages)
    responses_input = _messages_to_responses_input(messages) if is_gpt5 else None
    
    # Log conversation for debugging
    logger.info(f"[Agent] Conversation text (first 500 chars): {conversation_text[:500]}")
    
    # Call OpenAI with tool support
    logger.info(f"[Agent] Calling {model_to_use} ({'Responses API' if is_gpt5 else 'Chat Completions API'}) with {len(messages)} messages and {len(tools)} tools")
    
    if is_gpt5:
        # GPT-5 uses Responses API with structured input
        first_response = await client.responses.create(
            model=model_to_use,
            input=responses_input,
            tools=tools,
            reasoning={"effort": "medium"},
            text={"verbosity": "medium"}
        )
        
        # GPT-5 Responses API has different structure
        # Debug: Log full response structure (non-streaming)
        logger.info(f"[Agent] 🔍 GPT-5 Raw Response:")
        logger.info(f"  - Type: {type(first_response)}")
        logger.info(f"  - Response object: {first_response}")
        
        # GPT-5 uses response.output array with type filtering
        assistant_text = ""
        tool_calls_raw = []
        
        if hasattr(first_response, 'output'):
            logger.info(f"  - Found 'output' field: {type(first_response.output)}")
            for item in first_response.output:
                item_type = getattr(item, 'type', None)
                logger.info(f"    - Item type: {item_type}")
                
                if item_type == "function_call":
                    tool_calls_raw.append(item)
                elif item_type == "text":
                    # Text content in output
                    if hasattr(item, 'text'):
                        assistant_text += item.text
        elif hasattr(first_response, 'output_text'):
            assistant_text = first_response.output_text
        elif hasattr(first_response, 'choices'):
            assistant_text = first_response.choices[0].message.content or ""
        
        logger.info(f"  - Output text: {assistant_text[:200] if assistant_text else 'EMPTY'}")
        logger.info(f"  - Tool calls count: {len(tool_calls_raw)}")
        if tool_calls_raw:
            logger.info(f"  - Tool calls: {tool_calls_raw}")
        
        # Create a mock message object for compatibility
        class MockMessage:
            def __init__(self, content, tool_calls):
                self.content = content
                self.tool_calls = tool_calls
        
        assistant_message_obj = MockMessage(assistant_text, tool_calls_raw)
    else:
        # GPT-4 models use Chat Completions API
        response = await client.chat.completions.create(
            model=model_to_use,
            messages=messages,
            tools=tools,
            tool_choice="auto"
        )
        
        assistant_message_obj = response.choices[0].message
    tool_calls_raw = assistant_message_obj.tool_calls or []
    assistant_text = assistant_message_obj.content or ""
    
    logger.info(f"[Agent] GPT-5 response: {len(tool_calls_raw)} tool calls, message: {assistant_text[:100] if assistant_text else 'None'}")
    
    tool_calls_made = []
    
    # Execute tool calls
    if tool_calls_raw:
        logger.info(f"[Agent] Executing {len(tool_calls_raw)} tool calls")
        for tool_call in tool_calls_raw:
            # Handle different tool call structures (GPT-5 vs GPT-4)
            if hasattr(tool_call, 'function'):
                # GPT-4 Chat Completions format
                tool_name = tool_call.function.name
                tool_args = json.loads(tool_call.function.arguments)
                tool_id = tool_call.id
            else:
                # GPT-5 Responses API format (direct attributes)
                tool_name = tool_call.name
                tool_args = json.loads(tool_call.arguments) if isinstance(tool_call.arguments, str) else tool_call.arguments
                tool_id = getattr(tool_call, 'call_id', f"tool_{tool_name}")  # GPT-5 uses 'call_id', not 'id'
            
            logger.info(f"[Agent] Tool: {tool_name}, Args: {list(tool_args.keys())}, ID: {tool_id}")
            
            TOOL_LOGGER.info(
                "[Agent][non-stream] tool_start name=%s conversation=%s args=%s",
                tool_name,
                conversation_id,
                format_for_log(tool_args)
            )
            tool_start_time = perf_counter()

            if isinstance(tool_args, dict):
                tool_args = _ensure_scene_tool_conversation(tool_name, tool_args, context)

            try:
                result = await registry.invoke_tool(tool_name, tool_args)
                logger.info(f"[Agent] ✓ {tool_name} succeeded")
                duration_ms = (perf_counter() - tool_start_time) * 1000
                TOOL_LOGGER.info(
                    "[Agent][non-stream] tool_complete name=%s conversation=%s duration_ms=%.1f result=%s",
                    tool_name,
                    conversation_id,
                    duration_ms,
                    format_for_log(result)
                )
                
                context.add_tool_call(
                    tool_name=tool_name,
                    arguments=tool_args,
                    result=result
                )
                
                tool_calls_made.append({
                    "name": tool_name,
                    "arguments": tool_args,
                    "result": result,
                    "call_id": tool_id  # Store call_id for GPT-5
                })
                
                # Update context state
                _update_context_state(context, tool_name, result)
                
            except Exception as e:
                duration_ms = (perf_counter() - tool_start_time) * 1000
                logger.error(f"[Agent] ✗ {tool_name} failed: {str(e)}")
                TOOL_LOGGER.warning(
                    "[Agent][non-stream] tool_error name=%s conversation=%s duration_ms=%.1f error=%s",
                    tool_name,
                    conversation_id,
                    duration_ms,
                    str(e)
                )
                context.add_tool_call(
                    tool_name=tool_name,
                    arguments=tool_args,
                    error=str(e)
                )
                tool_calls_made.append({
                    "name": tool_name,
                    "arguments": tool_args,
                    "error": str(e),
                    "call_id": tool_id  # Store call_id for GPT-5
                })
    else:
        logger.warning("[Agent] ⚠️ No tool calls from GPT-5!")
    
    # Get final response with tool results
    if tool_calls_raw:
        if is_gpt5:
            # GPT-5: Build input array with original response output + function_call_output items
            # Use only the required fields for each item type
            input_items = []
            
            # Add original user message(s)
            for msg in context.messages:
                if msg["role"] == "user":
                    input_items.append({
                        "role": msg["role"],
                        "content": msg["content"]
                    })
            
            # Add the first response output items with ONLY required fields
            if hasattr(first_response, 'output'):
                for item in first_response.output:
                    item_type = getattr(item, 'type', None)
                    
                    if item_type == "function_call":
                        # Function call items: type, call_id, name, arguments
                        input_items.append({
                            "type": "function_call",
                            "call_id": getattr(item, 'call_id', ''),
                            "name": getattr(item, 'name', ''),
                            "arguments": getattr(item, 'arguments', {})
                        })
                    elif item_type == "text":
                        # Text items: type, text
                        input_items.append({
                            "type": "text",
                            "text": getattr(item, 'text', '')
                        })
                    # Add other types as needed
            
            # Now add tool results as function_call_output
            for tc_made in tool_calls_made:
                call_id = tc_made.get('call_id', 'unknown_call')
                
                input_items.append({
                    "type": "function_call_output",
                    "call_id": call_id,
                    "output": json.dumps(tc_made.get("result", tc_made.get("error", "No result")))
                })
            
            logger.info(f"[Agent] Sending {len(input_items)} items to GPT-5 for final response")
            
            final_response = await client.responses.create(
                model=settings.OPENAI_MODEL,
                input=input_items,
                reasoning={"effort": "low"},
                text={"verbosity": "medium"}
            )
            
            # Extract text from output
            final_message = _compose_final_message(
                _extract_responses_text(final_response),
                assistant_text,
                tool_calls_made,
            )
        else:
            # GPT-4: Use standard chat completions with tool messages
            messages.append({
                "role": "assistant",
                "content": assistant_text or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments
                        }
                    }
                    for tc in tool_calls_raw
                ]
            })
            
            for i, tool_call in enumerate(tool_calls_raw):
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": json.dumps(tool_calls_made[i].get("result", {}))
                })
            
            final_response = await client.chat.completions.create(
                model=settings.OPENAI_MODEL,
                messages=messages
            )
            final_message = final_response.choices[0].message.content or ""
    else:
        final_message = assistant_text

    final_message = _ensure_final_message_text(
        final_message,
        assistant_text,
        tool_calls_made,
    )
    
    # Add assistant message to context
    context.add_message("assistant", final_message)
    context_store.update_context(context)
    
    # Build state snapshot (v0.4 - no scene_kind)
    state_snapshot = {
        "image_id": context.image_id,
        "segments_count": len(context.segments),
        "entities_count": len(context.entities),
        "has_scene": context.scene is not None,
        "frames_count": len(context.frames),
        "scene": context.scene,
        "mapping": context.mapping,
        "image": context.image_metadata,
    }
    
    return final_message, tool_calls_made, state_snapshot


def _update_context_state(context, tool_name: str, result: Any):
    """Update context state based on tool execution results."""
    if tool_name in SCENE_EDIT_TOOL_NAMESET:
        scene = result.get("scene") if isinstance(result, dict) else None
        mapping = None
        if isinstance(scene, dict):
            mapping = scene.get("mapping")
        context.update_pipeline_state(
            scene=scene or context.scene,
            mapping=mapping or context.mapping
        )


# ===========================
# Streaming: SSE
# ===========================

async def _stream_agent_mode(
    message: str,
    conversation_id: str,
    attachments: list[dict[str, Any]],
    context_store,
    context_data: dict[str, Any] | None = None
) -> AsyncGenerator[str, None]:
    """
    Stream Agent mode execution with real-time progress updates.
    
    Args:
        message: User message
        conversation_id: Conversation ID
        attachments: File attachments
        context_store: Context store instance
        context_data: Additional context (simulation box metadata, etc.)
    
    Yields SSE events:
    - event: tool_start
    - event: tool_progress
    - event: tool_complete
    - event: message
    """
    registry = get_registry()
    
    # Get or create context
    context = context_store.get_context(conversation_id)
    if not context:
        context = context_store.create_context(conversation_id)
    
    hydrated_from = _hydrate_context_from_attached_boxes(context, context_store, context_data)
    if hydrated_from:
        logger.info(
            "[StreamAgent] Loaded scene state for conversation %s from attached simulation %s",
            conversation_id,
            hydrated_from,
        )

    _log_context_debug("stream_agent_mode", conversation_id, context, context_data)

    yield f"event: init\ndata: {json.dumps({'conversation_id': conversation_id})}\n\n"
    
    # Add user message
    context.add_message("user", message)
    requires_action = _requires_simulation_action(message)
    
    # Enhance message with explicit tool call hints for GPT-5
    enhanced_message = message
    # Add simulation box context if provided
    if context_data and context_data.get("simulation_box"):
        sim_box = context_data["simulation_box"]
        box_context = f"\n\n[CONTEXT: User is referring to simulation box '{sim_box.get('name', sim_box.get('id'))}'."
        
        if sim_box.get("objects"):
            box_context += f" It contains {len(sim_box['objects'])} objects: {', '.join([obj.get('type', 'unknown') for obj in sim_box['objects'][:5]])}."
        
        if sim_box.get("parameters"):
            params = sim_box["parameters"]
            if params.get("world"):
                box_context += f" World settings: gravity={params['world'].get('gravity_m_s2', 9.81)} m/s²."
        
        if sim_box.get("conversationId"):
            box_context += f" Conversation ID: {sim_box['conversationId']}."
        
        box_context += "]"
        enhanced_message += box_context
    
    # Detect intent and add explicit tool call instructions
    enhanced_message = _append_scene_state_hint(enhanced_message, context)

    pipeline_hint = _pipeline_instruction(context)
    if pipeline_hint:
        enhanced_message += pipeline_hint

    if context.scene or context.scene_state:
        edit_hint = _editing_catalog_instruction(context)
        if edit_hint:
            enhanced_message += edit_hint

    if requires_action:
        enhanced_message += (
            "\n\n[CRITICAL ACTION REQUEST: The user explicitly asked to apply or modify the simulation. "
            "Invoke the correct scene editing, simulation, or analysis tool before replying. "
            "Never respond with narration only when such a request is detected.]"
        )

    if enhanced_message != message:
        logger.info("[StreamAgent] Enhanced latest user message for tool guidance")
    
    # Process attachments
    for attachment in attachments:
        if attachment.get("type") == "image":
            context.update_pipeline_state(
                image_id=attachment.get("id", "uploaded_image"),
                image_metadata={"uploaded": True}
            )
    
    # Prepare OpenAI request
    system_prompt = get_agent_system_prompt()
    
    latest_user_index = next(
        (idx for idx in range(len(context.messages) - 1, -1, -1) if context.messages[idx]["role"] == "user"),
        None,
    )

    image_contents = _collect_unique_image_contents(context_data)
    if image_contents:
        logger.info(f"[StreamAgent] Added {len(image_contents)} unique image context(s)")
    
    messages = [{"role": "system", "content": system_prompt}]
    
    # Add conversation history with optional augmentation for the latest user turn
    for idx, msg in enumerate(context.messages):
        content = msg.get("content", "")
        role = msg.get("role")
        if latest_user_index is not None and idx == latest_user_index and role == "user":
            content = enhanced_message
            if image_contents:
                messages.append({
                    "role": "user",
                    "content": [
                        {"type": "text", "text": content},
                        *image_contents
                    ]
                })
                continue
        messages.append({
            "role": role,
            "content": content
        })
    
    # Detect if we're using GPT-5 (or o1 models) - use Responses API
    is_gpt5 = settings.OPENAI_MODEL.startswith("gpt-5") or settings.OPENAI_MODEL.startswith("o1")
    
    client = openai.AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    
    # Detect if we're using GPT-5 (or o1 models) - use Responses API
    is_gpt5 = settings.OPENAI_MODEL.startswith("gpt-5") or settings.OPENAI_MODEL.startswith("o1")
    model_to_use = settings.OPENAI_MODEL
    
    # Always use the configured model (GPT-5)
    if image_contents:
        logger.info(f"[StreamAgent] Images detected, using {model_to_use} with vision")
    
    # Get appropriate tool schemas
    if is_gpt5:
        tools = registry.get_gpt5_function_schemas()
    else:
        tools = registry.get_openai_function_schemas()
    
    conversation_text = _flatten_messages_for_text(messages)
    responses_input = _messages_to_responses_input(messages) if is_gpt5 else None
    
    yield f"event: thinking\ndata: {json.dumps({'status': 'calling_gpt'})}\n\n"
    
    # Call OpenAI
    if is_gpt5:
        # GPT-5 uses Responses API with structured input
        response = await client.responses.create(
            model=model_to_use,
            input=responses_input,
            tools=tools,
            reasoning={"effort": "medium"},
            text={"verbosity": "medium"}
        )
        
        # GPT-5 Responses API has different structure
        assistant_text = ""
        tool_calls_raw = []

        if hasattr(response, "output") and response.output:
            for item in response.output:
                item_type = getattr(item, "type", None)
                if item_type == "function_call":
                    tool_calls_raw.append(item)
                elif item_type == "text" and hasattr(item, "text"):
                    assistant_text += getattr(item, "text", "")
        elif hasattr(response, 'output_text'):
            assistant_text = response.output_text
        elif hasattr(response, 'choices'):
            assistant_text = response.choices[0].message.content or ""
        
        # Create a mock message object for compatibility
        class MockMessage:
            def __init__(self, content, tool_calls):
                self.content = content
                self.tool_calls = tool_calls
        
        assistant_message_obj = MockMessage(assistant_text, tool_calls_raw)
    else:
        # GPT-4 models use Chat Completions API
        response = await client.chat.completions.create(
            model=model_to_use,
            messages=messages,
            tools=tools,
            tool_choice="auto"
        )
        
        assistant_message_obj = response.choices[0].message
    tool_calls_raw = assistant_message_obj.tool_calls or []
    assistant_text = assistant_message_obj.content or ""
    
    tool_calls_made = []
    
    # Execute tool calls with streaming
    if tool_calls_raw:
        for idx, tool_call in enumerate(tool_calls_raw):
            # Handle different tool call structures (GPT-5 vs GPT-4)
            if hasattr(tool_call, 'function'):
                # GPT-4 Chat Completions format
                tool_name = tool_call.function.name
                tool_args = json.loads(tool_call.function.arguments)
                tool_id = tool_call.id
            else:
                # GPT-5 Responses API format (direct attributes)
                tool_name = tool_call.name
                tool_args = json.loads(tool_call.arguments) if isinstance(tool_call.arguments, str) else tool_call.arguments
                tool_id = getattr(tool_call, 'call_id', f"tool_{tool_name}")  # GPT-5 uses 'call_id', not 'id'
            
            # Tool start event
            yield f"event: tool_start\ndata: {json.dumps({'tool': tool_name, 'index': idx, 'total': len(tool_calls_raw)})}\n\n"
            TOOL_LOGGER.info(
                "[Agent][stream] tool_start name=%s conversation=%s args=%s",
                tool_name,
                conversation_id,
                format_for_log(tool_args)
            )
            tool_start_time = perf_counter()

            if isinstance(tool_args, dict):
                tool_args = _ensure_scene_tool_conversation(tool_name, tool_args, context)

            try:
                # Invoke tool
                result = await registry.invoke_tool(tool_name, tool_args)
                duration_ms = (perf_counter() - tool_start_time) * 1000
                TOOL_LOGGER.info(
                    "[Agent][stream] tool_complete name=%s conversation=%s duration_ms=%.1f result=%s",
                    tool_name,
                    conversation_id,
                    duration_ms,
                    format_for_log(result)
                )
                
                # Tool complete event
                yield f"event: tool_complete\ndata: {json.dumps({'tool': tool_name, 'success': True})}\n\n"
                
                context.add_tool_call(
                    tool_name=tool_name,
                    arguments=tool_args,
                    result=result
                )
                
                tool_calls_made.append({
                    "name": tool_name,
                    "arguments": tool_args,
                    "result": result
                })
                
                # Update context state
                _update_context_state(context, tool_name, result)
                
                # State update event reflecting latest scene snapshot
                state_snapshot = {
                    "segments_count": len(context.segments),
                    "entities_count": len(context.entities),
                    "has_scene": context.scene is not None,
                    "frames_count": len(context.frames),
                }

                result_scene = result.get("scene") if isinstance(result, dict) else None
                if result_scene:
                    state_snapshot["scene"] = result_scene
                elif context.scene:
                    state_snapshot["scene"] = context.scene
                if context.mapping:
                    state_snapshot["mapping"] = context.mapping
                if context.image_metadata:
                    state_snapshot.setdefault("image", context.image_metadata)
                if isinstance(result, dict) and result.get("frames"):
                    state_snapshot["frames"] = result.get("frames", [])
                
                yield f"event: state_update\ndata: {json.dumps(state_snapshot)}\n\n"
                
            except Exception as e:
                duration_ms = (perf_counter() - tool_start_time) * 1000
                traceback.print_exc()
                # Tool error event
                yield f"event: tool_error\ndata: {json.dumps({'tool': tool_name, 'error': str(e)})}\n\n"
                TOOL_LOGGER.warning(
                    "[Agent][stream] tool_error name=%s conversation=%s duration_ms=%.1f error=%s",
                    tool_name,
                    conversation_id,
                    duration_ms,
                    str(e)
                )
                
                context.add_tool_call(
                    tool_name=tool_name,
                    arguments=tool_args,
                    error=str(e)
                )
                tool_calls_made.append({
                    "name": tool_name,
                    "arguments": tool_args,
                    "error": str(e)
                })
        
        # Get final response
        yield f"event: thinking\ndata: {json.dumps({'status': 'generating_final_message'})}\n\n"
        
        if is_gpt5:
            # GPT-5: Build tool results summary and request final response
            tool_results_text = "\n".join([
                f"Tool {tc['name']} returned: {json.dumps(tc.get('result', tc.get('error', 'No result')))}"
                for tc in tool_calls_made
            ])
            
            final_input = f"{conversation_text}\n\nTool results:\n{tool_results_text}\n\nPlease provide a final response to the user based on these tool results."
            
            final_response = await client.responses.create(
                model=settings.OPENAI_MODEL,
                input=final_input,
                reasoning={"effort": "low"},
                text={"verbosity": "medium"}
            )
            final_message = _compose_final_message(
                _extract_responses_text(final_response),
                assistant_text,
                tool_calls_made,
            )
        else:
            # GPT-4: Use standard chat completions with tool messages
            messages.append({
                "role": "assistant",
                "content": assistant_text or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments
                        }
                    }
                    for tc in tool_calls_raw
                ]
            })
            
            for i, tool_call in enumerate(tool_calls_raw):
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": json.dumps(tool_calls_made[i].get("result", {}))
                })
            
            final_response = await client.chat.completions.create(
                model=settings.OPENAI_MODEL,
                messages=messages
            )
            final_message = final_response.choices[0].message.content or ""
    else:
        final_message = assistant_text
    
    final_message = _ensure_final_message_text(
        final_message,
        assistant_text,
        tool_calls_made,
    )

    # Add assistant message to context
    context.add_message("assistant", final_message)
    context_store.update_context(context)
    
    # Final message event
    yield f"event: message\ndata: {json.dumps({'content': final_message})}\n\n"
    
    # Done event
    yield f"event: done\ndata: {json.dumps({'conversation_id': conversation_id})}\n\n"


# ===========================
# API Endpoints
# ===========================

@router.get("", response_class=StreamingResponse)
async def chat_sse(
    message: str = Query(..., description="User message"),
    mode: Literal["tutor", "agent"] = Query("tutor", description="Chat mode"),
    conversation_id: str | None = Query(None, description="Conversation ID"),
    stream: bool = Query(True, description="Enable streaming"),
    attachments: str | None = Query(None, description="JSON-encoded attachments"),
    context: str | None = Query(None, description="JSON-encoded context")
):
    """
    GET endpoint for SSE streaming (EventSource compatibility).
    
    EventSource only supports GET requests, so we provide this endpoint
    for streaming mode. Use POST /chat for non-streaming requests.
    
    Query Parameters:
    - message: User message (required)
    - mode: "tutor" or "agent" (default: "tutor")
    - conversation_id: Optional conversation ID
    - stream: Must be true for streaming (default: true)
    - attachments: JSON-encoded attachments array
    - context: JSON-encoded context object
    
    Example:
        GET /chat?message=hello&mode=agent&stream=true
    """
    if not stream:
        raise HTTPException(
            status_code=400,
            detail="Use POST /chat for non-streaming requests"
        )
    
    if mode != "agent":
        raise HTTPException(
            status_code=400,
            detail="Streaming only supported in Agent mode"
        )
    
    # Parse attachments from query string
    parsed_attachments = []
    if attachments:
        try:
            parsed_attachments = json.loads(attachments)
        except json.JSONDecodeError:
            raise HTTPException(
                status_code=400,
                detail="Invalid attachments JSON"
            )
    
    # Parse context from query string
    parsed_context = None
    if context:
        try:
            parsed_context = json.loads(context)
        except json.JSONDecodeError:
            raise HTTPException(
                status_code=400,
                detail="Invalid context JSON"
            )
    
    # Generate conversation ID if not provided
    conv_id = conversation_id or str(uuid4())
    
    # Stream Agent mode
    context_store = get_context_store()
    return StreamingResponse(
        _stream_agent_mode(
            message,
            conv_id,
            parsed_attachments,
            context_store,
            parsed_context
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # Disable buffering in nginx
        }
    )


@router.post("", response_model=ChatResponse, status_code=status.HTTP_200_OK)
async def chat(request: ChatRequest) -> ChatResponse | StreamingResponse:
    """
    Unified chat endpoint with Tutor/Agent modes.
    
    Modes:
    - tutor: Scaffolded conversation (educational Q&A)
    - agent: Tool-enabled pipeline orchestration
    
    Streaming:
    - Set stream=true for Server-Sent Events
    - Provides real-time tool execution progress
    
    Example (Tutor mode):
        POST /chat
        {
            "message": "What is Newton's second law?",
            "mode": "tutor"
        }
    
    Example (Agent mode):
        POST /chat
        {
            "message": "Simulate this pulley diagram",
            "mode": "agent",
            "attachments": [{"type": "image", "id": "img_123"}],
            "stream": true
        }
    """
    # Generate or use existing conversation ID
    conversation_id = request.conversation_id or str(uuid4())
    
    # Streaming response
    if request.stream:
        if request.mode == "agent":
            context_store = get_context_store()
            return StreamingResponse(
                _stream_agent_mode(
                    request.message,
                    conversation_id,
                    request.attachments,
                    context_store,
                    request.context
                ),
                media_type="text/event-stream"
            )
        else:
            raise HTTPException(
                status_code=400,
                detail="Streaming only supported in Agent mode"
            )
    
    # Non-streaming response
    try:
        if request.mode == "tutor":
            # Tutor mode: Guided conversation
            conversation = await _chat_repository.get(UUID(conversation_id))
            history = []
            if conversation:
                history = [
                    {"role": msg.role, "content": msg.content}
                    for msg in conversation.messages
                ]
            
            assistant_message = await _handle_tutor_mode(
                request.message,
                conversation_id,
                history,
                request.context
            )
            
            # Save conversation (using chat repository)
            if not conversation:
                conversation = ConversationState(
                    conversation_id=UUID(conversation_id),
                    messages=[]
                )
            
            # Add messages (simplified - proper implementation should use ChatMessage schema)
            # TODO: Integrate with ChatRepository properly
            
            return ChatResponse(
                message=assistant_message,
                conversation_id=conversation_id,
                mode="tutor",
                tool_calls=[],
                state={}
            )
        
        else:  # agent mode
            context_store = get_context_store()
            
            assistant_message, tool_calls_made, state_snapshot = await _handle_agent_mode(
                request.message,
                conversation_id,
                request.attachments,
                context_store,
                request.context
            )
            
            return ChatResponse(
                message=assistant_message,
                conversation_id=conversation_id,
                mode="agent",
                tool_calls=tool_calls_made,
                state=state_snapshot
            )
    
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Chat failed: {str(e)}"
        )


@router.get("/conversations", response_model=list[dict[str, Any]])
async def list_conversations() -> list[dict[str, Any]]:
    """
    List all active conversations (Ask and Agent modes).
    
    Returns conversation metadata for debugging/monitoring.
    """
    # Get Ask mode conversations
    ask_conversations = await _chat_repository.list_conversations()
    
    # Get Agent mode contexts
    context_store = get_context_store()
    agent_contexts = []
    
    # TODO: context_store doesn't have list_all method yet
    # For now, return Ask conversations only
    
    return [
        {
            "conversation_id": str(conv.conversation_id),
            "mode": "ask",
            "message_count": len(conv.messages),
            "created_at": conv.created_at.isoformat() if hasattr(conv, 'created_at') else None
        }
        for conv in ask_conversations
    ]


@router.get("/context/{conversation_id}", response_model=dict[str, Any])
async def get_context(conversation_id: str) -> dict[str, Any]:
    """
    Get conversation context (Agent mode only).
    
    Returns full pipeline state for debugging.
    """
    context_store = get_context_store()
    context = context_store.get_context(conversation_id)
    
    if not context:
        raise HTTPException(
            status_code=404,
            detail=f"Agent context {conversation_id} not found"
        )
    
    return context.model_dump()


@router.delete("/context/{conversation_id}")
async def delete_context(conversation_id: str) -> dict[str, str]:
    """Delete conversation context (both Ask and Agent modes)."""
    
    # Try Agent context
    context_store = get_context_store()
    context_store.delete_context(conversation_id)
    
    # Try Ask conversation
    try:
        await _chat_repository.delete(UUID(conversation_id))
    except Exception:
        pass
    
    return {"message": f"Conversation {conversation_id} deleted"}
