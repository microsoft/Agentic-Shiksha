# tests

Pytest regressions for the main backend. Cloud clients, model calls and persistence
are mocked; some circuit tests additionally exercise an installed **local**
ngspice binary. There is no requirement to start Uvicorn or authenticate to Azure.

## Installation

First create the Python 3.13.5 environment and install the service requirements using
[the backend setup](../README.md#local-setup-powershell). Then, from
`Agentic Shiksha Platform\Backend`:

```powershell
.\.venv\Scripts\python.exe -m pip install pytest pytest-subtests
```

These test dependencies are installed separately in
[CI](../../../.github/workflows/ci.yml), not listed in `requirements.txt`.
The main-backend CI matrix also retains Python 3.11 compatibility coverage.

## Offline test environment

Use a **dedicated PowerShell terminal**. Disable dotenv loading so collection does
not read developer/production files, and supply synthetic import-time values.
The example below follows the backend CI environment; these are not usable live
credentials or resource addresses.

[conftest.py](conftest.py) installs synthetic MSAL tenant-discovery metadata
before test-module collection, so importing the application does not query a
real Microsoft sign-in endpoint. It only accepts the all-zero CI tenant below.
The real MSAL client and PKCE logic remain in use; no access/session tokens or
application authorization results are fabricated. Production authentication is
unchanged. An ordinary autouse fixture would be too late for module-level imports.
The bootstrap also disables private dotenv loading and blocks outbound socket
connections. Loopback/Unix-domain sockets remain available for local async test
clients; individual tests replace cloud boundaries with explicit fixtures.

```powershell
$env:PYTHONPATH = (Get-Location).Path
$env:PYTHON_DOTENV_DISABLED = "1"
$testEnvironment = @{
    AZURE_AI_PROJECT_ENDPOINT = "https://example.services.ai.azure.com/api/projects/ci"
    AZURE_AI_MODEL_DEPLOYMENT_NAME = "ci-chat"
    AZURE_AI_AGENT_MODEL_DEPLOYMENT = "ci-agent"
    AZURE_ALLOWED_DEPLOYMENTS = "ci-chat,ci-agent"
    AZURE_AUTH_TENANT_ID = "00000000-0000-0000-0000-000000000000"
    FRONTEND_URL = "http://localhost:5173"
    BACKEND_URL = "http://localhost:8000"
    AGENT_IMAGES_CONTAINER = "ci-agent-images"
    BLOB_CONTAINER_NAME = "ci-agent-files"
    AZURE_BING_CUSTOM_SEARCH_INSTANCE = "ci-websearch"
    AZURE_IMAGE_MODEL = "ci-image"
    GENERATED_IMAGES_CONTAINER = "ci-generated-images"
    TIKZ_GENERATOR_MODEL = "ci-diagram-generator"
    TIKZ_DISCRIMINATOR_MODEL = "ci-diagram-discriminator"
    TIKZ_POLISHER_MODEL = "ci-diagram-polisher"
    MEMORY_CHAT_MODEL = "ci-memory-chat"
    MEMORY_EMBEDDING_MODEL = "ci-memory-embedding"
    TEXTBOOK_RESEARCH_AGENT_NAME = "ci-textbook-research"
    THRESHOLD_CONCEPT_RESEARCH_AGENT_NAME = "ci-concept-research"
    TEACHER_ANALYTICS_AGENT_NAME = "ci-teacher-analytics"
    AZURE_AI_SEARCH_API_VERSION = "2025-11-01-preview"
    AZURE_AI_SEARCH_BLOB_CONTAINER = "ci-container"
    AZURE_AI_SEARCH_CONNECTION_ID = "/subscriptions/00000000-0000-0000-0000-000000000000/ci"
    AZURE_AI_SEARCH_ENDPOINT = "https://example.search.windows.net"
    AZURE_AI_SEARCH_SERVICE_NAME = "ci-search"
    AZURE_BING_CONNECTION_ID = "/subscriptions/00000000-0000-0000-0000-000000000000/ci-bing"
    AZURE_BING_CUSTOM_SEARCH_CONNECTION_ID = "/subscriptions/00000000-0000-0000-0000-000000000000/ci-bing-custom"
    AZURE_EVAL_MODEL = "gpt-4.1"
    AZURE_FOUNDRY_ENDPOINT = "https://example.services.ai.azure.com"
    AZURE_OPENAI_CHAT_MODEL = "gpt-4.1-mini"
    AZURE_OPENAI_ENDPOINT = "https://example.openai.azure.com"
    AZURE_RESOURCE_GROUP = "ci-resource-group"
    AZURE_SUBSCRIPTION_ID = "00000000-0000-0000-0000-000000000000"
    BING_CONNECTION_ID = "/subscriptions/00000000-0000-0000-0000-000000000000/ci-bing"
    COMMON_DATASOURCE_NAME = "ci-datasource"
    COMMON_IMAGE_CONTAINER = "ci-images"
    COMMON_INDEX_NAME = "ci-index"
    COMMON_INDEXER_NAME = "ci-indexer"
    COMMON_SKILLSET_NAME = "ci-skillset"
    COSMOS_ENDPOINT = "https://example.documents.azure.com:443/"
    COSMOS_DATABASE = "ci-database"
    DEEP_RESEARCH_AGENT_ID = "ci-deep-research-agent"
    DEEP_RESEARCH_BING_CONNECTION_ID = "/subscriptions/00000000-0000-0000-0000-000000000000/ci-bing"
    DEEP_RESEARCH_PROJECT_ENDPOINT = "https://example.services.ai.azure.com/api/projects/ci"
    DOCUMENT_INTELLIGENCE_ENDPOINT = "https://example.cognitiveservices.azure.com"
    EMBEDDING_DIMENSIONS = "1024"
    EMBEDDING_MODEL = "text-embedding-3-large"
    GOOGLE_CLIENT_ID = "ci-google-client-id"
    GOOGLE_CLIENT_SECRET = "ci-google-client-secret"
    JWT_SECRET = "ci-only-not-a-real-secret"
    PROJECT_ENDPOINT = "https://example.services.ai.azure.com/api/projects/ci"
    PROJECT_NAME = "ci-project"
    PROJECT_RESOURCE_ID = "/subscriptions/00000000-0000-0000-0000-000000000000/ci"
    STORAGE_ACCOUNT_NAME = "cistorageaccount"
    SUPER_ADMIN_EMAIL = "admin@example.com"
    VITE_AZURE_CLIENT_ID = "00000000-0000-0000-0000-000000000000"
}
foreach ($name in $testEnvironment.Keys) {
    [Environment]::SetEnvironmentVariable($name, $testEnvironment[$name], "Process")
}
```

The settings above affect only the current process and its children, not environment
files. Close this terminal after testing; do not start the cloud-backed application
using these placeholders.

## Running checks

From the backend service directory, choose the smallest relevant test set:

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_application_factory.py -q
.\.venv\Scripts\python.exe -m pytest tests\test_slides.py tests\test_tool_definitions.py -q
```

For the complete backend suite:

```powershell
.\.venv\Scripts\python.exe -m pytest tests -q
```

The application-factory test supplies its own router/configuration and does not
load the production registry. Other tests import that registry with placeholders
and replace cloud operations. Keep app lifespans out of those mocked HTTP checks.

Circuit tests marked `skipif(not shutil.which("ngspice"))` skip when the binary is
absent; when available they execute it locally. A pass with skips is not evidence
that numerical integration was exercised. No backend-cloud integration suite or
production-readiness claim is implied. Depending on pytest/plugin versions,
results may report test and unittest-subtest counts separately.

## What is covered

| Test | Guards |
| --- | --- |
| [test_ci_bootstrap.py](test_ci_bootstrap.py) | Pre-collection synthetic OAuth discovery with real MSAL/PKCE, rejection of nonfixture authorities, outbound-network isolation and loopback compatibility. |
| [test_deployment_settings.py](test_deployment_settings.py) | Explicit database/model/resource selection, optional-feature boundaries, secret-safe errors, configured session lifetime, dotenv precedence and prevention of reintroduced deployment fallbacks. |
| [test_speech_configuration.py](test_speech_configuration.py) | Authenticated voice-input token contract, missing resource/region behavior, configured endpoint selection, uncached responses and sanitized failures. |
| [test_application_factory.py](test_application_factory.py) | Factory assembly, middleware, exception handling, nested lifespans and dependency-free system routes. |
| [test_agent_creation.py](test_agent_creation.py) | Shared lifecycle manager, legacy course-creation options, no local configuration writes, duplicate-name checks and creation-failure propagation. |
| [test_foundry_sdk_compatibility.py](test_foundry_sdk_compatibility.py) | Stable Projects SDK tool names, explicit preview opt-in, memory store ownership and user-scoped memory calls. |
| [test_tool_definitions.py](test_tool_definitions.py) | Contract tests for the tool definition registry — the strongest guardrail against tool/definition drift. |
| [test_flashcard_retirement.py](test_flashcard_retirement.py) | Retired tool registration, stale-call rejection, and asset write validation without deleting historical records. |
| [test_knowledge_indexing.py](test_knowledge_indexing.py) | Verified material readiness, durable TA recovery, specification-only responses, and bounded retries that preserve saved checkpoints. |
| [test_course_form_assistant.py](test_course_form_assistant.py) | Typed form updates, attachment validation and local extraction, with mocked model calls. |
| [test_curriculum_translation.py](test_curriculum_translation.py) | Translation validation, access checks, source-versioned caching and custom-instruction isolation. |
| [test_student_assignments.py](test_student_assignments.py) | Explicit roster membership, active identities and invitation promotion. |
| [test_agent_sharing.py](test_agent_sharing.py) | TA management access and bounded public chat sharing. |
| [test_clarification_timing.py](test_clarification_timing.py) | Deadlines, drafts, extensions, ownership and concurrent waits. |
| [test_slides.py](test_slides.py) | Ten bounded layouts, component target/Unicode/XML/total-length contracts, exact native notes export, immutable original/private-copy persistence, and read-only status plus confirmed owner-only tool refresh. |
| [test_circuit_simulation.py](test_circuit_simulation.py) | Circuit validation, HTTP/tool behavior, rejection of retired trainer inputs/routes, explicit schema updates and optional local ngspice numerical checks. |
| [test_graph_memory_persistence.py](test_graph_memory_persistence.py) | Graph/learner repository partition boundaries, conditional batches, conflicts and private evidence storage using fakes. |
| [test_graph_memory_curriculum.py](test_graph_memory_curriculum.py), [test_graph_memory_policy.py](test_graph_memory_policy.py) | Shared graph/version/DAG validation, independent evidence, reversible misconception/concept state, deterministic coverage/transfer gates and derived profiles. |
| [test_graph_memory_processing.py](test_graph_memory_processing.py), [test_graph_memory_observations.py](test_graph_memory_observations.py) | Atomic intake/publication, server-frozen assessment grading, answer exposure, leases/recovery, append-only interpretations and private artifacts. |
| [test_graph_memory_access.py](test_graph_memory_access.py), [test_graph_memory_integration.py](test_graph_memory_integration.py), [test_graph_memory_http.py](test_graph_memory_http.py) | Authentication, institution/roster isolation, all chat transports, immutable server clocks, state-write denial, teacher evidence and real HTTP-to-ledger response shapes. |
| [test_graph_memory_retrieval.py](test_graph_memory_retrieval.py), [test_graph_memory_migration.py](test_graph_memory_migration.py) | Traversal/read/RU/context budgets, exact versus partial cohort counts, freshness/revalidation and dry-run-first non-qualifying legacy imports. |
| [test_progress_inference.py](test_progress_inference.py) | Server-side topic-progress inference. |
| [test_concept_inventory_mapping.py](test_concept_inventory_mapping.py) | Concept-inventory to threshold-concept mapping. |
| [test_quiz_first_attempts.py](test_quiz_first_attempts.py) | First-attempt quiz scoring. |
| [test_plain_text_emission.py](test_plain_text_emission.py) | Assistant prose survives turns that also call tools. |
| [test_general_agent_web_search.py](test_general_agent_web_search.py) | Automatic web-grounding orchestration in `GeneralAgent`, with the search/model response mocked. |
| [test_research_context_injection.py](test_research_context_injection.py) | Research context and learner preferences reach new/continued turns; persisted stale snapshots are removed before replacement/clearing, with pagination and cleanup-failure coverage. |
| [test_learner_profile.py](test_learner_profile.py) | Authenticated self-only preferences, atomic save/clear, confirmed chat instructions, typed per-TA memory snapshots, identity/membership isolation, and honest missing/malformed/storage-failure states. |
| [test_teacher_insights_evidence.py](test_teacher_insights_evidence.py) | Teacher-scoped, multi-source learning evidence. |
| [test_teacher_activity_analytics.py](test_teacher_activity_analytics.py) | Teacher learning-activity analytics. |
| [test_teacher_token_analytics.py](test_teacher_token_analytics.py) | Privacy-preserving teacher token analytics. |
| [test_teacher_scope_cache.py](test_teacher_scope_cache.py) | Course-ownership scoping cache. |
| [test_secret_configuration.py](test_secret_configuration.py) | Missing secrets fail startup instead of defaulting. |
| [test_cosmos_client_singleton.py](test_cosmos_client_singleton.py) | One Cosmos client, not one per request. |
| [test_agent_list_singleflight.py](test_agent_list_singleflight.py) | Concurrent agent-list calls collapse into one upstream request. |
| [test_course_curriculum_cache.py](test_course_curriculum_cache.py) | Bounded curriculum cache behaviour. |
| [test_chat_initial_load.py](test_chat_initial_load.py) | Initial chat message window. |
| [test_tikz_retry_guard.py](test_tikz_retry_guard.py) | TikZ regeneration retry bound. |

## Conventions

Learner-profile checks (use the placeholder environment above; no live services
or production app lifespan are needed):

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_learner_profile.py tests\test_research_context_injection.py -q
```

The context tests cover new/continued turns, image inputs, changed/cleared
instructions, and isolation when a runtime instance serves different learners.
They also exercise the installed conversation SDK against an in-memory HTTP
transport: prior snapshots must disappear from persisted context, not merely from
the next request payload. Deletion failures and unconfirmed deletes block the turn.

The profile memory tests point-read mocked learning-state records, bypass stale
runtime caches, and verify that profile reads never initialize progress. They
cover the real topic/concept/objective collections and saved preferences only;
no illustrative profile values or live learner records are used.

- Tests must not require network access or real Azure credentials.
- Use example data — `user@example.com`, never a real address or student record.
- Several of these are **regression tests written against a specific past bug**. If one
  starts failing, read its docstring before changing the assertion; it usually documents
  the failure it exists to prevent.
