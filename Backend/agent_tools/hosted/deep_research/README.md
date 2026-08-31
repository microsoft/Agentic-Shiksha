# deep_research (hosted)

Builds a `DeepResearchTool` for long-running, multi-step research runs.

| | |
|---|---|
| Builder | [builder.py](builder.py) → `build_deep_research_tool()` |
| Executed by | Azure AI Foundry, server-side |

## Configuration

All three are resolved at **import time** by
[backend/main.py](../../../backend/main.py), so the module will not import without them:

| Variable | Purpose |
|---|---|
| `DEEP_RESEARCH_PROJECT_ENDPOINT` | Foundry project hosting the research agent |
| `DEEP_RESEARCH_BING_CONNECTION_ID` | Bing connection used for grounding |
| `DEEP_RESEARCH_AGENT_ID` | The research agent itself |

Optional: `DEEP_RESEARCH_MODEL`, `DEEP_RESEARCH_BASE_MODEL`,
`DEEP_RESEARCH_MODEL_DEPLOYMENT_NAME`.

Runs are long by design — expect minutes, not seconds — so callers must treat this as
asynchronous rather than a normal tool round-trip. Prompts live in
[prompt_store/research_agents/](../../../prompt_store/research_agents).
