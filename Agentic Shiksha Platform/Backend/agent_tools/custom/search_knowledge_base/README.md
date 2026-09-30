# search_knowledge_base

Searches the unified knowledge base — course materials (textbooks, notes, slides) and
curated educational websites — in a single query.

| | |
|---|---|
| Class | *none* |
| Tool name | `search_knowledge_base` |
| Schema | [definition.json](definition.json) |

## Arguments

| Field | Notes |
|---|---|
| `query` | The search query or question |
| `num_results` | Result count, default `5` |

## Status: schema only, not wired

Unlike every other tool in [../](..), this package contains **no `__init__.py` and no
`CustomTool` subclass**. It is not attached by the agent-creation function-tool
registry and has no local dispatcher implementation.

Course retrieval currently runs through the hosted Azure AI Search tool in
[../../hosted/azure_ai_search/](../../hosted/azure_ai_search), which Foundry executes
server-side.

The schema is retained as a reference, not a supported endpoint or capability.
[test_tool_definitions.py](../../../tests/test_tool_definitions.py) validates
on-disk schemas and separately checks the explicit `HANDLER_MODULES` list. A valid
schema does not imply that a handler is registered or the tool is enabled.
