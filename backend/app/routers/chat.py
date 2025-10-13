"""Chat API routes."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from openai import AsyncOpenAI

from pathlib import Path

from ..chat.audit import ChatAuditLogger
from ..chat.engine import ChatEngine, EchoChatEngine, OpenAIChatConfig, OpenAIChatEngine
from ..chat.repository import ChatRepository
from ..chat.schemas import ChatTurnRequest, ChatTurnResponse, ConversationState
from ..chat.service import ChatService, ConversationNotFoundError, EmptyMessageError
from ..models.settings import settings

router = APIRouter(prefix="/chat", tags=["chat"])

_repository = ChatRepository()


def _create_audit_logger() -> ChatAuditLogger | None:
    if not settings.CHAT_AUDIT_LOG_ENABLED:
        return None
    log_path = Path(settings.CHAT_AUDIT_LOG_PATH)
    return ChatAuditLogger(log_path=log_path, enabled=True)


def _create_chat_engine() -> ChatEngine:
    if settings.OPENAI_API_KEY:
        client_kwargs: dict[str, str] = {"api_key": settings.OPENAI_API_KEY}
        if settings.OPENAI_BASE_URL:
            client_kwargs["base_url"] = settings.OPENAI_BASE_URL
        client = AsyncOpenAI(**client_kwargs)
        engine_config = OpenAIChatConfig(
            model=settings.OPENAI_MODEL,
            temperature=settings.OPENAI_TEMPERATURE,
            top_p=settings.OPENAI_TOP_P,
            max_output_tokens=settings.OPENAI_MAX_OUTPUT_TOKENS,
            presence_penalty=settings.OPENAI_PRESENCE_PENALTY,
            frequency_penalty=settings.OPENAI_FREQUENCY_PENALTY,
            system_prompt=settings.CHAT_SYSTEM_PROMPT,
            response_metadata={"provider": "openai", "model": settings.OPENAI_MODEL},
        )
        return OpenAIChatEngine(client=client, config=engine_config)
    return EchoChatEngine()


_engine: ChatEngine = _create_chat_engine()
_audit_logger = _create_audit_logger()
_service = ChatService(
    repository=_repository, engine=_engine, audit_logger=_audit_logger
)


async def get_chat_repository() -> ChatRepository:
    return _repository


async def get_chat_service() -> ChatService:
    return _service


ServiceDep = Annotated[ChatService, Depends(get_chat_service)]
RepoDep = Annotated[ChatRepository, Depends(get_chat_repository)]


@router.post("", response_model=ChatTurnResponse, status_code=status.HTTP_200_OK)
async def post_chat_turn(
    payload: ChatTurnRequest, service: ServiceDep
) -> ChatTurnResponse:
    """Process a chat turn and return generated responses."""
    try:
        return await service.process_turn(payload)
    except ConversationNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
    except EmptyMessageError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc


@router.get("/{conversation_id}", response_model=ConversationState)
async def get_conversation(
    conversation_id: UUID, repository: RepoDep
) -> ConversationState:
    """Retrieve a conversation state by identifier."""
    conversation = await repository.get(conversation_id)
    if conversation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="conversation not found"
        )
    return conversation


@router.get("", response_model=list[ConversationState])
async def list_conversations(repository: RepoDep) -> list[ConversationState]:
    """List all active conversations (development helper)."""
    return await repository.list_conversations()
