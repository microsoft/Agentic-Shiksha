# deep_research (hosted)

Builds a `DeepResearchTool` for long-running, multi-step research runs. This
builder accepts an explicit Bing connection ID and research deployment name;
it is not automatically attached by the normal TA tool builder.

| | |
|---|---|
| Builder | [builder.py](builder.py) → `build_deep_research_tool()` |
| Executed by | Azure AI Foundry, server-side |

## Configuration

All three are resolved at **import time** by the production
[backend/main.py](../../../backend/main.py), so the main application will not
import without them. They are not environment reads in this small builder:

| Variable | Purpose |
|---|---|
| `DEEP_RESEARCH_PROJECT_ENDPOINT` | Foundry project hosting the research agent |
| `DEEP_RESEARCH_BING_CONNECTION_ID` | Bing connection used for grounding |
| `DEEP_RESEARCH_AGENT_ID` | The research agent itself |

The main workflow additionally reads `DEEP_RESEARCH_MODEL` and
`DEEP_RESEARCH_BASE_MODEL`. Inspect the specific caller before assuming a builder
configuration is used by an already-provisioned research agent.

Runs are long by design — expect minutes, not seconds — so callers must treat this as
asynchronous rather than a normal tool round-trip. Prompts live in
[prompt_store/research_agents/](../../../prompt_store/research_agents).
