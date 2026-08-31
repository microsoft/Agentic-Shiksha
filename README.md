# Agentic Shiksha

Agentic Shiksha is an AI-powered teaching-and-learning platform that operationalizes the
Ekalaiva framework. It provides course-specific Teaching Assistant agents and lifelong
personal-companion Lumens, aiming to shift education from knowledge *transmission* to
knowledge *transformation*.

> **Status:** research project. Interfaces and data models may change between releases.

## What it does

Rather than answering questions in isolation, each agent teaches against a course
curriculum and tracks what a learner has actually understood.

- **Course TA agents** — grounded in the teacher's own materials via retrieval-augmented
  generation, not general web knowledge.
- **Threshold concepts** — the curriculum is modelled as threshold concepts (ideas that
  are transformative and often troublesome). Progress is tracked per concept, and a
  concept is only marked complete once the learner's misconceptions have been addressed.
- **Structured output** — agents emit documents, quizzes, flashcards, challenges and
  diagrams as first-class blocks rather than walls of chat text.
- **Teacher dashboard** — usage, token analytics, groundedness evaluation and
  per-student progress.

## Architecture

```
Frontend (React + Vite)  ──►  Backend (FastAPI)  ──►  Microsoft Foundry Agents
                                     │
                                     ├──►  Azure AI Search   (course retrieval)
                                     ├──►  Azure Cosmos DB   (chat, progress, identity)
                                     └──►  Azure Blob Storage (course materials, media)
```

| Path | Purpose |
| --- | --- |
| `Backend/` | FastAPI service. Entry point `backend/main.py`, served as `uvicorn backend.main:app`. |
| `Backend/agent_tools/` | Agent tools — `custom/` are function tools, `hosted/` wrap Foundry-hosted tools. |
| `Backend/azure_services/` | Azure integrations: agents, persistence, storage, search, evaluation. |
| `Backend/prompt_store/` | Agent instructions. Only `core_agent_prompts/` is loaded at runtime. |
| `Frontend/` | React 19 + TypeScript + Vite client. |
| `Dashboard/` | Teacher and admin dashboards (separate services). |

### Retrieval

Course material is indexed with Azure AI Search's integrated pipeline: blob data source →
skillset → index. The skillset runs the Document Intelligence Layout skill for
structure-aware chunking (split at markdown headings, so tables and lists stay intact),
then embeds each chunk with Azure OpenAI. Queries use hybrid vector + keyword search over
an HNSW index, fused with Reciprocal Rank Fusion and re-scored by the semantic ranker.

## Getting started

You need an Azure subscription with Microsoft Foundry, Azure AI Search, Cosmos DB and
Blob Storage provisioned. Services authenticate with Microsoft Entra ID (managed
identity), so no service keys are required.

### Backend

```bash
cd Backend
cp .env.example .env          # fill in your own Azure resources
pip install -r requirements.txt
PYTHONPATH=. uvicorn backend.main:app --reload
```

The 31 variables marked `[REQUIRED]` in `.env.example` are resolved at import time by
`azure_services/config.py`, `backend/main.py` and `auth.py`. Startup fails immediately if
any is missing — the app will not run with silent, wrong defaults.

### Frontend

```bash
cd Frontend
cp .env.example .env
npm install
npm run dev
```

Variables prefixed `VITE_` are inlined into the browser bundle at build time and are
therefore public. Never put a credential in one.

### Tests

```bash
cd Backend
PYTHONPATH=. python -m pytest tests/ -q
```

The suite reports two independent counts, for example `63 passed, 79 subtests passed`;
the second is not a subset of the first.

## Deployment

Both services ship as containers. The build context is each service directory, and
`.dockerignore` keeps `.env` out of the image — supply configuration at runtime through
App Service application settings or an equivalent secret store. Real environment
variables take precedence over `.env`, so the same image works across environments.

```bash
# Build in a registry, then point the web app at the new tag.
az acr build --registry <registry> --image agentic-shiksha-backend:<tag> --file Dockerfile .
az webapp config container set -g <resource-group> -n <app-name> \
    --container-image-name <registry>.azurecr.io/agentic-shiksha-backend:<tag>
az webapp restart -g <resource-group> -n <app-name>
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and the CLA. This project
has adopted the [Microsoft Open Source Code of Conduct](CODE_OF_CONDUCT.md).

- [FAQ.md](FAQ.md) — intended use, evaluation, safeguards, privacy and known limitations.
- [SUPPORT.md](SUPPORT.md) — how to file an issue and get help.
- [SECURITY.md](SECURITY.md) — coordinated disclosure. Please do not open a public issue
  for a suspected vulnerability.

## Trademarks

This project may contain trademarks or logos for projects, products, or services.
Authorized use of Microsoft trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause
confusion or imply Microsoft sponsorship. Any use of third-party trademarks or logos is
subject to those third parties' policies.

## License

Licensed under the [MIT License](LICENSE).
