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
    import logging
    logger = logging.getLogger("unified_chat")
    
    registry = get_registry()
    
    # Get or create context
    context = context_store.get_context(conversation_id)
    if not context:
        context = context_store.create_context()
        context.conversation_id = conversation_id
        logger.info(f"[Agent] Created new conversation: {conversation_id}")
    
    # Add user message
    context.add_message("user", message)
    
    # Enhance message with explicit tool call hints for GPT-5
    enhanced_message = message
    message_lower = message.lower()
    
    # Detect intent and add explicit tool call instructions
    if any(keyword in message_lower for keyword in ["세그먼트", "segment", "분석", "analyze", "시뮬레이션", "simulate", "진행", "proceed"]):
        if context.image_id and not context.segments:
            # Has image but no segments - need to segment first
            enhanced_message += f"\n\n[INSTRUCTION: Call segment_image tool NOW with image_id='{context.image_id}' to extract object boundaries from the uploaded diagram.]"
        elif context.segments and not context.entities:
            # Has segments but no entities - need to label
            enhanced_message += f"\n\n[INSTRUCTION: Call label_segments tool NOW to identify the {len(context.segments)} detected objects (masses, pulleys, etc.)]"
        elif context.entities and not context.scene:
            # Has entities but no scene - need to build
            enhanced_message += f"\n\n[INSTRUCTION: Call build_physics_scene tool NOW to construct the simulation scene from {len(context.entities)} entities.]"
        elif context.scene and not context.frames:
            # Has scene but no simulation - need to simulate
            enhanced_message += "\n\n[INSTRUCTION: Call simulate_physics tool NOW to run the Matter.js simulation.]"
        elif context.frames:
            # Has simulation - analyze
            enhanced_message += "\n\n[INSTRUCTION: Call analyze_simulation tool NOW to evaluate the simulation results.]"
    
    # Update the message if enhanced
    if enhanced_message != message:
        context.messages[-1]["content"] = enhanced_message
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
            
            # Add explicit image context to the message for GPT-5
            image_context = f"\n[System: User has uploaded an image with ID: {image_id}. Use the segment_image tool to analyze it.]"
            context.messages[-1]["content"] += image_context
    
    # Prepare OpenAI request
    system_prompt = get_agent_system_prompt()
    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(context.messages)
    
    # Detect if we're using GPT-5 (or o1 models) - use Responses API
    is_gpt5 = settings.OPENAI_MODEL.startswith("gpt-5") or settings.OPENAI_MODEL.startswith("o1")
    
    # Get appropriate tool schemas
    if is_gpt5:
        tools = registry.get_gpt5_function_schemas()
    else:
        tools = registry.get_openai_function_schemas()
    
    logger.info(f"[Agent] Available tools: {[t.get('name') or t.get('function', {}).get('name') for t in tools]}")
    
    # Log user messages for debugging
    user_messages = [m for m in messages if m["role"] == "user"]
    logger.info(f"[Agent] User messages: {[m['content'][:100] for m in user_messages]}")
    logger.info(f"[Agent] Context state: image_id={context.image_id}, segments={len(context.segments)}, entities={len(context.entities)}")
    
    client = openai.AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    
    # Detect if we're using GPT-5 (or o1 models) - use Responses API
    is_gpt5 = settings.OPENAI_MODEL.startswith("gpt-5") or settings.OPENAI_MODEL.startswith("o1")
    
    # Convert messages to conversational format (for GPT-5)
    # GPT-5 Responses API needs clear instruction format
    if is_gpt5:
        # Extract system message and format it as instructions
        system_msg = next((msg["content"] for msg in messages if msg["role"] == "system"), "")
        user_assistant_msgs = [msg for msg in messages if msg["role"] != "system"]
        
        # Format: Instructions first, then conversation
        conversation_parts = []
        if system_msg:
            conversation_parts.append(f"<instructions>\n{system_msg}\n</instructions>\n")
        
        conversation_parts.extend([
            f"{msg['role']}: {msg['content']}" for msg in user_assistant_msgs
        ])
        conversation_text = "\n".join(conversation_parts)
    else:
        conversation_text = "\n".join([
            f"{msg['role']}: {msg['content']}" for msg in messages
        ])
    
    # Log conversation for debugging
    logger.info(f"[Agent] Conversation text (first 500 chars): {conversation_text[:500]}")
    
    # Call OpenAI with tool support
    logger.info(f"[Agent] Calling {settings.OPENAI_MODEL} ({'Responses API' if is_gpt5 else 'Chat Completions API'}) with {len(messages)} messages and {len(tools)} tools")
    
    if is_gpt5:
        # GPT-5 uses Responses API with 'input' parameter
        # Include system prompt explicitly in conversation
        first_response = await client.responses.create(
            model=settings.OPENAI_MODEL,
            input=conversation_text,  # Already includes system message
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
            model=settings.OPENAI_MODEL,
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
            
            # Inject image_id for segment_image if not provided
            if tool_name == "segment_image" and "image_data" not in tool_args:
                if context.image_id:
                    tool_args["image_data"] = context.image_id
                    logger.info(f"[Agent] Injected image_id: {context.image_id}")
            
            # Inject frames/scene for analyze_simulation if not provided
            if tool_name == "analyze_simulation":
                if "frames" not in tool_args and context.frames:
                    tool_args["frames"] = context.frames
                    logger.info(f"[Agent] Injected frames: {len(context.frames)} frames")
                if "scene" not in tool_args and context.scene:
                    tool_args["scene"] = context.scene
                    logger.info(f"[Agent] Injected scene")
            
            try:
                result = await registry.invoke_tool(tool_name, tool_args)
                logger.info(f"[Agent] ✓ {tool_name} succeeded")
                
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
                logger.error(f"[Agent] ✗ {tool_name} failed: {str(e)}")
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
            final_message = ""
            if hasattr(final_response, 'output'):
                for item in final_response.output:
                    if getattr(item, 'type', None) == 'text' and hasattr(item, 'text'):
                        final_message += item.text
            elif hasattr(final_response, 'output_text'):
                final_message = final_response.output_text
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
    
    # Add assistant message to context
    context.add_message("assistant", final_message)
    context_store.update_context(context)
    
    # Build state snapshot (v0.4 - no scene_kind)
    state_snapshot = {
        "image_id": context.image_id,
        "segments_count": len(context.segments),
        "entities_count": len(context.entities),
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
    elif tool_name == "build_physics_scene":
        context.update_pipeline_state(
            scene=result["scene"]
        )
    elif tool_name == "simulate_physics":
        context.update_pipeline_state(
            frames=result["frames"]
        )
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
    
    # Enhance message with explicit tool call hints for GPT-5
    enhanced_message = message
    message_lower = message.lower()
    
    # Detect intent and add explicit tool call instructions
    if any(keyword in message_lower for keyword in ["세그먼트", "segment", "분석", "analyze", "시뮬레이션", "simulate", "진행", "proceed"]):
        if context.image_id and not context.segments:
            # Has image but no segments - need to segment first
            enhanced_message += f"\n\n[INSTRUCTION: Call segment_image tool NOW with image_id='{context.image_id}' to extract object boundaries from the uploaded diagram.]"
        elif context.segments and not context.entities:
            # Has segments but no entities - need to label
            enhanced_message += f"\n\n[INSTRUCTION: Call label_segments tool NOW to identify the {len(context.segments)} detected objects (masses, pulleys, etc.)]"
        elif context.entities and not context.scene:
            # Has entities but no scene - need to build
            enhanced_message += f"\n\n[INSTRUCTION: Call build_physics_scene tool NOW to construct the simulation scene from {len(context.entities)} entities.]"
        elif context.scene and not context.frames:
            # Has scene but no simulation - need to simulate
            enhanced_message += "\n\n[INSTRUCTION: Call simulate_physics tool NOW to run the Matter.js simulation.]"
        elif context.frames:
            # Has simulation - analyze
            enhanced_message += "\n\n[INSTRUCTION: Call analyze_simulation tool NOW to evaluate the simulation results.]"
    
    # Update the message if enhanced
    if enhanced_message != message:
        context.messages[-1]["content"] = enhanced_message
    
    # Process attachments
    for attachment in attachments:
        if attachment.get("type") == "image":
            context.update_pipeline_state(
                image_id=attachment.get("id", "uploaded_image"),
                image_metadata={"uploaded": True}
            )
            
            # Add explicit image context to the message for GPT-5
            image_id = attachment.get("id", "uploaded_image")
            image_context = f"\n[System: User has uploaded an image with ID: {image_id}. Use the segment_image tool to analyze it.]"
            context.messages[-1]["content"] += image_context
    
    # Prepare OpenAI request
    system_prompt = get_agent_system_prompt()
    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(context.messages)
    
    # Detect if we're using GPT-5 (or o1 models) - use Responses API
    is_gpt5 = settings.OPENAI_MODEL.startswith("gpt-5") or settings.OPENAI_MODEL.startswith("o1")
    
    # Get appropriate tool schemas
    if is_gpt5:
        tools = registry.get_gpt5_function_schemas()
    else:
        tools = registry.get_openai_function_schemas()
    
    client = openai.AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    
    # Detect if we're using GPT-5 (or o1 models) - use Responses API
    is_gpt5 = settings.OPENAI_MODEL.startswith("gpt-5") or settings.OPENAI_MODEL.startswith("o1")
    
    # Convert messages to conversational format (for GPT-5)
    # GPT-5 Responses API needs clear instruction format
    if is_gpt5:
        # Extract system message and format it as instructions
        system_msg = next((msg["content"] for msg in messages if msg["role"] == "system"), "")
        user_assistant_msgs = [msg for msg in messages if msg["role"] != "system"]
        
        # Format: Instructions first, then conversation
        conversation_parts = []
        if system_msg:
            conversation_parts.append(f"<instructions>\n{system_msg}\n</instructions>\n")
        
        conversation_parts.extend([
            f"{msg['role']}: {msg['content']}" for msg in user_assistant_msgs
        ])
        conversation_text = "\n".join(conversation_parts)
    else:
        conversation_text = "\n".join([
            f"{msg['role']}: {msg['content']}" for msg in messages
        ])
    
    yield f"event: thinking\ndata: {json.dumps({'status': 'calling_gpt'})}\n\n"
    
    # Call OpenAI
    if is_gpt5:
        # GPT-5 uses Responses API with 'input' parameter
        response = await client.responses.create(
            model=settings.OPENAI_MODEL,
            input=conversation_text,
            tools=tools,
            reasoning={"effort": "medium"},
            text={"verbosity": "medium"}
        )
        
        # GPT-5 Responses API has different structure
        assistant_text = response.output_text if hasattr(response, 'output_text') else ""
        tool_calls_raw = getattr(response, 'tool_calls', [])
        
        # Create a mock message object for compatibility
        class MockMessage:
            def __init__(self, content, tool_calls):
                self.content = content
                self.tool_calls = tool_calls
        
        assistant_message_obj = MockMessage(assistant_text, tool_calls_raw)
    else:
        # GPT-4 models use Chat Completions API
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
            
            # Inject image_id for segment_image if not provided
            if tool_name == "segment_image" and "image_data" not in tool_args:
                if context.image_id:
                    tool_args["image_data"] = context.image_id
            
            # Inject frames/scene for analyze_simulation if not provided
            if tool_name == "analyze_simulation":
                if "frames" not in tool_args and context.frames:
                    tool_args["frames"] = context.frames
                if "scene" not in tool_args and context.scene:
                    tool_args["scene"] = context.scene
            
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
                
                # State update event with full data for simulate_physics
                state_snapshot = {
                    "segments_count": len(context.segments),
                    "entities_count": len(context.entities),
                    "has_scene": context.scene is not None,
                    "frames_count": len(context.frames)
                }
                
                # Include full simulation data for visualization
                if tool_name == "simulate_physics" and result:
                    state_snapshot["scene"] = context.scene
                    state_snapshot["frames"] = result.get("frames", [])
                    if context.image_metadata:
                        state_snapshot["image"] = context.image_metadata
                
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
            final_message = final_response.output_text if hasattr(final_response, 'output_text') else ""
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
