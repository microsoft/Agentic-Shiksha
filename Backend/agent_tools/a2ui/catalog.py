"""
A2UI custom catalog for EKALAIVA's educational widgets.

A2UI (https://a2ui.org) lets an agent describe UI declaratively while the client
renders it with its own trusted components. Rather than using A2UI's generic
catalog (Card / Button / TextField), we register our seven pedagogical widgets as
custom component types so their domain semantics (correct answers, difficulty,
hint ordering) survive the round trip.

Spec version targeted: v0.9.1 (current production release).
"""

from typing import Any, Dict, List

# Catalog identifier sent in the `createSurface` message. Clients match on this
# to pick the component registry they render with.
CATALOG_ID = "https://ekalaiva.dev/a2ui/v1/catalog.json"

A2UI_VERSION = "0.9.1"

# Maps the backend stream event type -> A2UI component type name.
# Keys mirror the event types emitted by the agent stream generator.
BLOCK_COMPONENT_TYPES: Dict[str, str] = {
    "quiz": "Quiz",
    "flashcard": "Flashcard",
    "challenge": "Challenge",
    "document": "Document",
    "message_block": "MessageBlock",
    "tikz_image": "DiagramImage",
    # Read compatibility for legacy producers. New TikZ tools emit tikz_image.
    "sympy_image": "DiagramImage",
    "generated_image": "GeneratedImage",
    "clarify": "Clarify",
    "suggested_queries": "SuggestedQueries",
}

# Properties each component binds from the surface data model. These are the
# exact keys the corresponding tool payload provides.
COMPONENT_PROPERTIES: Dict[str, List[str]] = {
    "Quiz": ["title", "assessmentType", "thresholdConcept", "questions"],
    "Flashcard": ["title", "cards"],
    "Challenge": [
        "title",
        "description",
        "difficulty",
        "hints",
        "solution",
        "challenge_type",
    ],
    "Document": ["title", "content", "doc_type"],
    "MessageBlock": ["content"],
    "ChemistryVisual": [
        "title",
        "imageData",
        "caption",
        "smiles",
        "visualizationType",
        "patternSmarts",
    ],
    "DiagramImage": ["title", "imageData", "caption", "visualizationType"],
    "GeneratedImage": ["title", "imageData", "imageUrl", "caption", "size", "quality"],
    "Clarify": ["clarifyId", "questions"],
    "SuggestedQueries": ["queries"],
}

# Properties that carry streamed text and therefore receive incremental
# `updateDataModel` patches while the block is still being generated.
STREAMING_PROPERTY: Dict[str, str] = {
    "Document": "content",
    "MessageBlock": "content",
}


def build_catalog_definition() -> Dict[str, Any]:
    """Return the machine-readable catalog document served to clients."""
    return {
        "catalogId": CATALOG_ID,
        "version": A2UI_VERSION,
        "name": "EKALAIVA Educational Widgets",
        "description": (
            "Trusted, pre-approved teaching components. Agents may only request "
            "these types; no arbitrary UI or executable code is accepted."
        ),
        "components": [
            {
                "type": component_type,
                "properties": [
                    {"name": prop, "binding": "dataModel"}
                    for prop in COMPONENT_PROPERTIES[component_type]
                ],
                "streamingProperty": STREAMING_PROPERTY.get(component_type),
            }
            for component_type in sorted(COMPONENT_PROPERTIES)
        ],
    }
