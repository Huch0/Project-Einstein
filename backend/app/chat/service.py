"""Chat service orchestrating repository and engine components."""

from __future__ import annotations

from datetime import datetime
from typing import Sequence
from uuid import UUID, uuid4

from .engine import ChatEngine
from .repository import ChatRepository
from .schemas import (
    ChatMessage,
    ChatRole,
    ChatTurnRequest,
    ChatTurnResponse,
    ConversationState,
)


class ConversationNotFoundError(Exception):
    """Raised when a requested conversation does not exist."""

    def __init__(self, conversation_id: UUID) -> None:
        super().__init__(f"Conversation {conversation_id} not found")
        self.conversation_id = conversation_id


class EmptyMessageError(ValueError):
    """Raised when the user submits an empty message."""


class ChatService:
    """Core application service for chat interactions."""

    def __init__(self, repository: ChatRepository, engine: ChatEngine) -> None:
        self._repository = repository
        self._engine = engine

    async def process_turn(self, request: ChatTurnRequest) -> ChatTurnResponse:
        """Handle a user turn, returning generated assistant messages."""
        content = request.message.strip()
        if not content:
            raise EmptyMessageError("message must not be blank")

        conversation = await self._ensure_conversation(request.conversation_id)

        user_message = ChatMessage(
            id=uuid4(),
            role=ChatRole.USER,
            content=content,
            created_at=datetime.utcnow(),
            metadata={"input_metadata": request.metadata},
        )
        conversation = await self._repository.append_message(
            conversation.id, user_message
        )

        assistant_messages = await self._engine.generate(
            conversation, user_message, request.metadata
        )
        conversation = await self._append_many(conversation.id, assistant_messages)

        return ChatTurnResponse(
            conversation=conversation, new_messages=[user_message, *assistant_messages]
        )

    async def _ensure_conversation(
        self, conversation_id: UUID | None
    ) -> ConversationState:
        if conversation_id is None:
            return await self._repository.create()
        conversation = await self._repository.get(conversation_id)
        if conversation is None:
            raise ConversationNotFoundError(conversation_id)
        return conversation

    async def _append_many(
        self, conversation_id: UUID, messages: Sequence[ChatMessage]
    ) -> ConversationState:
        conversation = await self._repository.get(conversation_id)
        if conversation is None:
            raise ConversationNotFoundError(conversation_id)
        for message in messages:
            if message.role == ChatRole.USER:
                raise ValueError("Engine must not return user messages")
            conversation = await self._repository.append_message(
                conversation_id, message
            )
        return conversation
