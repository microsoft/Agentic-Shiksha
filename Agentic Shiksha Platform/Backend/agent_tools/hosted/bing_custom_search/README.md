# bing_custom_search (hosted)

Builds a `BingCustomSearchPreviewTool` for domain-specific search over a teacher-curated
set of sites.

| | |
|---|---|
| Builder | [builder.py](builder.py) → `build_bing_custom_search_tool()` |
| Executed by | Azure AI Foundry, server-side |

## Configuration

| Variable | Purpose |
|---|---|
| `AZURE_BING_CUSTOM_SEARCH_CONNECTION_ID` | Foundry connection. Read at import time by `agent_creation.py` |
| `AZURE_BING_CUSTOM_SEARCH_INSTANCE` | Custom search instance name. Defaults to `agentic_shiksha_custom_websearch` |

The instance defines *which* sites are searchable, and it is configured in the Bing Custom
Search portal rather than in this repository. Changing the allowed sites is therefore a
portal change, not a code change.

Preferred over [../bing_grounding/](../bing_grounding) for course work, because it keeps
answers inside a set of sources a teacher has approved.
