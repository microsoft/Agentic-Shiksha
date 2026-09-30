# Support

Agentic Shiksha is a research project. It is provided as-is, without a service-level
agreement or commercial support, and interfaces may change between releases.

Start with [INSTALL.md](INSTALL.md) for dependencies and startup, and
[RELEASE_NOTES.md](RELEASE_NOTES.md) when upgrading an existing checkout.

## How to file issues and get help

This project uses GitHub Issues to track bugs and feature requests. Please search the
existing issues before filing a new one to avoid duplicates.

| I want to… | Where to go |
| --- | --- |
| Report a bug | Open a GitHub Issue using the guidance below |
| Request a feature | Open a GitHub Issue describing the problem, not just the solution |
| Ask how something works | Open a GitHub Discussion, or an Issue if Discussions are disabled |
| Report a security vulnerability | **Do not open an issue.** Follow [SECURITY.md](SECURITY.md) |
| Report Code of Conduct concerns | [opencode@microsoft.com](mailto:opencode@microsoft.com) |
| Contribute a change | See [CONTRIBUTING.md](CONTRIBUTING.md) |

## Before you file a bug

Most reports we cannot act on are missing configuration details. Please include:

1. **Which service** — `Agentic Shiksha Platform/Backend/`,
   `Agentic Shiksha Platform/Frontend/`, or one of the dashboard services.
2. **How you ran it** — local (`uvicorn` / `npm run dev`) or a container on App Service.
3. **The full error**, including the traceback. Startup failures usually name the exact
   problem, for example `Missing required environment variable: <NAME>`.
4. **Redacted configuration** — which of the variables marked `[REQUIRED]` in
   `Agentic Shiksha Platform/Backend/.env.example` are set. Never paste real endpoints, secrets, tokens,
   connection strings, or student data into an issue.
5. **Reproduction steps**, and what you expected instead.

## Common problems

**The backend exits immediately with `Missing required environment variable`.**
This is intentional. Configuration is resolved at import time so the app fails fast
instead of running with silent, wrong defaults. Copy
`Agentic Shiksha Platform/Backend/.env.example` to
`Agentic Shiksha Platform/Backend/.env` and fill in every variable marked `[REQUIRED]`.
Also review [INSTALL.md](INSTALL.md#main-backend): some source-required settings,
including the Search connection ID, are not marked consistently in the example.

**A required variable looks set but is still rejected.**
If the value is blank, check that you have not written the marker inline —
`KEY=  # [REQUIRED]` parses as the literal string `# [REQUIRED]`, because a trailing
comment is only stripped when a value precedes it. Leave blank values bare.

**Azure calls fail with an authentication or authorization error.**
Services authenticate with Microsoft Entra ID rather than service keys, so the signed-in
principal needs data-plane role assignments on Azure AI Search, Cosmos DB, Blob Storage
and the Foundry project. Locally, run `az login` first.

**An agent ignores a prompt or tool change.**
Instructions and tool schemas are baked into a Foundry agent version when it is created.
Editing files under `Agentic Shiksha Platform/Backend/prompt_store/` only affects newly created agents; existing
agents must be re-provisioned.

**Tests fail to import.**
Several test modules load the Azure configuration chain, so the required environment
variables must be present. CI uses placeholders for isolated tests, but that does
not make the live application or arbitrary integration scripts offline. See the
[backend test guide](<Agentic Shiksha Platform/Backend/tests/README.md>) and the
`env` block in [ci.yml](.github/workflows/ci.yml); never run diagnostics against
production just to satisfy a test import.

## Microsoft Support Policy

Support for Agentic Shiksha is limited to the resources listed above.
