"""A2UI protocol support for EKALAIVA's educational widget catalog."""

from agent_tools.a2ui.adapters import (
    block_to_a2ui,
    delete_surface,
    new_surface_id,
    open_streaming_surface,
    patch_streaming_text,
    to_contents,
)
from agent_tools.a2ui.catalog import (
    A2UI_VERSION,
    BLOCK_COMPONENT_TYPES,
    CATALOG_ID,
    COMPONENT_PROPERTIES,
    STREAMING_PROPERTY,
    build_catalog_definition,
)

__all__ = [
    "A2UI_VERSION",
    "BLOCK_COMPONENT_TYPES",
    "CATALOG_ID",
    "COMPONENT_PROPERTIES",
    "STREAMING_PROPERTY",
    "block_to_a2ui",
    "build_catalog_definition",
    "delete_surface",
    "new_surface_id",
    "open_streaming_surface",
    "patch_streaming_text",
    "to_contents",
]
