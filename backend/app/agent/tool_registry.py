"""
Agent Tool Registry (v0.4)

Registers all agent tools with OpenAI function calling format and validation.
Updated for Universal Physics Builder architecture.
"""
import traceback
from time import perf_counter
from typing import Any, Callable, List, Tuple, get_args, get_origin

from pydantic import BaseModel

from app.logging_utils import get_logger, format_for_log

from .tools.scene_editor import SCENE_EDIT_TOOL_SPECS


TOOL_LOGGER = get_logger("agent.tools")


class ToolMetadata(BaseModel):
    """Metadata for a registered tool."""
    
    name: str
    description: str
    input_schema: type[BaseModel]
    output_schema: type[BaseModel]
    function: Callable
    category: str = "simulation"


class ToolRegistry:
    """
    Central registry for agent tools.
    
    Provides:
    - Tool metadata for OpenAI function calling
    - Input/output validation
    - Tool invocation with error handling
    """
    
    def __init__(self):
        self._tools: dict[str, ToolMetadata] = {}
        self._register_all_tools()

    def _register_all_tools(self):
        """Register chat-facing tools (scene editing/refinement only)."""
        self._register_scene_edit_tools()

    def _register_scene_edit_tools(self):
        for spec in SCENE_EDIT_TOOL_SPECS:
            self.register_tool(ToolMetadata(
                name=spec.name,
                description=spec.description,
                input_schema=spec.input_model,
                output_schema=spec.output_model,
                function=spec.function,
                category="scene_editing",
            ))

    @staticmethod
    def _strip_optional(annotation: Any) -> Any:
        args = get_args(annotation)
        if not args:
            return annotation
        non_none = [arg for arg in args if arg is not type(None)]  # noqa: E721
        if len(non_none) == 1 and len(non_none) != len(args):
            return non_none[0]
        return annotation

    @staticmethod
    def _infer_array_items(annotation: Any) -> dict[str, Any]:
        annotation = ToolRegistry._strip_optional(annotation)
        origin = get_origin(annotation)
        if origin in (list, List):
            args = [arg for arg in get_args(annotation) if arg is not Ellipsis]
            if args:
                return ToolRegistry._primitive_schema(args[0])
            return {"type": "string"}
        if origin in (tuple, Tuple):
            args = [arg for arg in get_args(annotation) if arg is not Ellipsis]
            if not args:
                return {"type": "string"}
            if all(arg == args[0] for arg in args[1:]):
                return ToolRegistry._primitive_schema(args[0])
            return {"anyOf": [ToolRegistry._primitive_schema(arg) for arg in args]}
        return {"type": "string"}

    @staticmethod
    def _primitive_schema(annotation: Any) -> dict[str, Any]:
        annotation = ToolRegistry._strip_optional(annotation)
        mapping = {
            float: {"type": "number"},
            int: {"type": "number"},
            str: {"type": "string"},
            bool: {"type": "boolean"},
        }
        return mapping.get(annotation, {"type": "string"})

    @staticmethod
    def _normalize_schema(schema: dict[str, Any], model: type[BaseModel]) -> dict[str, Any]:
        properties = schema.get("properties", {})
        fields = getattr(model, "model_fields", {})

        def apply_array_fixes(node: dict[str, Any], annotation: Any) -> None:
            if node.get("type") == "array":
                if "items" not in node:
                    node["items"] = ToolRegistry._infer_array_items(annotation)
                node.pop("prefixItems", None)
            elif "prefixItems" in node and "items" not in node:
                node["items"] = {
                    "anyOf": node.get("prefixItems") or [{"type": "string"}],
                }
                node.pop("prefixItems", None)

        for name, prop_schema in properties.items():
            if not isinstance(prop_schema, dict):
                continue
            field_info = fields.get(name)
            annotation = field_info.annotation if field_info else Any  # type: ignore[attr-defined]

            apply_array_fixes(prop_schema, annotation)

            if "anyOf" in prop_schema and isinstance(prop_schema["anyOf"], list):
                for entry in prop_schema["anyOf"]:
                    if isinstance(entry, dict):
                        apply_array_fixes(entry, annotation)

        return schema
    
    def register_tool(self, metadata: ToolMetadata):
        """Register a single tool."""
        self._tools[metadata.name] = metadata
    
    def get_tool(self, name: str) -> ToolMetadata | None:
        """Get tool metadata by name."""
        return self._tools.get(name)
    
    def list_tools(self) -> list[ToolMetadata]:
        """List all registered tools."""
        return list(self._tools.values())
    
    def get_openai_function_schemas(self) -> list[dict[str, Any]]:
        """
        Get tool schemas in OpenAI function calling format.
        
        Returns list of function definitions for GPT function calling API.
        """
        functions = []
        
        for tool in self._tools.values():
            # Convert Pydantic schema to OpenAI function format
            schema = tool.input_schema.model_json_schema()
            schema = self._normalize_schema(schema, tool.input_schema)
            
            function_def = {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": {
                        "type": "object",
                        "properties": schema.get("properties", {}),
                        "required": schema.get("required", [])
                    }
                }
            }
            
            functions.append(function_def)
        
        return functions
    
    def get_gpt5_function_schemas(self) -> list[dict[str, Any]]:
        """
        Get tool schemas in GPT-5 Responses API format.
        
        GPT-5 Responses API expects a slightly different format than Chat Completions.
        """
        functions = []
        
        for tool in self._tools.values():
            # Convert Pydantic schema to GPT-5 Responses API format
            schema = tool.input_schema.model_json_schema()
            schema = self._normalize_schema(schema, tool.input_schema)
            
            function_def = {
                "type": "function",
                "name": tool.name,
                "description": tool.description,
                "parameters": {
                    "type": "object",
                    "properties": schema.get("properties", {}),
                    "required": schema.get("required", [])
                }
            }
            
            functions.append(function_def)
        
        return functions
    
    async def invoke_tool(
        self,
        tool_name: str,
        arguments: dict[str, Any]
    ) -> dict[str, Any]:
        """
        Invoke a tool with validation and error handling.
        
        Args:
            tool_name: Name of tool to invoke
            arguments: Tool input arguments (will be validated)
            
        Returns:
            Tool output as dict
            
        Raises:
            ValueError: If tool not found or validation fails
            Exception: If tool execution fails
        """
        tool = self.get_tool(tool_name)
        if not tool:
            raise ValueError(f"Tool '{tool_name}' not found")
        
        # Validate input
        try:
            validated_input = tool.input_schema(**arguments)
        # print out the whole traceback for debugging
        except Exception as e:
            traceback.print_exc()
            raise ValueError(
                f"Input validation failed for tool '{tool_name}': {str(e)}"
            ) from e

        
        payload_for_log = (
            validated_input.model_dump(exclude_none=True)
            if isinstance(validated_input, BaseModel)
            else arguments
        )
        conversation_id = (
            getattr(validated_input, "conversation_id", None)
            or arguments.get("conversation_id")
        )

        TOOL_LOGGER.info(
            "[registry] tool_start name=%s conversation=%s args=%s",
            tool_name,
            conversation_id,
            format_for_log(payload_for_log)
        )
        start_time = perf_counter()

        # Invoke tool function
        try:
            result = await tool.function(validated_input)
        except Exception as e:
            duration_ms = (perf_counter() - start_time) * 1000
            TOOL_LOGGER.warning(
                "[registry] tool_error name=%s conversation=%s duration_ms=%.1f error=%s",
                tool_name,
                conversation_id,
                duration_ms,
                str(e)
            )
            raise Exception(
                f"Tool '{tool_name}' execution failed: {str(e)}"
            )
        
        duration_ms = (perf_counter() - start_time) * 1000

        # Convert output to dict
        if isinstance(result, BaseModel):
            output = result.model_dump()
        else:
            output = result

        TOOL_LOGGER.info(
            "[registry] tool_complete name=%s conversation=%s duration_ms=%.1f result=%s",
            tool_name,
            conversation_id,
            duration_ms,
            format_for_log(output)
        )

        return output


# Global registry instance
_registry = ToolRegistry()


def get_registry() -> ToolRegistry:
    """Get global tool registry instance."""
    return _registry
