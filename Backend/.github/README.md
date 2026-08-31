# .github (Backend)

Backend-scoped AI assistant configuration. This folder holds no workflows — CI lives in
[../../.github/workflows/](../../.github/workflows).

| File | Purpose |
| --- | --- |
| [copilot-instructions.md](copilot-instructions.md) | Coding rules applied to this service: Python 3.11, FastAPI, Foundry agents, Cosmos DB, Blob Storage, AI Search. |

The instructions require that any rule an assistant has to break is flagged rather than
worked around silently. If a change here contradicts [../README.md](../README.md) or
[../../CONTRIBUTING.md](../../CONTRIBUTING.md), those documents win — update this file to
match rather than letting the two drift.
