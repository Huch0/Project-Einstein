"""Audit logging utilities for chat interactions."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable
from uuid import UUID

from .schemas import ChatMessage, ConversationState


class ChatAuditLogger:
    """Persist chat turns and agent actions for observability."""

    def __init__(self, log_path: Path, enabled: bool = True) -> None:
        self._enabled = enabled
        self._log_path = log_path
        self._lock = asyncio.Lock()
        if self._enabled:
            self._log_path.parent.mkdir(parents=True, exist_ok=True)

    async def log_turn(
        self,
        conversation: ConversationState,
        user_message: ChatMessage,
        assistant_messages: Iterable[ChatMessage],
    ) -> None:
        """Append a human-readable record describing the completed chat turn."""
        if not self._enabled:
            return
        record = {
            "type": "chat_turn",
            "logged_at": datetime.now(tz=timezone.utc).isoformat(),
            "conversation_id": str(conversation.id),
            "conversation_created_at": conversation.created_at.isoformat(),
            "conversation_updated_at": conversation.updated_at.isoformat(),
            "conversation_length": len(conversation.messages),
            "user_message": _message_to_dict(user_message),
            "assistant_messages": [_message_to_dict(msg) for msg in assistant_messages],
        }
        await self._write_entry(_format_chat_turn(record))

    async def log_agent_action(
        self,
        conversation_id: UUID,
        action_type: str,
        payload: dict,
    ) -> None:
        """Reserve hook for future agent/tool events."""
        if not self._enabled:
            return
        record = {
            "type": "agent_action",
            "logged_at": datetime.now(tz=timezone.utc).isoformat(),
            "conversation_id": str(conversation_id),
            "action_type": action_type,
            "payload": payload,
        }
        await self._write_entry(_format_agent_action(record))

    async def _write_entry(self, payload: str) -> None:
        async with self._lock:
            await asyncio.to_thread(self._append_entry, payload)

    def _append_entry(self, payload: str) -> None:
        with self._log_path.open("a", encoding="utf-8") as file:
            file.write(payload.rstrip())
            file.write("\n\n")


def _message_to_dict(message: ChatMessage) -> dict:
    return {
        "id": str(message.id),
        "role": message.role.value,
        "content": message.content,
        "created_at": message.created_at.isoformat(),
        "metadata": message.metadata,
    }


def _format_chat_turn(record: dict) -> str:
    lines = [
        "=== chat turn ===",
        f"timestamp: {record['logged_at']}",
        f"conversation_id: {record['conversation_id']}",
        f"conversation_created_at: {record['conversation_created_at']}",
        f"conversation_updated_at: {record['conversation_updated_at']}",
        f"conversation_length: {record['conversation_length']}",
        "--- user ---",
    ]

    lines.extend(_format_message(record["user_message"]))

    for idx, assistant_message in enumerate(record["assistant_messages"]):
        lines.append(f"--- assistant[{idx}] ---")
        lines.extend(_format_message(assistant_message))

    return "\n".join(lines)


def _format_agent_action(record: dict) -> str:
    payload = json.dumps(
        record["payload"], ensure_ascii=False, indent=2, sort_keys=True
    )
    lines = [
        "=== agent action ===",
        f"timestamp: {record['logged_at']}",
        f"conversation_id: {record['conversation_id']}",
        f"action_type: {record['action_type']}",
        "payload:",
        payload,
    ]
    return "\n".join(lines)


def _format_message(message_dict: dict) -> list[str]:
    metadata = json.dumps(
        message_dict.get("metadata", {}), ensure_ascii=False, indent=2, sort_keys=True
    )
    return [
        f"id: {message_dict['id']}",
        f"role: {message_dict['role']}",
        f"created_at: {message_dict['created_at']}",
        "metadata:",
        metadata,
        "content:",
        message_dict["content"],
    ]
