from __future__ import annotations

from typing import Protocol, Any, Dict, List

class Builder(Protocol):
    kind: str
    def validate(self, request: Dict[str, Any]) -> List[str]: ...
    def build(self, request: Dict[str, Any]) -> Dict[str, Any]: ...  # returns Scene JSON (dict)

REGISTRY: dict[str, Builder] = {}

def register(builder: Builder) -> None:
    REGISTRY[builder.kind] = builder

def get(kind: str) -> Builder | None:
    return REGISTRY.get(kind)
