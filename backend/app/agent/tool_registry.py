"""
Agent Tool Registry

Registers all agent tools with OpenAI function calling format and validation.
"""

from typing import Any, Callable

from pydantic import BaseModel

from .tools.segment_image import (
    segment_image,
    SegmentImageInput,
    SegmentImageOutput
)
from .tools.label_segments import (
    label_segments,
    LabelSegmentsInput,
    LabelSegmentsOutput
)
from .tools.validate_entities import (
    validate_scene_entities,
    ValidateEntitiesInput,
    ValidateEntitiesOutput
)
from .tools.build_scene import (
    build_physics_scene,
    BuildSceneInput,
    BuildSceneOutput
)
from .tools.simulate_physics import (
    simulate_physics,
    SimulatePhysicsInput,
    SimulatePhysicsOutput
)
from .tools.analyze_results import (
    analyze_simulation,
    AnalyzeSimulationInput,
    AnalyzeSimulationOutput
)


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
        """Register all available tools."""
        # Tool 1: segment_image
        self.register_tool(ToolMetadata(
            name="segment_image",
            description=(
                "Extract object boundaries from physics diagram image using SAM. "
                "Returns segments with bounding boxes, polygons, and image metadata."
            ),
            input_schema=SegmentImageInput,
            output_schema=SegmentImageOutput,
            function=segment_image,
            category="preprocessing"
        ))
        
        # Tool 2: label_segments
        self.register_tool(ToolMetadata(
            name="label_segments",
            description=(
                "Identify physics entities (mass, pulley, surface, etc.) from segments. "
                "Uses GPT Vision to estimate physical properties like mass, friction, etc."
            ),
            input_schema=LabelSegmentsInput,
            output_schema=LabelSegmentsOutput,
            function=label_segments,
            category="labeling"
        ))
        
        # Tool 3: validate_scene_entities
        self.register_tool(ToolMetadata(
            name="validate_scene_entities",
            description=(
                "Validate entity set and determine scene type (pulley, ramp, pendulum, spring). "
                "Checks if entities are sufficient for building a physical scene. "
                "Returns warnings and suggestions for missing or extra entities."
            ),
            input_schema=ValidateEntitiesInput,
            output_schema=ValidateEntitiesOutput,
            function=validate_scene_entities,
            category="validation"
        ))
        
        # Tool 4: build_physics_scene
        self.register_tool(ToolMetadata(
            name="build_physics_scene",
            description=(
                "Convert entities and geometry into simulator-ready Scene JSON. "
                "Maps pixel coordinates to physical units, creates bodies and constraints. "
                "Returns complete scene specification with warnings for inferred values."
            ),
            input_schema=BuildSceneInput,
            output_schema=BuildSceneOutput,
            function=build_physics_scene,
            category="scene_building"
        ))
        
        # Tool 5: simulate_physics
        self.register_tool(ToolMetadata(
            name="simulate_physics",
            description=(
                "Run physics simulation using Matter.js or analytic solver. "
                "Generates motion frames showing positions over time. "
                "Returns frames, energy data, and simulation summary."
            ),
            input_schema=SimulatePhysicsInput,
            output_schema=SimulatePhysicsOutput,
            function=simulate_physics,
            category="simulation"
        ))
        
        # Tool 6: analyze_simulation
        self.register_tool(ToolMetadata(
            name="analyze_simulation",
            description=(
                "Analyze simulation results for correctness and pedagogical insights. "
                "Checks energy conservation, constraint violations, motion characteristics. "
                "Provides human-readable explanations of system behavior."
            ),
            input_schema=AnalyzeSimulationInput,
            output_schema=AnalyzeSimulationOutput,
            function=analyze_simulation,
            category="analysis"
        ))
    
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
        except Exception as e:
            raise ValueError(f"Invalid input for tool '{tool_name}': {str(e)}")
        
        # Invoke tool function
        try:
            result = await tool.function(validated_input)
        except Exception as e:
            raise Exception(
                f"Tool '{tool_name}' execution failed: {str(e)}"
            )
        
        # Convert output to dict
        if isinstance(result, BaseModel):
            return result.model_dump()
        return result


# Global registry instance
_registry = ToolRegistry()


def get_registry() -> ToolRegistry:
    """Get global tool registry instance."""
    return _registry
