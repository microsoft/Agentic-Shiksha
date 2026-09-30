# Agentic Shiksha Platform

**Course-grounded agents that aim to change understanding, not just deliver answers.**

[Research overview](../README.md) · [Demos](../README.md#demo-gallery) ·
[Docs](../docs/README.md) · [Architecture](../docs/architecture.md) ·
[Quick start](../README.md#quick-start)

[![Agentic Shiksha logo: from knowledge transmission to knowledge transformation, with an illustrative Ask, Explore, Reframe learning path.](../assets/images/research/shiksha-research-banner.svg)](../README.md)

## What lives here?

The main product has two independently installed, built, and deployed services.
This folder groups them; it is not a Python package, npm workspace, or shared
container build context.

| Service | Responsibilities | Local port |
| --- | --- | --- |
| [Backend](Backend/README.md) | FastAPI, TA orchestration, material jobs, persistence and teacher-dashboard APIs | 8000 |
| [Frontend](Frontend/README.md) | React course chat, creation/editing, artifacts and embedded teacher dashboard | 5173 |

The separate [Admin Dashboard](../Admin-Dashboard/README.md) remains at repository
root. Do not point teacher-dashboard traffic at the admin backend: the embedded
teacher dashboard uses the main API and its session cookie.

## How does the learning loop work?

[![Learner to evidence to learner model to teaching strategy to the course TA and back to learner.](../assets/images/research/04-conceptual-loop.svg)](../docs/architecture.md)

Explore [EKALAIVA](../docs/pedagogy/ekalaiva.md),
[learner memory](../docs/memory/overview.md), and the
[observable decision record](../docs/memory/see-it-think.md).
Graph memory is opt-in and disabled by default; this figure is a research model,
not a claim that every deployment has enabled it.
The [agent catalogue](../docs/agents/README.md) maps the actual named agents to
course teaching, Course Companion, creation, research and analytics.

## How do I run it?

Start with [installation](../INSTALL.md). The current application is
Azure/Foundry-backed, not yet interchangeable with direct OpenAI, local, or custom
providers. The [provider guide](../docs/providers.md) separates current code from
the proposed portable layout.

<details>
<summary>Setup, release status, and path compatibility</summary>

- [Design and operations](../docs/README.md): architecture, pedagogy, memory,
  agent roles, evaluation, and deployment boundaries.
- [INSTALL.md](../INSTALL.md): runtime/dependency requirements, environment setup,
  startup, local containers and verification for all four services.
- [CHANGELOG.md](../CHANGELOG.md): concise change history, including Unreleased work.
- [RELEASE_NOTES.md](../RELEASE_NOTES.md): upgrade considerations and release status.
- [CONTRIBUTING.md](../CONTRIBUTING.md): development and README maintenance policy.

Commands starting at repository root must quote the directory name because it
contains spaces. Old root-level `Backend`/`Frontend` commands need this prefix.
Inside a service, its module imports and build context remain service-relative.

</details>

## Azure command reference

Commands are kept in one place per operation so the four service READMEs do not
drift or duplicate provisioning/deployment recipes:

- [Create Azure resources](Backend/azure_services/README.md#azure-resource-creation-commands):
  Foundry accounts/projects, monitoring, both Bing variants, Search, Document
  Intelligence, Speech, Cosmos, Storage, identity, optional private networking,
  Container Registry and Linux App Service Plan.
- [Build/publish images and configure App Service](../docs/deployment.md#azure-cli-container-and-app-service-commands):
  select one of the four service contexts, provide public frontend settings,
  create a new app only when needed, configure managed ACR access, supply runtime
  settings privately, and verify an approved image-only redeploy.

The examples use PowerShell and placeholders, not deployment-specific resource
names. MongoDB is optional and is not the main application's Cosmos NoSQL store.
They are reference procedures, not commands run as part of a README update.

## Where should I work?

| Area | Guide |
| --- | --- |
| Runtime and function tools | [harness](Backend/harness/README.md), [agent tools](Backend/agent_tools/README.md) |
| Azure integrations | [azure_services](Backend/azure_services/README.md) |
| Versioned prompt inputs | [prompt_store](Backend/prompt_store/README.md) |
| Backend tests | [tests](Backend/tests/README.md) |
| Frontend navigation and state | [src](Frontend/src/README.md), [lib](Frontend/src/lib/README.md) |
| Create/Edit workflows | [create](Frontend/src/features/create/README.md), [edit](Frontend/src/features/edit/README.md) |
| Chat and artifacts | [chat](Frontend/src/features/chat/README.md), [assets](Frontend/src/components/assets/README.md) |
| Teacher analytics | [backend](Backend/teacher_dashboard/README.md), [frontend](Frontend/src/features/dashboard/README.md) |

Local code or documentation changes do not update a live app or an existing Foundry
agent definition. Review the release notes and obtain separate deployment approval.
