# Backend

The main Agentic Shiksha FastAPI service: teaching assistants, chat and streaming,
course materials, learner progress, and teacher analytics. It is separate from the
[Admin Dashboard backend](../../Admin-Dashboard/backend/README.md).

See the repository [installation guide](../../INSTALL.md) for the complete stack
and the [HTTP API guide](backend/README.md) for feature contracts.

For actual agent identifiers and responsibilities, use the
[implemented-agent catalogue](../../docs/agents/README.md). Course TAs,
`form-fill-assistant`, `course-agent-creation-agent`, the curriculum-research
agents and `teacher-analytics-agent` have different call paths; local workers
and the shared harness are not additional remote agents.

## Local setup (PowerShell)

Start at the repository root with your **Python 3.13.5** interpreter selected
(the existing activated Conda environment works). [Dockerfile](Dockerfile) pins
the same **3.13.5** runtime. [CI](../../.github/workflows/ci.yml) tests both
**3.11** and **3.13.5**, retaining the earlier compatibility baseline.

```powershell
Set-Location "Agentic Shiksha Platform\Backend"
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Populate your own development configuration before starting the server; example
resource names are not working services. Existing environment files are not
overwritten by the command above. A virtual-environment activation script is not
required when using the explicit interpreter path.

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

Run from this **service directory**, not its inner `backend` directory. The current
Python package is lowercase `backend`; preserve that spelling on case-sensitive
filesystems. [backend/main.py](backend/main.py) exports the assembled `app`, using
the factory in [backend/app.py](backend/app.py).

In a second PowerShell terminal:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/health"
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/healthz"
```

`/api/health` is the public liveness path; `/api/healthz` additionally reports version
and allowed models. Neither verifies cloud-service readiness. Swagger UI is at
`http://127.0.0.1:8000/docs`. Starting the production application runs cloud-backed
lifespans and background workers: it is **not an offline configuration check**.
For mocked checks without starting the server, follow [tests/README.md](tests/README.md).

## Azure provisioning and deployment commands

