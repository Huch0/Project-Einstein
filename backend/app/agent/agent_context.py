"""
Agent Conversation Context Management (v0.4)

Manages state persistence across multi-turn conversations.
Updated for Universal Builder architecture - no scene_kind field.
"""

import uuid
from datetime import datetime
from copy import deepcopy
from typing import Any

from pydantic import BaseModel, Field


class ConversationContext(BaseModel):
    """
    State container for a conversation session (v0.4).
    
    Tracks intermediate results through the pipeline:
    - Image upload
    - Segmentation
    - Entity labeling (supports N entities, not just 2)
    - Scene building (via Universal Builder)
    - Simulation frames (Matter.js only)
    
    v0.4 Changes:
    - Removed scene_kind field (no classification)
    - entities list is unbounded (N-body support)
    - All simulations use Matter.js
    """
    
    conversation_id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        description="Unique conversation identifier"
    )
    
    created_at: datetime = Field(
        default_factory=datetime.now,
        description="Conversation start time"
    )
    
    updated_at: datetime = Field(
        default_factory=datetime.now,
        description="Last update time"
    )
    
    # Pipeline state
    image_id: str | None = Field(
        default=None,
        description="Uploaded image identifier"
    )
    
    image_metadata: dict[str, Any] | None = Field(
        default=None,
        description="Image size and metadata"
    )
    
    segments: list[dict[str, Any]] = Field(
        default_factory=list,
        description="SAM segmentation results"
    )

    detections: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Derived detection overlays (polygon + bbox in px)"
    )
    
    entities: list[dict[str, Any]] = Field(
        default_factory=list,
        description="GPT labeled entities (any count - v0.4 supports N bodies)"
    )
    
    entity_summary: dict[str, int] = Field(
        default_factory=dict,
        description="Entity type counts (mass: 3, pulley: 1, etc.)"
    )
    
    scene: dict[str, Any] | None = Field(
        default=None,
        description="Built Scene JSON"
    )

    mapping: dict[str, Any] | None = Field(
        default=None,
        description="Coordinate mapping details between pixels and meters"
    )

    scene_state: dict[str, Any] = Field(
        default_factory=dict,
        description="Mutable scene state used during iterative editing"
    )

    scene_history: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Chronological record of scene snapshots"
    )

    last_scene_render_path: str | None = Field(
        default=None,
        description="Filesystem path of most recent scene render"
    )
    
    frames: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Simulation frames"
    )
    
    # Conversation history
    messages: list[dict[str, str]] = Field(
        default_factory=list,
        description="Message history [{'role': 'user'|'assistant', 'content': str}]"
    )
    
    # Tool call history
    tool_calls: list[dict[str, Any]] = Field(
        default_factory=list,
        description="History of tool invocations"
    )
    
    def add_message(self, role: str, content: str):
        """Add message to conversation history."""
        self.messages.append({
            "role": role,
            "content": content,
            "timestamp": datetime.now().isoformat()
        })
        self.updated_at = datetime.now()
    
    def add_tool_call(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        result: dict[str, Any] | None = None,
        error: str | None = None
    ):
        """Record a tool call."""
        self.tool_calls.append({
            "tool_name": tool_name,
            "arguments": arguments,
            "result": result,
            "error": error,
            "timestamp": datetime.now().isoformat()
        })
        self.updated_at = datetime.now()
    
    def update_pipeline_state(self, **kwargs):
        """Update pipeline state fields."""
        for key, value in kwargs.items():
            if hasattr(self, key):
                setattr(self, key, value)
        self.updated_at = datetime.now()

    # Scene editing helpers

    def reset_scene_state(
        self,
        *,
        world: dict[str, Any] | None = None,
        mapping: dict[str, Any] | None = None,
    ) -> None:
        """Initialize the mutable scene state for iterative editing."""
        default_world = {
            "gravity_m_s2": 9.81,
            "time_step_s": 0.016,
        }
        self.scene_state = {
            "world": world or default_world,
            "bodies": {},
            "constraints": {},
            "mapping": mapping,
        }
        self.scene_history = []
        self.scene = None
        self.mapping = mapping
        self.updated_at = datetime.now()

    def scene_snapshot(self) -> dict[str, Any]:
        """Return the current scene state in builder schema format."""
        if not self.scene_state:
            self.reset_scene_state()
        snapshot = {
            "version": "0.6-iterative",
            "world": deepcopy(self.scene_state.get("world", {})),
            "bodies": list(deepcopy(self.scene_state.get("bodies", {})).values()),
            "constraints": list(deepcopy(self.scene_state.get("constraints", {})).values()),
            "mapping": deepcopy(self.scene_state.get("mapping")),
        }
        self.scene = snapshot
        return snapshot

    def record_scene_snapshot(self, note: str | None = None) -> dict[str, Any]:
        """Persist the current scene snapshot to history with optional note."""
        snapshot = self.scene_snapshot()
        entry = {
            "timestamp": datetime.now().isoformat(),
            "note": note,
            "scene": snapshot,
        }
        self.scene_history.append(entry)
        self.updated_at = datetime.now()
        return snapshot

    def apply_scene_updates(
        self,
        *,
        bodies: dict[str, dict[str, Any]] | None = None,
        constraints: dict[str, dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Merge provided bodies/constraints into the mutable scene state."""
        if not self.scene_state:
            self.reset_scene_state()

        if bodies:
            self.scene_state.setdefault("bodies", {}).update(bodies)
        if constraints:
            self.scene_state.setdefault("constraints", {}).update(constraints)
        self.updated_at = datetime.now()
        return self.scene_snapshot()

    def remove_scene_entities(
        self,
        *,
        body_ids: list[str] | None = None,
        constraint_ids: list[str] | None = None,
    ) -> dict[str, Any]:
        """Remove scene entities by identifier from the mutable scene state."""
        if not self.scene_state:
            self.reset_scene_state()

        if body_ids:
            body_map = self.scene_state.setdefault("bodies", {})
            for body_id in body_ids:
                body_map.pop(body_id, None)

        if constraint_ids:
            constraint_map = self.scene_state.setdefault("constraints", {})
            for constraint_id in constraint_ids:
                constraint_map.pop(constraint_id, None)

        self.updated_at = datetime.now()
        return self.scene_snapshot()


class ContextStore:
    """
    In-memory storage for conversation contexts.
    
    For production, replace with Redis or database backend.
    """
    
    def __init__(self):
        self._contexts: dict[str, ConversationContext] = {}
    
    def create_context(self) -> ConversationContext:
        """Create new conversation context."""
        context = ConversationContext()
        self._contexts[context.conversation_id] = context
        return context
    
    def get_context(self, conversation_id: str) -> ConversationContext | None:
        """Retrieve context by ID."""
        return self._contexts.get(conversation_id)
    
    def update_context(self, context: ConversationContext):
        """Update existing context."""
        context.updated_at = datetime.now()
        self._contexts[context.conversation_id] = context
    
    def delete_context(self, conversation_id: str):
        """Delete context."""
        if conversation_id in self._contexts:
            del self._contexts[conversation_id]
    
    def list_contexts(self) -> list[ConversationContext]:
        """List all contexts."""
        return list(self._contexts.values())


# Global context store instance
_store = ContextStore()


def get_context_store() -> ContextStore:
    """Get global context store instance."""
    return _store
