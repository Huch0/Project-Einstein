"""
Agent Chat Router

Natural language interface for simulation pipeline orchestration.
"""

import json
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
import openai

from app.models.settings import settings
from app.agent.tool_registry import get_registry
from app.agent.agent_context import get_context_store, ConversationContext
from app.agent.prompts import get_agent_system_prompt


router = APIRouter(prefix="/agent", tags=["agent"])


class ChatMessage(BaseModel):
    """Single chat message."""
    
    message: str = Field(
        description="User message"
    )
    conversation_id: str | None = Field(
        default=None,
        description="Conversation ID for multi-turn chat (optional for first message)"
    )
    attachments: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Attachments (images, files, etc.)"
    )


class ToolCallRequest(BaseModel):
    """Tool call from GPT."""
    
    name: str
    arguments: dict[str, Any]


class ChatResponse(BaseModel):
    """Agent chat response."""
    
    assistant_message: str = Field(
        description="Assistant's text response"
    )
    conversation_id: str = Field(
        description="Conversation ID for continuing the chat"
    )
    tool_calls: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Tool calls made (for transparency)"
    )
    state: dict[str, Any] = Field(
        default_factory=dict,
        description="Current pipeline state snapshot"
    )


@router.post("/chat", response_model=ChatResponse)
async def agent_chat(message: ChatMessage) -> ChatResponse:
    """
    Natural language interface for simulation pipeline.
    
    The agent orchestrates the full workflow:
    1. segment_image - SAM segmentation
    2. label_segments - GPT entity recognition
    3. validate_scene_entities - Scene type determination
    4. build_physics_scene - Scene JSON construction
    5. simulate_physics - Physics simulation
    6. analyze_simulation - Results analysis
    
    Example:
        User: "Simulate this pulley diagram" [uploads image]
        Agent: Calls segment_image, label_segments, build_scene, simulate_physics
        Returns: Visualization + analysis
    
    Args:
        message: User message with optional conversation_id and attachments
        
    Returns:
        Assistant response with tool calls and updated state
    """
    store = get_context_store()
    registry = get_registry()
    
    # Get or create conversation context
    if message.conversation_id:
        context = store.get_context(message.conversation_id)
        if not context:
            raise HTTPException(
                status_code=404,
                detail=f"Conversation {message.conversation_id} not found"
            )
    else:
        context = store.create_context()
    
    # Add user message to history
    context.add_message("user", message.message)
    
    # Process attachments (images)
    for attachment in message.attachments:
        if attachment.get("type") == "image":
            # Store image data in context
            context.update_pipeline_state(
                image_id=attachment.get("id", "uploaded_image"),
                image_metadata={"uploaded": True}
            )
    
    # Prepare messages for OpenAI
    # Load system prompt from YAML
    system_prompt = get_agent_system_prompt()
    
    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(context.messages)
    
    # Get OpenAI function schemas
    tools = registry.get_openai_function_schemas()
    
    # Call OpenAI with function calling
    try:
        client = openai.OpenAI(api_key=settings.OPENAI_API_KEY)
        
        # Use Responses API for GPT-5, Chat API for GPT-4
        if settings.OPENAI_MODEL.startswith("gpt-5"):
            # GPT-5 Responses API with native tool use
            response = client.responses.create(
                model=settings.OPENAI_MODEL,
                input=json.dumps({
                    "conversation_history": messages,
                    "available_tools": tools
                }),
                reasoning={"effort": "medium"},
                text={"verbosity": "medium"},
                tools=tools,
            )
            
            # Extract tool calls from GPT-5 response
            tool_calls_raw = getattr(response, "tool_calls", [])
            assistant_text = getattr(response, "output_text", "Processing...")
            
        else:
            # GPT-4o Chat API
            response = client.chat.completions.create(
                model=settings.OPENAI_MODEL,
                messages=messages,
                tools=tools,
                tool_choice="auto"
            )
            
            assistant_message = response.choices[0].message
            tool_calls_raw = assistant_message.tool_calls or []
            assistant_text = assistant_message.content or "Processing..."
        
        tool_calls_made = []
        
        # Execute tool calls if any
        if tool_calls_raw:
            for tool_call in tool_calls_raw:
                # Handle both GPT-5 and GPT-4 tool call formats
                if hasattr(tool_call, 'function'):
                    # GPT-4 format
                    tool_name = tool_call.function.name
                    tool_args = json.loads(tool_call.function.arguments)
                    tool_id = tool_call.id
                else:
                    # GPT-5 format (assuming direct dict)
                    tool_name = tool_call.get("name")
                    tool_args = tool_call.get("arguments", {})
                    tool_id = tool_call.get("id", f"call_{len(tool_calls_made)}")
                
                try:
                    # Invoke tool
                    result = await registry.invoke_tool(tool_name, tool_args)
                    
                    # Record tool call in context
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
                    
                    # Update context state based on tool results
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
                            scene_kind=result["scene_kind"]
                        )
                    elif tool_name == "build_physics_scene":
                        context.update_pipeline_state(
                            scene=result["scene"]
                        )
                    elif tool_name == "simulate_physics":
                        context.update_pipeline_state(
                            frames=result["frames"]
                        )
                    
                except Exception as e:
                    # Record error
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
            
            # If tools were called, make another API call to get final response
            # Add tool results to messages (GPT-4 format, adapt for GPT-5 if needed)
            if settings.OPENAI_MODEL.startswith("gpt-4"):
                messages.append({
                    "role": "assistant",
                    "content": assistant_text or "",
                    "tool_calls": [
                        {
                            "id": tc.id if hasattr(tc, 'id') else f"call_{i}",
                            "type": "function",
                            "function": {
                                "name": tc.function.name if hasattr(tc, 'function') else tc.get("name"),
                                "arguments": tc.function.arguments if hasattr(tc, 'function') else json.dumps(tc.get("arguments", {}))
                            }
                        }
                        for i, tc in enumerate(tool_calls_raw)
                    ]
                })
                
                # Add tool results
                for i, tool_call in enumerate(tool_calls_raw):
                    tc_id = tool_call.id if hasattr(tool_call, 'id') else f"call_{i}"
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc_id,
                        "content": json.dumps(tool_calls_made[i].get("result", {}))
                    })
                
                # Get final response
                final_response = client.chat.completions.create(
                    model=settings.OPENAI_MODEL,
                    messages=messages
                )
                final_message = final_response.choices[0].message.content or ""
                
            else:
                # GPT-5: tool results are handled differently
                # Add tool results to input
                messages.append({
                    "role": "assistant",
                    "content": assistant_text,
                    "tool_results": tool_calls_made
                })
                
                final_response = client.responses.create(
                    model=settings.OPENAI_MODEL,
                    input=json.dumps({
                        "conversation_history": messages,
                        "tool_results": tool_calls_made
                    }),
                    reasoning={"effort": "medium"},
                    text={"verbosity": "medium"},
                )
                final_message = getattr(final_response, "output_text", assistant_text)
                
        else:
            # No tool calls, use initial response
            final_message = assistant_text
        
        # Add assistant message to context
        context.add_message("assistant", final_message)
        
        # Update context in store
        store.update_context(context)
        
        # Build state snapshot
        state_snapshot = {
            "image_id": context.image_id,
            "segments_count": len(context.segments),
            "entities_count": len(context.entities),
            "scene_kind": context.scene_kind,
            "has_scene": context.scene is not None,
            "frames_count": len(context.frames)
        }
        
        return ChatResponse(
            assistant_message=final_message,
            conversation_id=context.conversation_id,
            tool_calls=tool_calls_made,
            state=state_snapshot
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Agent chat failed: {str(e)}"
        )


@router.get("/context/{conversation_id}")
async def get_context(conversation_id: str) -> dict[str, Any]:
    """
    Retrieve full conversation context.
    
    Useful for debugging or restoring conversation state.
    """
    store = get_context_store()
    context = store.get_context(conversation_id)
    
    if not context:
        raise HTTPException(
            status_code=404,
            detail=f"Conversation {conversation_id} not found"
        )
    
    return context.model_dump()


@router.delete("/context/{conversation_id}")
async def delete_context(conversation_id: str) -> dict[str, str]:
    """Delete conversation context."""
    store = get_context_store()
    store.delete_context(conversation_id)
    return {"message": f"Conversation {conversation_id} deleted"}
