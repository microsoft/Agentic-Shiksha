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
agents that already exist. Updating them requires an explicit new-version operation;
some feature routers provide narrow owner/admin tool updates.

An `AgentObject` inlines its definition at `versions.latest.definition` (kind, model,
instructions, tools). Read the selected version object rather than assuming a
top-level `.version`. Tools follow the installed SDK's object model; use its
attributes or explicit serialization rather than assuming the older nested
`{"function": ...}` format.

The production chat/dispatch runtime is [harness/runtime.py](../../harness/runtime.py).
Lifecycle or CLI-style helpers in this package can create/delete live resources:
they are not install-time validation commands.
