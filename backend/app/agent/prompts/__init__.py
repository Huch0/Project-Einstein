"""Prompt management for agent system."""
import yaml
from pathlib import Path
from typing import Dict, Any

PROMPTS_DIR = Path(__file__).parent


def load_prompt(prompt_name: str) -> Dict[str, Any]:
    """
    Load a prompt YAML file.
    
    Args:
        prompt_name: Name of prompt file (without .yaml extension)
        
    Returns:
        Dict containing prompt configuration
        
    Example:
        >>> config = load_prompt("agent_system")
        >>> system_prompt = config["system_prompt"]
    """
    prompt_path = PROMPTS_DIR / f"{prompt_name}.yaml"
    
    if not prompt_path.exists():
        raise FileNotFoundError(f"Prompt file not found: {prompt_path}")
    
    with open(prompt_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def get_agent_system_prompt() -> str:
    """Get the main agent system prompt."""
    config = load_prompt("agent_system")
    return config["system_prompt"]


def get_ask_system_prompt() -> str:
    """Get the ASK mode system prompt (educational tutor)."""
    config = load_prompt("ask_system")
    return config["system_prompt"]


def get_labeler_system_prompt() -> str:
    """Get the labeler system prompt."""
    config = load_prompt("labeler_system")
    return config["system_prompt"]


def get_labeler_user_prompt(segments_json: str) -> str:
    """
    Get the labeler user prompt with segments injected.
    
    Args:
        segments_json: JSON string of segments data
        
    Returns:
        Formatted user prompt
    """
    config = load_prompt("labeler_system")
    template = config["user_prompt_template"]
    return template.format(segments_json=segments_json)
