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
`CustomTool` subclass**, and the name `search_knowledge_base` does not appear anywhere in
the backend Python source. Nothing dispatches it.

Course retrieval currently runs through the hosted Azure AI Search tool in
[../../hosted/azure_ai_search/](../../hosted/azure_ai_search), which Foundry executes
server-side.

Keep this schema only if the local variant is coming back. Otherwise it is dead weight
that will drift out of sync with the retrieval that actually runs — and because
[test_tool_definitions.py](../../../tests/test_tool_definitions.py) checks definitions
against registered classes, an orphaned schema is exactly the kind of drift that suite
exists to catch.
