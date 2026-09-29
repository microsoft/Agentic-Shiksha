# azure_services/agents

Lifecycle management for Microsoft Foundry agents — creation, inspection, chat and
deletion.

| Module | Purpose |
| --- | --- |
| [agent_creation.py](agent_creation.py) | Creates agents through `AIProjectClient.agents`, with named agents and versions. |
| [agent_info.py](agent_info.py) | Reads back an agent's definition. |
| [agent_chat.py](agent_chat.py) | Turn loop, plus an optional CLI-style entrypoint. |
| [agent_deletion.py](agent_deletion.py) | Removes an agent. |

## Required configuration

`agent_creation.py` reads two connection ids at **import time**, so both must be set or
the module fails to import:

- `AZURE_BING_CONNECTION_ID` — general web search grounding
- `AZURE_BING_CUSTOM_SEARCH_CONNECTION_ID` — domain-specific search over teacher-curated
  sites

## Versioning behaviour worth knowing

Instructions and tool schemas are **baked into an agent version at creation**. Editing
[prompt_store/](../../prompt_store) or a tool's `definition.json` changes nothing about
agents that already exist — they must be re-provisioned.

An `AgentObject` inlines its definition at `versions.latest.definition` (kind, model,
instructions, tools). There is no `.version` attribute. Tools come back as SDK objects,
not dictionaries, so `tool.get("function")` silently yields nothing — read the attributes
instead.

## Optional teaching capabilities

The creation flow accepts an optional `capabilities` object with boolean
`documents`, `quizzes`, `flashcards`, `challenges`, and `images` fields. Omitted
fields default to `true`, preserving existing clients. Unknown capability names
and non-boolean values are rejected.

The settings pass through the learning-agent manager into `AgentToolBuilder`.
Disabled capabilities are omitted from the Foundry agent's function-tool list,
not merely hidden in the UI. Core chat, retrieval, memory, clarification, and
learning-progress tools are unchanged, including when all five capabilities are
disabled. Settings are saved in the agent setup and Cosmos metadata.

Run the focused regression tests from `Backend`:

```powershell
python -m unittest discover -s tests -p test_agent_capabilities.py
```
