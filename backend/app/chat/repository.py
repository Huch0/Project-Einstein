"""In-memory persistence layer for chat conversations.

The repository abstraction makes it easy to swap a real database later
without touching higher-level orchestration code.
"""

from __future__ import annotations

import asyncio
from datetime import datetime
from uuid import UUID, uuid4

from .schemas import ChatMessage, ConversationState


class ChatRepository:
    """Simple in-memory store for chat conversations."""

    def __init__(self) -> None:
        self._conversations: dict[UUID, ConversationState] = {}
        self._lock = asyncio.Lock()

    async def create(self) -> ConversationState:
        """Create and return an empty conversation."""
        conversation_id = uuid4()
        now = datetime.utcnow()
        conversation = ConversationState(
            id=conversation_id, created_at=now, updated_at=now
        )
        async with self._lock:
            self._conversations[conversation_id] = conversation
        return conversation

    async def get(self, conversation_id: UUID) -> ConversationState | None:
        """Fetch a conversation by identifier."""
        async with self._lock:
            return self._conversations.get(conversation_id)

    async def upsert(self, conversation: ConversationState) -> ConversationState:
        """Persist the provided conversation state."""
        async with self._lock:
            self._conversations[conversation.id] = conversation
        return conversation

    async def append_message(
        self, conversation_id: UUID, message: ChatMessage
    ) -> ConversationState:
        """Append a message to the conversation and update timestamps."""
        async with self._lock:
            conversation = self._conversations.get(conversation_id)
            if conversation is None:
                raise KeyError(f"Conversation {conversation_id} not found")
            conversation.messages.append(message)
            conversation.updated_at = message.created_at
            self._conversations[conversation_id] = conversation
            return conversation

    async def list_conversations(self) -> list[ConversationState]:
        """Return a snapshot of all stored conversations."""
        async with self._lock:
            return list(self._conversations.values())
