"""Pydantic models for the chat subsystem."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class ChatRole(str, Enum):
    """Supported roles for chat messages."""

    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"


class ChatMessage(BaseModel):
    """Canonical representation of a chat message."""

    id: UUID = Field(default_factory=uuid4)
    role: ChatRole
    content: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ConversationState(BaseModel):
    """Aggregate view of the conversation timeline."""

    id: UUID = Field(default_factory=uuid4)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    messages: list[ChatMessage] = Field(default_factory=list)


class ChatTurnRequest(BaseModel):
    """Incoming payload for a chat turn."""

    conversation_id: UUID | None = Field(
        default=None,
        description="Existing conversation identifier; set null to start a new one.",
        json_schema_extra={"example": None},
    )
    message: str = Field(min_length=1)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ChatTurnResponse(BaseModel):
    """Response payload after processing a turn."""

    conversation: ConversationState
    new_messages: list[ChatMessage]
