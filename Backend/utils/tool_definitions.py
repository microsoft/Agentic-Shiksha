"""
Tool definition loader.

Central place to load agent tool/function schemas that live as versioned JSON
files under ``agent_tools/custom/<tool>/definition.json``. Mirrors the prompt
loading pattern in :mod:`utils.prompt_unifier` so tool schemas are no longer
inlined as large Python dict literals inside the modules that use them.

Each call returns a freshly parsed dict, so callers can safely mutate the
result without affecting other callers.
"""

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List

from pydantic import BaseModel, ConfigDict, model_validator

# Root of the per-tool folder layout. Each tool lives in its own folder under
# ``agent_tools/custom/<tool>/`` and ships exactly one ``definition.json``.
# Multi-tool handlers keep several named ``<tool>.json`` files in one folder
# (e.g. ``logging_agent_tools/``).
CUSTOM_TOOLS_DIR = Path(__file__).parent.parent / "agent_tools" / "custom"

# JSON filenames that map to a folder-derived key rather than their own stem.
_RESERVED_DEFINITION_FILES = {"definition.json"}


# ---------------------------------------------------------------------------
# Contract validation
# ---------------------------------------------------------------------------
# Every tool definition is validated against this schema the first time it is
# loaded. This is the single source of truth for what a *valid* tool definition
# looks like, so a malformed or drifted JSON file fails fast at import time
# instead of being silently sent to the model at runtime.
#
# Two wire-format shapes are accepted and normalized:
#   * flat   (Responses API):  {"type": "function", "name", "description", "parameters"}
#   * nested (Chat API):       {"type": "function", "function": {"name", ...}}


class _ParametersSchema(BaseModel):
    """A JSON-Schema ``object`` describing a tool's parameters."""

    model_config = ConfigDict(extra="allow")

    type: str
    properties: Dict[str, Any] = {}
    required: List[str] = []

    @model_validator(mode="after")
    def _check(self) -> "_ParametersSchema":
        if self.type != "object":
            raise ValueError(
                f"parameters.type must be 'object', got {self.type!r}"
            )
        missing = [r for r in self.required if r not in self.properties]
        if missing:
            raise ValueError(
                f"'required' lists properties that are not defined: {missing}"
            )
        return self


class ToolDefinition(BaseModel):
    """Normalized view of a tool definition used for validation only."""

    model_config = ConfigDict(extra="allow")

    name: str
    description: str
    parameters: _ParametersSchema

    @model_validator(mode="before")
    @classmethod
    def _normalize(cls, data: Any) -> Any:
        # Lift the nested Chat-API ``function`` wrapper into the top level so
        # both shapes validate through the same fields.
        if isinstance(data, dict) and isinstance(data.get("function"), dict):
            return data["function"]
        return data


def _validate_definition(name: str, data: Dict[str, Any]) -> None:
    """Validate a parsed definition and enforce ``name`` matches the file stem.

    Raises:
        ValueError: If the definition is malformed or its declared ``name``
            does not match the file stem.
    """
    model = ToolDefinition.model_validate(data)
    if model.name != name:
        raise ValueError(
            f"Tool definition '{name}.json' declares name={model.name!r}; "
            f"the declared name must be {name!r}."
        )


@lru_cache(maxsize=None)
def _definition_registry() -> Dict[str, Path]:
    """Map every tool definition lookup name to its JSON file on disk.

    Resolution rules for each ``agent_tools/custom/<folder>/``:

      * ``definition.json``        -> key ``<folder>``
      * any other ``<stem>.json``  -> key ``<stem>`` (multi-tool handler folders)
    """
    registry: Dict[str, Path] = {}
    if not CUSTOM_TOOLS_DIR.is_dir():
        return registry
    for folder in sorted(CUSTOM_TOOLS_DIR.iterdir()):
        if not folder.is_dir() or folder.name.startswith(("_", ".")):
            continue
        definition = folder / "definition.json"
        if definition.exists():
            registry[folder.name] = definition
        for extra in sorted(folder.glob("*.json")):
            if extra.name in _RESERVED_DEFINITION_FILES:
                continue
            registry[extra.stem] = extra
    return registry


def iter_definition_names() -> List[str]:
    """Return every tool definition lookup name discovered on disk."""
    return sorted(_definition_registry().keys())


@lru_cache(maxsize=None)
def _read_raw(name: str) -> str:
    """Read, validate, and cache the raw JSON text for a tool definition file."""
    definition_path = _definition_registry().get(name)
    if definition_path is None or not definition_path.exists():
        raise FileNotFoundError(
            f"Tool definition '{name}' not found under {CUSTOM_TOOLS_DIR}"
        )
    text = definition_path.read_text(encoding="utf-8")
    _validate_definition(name, json.loads(text))
    return text


def load_tool_definition(name: str) -> Dict[str, Any]:
    """
    Load a tool/function definition schema by name.

    The definition is validated against :class:`ToolDefinition` on first load,
    so malformed or drifted schemas raise immediately instead of failing later
    at model-call time.

    Args:
        name: The lookup name of the definition (for example ``"add_document"``
            for ``add_document/definition.json``).

    Returns:
        A fresh dict parsed from the JSON file.
    """
    return json.loads(_read_raw(name))
