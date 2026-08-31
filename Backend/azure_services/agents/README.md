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