Use the canonical [resource-creation recipes](azure_services/README.md#azure-resource-creation-commands)
for Foundry, grounding/search, monitoring, NoSQL, Storage, Speech and optional
networking. The [shared container/App Service recipe](../../docs/deployment.md#azure-cli-container-and-app-service-commands)
uses service key `main-backend` and the relocated build context
`Agentic Shiksha Platform\Backend`. It covers ACR build/publication, managed
image-pull identity, private runtime settings and an approved image-only update.
Do not provision the optional MongoDB example in place of the NoSQL store.
These references avoid duplicating infrastructure commands in each service README.

## Layout

| Path | Purpose |
| --- | --- |
| [backend/](backend/README.md) | App factory, production route registry, domain routers, schemas, dependencies and AG-UI encoding. |
| [agent_tools/](agent_tools) | Tools the agents can call. `custom/` run here, `hosted/` run in Foundry. |
| [azure_services/](azure_services) | Azure integrations: agents, persistence, storage, search, evaluation. |
| [harness/](harness) | Canonical agent conversation, context, planning and tool-execution runtime. |
| [learner_memory/](learner_memory/README.md) | Opt-in shared curriculum graph, append-only learner evidence, deterministic state policies, worker/API integration and scoped retrieval. Disabled by default; provisioning and course activation are explicit. |
| [base_agents/](base_agents) | Shared lifecycle manager used by legacy course creation and compatible imports for the harness. |
| [prompt_store/](prompt_store) | Core TA instructions plus task, research, tool and preference prompts; callers select the files they load. |
| [teacher_dashboard/](teacher_dashboard) | Teacher-scoped analytics, mounted under `/api/teacher-dashboard`. |
| [utils/](utils) | Shared helpers — prompt assembly, TikZ rendering, document conversion. |
| [scripts/](scripts) | Manual graph-memory administration utilities. Not imported by the app. |
| [tests/](tests) | Mocked cloud regressions and optional local ngspice integration checks. |
| [user_data/](user_data/README.md) | Local staging, caches and backups. Never assume an unsynchronized local file is safe to delete. |

## Configuration

Use [.env.example](.env.example) as the value-free variable inventory.
[deployment_settings.py](deployment_settings.py) owns typed environment-backed
settings; [azure_services/config.py](azure_services/config.py) retains the existing
import names as a compatibility facade. Required resource/database/model values
reject missing or blank configuration instead of choosing a deployment.
Settings errors identify fields without printing their values, and secrets use
`SecretStr` until passed to their authentication/SDK boundary.

For local startup, injected process environment takes precedence over the optional
service-root `.env`. Restart the service after changing environment configuration;
validated settings are cached. Real environment files are neither rewritten by this
cleanup nor committed.

Before deploying this configuration cleanup, explicitly configure:

- `COSMOS_DATABASE`, `AZURE_AI_MODEL_DEPLOYMENT_NAME`,
  `AZURE_AI_AGENT_MODEL_DEPLOYMENT`, and `AZURE_ALLOWED_DEPLOYMENTS`; the allowed
  list must include the selected default. The browser now displays configuration
  failures and offers retry rather than inventing a model list.
- `FRONTEND_URL`, `BACKEND_URL`, the Entra tenant/authority, `BLOB_CONTAINER_NAME`
  and `AGENT_IMAGES_CONTAINER`. `CORS_ALLOWED_ORIGINS` contains additional allowed
  origins; localhost origins are no longer appended automatically.
- Any optional feature being used: custom Bing search instance, image model and
  generated-image container, TikZ model deployments, memory-store deployments,
  and pre-existing research/teacher-analytics agent names. Unset optional tools
  do not acquire a guessed model or resource.

The independently deployed admin API has its own
[settings module](../../Admin-Dashboard/backend/settings.py) and environment
contract. Versioned schema container names, protocol URLs, voice IDs and layout
identifiers remain ordinary code constants; this is not a data migration.

Both Speech features use the same configured resource. Narration requires its
explicit resource/subscription/group; microphone input additionally requires
`AZURE_SPEECH_REGION`. `/api/speech/token` retains its token/region response but
now lives in [routers/speech.py](backend/routers/speech.py), requires an active
signed-in user, returns uncached tokens, and reports missing configuration or
upstream failures without exposing credentials. No fallback Speech resource or
region is embedded in the endpoint.

Configuration includes:

- Foundry project/resource endpoints and resource ID, subscription/resource group,
  model deployment names, and Bing project connections.
- Azure AI Search endpoint/connection, shared `COMMON_*` index resources, embedding
  deployment/dimensions, Storage account/container, Cosmos endpoint/database, and
  Document Intelligence endpoint.
- `JWT_SECRET`, `SUPER_ADMIN_EMAIL`, `AZURE_AUTH_CLIENT_ID` (or the legacy
  `VITE_AZURE_CLIENT_ID` fallback), and Google OAuth client ID **and secret**.
  Google values are required by the current main module even for an Entra-only
  local sign-in workflow.
- Deep-research project endpoint, Bing connection and agent ID, also read at import.
- Explicit local frontend/backend URLs and registered OAuth callbacks. The API
  defaults to frontend port 5173 and backend port 8000 for local development.

Use process/App Service settings for deployment-specific configuration. Optional
blank strings can suppress defaults in `os.getenv`; omit/comment an optional entry
when you intend to use its default.

> Leave blank values bare. `KEY=  # note` parses as the literal string `# note`, because
> python-dotenv only strips a trailing comment when a value precedes it.

## Authentication

The main Azure data paths use Microsoft Entra ID credentials: a suitably authorized
development identity or deployed managed identity. The credential chain is implemented
in [common_azure_auth.py](common_azure_auth.py), with `auto`, `cli`, and `default`
modes. Local Azure sign-in and resource permissions are needed for live use, not for
the mocked suite. This does not remove the separate application-secret requirements.

User sessions are separate: [auth.py](auth.py) issues an HS256 JWT signed with
`JWT_SECRET`, and [google_auth.py](google_auth.py) provides Google OAuth via the
authorization-code flow with PKCE, mirroring the Entra path.

## Course placement API

Active `admin` and `superadmin` accounts can `GET` or `PUT`
`/api/agents/{agent_id}/placement`. Both return exactly
`{agent_id, institute, department, revision}`; `revision` is the persisted Cosmos
`_etag`. GET uses only explicit course `institute` (falling back to `institution`)
and `department`. A missing/partial pair is returned as two empty strings, never
inferred from creator or teacher profiles. Non-course `job_type` documents are
rejected; malformed saved name values return 422.

PUT accepts only `{institute, department, revision}`. Names are trimmed strings,
at most 200 characters, without control characters. Supply both names, or two
empty strings to unassign. The current revision is required: a stale read or
conditional-write conflict returns 409. The atomic patch changes only `institute`,
`department`, and `departmentId` (cleared); memberships and other course metadata
are untouched. Successful writes invalidate the main agent-list caches.
Missing authentication returns 401, non-admin roles 403, missing courses 404,
invalid input 422, and logged storage/cache failures a sanitized 503. Reload after
a 503 before retrying, since a cache failure can occur after persistence.

## Presentation copies

`POST /api/agents/{agent_name}/slides/save` accepts only `{"deck": SlideDeck}` and
returns `200` with `{assetId: string, block: {type: "slides", slidesId, title, deck}}`.
It requires an active authenticated account and the same course access as
PowerPoint export. Ownership comes from the verified account, not request fields.
Every successful save creates a **new private copy** with fresh asset and slides
IDs; it never replaces the original AI chat block or asset. The existing asset
store receives category `presentation`, type `json`, and the originating agent ID
both on the asset and inside its serialized slides content. The response block
omits `agentId`; clients retain the originating TA when displaying the copy.
Copies preserve both `speaker_notes` (the slide introduction) and optional
`component_notes` (`{target, text}` scripts for actual components). Native
PowerPoint notes include both scripts verbatim, target labels and sources.
Legacy decks may omit component notes. See the
[script targets and limits](agent_tools/custom/add_slides/README.md#component-scripts).

Deck validation and in-memory PowerPoint rendering finish before any write.
Invalid or overcrowded decks return `422`; authentication/access failures return
`401`/`403`, missing courses `404`, and internal failures a logged, generic `503`.
Successful responses are `private, no-store`. Saves are not idempotent and are
not automatically retried: check the asset library after an uncertain failure
before saving again. Owner, visibility, source IDs and thread/message IDs are not
accepted in the body. See the [presentation API](backend/README.md#presentations)
and [tool documentation](agent_tools/custom/add_slides/README.md).

### Indian-voice presentation speech

Both new endpoints require an active authenticated account and course access:

- `GET /api/agents/{agent_name}/slides/voices` returns
  `{available: boolean, voices: [{id, name, language}], detail?: string}`.
  This local catalog never contacts Azure. `available` means configuration is
  present and valid, not that cloud connectivity or permissions have been tested.
  The four listed voices are `en-IN-NeerjaNeural`, `en-IN-PrabhatNeural`,
  `hi-IN-SwaraNeural`, and `hi-IN-MadhurNeural`, even when unavailable.
- `POST /api/agents/{agent_name}/slides/speech` accepts exactly
  `{"text": "Saved component script", "voice": "en-IN-NeerjaNeural"}` and returns
  binary `audio/mpeg`, not JSON. Successful audio is `private, no-store` and
  `nosniff`. Text must be nonblank, XML-safe, and at most **1,200 Unicode code
  points**. Whitespace, newlines, and the supplied script are preserved without
  rewriting or trimming. The server escapes text into SSML; user markup is spoken
  as text, never interpreted as SSML.

Configure `AZURE_SPEECH_RESOURCE_NAME`, `AZURE_SUBSCRIPTION_ID`, and
`AZURE_RESOURCE_GROUP` explicitly in the existing backend environment. The resource
name must also be its enabled custom subdomain. The endpoint is derived as
`https://<resource>.cognitiveservices.azure.com/tts/cognitiveservices/v1`; the ARM
resource ID uses those same settings. `AZURE_SPEECH_REGION` is not needed by
these routes. No resource defaults, API key, Speech SDK, or Foundry model deployment
is used. The existing shared Azure credential obtains the Cognitive Services token;
assign **Cognitive Services Speech User** on that resource to the calling identity.
See [Microsoft Entra setup](https://learn.microsoft.com/azure/ai-services/speech-service/how-to-configure-azure-ad-auth)
and the [Speech REST reference](https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech).
Settings are read through `BaseSettings` without loading dotenv files, then cached;
restart the backend after changing its configured environment.

Missing or invalid Speech settings disable synthesis with `503` and a clear
catalog detail. Input errors return `422`, missing/inactive or unauthorized users
`401`/`403`, and unknown courses `404`. Azure authentication failures return a
generic `503`, upstream failures/redirects/invalid audio `502`, timeouts `504`,
and throttling `429` with a sanitized `Retry-After` bounded to **1–60 seconds**
(5 seconds if unusable). Upstream bodies, credentials, and scripts are not logged.
There are no automatic synthesis retries or audio/script persistence.

Synthesis uses `audio-24khz-48kbitrate-mono-mp3`, with 5-second connection/write/pool
and 20-second read timeouts, a 30-second checked streaming deadline, and a **2 MiB**
audio limit. Redirects and compressed upstream bodies are rejected. The read
timeout bounds a blocking read beyond the checked streaming deadline.
For isolated checks, first apply the synthetic environment in
[tests/README.md](tests/README.md#offline-test-environment), including
`PYTHON_DOTENV_DISABLED=1`, then run from this backend directory:

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_slide_speech.py tests\test_slides.py -q
```

These tests mock credentials and HTTP; no Azure calls or live playback verification
are involved. The older speech-token route is unchanged.

## Dependencies and native programs

[requirements.txt](requirements.txt) pins the runtime dependencies. Projects uses
the stable `2.4.0` SDK, the latest stable release compatible with the pinned
OpenAI 2.x/LiteLLM stack: Projects `2.5.0` and later require OpenAI 3.x, while this
LiteLLM release requires OpenAI below 3. OpenAI is explicit because
Foundry's `get_openai_client()` requires it; `aiohttp` supplies the asynchronous
Azure transport. There is no backend `pyproject.toml` or transitive lockfile.
Install the full manifest rather than selecting only FastAPI: eager tool imports
also load document, image and Azure SDK dependencies. `pytest` and `pytest-subtests`
are installed separately for development, as in CI.

Two preview packages remain intentionally; replacing them with the stable
versions would remove APIs still used by this backend:

| Package | Current pin | Latest stable checked | Compatibility blocker |
| --- | --- | --- | --- |
| `azure-ai-agents` | `1.2.0b5` | `1.1.0` | The stable SDK does not expose `DeepResearchTool`. |
| `azure-search-documents` | `11.7.0b2` | `12.0.0` | The knowledge-base pipeline uses preview output modes, answer synthesis and retrieval instructions removed from the stable SDK. |

See the [Search migration guidance](https://learn.microsoft.com/azure/search/agentic-retrieval-how-to-migrate)
before replacing the latter; answer synthesis remains preview-only. These are
feature-migration requirements, not version-string substitutions.
The stable Projects package also contains preview features: existing hosted
memory uses `client.beta.memory_stores` with `allow_preview=True`, and existing
memory/custom-search tools remain enabled. A stable package version does not
make every service feature generally available.

Evaluation runs in the admin service, so `azure-ai-evaluation` belongs to its
separate requirements. The unused management SDK is not a main-runtime dependency.
The [optional search-connection setup helper](azure_services/tools/search/README.md#optional-search-connection-setup)
is not called by the application; its lazily imported `azure-ai-ml` dependency is
intentionally not included in the runtime manifest.

After installation, verify installed package constraints:

```powershell
.\.venv\Scripts\python.exe -m pip check
```

For fully offline runs, prepare LiteLLM's public tokenizer data while downloads
are still available. Keep the same cache settings when starting the API or tests:

```powershell
$env:CUSTOM_TIKTOKEN_CACHE_DIR = Join-Path $env:LOCALAPPDATA 'AgenticShiksha\tiktoken'
$env:TIKTOKEN_CACHE_DIR = $env:CUSTOM_TIKTOKEN_CACHE_DIR
.\.venv\Scripts\python.exe -c "import tiktoken; tiktoken.get_encoding('cl100k_base')"
```

| Feature | Additional host requirement |
| --- | --- |
| PDF page conversion and course-form PDF extraction | Poppler (`pdfinfo`, `pdftotext`, `pdftoppm`). Put its binaries on `PATH`; `POPPLER_PATH` is also read by document conversion. |
| Legacy TikZ diagrams / geometry compilation | `pdflatex` plus the required LaTeX packages (MiKTeX or TeX Live), with `pdflatex` on `PATH`. |
| Circuit simulation | `ngspice` on `PATH`; unavailable engines are reported rather than replaced with fabricated simulation results. |
| Editable PowerPoint export | `python-pptx` from the manifest; **no Microsoft Office installation** is required. |

The Linux image installs build tools, Poppler, TeX Live packages and ngspice itself.
Its command remains `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`, with
`PORT=8080` by default. Setting `PORT` alone does not change the explicit local
PowerShell command above.

## Updates and operational boundaries

- Agent instructions and tool schemas are baked into a Foundry agent version at creation.
  Updating repository files does not automatically update existing remote versions.
  Use the relevant owner/admin version-update flow deliberately; slides and circuit
  tools have explicit enable/update endpoints.
- `add_flashcard` is retired. Stale calls fail explicitly; historical data is retained
  but is not offered as new flashcard content. Legacy `add_tikz_diagram` calls remain
  supported, although newly created TAs use `generate_image` instead.
- Compare environment examples and reinstall requirements when updating. Keep the
  intended Cosmos database and embedding/index dimensions aligned with your resources.
  Legacy v1-to-v2 cutover scripts have been archived outside the source tree.
  [scripts/graph_memory.py](scripts/graph_memory.py) retains the manual graph-memory
  setup/import commands; see [learner-memory operations](learner_memory/README.md#provisioning-and-migration).
  These commands are **not** a normal installation or upgrade step and make no
  changes unless explicitly applied.
- Clarification waits and some runtime caches are process-local; active waits cannot
  be resumed after a restart and need worker affinity.
- [.dockerignore](.dockerignore) excludes live environment files and local runtime
  data from the image. Supply deployed configuration at runtime, never in the image.

## Assistant configuration

Backend-scoped AI assistant instructions are maintained in
[.github/copilot-instructions.md](.github/copilot-instructions.md). The directory
contains configuration only; repository CI workflows are maintained separately in
[.github/workflows/](../../.github/workflows/).

The instructions cover the Python 3.13.5 runtime with Python 3.11
compatibility, FastAPI, Foundry agents, Cosmos DB, Blob Storage, and AI Search.
When a rule must be broken, flag it rather than working around it silently. If an
instruction conflicts with this README or [the contribution guide](../../CONTRIBUTING.md),
those repository documents take precedence; update the instruction to prevent
future drift.
