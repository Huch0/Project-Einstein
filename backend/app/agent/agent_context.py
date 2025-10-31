"""
Agent Conversation Context Management (v0.4)

Manages state persistence across multi-turn conversations.
Updated for Universal Builder architecture - no scene_kind field.
"""

import uuid
from datetime import datetime
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
