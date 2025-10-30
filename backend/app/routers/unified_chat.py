"""
Unified Chat Router (v0.4)

Supports two modes:
- Ask Mode: Normal conversation with GPT (educational Q&A)
- Agent Mode: Tool-enabled simulation pipeline orchestration

Features:
- Server-Sent Events (SSE) streaming for real-time progress
- Conversation context management
- Tool execution with progress updates
"""

from __future__ import annotations

import json
import asyncio
from typing import Any, AsyncGenerator, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, status, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
import openai

from app.models.settings import settings
from app.agent.tool_registry import get_registry
from app.agent.agent_context import get_context_store
from app.agent.prompts import get_agent_system_prompt
from app.chat.repository import ChatRepository
from app.chat.schemas import ConversationState


router = APIRouter(prefix="/chat", tags=["chat"])


# ===========================
# Pydantic Schemas
# ===========================

class ChatRequest(BaseModel):
    """Unified chat request for Ask/Agent modes."""
    
    message: str = Field(
        description="User message"
    )
    conversation_id: str | None = Field(
        default=None,
        description="Conversation ID (optional for first message)"
    )
    mode: Literal["ask", "agent"] = Field(
        default="ask",
        description="Chat mode: 'ask' for normal conversation, 'agent' for tool-enabled"
    )
    attachments: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Attachments (images, files) for Agent mode"
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
    mode: Literal["ask", "agent"] = Field(
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


# ===========================
# Ask Mode: Normal Chat
# ===========================

async def _handle_ask_mode(
    message: str,
    conversation_id: str,
    history: list[dict[str, str]]
) -> str:
    """
    Ask mode: Normal conversation without tool calls.
    
    Uses OpenAI API (GPT-5 Responses or GPT-4 Chat Completions).
    """
    client = openai.AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    
    # Prepare messages with Ask mode system prompt
    messages = [{"role": "system", "content": settings.ASK_SYSTEM_PROMPT}]
    messages.extend(history)
    messages.append({"role": "user", "content": message})
    
    # Check if using GPT-5
    is_gpt5 = settings.OPENAI_MODEL.startswith("gpt-5") or settings.OPENAI_MODEL.startswith("o1")
    
    if is_gpt5:
        # GPT-5 Responses API
        # Convert messages to single input string
        conversation_text = "\n".join([
            f"{msg['role']}: {msg['content']}" for msg in messages
        ])
        
        response = await client.responses.create(
            model=settings.OPENAI_MODEL,
            input=conversation_text,
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
    else:
        # GPT-4 Chat Completions API
        response = await client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=messages,
            temperature=settings.OPENAI_TEMPERATURE,
        )
        assistant_message = response.choices[0].message.content or ""
    
    return assistant_message


# ===========================
# Agent Mode: Tool-Enabled
# ===========================

async def _handle_agent_mode(
    message: str,
    conversation_id: str,
    attachments: list[dict[str, Any]],
    context_store
) -> tuple[str, list[dict[str, Any]], dict[str, Any]]:
    """
    Agent mode: Tool-enabled conversation.
    
    Returns: (assistant_message, tool_calls_made, state_snapshot)
    """
    registry = get_registry()
    
    # Get or create context
    context = context_store.get_context(conversation_id)
    if not context:
        context = context_store.create_context()
        context.conversation_id = conversation_id
    
    # Add user message
    context.add_message("user", message)
    
    # Process attachments
    for attachment in attachments:
        if attachment.get("type") == "image":
            context.update_pipeline_state(
                image_id=attachment.get("id", "uploaded_image"),
                image_metadata={"uploaded": True}
            )
    
    # Prepare OpenAI request
    system_prompt = get_agent_system_prompt()
    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(context.messages)
    
    tools = registry.get_openai_function_schemas()
    
    client = openai.AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    
    # Call OpenAI with tool support
    response = await client.chat.completions.create(
        model=settings.OPENAI_MODEL,
        messages=messages,
        tools=tools,
        tool_choice="auto"
    )
    
    assistant_message_obj = response.choices[0].message
    tool_calls_raw = assistant_message_obj.tool_calls or []
    assistant_text = assistant_message_obj.content or ""
    
    tool_calls_made = []
    
    # Execute tool calls
    if tool_calls_raw:
        for tool_call in tool_calls_raw:
            tool_name = tool_call.function.name
            tool_args = json.loads(tool_call.function.arguments)
            tool_id = tool_call.id
            
            try:
                result = await registry.invoke_tool(tool_name, tool_args)
                
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
                
            except Exception as e:
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
        
        # Get final response with tool results
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
    
    # Add assistant message to context
    context.add_message("assistant", final_message)
    context_store.update_context(context)
    
    # Build state snapshot
    state_snapshot = {
        "image_id": context.image_id,
        "segments_count": len(context.segments),
        "entities_count": len(context.entities),
        "scene_kind": context.scene_kind,
        "has_scene": context.scene is not None,
        "frames_count": len(context.frames)
    }
    
    return final_message, tool_calls_made, state_snapshot


def _update_context_state(context, tool_name: str, result: Any):
    """Update context state based on tool execution results."""
    if tool_name == "segment_image":
        context.update_pipeline_state(
            segments=result["segments"],
            image_metadata=result["image"]
        )
    elif tool_name == "label_segments":
        context.update_pipeline_state(
            entities=result["entities"]
        )
    elif tool_name == "validate_scene_entities":
        context.update_pipeline_state(
            scene_kind=result.get("scene_kind")
        )
    elif tool_name == "build_physics_scene":
        context.update_pipeline_state(
            scene=result["scene"]
        )
    elif tool_name == "simulate_physics":
        context.update_pipeline_state(
            frames=result["frames"]
        )


# ===========================
# Streaming: SSE
# ===========================

async def _stream_agent_mode(
    message: str,
    conversation_id: str,
    attachments: list[dict[str, Any]],
    context_store
) -> AsyncGenerator[str, None]:
    """
    Stream Agent mode execution with real-time progress updates.
    
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
        context = context_store.create_context()
        context.conversation_id = conversation_id
    
    yield f"event: init\ndata: {json.dumps({'conversation_id': conversation_id})}\n\n"
    
    # Add user message
    context.add_message("user", message)
    
    # Process attachments
    for attachment in attachments:
        if attachment.get("type") == "image":
            context.update_pipeline_state(
                image_id=attachment.get("id", "uploaded_image"),
                image_metadata={"uploaded": True}
            )
    
    # Prepare OpenAI request
    system_prompt = get_agent_system_prompt()
    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(context.messages)
    
    tools = registry.get_openai_function_schemas()
    
    client = openai.AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    
    yield f"event: thinking\ndata: {json.dumps({'status': 'calling_gpt'})}\n\n"
    
    # Call OpenAI
    response = await client.chat.completions.create(
        model=settings.OPENAI_MODEL,
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
            tool_name = tool_call.function.name
            tool_args = json.loads(tool_call.function.arguments)
            tool_id = tool_call.id
            
            # Tool start event
            yield f"event: tool_start\ndata: {json.dumps({'tool': tool_name, 'index': idx, 'total': len(tool_calls_raw)})}\n\n"
            
            try:
                # Invoke tool
                result = await registry.invoke_tool(tool_name, tool_args)
                
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
                
                # State update event
                state_snapshot = {
                    "segments_count": len(context.segments),
                    "entities_count": len(context.entities),
                    "has_scene": context.scene is not None,
                    "frames_count": len(context.frames)
                }
                yield f"event: state_update\ndata: {json.dumps(state_snapshot)}\n\n"
                
            except Exception as e:
                # Tool error event
                yield f"event: tool_error\ndata: {json.dumps({'tool': tool_name, 'error': str(e)})}\n\n"
                
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
    mode: Literal["ask", "agent"] = Query("ask", description="Chat mode"),
    conversation_id: str | None = Query(None, description="Conversation ID"),
    stream: bool = Query(True, description="Enable streaming"),
    attachments: str | None = Query(None, description="JSON-encoded attachments")
):
    """
    GET endpoint for SSE streaming (EventSource compatibility).
    
    EventSource only supports GET requests, so we provide this endpoint
    for streaming mode. Use POST /chat for non-streaming requests.
    
    Query Parameters:
    - message: User message (required)
    - mode: "ask" or "agent" (default: "ask")
    - conversation_id: Optional conversation ID
    - stream: Must be true for streaming (default: true)
    - attachments: JSON-encoded attachments array
    
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
    
    # Generate conversation ID if not provided
    conv_id = conversation_id or str(uuid4())
    
    # Stream Agent mode
    context_store = get_context_store()
    return StreamingResponse(
        _stream_agent_mode(
            message,
            conv_id,
            parsed_attachments,
            context_store
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
    Unified chat endpoint with Ask/Agent modes.
    
    Modes:
    - ask: Normal conversation (educational Q&A)
    - agent: Tool-enabled pipeline orchestration
    
    Streaming:
    - Set stream=true for Server-Sent Events
    - Provides real-time tool execution progress
    
    Example (Ask mode):
        POST /chat
        {
            "message": "What is Newton's second law?",
            "mode": "ask"
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
                    context_store
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
        if request.mode == "ask":
            # Ask mode: Normal conversation
            conversation = await _chat_repository.get(UUID(conversation_id))
            history = []
            if conversation:
                history = [
                    {"role": msg.role, "content": msg.content}
                    for msg in conversation.messages
                ]
            
            assistant_message = await _handle_ask_mode(
                request.message,
                conversation_id,
                history
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
                mode="ask",
                tool_calls=[],
                state={}
            )
        
        else:  # agent mode
            context_store = get_context_store()
            
            assistant_message, tool_calls_made, state_snapshot = await _handle_agent_mode(
                request.message,
                conversation_id,
                request.attachments,
                context_store
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
