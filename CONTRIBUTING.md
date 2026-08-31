# Contributing

Thank you for your interest in Agentic Shiksha.

## Contributor License Agreement

This project welcomes contributions and suggestions. Most contributions require you to
agree to a Contributor License Agreement (CLA) declaring that you have the right to,
and actually do, grant us the rights to use your contribution. For details, visit
<https://cla.opensource.microsoft.com>.

When you submit a pull request, a CLA bot will automatically determine whether you need
to provide a CLA and decorate the PR appropriately (e.g., status check, comment). Simply
follow the instructions provided by the bot. You will only need to do this once across
all repositories using our CLA.

## Code of Conduct

This project has adopted the
[Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), the
[Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/), or contact
[opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or
comments.

## Getting Help

See [SUPPORT.md](SUPPORT.md) for how to file issues and work through common setup
problems, and [FAQ.md](FAQ.md) for intended use, evaluation, safeguards and known
limitations.

## Reporting Security Issues

Do not open a public issue for security vulnerabilities. See [SECURITY.md](SECURITY.md)
for the coordinated disclosure process.

## Repository Layout

| Path | Purpose |
| --- | --- |
| `Backend/` | FastAPI service. Entry point is `backend/main.py`, served as `uvicorn backend.main:app`. |
| `Backend/agent_tools/` | Agent tools. `custom/` are function tools; `hosted/` wrap Foundry-hosted tools. |
| `Backend/azure_services/` | Azure integrations: agents, persistence, storage, search, evaluation. |
| `Backend/prompt_store/` | Agent instructions. Only `core_agent_prompts/` is loaded at runtime. |
| `Frontend/` | React 19 + TypeScript + Vite client. |
| `Dashboard/` | Teacher and admin dashboards (separate services). |

## Development Setup

### Backend

```bash
cd Backend
cp .env.example .env          # fill in your own Azure resources
pip install -r requirements.txt
PYTHONPATH=. uvicorn backend.main:app --reload
```

The 31 variables marked `[REQUIRED]` in `.env.example` are resolved at import time by
`azure_services/config.py`, `backend/main.py` and `auth.py`. The app deliberately fails
fast on startup if any are missing, rather than running with silent, wrong defaults.

### Frontend

```bash
cd Frontend
cp .env.example .env
npm install
npm run dev
```

## Running Tests

```bash
cd Backend
PYTHONPATH=. python -m pytest tests/ -q
```

Note that the suite reports two independent counts, for example
`63 passed, 79 subtests passed` — the second is not a subset of the first.

Several test modules import the Azure configuration chain, so they need the required
environment variables to be set. Placeholder values are sufficient; no test makes a
live Azure call.

## Pull Requests

1. Keep changes focused — one concern per pull request.
2. Run the backend tests and `npx tsc -p tsconfig.app.json --noEmit` for frontend changes.
3. Never commit `.env` files, credentials, or personal data. Test fixtures should use
   example addresses such as `user@example.com`.
4. Explain *why* in the PR description; the diff already shows *what*.

## Trademarks

This project may contain trademarks or logos for projects, products, or services.
Authorized use of Microsoft trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause
confusion or imply Microsoft sponsorship. Any use of third-party trademarks or logos is
subject to those third parties' policies.
