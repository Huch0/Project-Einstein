"""Chat engine abstraction and concrete implementations."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Iterable, Protocol

from openai import AsyncOpenAI
from openai import OpenAIError
from openai.types.chat import ChatCompletion

from .schemas import ChatMessage, ChatRole, ConversationState


_SUPPORTED_ROLE_VALUES = {role.value for role in ChatRole}


class ChatEngine(Protocol):
    """Interface for chat response generation."""

    async def generate(
        self,
        conversation: ConversationState,
        user_message: ChatMessage,
        metadata: dict[str, Any],
    ) -> list[ChatMessage]:
        """Produce assistant/tool messages in response to the latest user turn."""


@dataclass(slots=True)
class OpenAIChatConfig:
    """Configuration options for the OpenAI chat engine."""

    model: str
    temperature: float = 0.7
    top_p: float | None = None
    max_output_tokens: int | None = None
    presence_penalty: float | None = None
    frequency_penalty: float | None = None
    system_prompt: str | None = None
    response_metadata: dict[str, Any] = field(default_factory=dict)


class OpenAIChatEngine:
    """Chat engine that proxies conversations to OpenAI's GPT models."""

    def __init__(self, client: AsyncOpenAI, config: OpenAIChatConfig) -> None:
        self._client = client
        self._config = config

    async def generate(
        self,
        conversation: ConversationState,
        user_message: ChatMessage,
        metadata: dict[str, Any],
    ) -> list[ChatMessage]:
        prompt_messages = list(self._build_prompt(conversation, user_message))
        try:
            response = await self._client.chat.completions.create(
                model=self._config.model,
                messages=prompt_messages,
                temperature=self._config.temperature,
                top_p=self._config.top_p,
                max_tokens=self._config.max_output_tokens,
                presence_penalty=self._config.presence_penalty,
                frequency_penalty=self._config.frequency_penalty,
            )
        except OpenAIError as exc:  # pragma: no cover - network failure guard
            raise RuntimeError("OpenAI chat completion failed") from exc
        return self._to_chat_messages(response, metadata)

    def _build_prompt(
        self, conversation: ConversationState, user_message: ChatMessage
    ) -> Iterable[dict[str, str]]:
        if self._config.system_prompt:
            yield {"role": "system", "content": self._config.system_prompt}

        for message in conversation.messages:
            yield {"role": message.role.value, "content": message.content}

        # Ensure the latest user turn is present even if the caller did not persist it yet.
        if not conversation.messages or conversation.messages[-1].id != user_message.id:
            yield {"role": "user", "content": user_message.content}

    def _to_chat_messages(
        self, completion: ChatCompletion, metadata: dict[str, Any]
    ) -> list[ChatMessage]:
        usage_metadata: dict[str, Any] = {}
        if completion.usage:
            usage_metadata = completion.usage.model_dump()

        messages: list[ChatMessage] = []
        for choice in completion.choices:
            message = choice.message
            content = self._render_content(message.content)
            role_value = message.role or ChatRole.ASSISTANT.value
            if role_value not in _SUPPORTED_ROLE_VALUES:
                role_value = ChatRole.ASSISTANT.value
            tool_calls = getattr(message, "tool_calls", None)
            assistant_message = ChatMessage(
                role=ChatRole(role_value),
                content=content,
                created_at=datetime.utcnow(),
                metadata={
                    "model": completion.model,
                    "finish_reason": choice.finish_reason,
                    "choice_index": choice.index,
                    "upstream_metadata": metadata,
                    "engine_metadata": self._config.response_metadata,
                    "usage": usage_metadata,
                },
            )
            if tool_calls:
                serialized_calls = []
                for call in tool_calls:
                    if hasattr(call, "model_dump"):
                        serialized_calls.append(call.model_dump())
                    else:
                        serialized_calls.append(call)
                assistant_message.metadata["tool_calls"] = serialized_calls
            messages.append(assistant_message)
        return messages

    @staticmethod
    def _render_content(content: Any) -> str:
        if content is None:
            return ""
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            text_parts = []
            for item in content:
                text = item.get("text") if isinstance(item, dict) else None
                if text:
                    text_parts.append(text)
            if text_parts:
                return "".join(text_parts)
        return json.dumps(content)


class EchoChatEngine:
    """Fallback engine that returns a simple acknowledgement."""

    async def generate(
        self,
        conversation: ConversationState,
        user_message: ChatMessage,
        metadata: dict[str, Any],
    ) -> list[ChatMessage]:
        content = "I heard you say: {}".format(user_message.content.strip())
        assistant_message = ChatMessage(
            role=ChatRole.ASSISTANT,
            content=content,
            created_at=datetime.utcnow(),
            metadata={"echo": True, "source": "echo"},
        )
        return [assistant_message]
