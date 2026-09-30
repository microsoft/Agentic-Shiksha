"""
Adapters converting EKALAIVA widget payloads into A2UI protocol messages.

Each widget becomes one A2UI *surface*. The component tree is a single custom
component whose properties bind to the surface data model, which keeps the
payload data separate from the UI structure and allows incremental patching
while a block is still streaming.

Message order follows the A2UI spec: component definitions and data first,
`createSurface` last (the client buffers updates until the surface is created).
"""

import uuid
from typing import Any, Dict, List, Mapping, Sequence

from agent_tools.a2ui.catalog import (
    A2UI_VERSION,
    BLOCK_COMPONENT_TYPES,
    CATALOG_ID,
    COMPONENT_PROPERTIES,
    STREAMING_PROPERTY,
)


def new_surface_id(kind: str) -> str:
    """Generate a surface id unique for the lifetime of a renderer."""
    return f"{kind}-{uuid.uuid4().hex[:12]}"


def _entry(key: str, value: Any) -> Dict[str, Any]:
    """Encode one key/value pair using A2UI's typed value fields.

    A2UI deliberately avoids a generic `value` field so clients never have to
    infer types. Note that ``bool`` is checked before the numeric branch because
    ``bool`` is a subclass of ``int`` in Python.
    """
    if value is None:
        return {"key": key, "valueString": ""}
    if isinstance(value, bool):
        return {"key": key, "valueBoolean": value}
    if isinstance(value, (int, float)):
        return {"key": key, "valueNumber": value}
    if isinstance(value, str):
        return {"key": key, "valueString": value}
    if isinstance(value, Mapping):
        return {"key": key, "valueMap": [_entry(str(k), v) for k, v in value.items()]}
    if isinstance(value, Sequence):
        return {"key": key, "valueMap": [_entry(str(i), v) for i, v in enumerate(value)]}
    return {"key": key, "valueString": str(value)}


def to_contents(payload: Mapping[str, Any]) -> List[Dict[str, Any]]:
    """Convert a flat widget payload into an A2UI data-model contents list."""
    return [_entry(str(key), value) for key, value in payload.items()]


def block_to_a2ui(
    event_type: str,
    payload: Mapping[str, Any],
    surface_id: str,
) -> List[Dict[str, Any]]:
    """Translate one widget payload into an ordered list of A2UI messages.

    Returns an empty list when ``event_type`` is not a registered widget, so the
    caller can fall through to its own handling.
    """
    component_type = BLOCK_COMPONENT_TYPES.get(event_type)
    if not component_type:
        return []

    root_id = f"{surface_id}-root"
    properties = COMPONENT_PROPERTIES[component_type]

    # Bind every catalog property to its path in the surface data model.
    bindings = {prop: {"path": f"/{prop}"} for prop in properties}

    # Only forward payload keys this component actually declares.
    data = {prop: payload.get(prop) for prop in properties if prop in payload}

    return [
        {
            "version": A2UI_VERSION,
            "updateComponents": {
                "surfaceId": surface_id,
                "components": [
                    {"id": root_id, "component": {component_type: bindings}}
                ],
            },
        },
        {
            "version": A2UI_VERSION,
            "updateDataModel": {
                "surfaceId": surface_id,
                "contents": to_contents(data),
            },
        },
        {
            "version": A2UI_VERSION,
            "createSurface": {
                "surfaceId": surface_id,
                "root": root_id,
                "catalogId": CATALOG_ID,
            },
        },
    ]


def open_streaming_surface(event_type: str, surface_id: str) -> List[Dict[str, Any]]:
    """Create an empty surface up front so streamed text can patch into it."""
    component_type = BLOCK_COMPONENT_TYPES.get(event_type)
    if not component_type or component_type not in STREAMING_PROPERTY:
        return []

    root_id = f"{surface_id}-root"
    bindings = {
        prop: {"path": f"/{prop}"} for prop in COMPONENT_PROPERTIES[component_type]
    }

    return [
        {
            "version": A2UI_VERSION,
            "updateComponents": {
                "surfaceId": surface_id,
                "components": [
                    {"id": root_id, "component": {component_type: bindings}}
                ],
            },
        },
        {
            "version": A2UI_VERSION,
            "createSurface": {
                "surfaceId": surface_id,
                "root": root_id,
                "catalogId": CATALOG_ID,
            },
        },
    ]


def patch_streaming_text(
    event_type: str,
    surface_id: str,
    chunk: str,
    index: int,
) -> List[Dict[str, Any]]:
    """Append one streamed chunk to an open surface's data model.

    Chunks are written as indexed keys under ``<prop>_chunks`` rather than
    resending the whole accumulated string each time. ``updateDataModel``
    merges at ``path``, so this stays O(total_text) instead of O(n^2); the
    client joins the chunks in key order.
    """
    component_type = BLOCK_COMPONENT_TYPES.get(event_type)
    prop = STREAMING_PROPERTY.get(component_type or "")
    if not prop or not chunk:
        return []

    return [
        {
            "version": A2UI_VERSION,
            "updateDataModel": {
                "surfaceId": surface_id,
                "path": f"{prop}_chunks",
                "contents": [{"key": str(index), "valueString": chunk}],
            },
        }
    ]


def delete_surface(surface_id: str) -> Dict[str, Any]:
    """Remove a surface and its data from the client."""
    return {
        "version": A2UI_VERSION,
        "deleteSurface": {"surfaceId": surface_id},
    }
