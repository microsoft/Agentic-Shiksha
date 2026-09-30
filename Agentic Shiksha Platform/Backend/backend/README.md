# Backend API Directory

The lowercase `backend` Python package contains the HTTP application. Start it
from the parent service directory using `backend.main:app`; see the
[service setup](../README.md#local-setup-powershell) and repository
[installation guide](../../../INSTALL.md).

## Files

| File | Description |
|------|-------------|
| [main.py](main.py) | Production configuration, lifespan, legacy routes and domain-router registry; exports `app`. |
| [app.py](app.py) | `create_app` factory, CORS, Swagger accessibility styling and exception handlers. |
| [agui.py](agui.py) | AG-UI event encoding for streamed conversations. |
| [routers/](routers/README.md) | Extracted feature routers, including public system endpoints. |
| [schemas/](schemas/README.md) | Typed request, response and artifact models. |
| [dependencies/](dependencies/README.md) | Shared active-user and TA-access checks. |

## Overview

`main.py` declares the production `APIRouter`, includes the feature routers, and
passes the completed registry to `create_app`. Existing router lifespans are
preserved. Supplying both an explicit router and allowed origins to the factory
allows isolated HTTP tests without importing the cloud-backed main module.

The service provides:

- **Agent Management** - CRUD operations for AI agents
- **Chat** - Message handling with Azure AI Agents
- **File Operations** - Document upload and management
- **Thread Management** - Conversation thread handling
- **Course Retrieval** - Azure AI Search indexing and grounded course-material access

`GET /api/health` and `GET /api/healthz` are public liveness endpoints, not checks
that Foundry, Cosmos or Search are ready. `GET /api/config` exposes client model
configuration. `/docs` describes the current registered API.

## API Endpoints

### Agents

Agent listing and membership use [routers/agent_membership.py](routers/agent_membership.py);
durable creation/retry uses [routers/course_creation.py](routers/course_creation.py).
For example, `GET /api/azure/agents/list` returns the authenticated caller's scoped
list, and `POST /api/agents/create-async` begins the typed creation workflow.

Creation, setup details and agent lists include optional `agentAvatar` settings:
`{"initials": "TC", "color": "#34d399"}`. Initials accept up to three Unicode
letters/numbers and colors use six-digit hex. Null fields use name-derived
initials and the automatic palette. Setup updates preserve an omitted
`agentAvatar`; explicit null resets it. Settings are retained when an image is
uploaded, so removing the image restores the configured initials.

### Chat

The authenticated streaming endpoints `POST /api/agents/{agent_id}/chat/stream`
and `POST /api/agents/{agent_id}/chat/agui` also accept `answer_depth`:
`"quick"`, `"balanced"` (default when omitted), or `"detailed"`. Invalid values,
including null, return `422` before opening a stream. The preference applies to
new and continued conversations independently of profile injection. It changes
the current answer's presentation only, not the model or tool configuration.

### Clarification timing

[routers/clarification.py](routers/clarification.py) manages the current waiting
turn for its active authenticated owner. The default answer window is 60 seconds,
followed by a 10-second decision window. The UI offers **Continue with defaults**
or **Give me 60 more seconds**. With no choice, the server resumes using saved
answers and sensible defaults for unanswered questions. Each accepted extension
opens another answer window followed by the same decision window.

- `GET /api/clarify/{clarify_id}` returns server time, answer/decision deadlines,
  window lengths, phase, saved answers, and an extension revision. Responses are
  private and not cached; refreshing does not reset the timer.
- `PATCH /api/clarify/{clarify_id}` accepts `{answers: [{answer: "..."}]}` and saves
  partial choices without resuming the agent. Send one entry per question;
  unanswered/skipped positions are empty strings.
- `POST /api/clarify/{clarify_id}` accepts the same answer array and resumes
  immediately. All-empty entries deliberately choose defaults.
- `POST /api/clarify/{clarify_id}/extend` accepts `{revision: 0}` during the
  decision window only. It adds a fresh answer window and increments the revision;
  duplicate/stale requests cannot repeatedly extend the timer.

Unauthenticated callers receive `401`, other users `403`, stale/early extensions
`409`, expired/completed waits `410`, invalid bodies `422`, and internal failures
a sanitized `503`. The runtime emits `clarification_done` with `clarifyId` before
continuing, in both SSE and AG-UI. State remains process-local: stream and follow-up
requests need worker affinity, and waits cannot be resumed after a server restart.
No remote agent definitions, prompts, deployment settings, or cloud records are
changed by this UI/runtime behavior.

### Learner profile

[routers/learner_profile.py](routers/learner_profile.py) uses the shared active-user
dependency: a valid `session` cookie or bearer token plus an active account is
required. Identity always comes from that account, never a client `user_id`.

- `GET /api/learner-profile` returns
  `{customInstructions: string, updatedAt: string | null}`. Missing/null instructions
  become `""`; missing timestamps become `null`. Reading does not create a profile.
- `PUT /api/learner-profile` accepts **only** `{customInstructions: string}` and
  returns the persisted fields after the write is confirmed. `""` explicitly clears
  instructions. Text is preserved verbatim, without a new application length cap.
  Only `customInstructions` and the server-generated `updatedAt` are patched in
  `users_v1`; names, roles, onboarding and unknown fields are untouched.

Responses are `private, no-store`. Invalid/missing sessions return `401`, inactive
or missing accounts `403`, a profile removed after authentication `404`, invalid
bodies `422`, and read/write failures a generic `503`. `updatedAt` is the existing
profile-wide timestamp, not a separate instruction revision.

After GET/save, copy the returned instructions into `chatStore.userCustomInstructions`
without scheduling the legacy full-profile upsert. Settings and chat use this same
field; the existing profile hash triggers reinjection after edits or clearing.
The SSE and AG-UI runtime now consumes the supplied field as a scoped preference
snapshot. Before a continued turn injects a replacement (including `""`), it
removes earlier injected profile snapshots containing custom instructions from
that conversation and verifies their removal before requesting a response.
Cleanup failure stops the turn with a generic retry error, rather than running
with stale preferences. Omitted profile injection retains the latest snapshot.
Ordinary chat messages, tool outputs and other conversations are retained; remote
agent definitions are not changed.

### Learner progress (existing route)

Use `GET /api/agents/{agent_name}/progress/{user_id}` with the TA's identifier and
the signed-in learner's ID. `require_agent_access` requires an active account and
TA membership; students cannot request another user's progress. Teachers retain
owner/assigned-teacher access and admins retain their existing access.

- Success: `{agent_name, user_id, status: "ok", progress}`.
- `progress.overall`: `total_topics`, `learned`, `in_progress`, `not_started`,
  `percent` (0–100), `last_active`.
- Other progress fields: `topics` (topic-name map with `module`, `status`,
  `latest_summary`, `last_touched`), `objectives` (objective-name map with `status`,
  `evidence`), `threshold_concepts`, `in_progress`, `recently_active`,
  `struggle_areas`.
- `in_progress[]` contains `{topic, module, latest_summary}`; `recently_active[]`
  adds `status`; `struggle_areas[]` contains `{topic, summary}`.
- No available state: `{agent_name, user_id, status: "no_state", message}` with
  **no** `progress` property; distinguish this from 0% completion.

The read may initialize learning state from the curriculum. `recently_active`
currently sorts summaries rather than timestamps; use `topics[*].last_touched`
if the UI needs chronological activity. Handle missing fields in older records
defensively. No new progress endpoint is required.

### Student assignments

[routers/agent_membership.py](routers/agent_membership.py) serves the assignment
editor in the admin dashboard using the **main backend**, not the analytics server.
Every route requires an active authenticated account.

- `GET /api/agents/{agent_id}/students` requires admin/superadmin and returns
  `agent_id`, `student_ids`, the Cosmos `revision`, and `students` (the active/invited
  student directory). Removed directory entries still on the roster are marked
  `unavailable` so administrators can explicitly remove them.
- `PUT /api/agents/{agent_id}/students` requires admin/superadmin and accepts
  `{student_ids: [...], revision: "..."}`. It replaces this TA's roster only.
  An empty list removes all student access; department affiliation never grants access.
  Invalid/non-student IDs are rejected with `422`. Concurrent edits return `409`;
  reload the roster before retrying. Failed loads/writes return a sanitized `503`,
  not an empty roster or a successful save.
- `GET /api/azure/agents/list` derives identity and role from the session, not the
  query string. Students see only explicitly assigned active TAs, without a cached
  roster or an unscoped Foundry fallback.
- `POST /api/agents/connect-by-code` opens a TA for an already assigned student;
  an unassigned student gets `403` and is **not enrolled**. Teacher joining and
  existing teacher/admin access are retained.
- The legacy `/api/agents/{agent_id}/members` routes also require authenticated
  course management access. Only administrators can add/remove student memberships;
  a claimed `requester_id` cannot substitute for the authenticated identity.

Existing `studentIds` are retained as assignments. Invited students can be assigned
before first sign-in: the promoted invitation's `oauthUserId` resolves the original
invite ID without a bulk data migration. After promotion, the editor shows the
active identity once and canonicalizes it on the next save.

Direct chat (all four transports), TA details/setup/starters, course curriculum,
protected course materials, exports, and other course-scoped tools use the same
membership check. New requests are denied after removal; prior messages are not
deleted and a response already in progress is not interrupted. Teacher/admin roles
retain their existing ownership/assigned-teacher management rules.

Offline regression checks, from the service directory after applying the
[test environment](../tests/README.md#offline-test-environment):

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_student_assignments.py tests\test_agent_sharing.py tests\test_agent_list_singleflight.py -q
```

### Files

Course-scoped uploads, protected downloads and indexing are handled by
[routers/course_materials.py](routers/course_materials.py). See
[Course Material Indexing and Citations](#course-material-indexing-and-citations)
below rather than assuming an unscoped `/files/upload` endpoint.

### Presentations

The routes in [routers/slides.py](routers/slides.py) require an active authenticated
account. They do not execute model-generated Python or read arbitrary file paths.

- `POST /api/agents/{agent_name}/slides/export` accepts `{"deck": ...}` using
  [SlideDeck](schemas/slides.py) and returns a PowerPoint attachment with MIME type
  `application/vnd.openxmlformats-officedocument.presentationml.presentation`.
  Course owners, assigned teachers, enrolled students and admins may export.
  Missing/invalid auth is `401`; disabled accounts and nonmembers are rejected.
  Validation/overflow errors are `422`; generation failures are a sanitized `503`.
  Downloads are `private, no-store`. Each export creates an independent presentation
  in memory; deck persistence uses existing chat/asset records, not public files.
- `POST /api/agents/{agent_name}/slides/save` accepts only `{"deck": ...}` with the
  same course-access rules as export. It returns `200` with
  `{assetId: string, block: {type: "slides", slidesId, title, deck}}` and
  `Cache-Control: private, no-store`. Each call creates a **new private copy** with
  fresh asset and slides IDs; the original AI chat and asset are never overwritten.
  Ownership comes from the verified account. Owner, visibility, source asset/slides
  IDs, agent IDs and thread/message IDs are forbidden in the body.
  Existing asset persistence stores category `presentation`, type `json`, and
  `{type: "slides", slidesId, title, deck, agentId: agent_name}` as serialized content,
  with the same originating `agentId` on the asset. The response block omits
  `agentId`; clients retain the route's TA for subsequent export.
  Deck validation and local rendering precede the single write. Invalid/overcrowded
  decks return `422` without writing, missing courses `404`, and internal failures
  a logged, generic `503`. No automatic retries or success-shaped fallback are
  used. Check the asset library after an uncertain failure before saving again;
  repeated successful requests intentionally create separate copies.
- `GET /api/agents/{agent_name}/slides/tool` reports
  `{enabled, agent_version, update_available}` to the course owner/admin.
  `update_available` compares an enabled tool's description and parameters with
  the current registry. This is read-only; absent/current tools report `false`.
- `POST /api/agents/{agent_name}/slides/tool` accepts `{expected_version}` and enables
  or refreshes `add_slides` on an existing prompt agent. It shares the existing
  tool-update lease, preserves all other definition fields/tools and metadata,
  and rejects stale versions with `409`. A stale enabled tool is updated in place
  in a new version, not duplicated; an already-current tool causes no write.
  The frontend must invoke this only after an explicit confirmed owner/admin
  action. Updates are never automatically retried. New agents include the current
  tool at creation; repository edits, status reads, exports and copy saves never
  silently update existing agents.

The PowerPoint contains native editable text and shapes, speaker notes, labeled
component scripts and source hyperlinks. Ten bounded layouts and three themes
are available. Alongside the original six layouts, `process`/`timeline` require
2–5 captions, `quote` requires one quotation, and `key_stat` requires one value of
at most 40 Unicode code points. Quote attribution and statistic context belong
in `subtitle`; other bullet bounds remain unchanged.

Each slide retains `speaker_notes` (optional, maximum 4000 Unicode code points)
for its introduction and adds optional `component_notes`, defaulting to `[]`.
Each of at most 12 notes is exactly `{target, text}`. `text` is nonblank, XML-safe
and at most 1200 Unicode code points. The sum of the introduction and all component
text is at most 8000 Unicode code points. Targets are unique and must exist on
that slide: `title`, a nonblank `subtitle`, `bullet-1` … `bullet-5`, or, only for
two-column slides, `column-1`/`column-2` and
`column-1-bullet-1` … `column-2-bullet-4` (1–4 per column).
Quote/statistic featured content uses `bullet-1`. Native notes preserve scripts
verbatim, including legal whitespace, under their target labels plus sources.
No missing scripts are invented; legacy/manual decks without them remain valid.
New generation authors the introduction and concrete explanations for every
substantive component once; TTS reads stored scripts without a second model pass.
See the [full target and narration contract](../agent_tools/custom/add_slides/README.md#component-scripts).

The model must use approved course sources. In-app previews use the same deck data but are not
pixel-identical to desktop PowerPoint. Image embedding and animations are not part
of this first version.

### Threads

Thread/message persistence and synchronization remain in [main.py](main.py).
[routers/chat_sharing.py](routers/chat_sharing.py) handles authenticated share
creation/revocation; a public share is a bounded transcript snapshot, not ongoing
access to the owner's conversation.

### Course Material Indexing and Citations

The routes in `routers/course_materials.py` require an active signed-in account.
Indexing updates and status checks require the course owner, an assigned teacher,
or an administrator; file downloads also allow enrolled students.

#### Upload and Creation Jobs

- `POST /api/knowledge/preflight` validates multipart `files` without storing them or calling Document Intelligence. It reports per-file acceptance, byte/page counts, likely OCR pages, and whether PDF splitting is needed.
- `POST /api/knowledge/drafts` takes an idempotent `request_id` and returns an owner-bound `session_uuid` and `job_id`. Use this returned session for uploads and creation.
- `POST /api/knowledge/build` takes multipart `session`, `kb_scope`, and `files`. Edits also send `agent_name`, whose saved session must match. Its `202` receipt means originals were saved, not that they are searchable.
- `POST /api/knowledge/jobs/{job_id}/process` seals an uploaded batch. Optional `source_ids` retries selected failed files; successfully processed files are retained.
- `GET /api/knowledge/jobs/{job_id}` and `GET /api/knowledge/jobs/{job_id}/events` expose pollable and SSE status, including separate TA and material states.
- `POST /api/agents/create-async` now returns `202` with a durable creation status, not a completed agent. `GET /api/agents/creation-jobs/{job_id}` returns the result after setup and ownership metadata are saved. `POST /api/agents/creation-jobs/{job_id}/retry` resumes a failed job.
- `GET /api/agents/{agent_name}/course-materials?kb_scope=...` lists original files. `DELETE /api/agents/{agent_name}/course-materials/file?source_id=...&kb_scope=...` queues removal of searchable copies; seal it with the process endpoint. Preserved originals are not deleted by this operation.

Creation status includes `course_name` when a request exists. An owned draft whose
creation request was never accepted returns `NOT_STARTED`, not a running job;
retrying such a draft returns `409` until its form is submitted. Terminal parent
jobs with stale nested running states report failure and can resume through the same
retry endpoint without replacing specifications, memory stores, or agent-creation
checkpoints. Active leases are never taken over.

Material status marks unfinished files in stopped jobs as needing retry. Retrying
selected files preserves ready files and original uploads, and an empty material
batch cannot prematurely complete a pending TA creation. Status reads do not mutate
jobs; the browser's confirmed fresh-start action does not delete or cancel server work.

Supported material formats are PDF, DOCX, UTF-8 TXT/Markdown, PNG, JPEG, TIFF, and BMP.
PDF originals are limited to 100 MiB and 2,000 pages; non-PDF files to 16 MB. A request
accepts at most 100 files and 250 MiB. A saved session allows at most 500 originals and
250 MiB, including retained removed files. Images must be 50-10,000 pixels per dimension.
Encrypted, malformed, empty, and unsupported files are rejected. Legacy DOC, ZIP, and
recursive folder uploads are not supported.

Originals are immutable, content-identified blobs outside the indexed `sessions/` prefix,
also marked `AzureSearch_Skip`. A worker creates deterministic PDF copies of at most
50 pages and 16,000,000 bytes, splitting further by size when needed. A single page that
still exceeds the limit fails with an actionable per-file error. TXT/Markdown become
escaped HTML copies accepted by the Layout skill. Each category is capped at 500 indexing
copies. PDF copies retain original page ranges; citations resolve through the saved
manifest to original filenames, page numbers, and protected original downloads.

Jobs and name reservations use the existing `courses_v2` Cosmos container, with a
`job_type` discriminator excluded from the legacy course APIs. Lifespan-managed workers
claim jobs with ETags, renew expiring leases, and checkpoint side effects. Restarted workers
resume stored jobs and reconcile existing copies, memory stores, and named agents.
Prompt generation and memory preparation run concurrently. The existing textbook
curriculum pipeline has a separate durable job and does not block TA/material processing.
An uncertain Foundry create response is reconciled by job metadata, never blindly retried
as another agent version. If its outcome cannot be established, the job fails for inspection.

The specification request retains the named creation agent and its configured model but
uses `tool_choice="none"`: response/function tools must not replace the required JSON text.
Foundry does not allow request-level `text.format` overrides with this agent-reference API,
so the completed response is validated against `CourseSpecification` before use. Empty,
malformed, schema-invalid, or incomplete output is an explicit failure, never an instruction
fallback. These generation failures use the existing four-attempt job limit and preserve
successful memory preparation; the UI receives a safe specification-specific error.

Document Intelligence runs only in the existing Search Layout pipeline, not synchronously
during upload. Workers do not recreate shared Search resources or depend on an indexer
schedule. A fresh completed run and all expected indexed copies are required for readiness;
unattributed shared-indexer failures/warnings conservatively block readiness. Processing
times out after two hours and exposes per-file retry. The backend must be running for
workers to advance; another instance or restart can reclaim expired leases. Deployment
must preserve the configured Blob/Search resources and allow the existing identity to
read/write the Cosmos job container. No new cloud resources are provisioned by these APIs.

OCR can recover scanned text, but ingestion does not guarantee reasoning over diagrams
or arbitrary visual content. Keep originals and inspect per-file results before relying
on uploaded material in answers.

#### Legacy Edit Indexing

- `POST /api/knowledge/update-index` accepts form fields `agent_name`, `session_uuid`,
	and `kb_scope` (`course`, `exam`, or `textbook`). The session must match the saved course setup.
	A `202` response contains `operation_id` and `status: "indexing"`, not a readiness guarantee.
	Failed or rejected indexer starts return a sanitized `503`; conflicting course changes return `409`.
- `GET /api/knowledge/index-status?agent_name=...&operation_id=...` returns `indexing`,
	`ready`, `failed`, or `changed`, plus expected/indexed file counts. It does not expose
	other courses' indexer errors or filenames.
- `GET /api/agents/{agent_name}/course-materials/file?filename=...&kb_scope=course`
	downloads the current course file after checking membership. The server derives the
	Blob prefix from the saved course setup; arbitrary Blob URLs and paths are not accepted.

The latest indexing operation is persisted in the course's Cosmos record under
`materialIndexing`, using an ETag-conditional partial update. It records a snapshot of
filenames and Blob ETags. Readiness requires unchanged files, a successful indexer run
started after the request, no failed items, and an exact match between expected files
and indexed document identities. This covers replacements and checks that deleted files
are no longer present. The operation fails after 15 minutes without confirmation.
Edit-mode indexing runs the existing shared indexer; it does not recreate the shared pipeline.

The edit UI polls a managed material job, or this legacy operation for older files,
for up to three minutes before continuing Save. Failure,
timeout, or an unavailable status stops the success flow and leaves the update retryable.
An upload receipt by itself never means the files are searchable.

For explicit course-file questions, the shared chat handler retrieves structured passages
directly from the configured Search index, retaining the agent's filter and adding its
saved-session restriction. Results must match the configured Blob account/container and
course path. Each passage has a stable citation ID, filename, exact excerpt, and page/section
only when provided by the index. At most eight passages and 12,000 excerpt characters are
included; each excerpt is limited to 4,000 characters and truncation is reported.
The tutor receives the versioned `course_material_grounding_context_v2.md` prompt and exact
citation markers; no extra model summarization call is needed for retrieval.

Chat stores these sources in message metadata. Inline references and the Sources list open
the retrieved passage with a highlighted excerpt and a protected download action. Different
passages from the same file remain separate. Stored excerpts are snapshots; managed downloads
open the preserved original. Legacy downloads open the current file, which can have changed since the answer. Older messages without passage
metadata are not backfilled, and unknown citation IDs are not linked to a guessed source.

### Curriculum Generation and Retry

`GET /api/agents/{agent_name}/course-curriculum` returns `not_available`, `failed`,
`processing`, or `ready`, with `can_retry` for the authenticated caller. Add
`?status_only=true` to omit the curriculum payload. Course membership is required;
only the owner, an assigned teacher, or an administrator can retry generation.

`POST /api/agents/{agent_name}/course-curriculum/retry` accepts an empty JSON object
and returns `202` with the saved job status. It uses the TA's saved description and
textbooks, without recreating the agent or uploading course files again. Older TAs
without a creation job get a bounded input snapshot for the same durable worker.
If neither a saved description nor textbooks are available, it returns `422` with
an instruction to update the course details in Edit TA.

Queued/running jobs and unexpired worker leases report `processing` and never offer
retry. Repeated or concurrent retry requests reuse the same per-course job, using
create-if-absent and ETag checks. Existing session-keyed jobs remain readable and
active ones take priority. Failed partial output stays available, but is no longer
treated as evidence of an indefinitely running job. Storage failures return a generic
`503`, not a missing curriculum; private generation errors are not sent to the client.
Complete curricula are not regenerated by the retry action.

The TA menu and an open partial-curriculum panel show **Retry generation** only when
the server permits it. The button disappears immediately on submission and remains
hidden while processing; polling updates the view when generation completes. The
legacy `retry-textbook-research` and `retry-threshold-research` URLs use the same
authorization and durable-job guard, not untracked background threads. Threshold-only
retry retains its requirement for a saved research syllabus.

### Shared Chat Snapshots

`POST /api/chat/thread/{thread_id}/share` requires the authenticated thread owner and a
JSON body with nonempty `message_ids` and optional `refresh` (default false). The browser
waits for generation to finish and for thread/title/message metadata saves to be acknowledged.
Unconfirmed saves prevent sharing; missing stored IDs return `409`. Owner identity is never
taken from a caller-supplied user ID. `DELETE` at the same path revokes the link.

Copying an existing link preserves its pinned message IDs and title. Only the owner's
explicitly confirmed `refresh: true` updates that selection, retaining the URL. No later
messages are automatically added. Public reads restore saved documents, images, research,
and citation metadata; downloads of original course files still require course membership.
Expired generated-image URLs are re-signed only for the configured account and image container.
The boundary pins message IDs, not immutable copies of message bodies. Existing incomplete
links are not changed by deployment; their owners must explicitly update the snapshot.

### Chat Latency and Suggestions

### Circuit Simulation

- `POST /api/agents/{agent_name}/circuit/simulate` accepts `{ "circuit": ... }` and
	returns typed ngspice results. It requires an active account with course membership.
	Invalid circuits and failed convergence return 422; a missing/busy engine returns 503.
- `GET /api/agents/{agent_name}/circuit/tool` reports `enabled`, `update_available`
	(default false), `engine_available`, and `agent_version` to the course owner or an
	administrator. An update is available when the registered function schema or
	description differs from the current circuit-only definition.
- `POST /api/agents/{agent_name}/circuit/tool` accepts `expected_version` and explicitly
	enables the tool or upgrades an older `add_circuit` schema in place. It preserves tool
	order, other tools, model, instructions, settings, metadata and description under the
	existing lease. A current schema is idempotent; a stale version that would require a
	write returns 409. Deployment and status reads do not change old TAs silently.

The `add_circuit` function tool emits `circuit_start`, then a validated `circuit` block,
or `block_cancel` on failure. Both legacy SSE and AG-UI/A2UI carry the specification
and numeric result. Results include selected node voltages and signed current traces
for every component. Industrial results add named-terminal currents and machine/state
signals, bounded to 256 traces, 1,001 samples per trace and a 64,000-value plot budget.
Meter calculations use full-resolution solver samples before downsampling. Chat renders a
compact launch item; the document pane contains the editor and solver-driven illustrative
electron/current playback. Saved chats restore editable circuits; public shares allow
read-only playback. Old results without branch-current traces remain viewable without
animation until rerun.
See [the tool documentation](../agent_tools/custom/add_circuit/README.md) for installation,
component support, numerical tests, and execution limits. Format 2 adds explicit industrial
models, instruments, bounded event/fault timelines and named terminals. No arbitrary SPICE,
external models, manufacturer calibration, hardware safety certification, or digital IC
simulation is supported. N/PE conductor roles are labels, never implicit ground bonds.

Industrial Trainer is retired: its routes, private-attempt workflow, and tool input
branch are removed. Circuit Lab, including format-2 devices and virtual meters, remains
available. Existing trainer records are not migrated or deleted, and the browser hides
legacy trainer-only assets while retaining valid saved circuit specifications/results.

### Chat Latency and Suggestions

Greeting-only turns use three deterministic questions naming the current course. Generic
model suggestions on these turns are replaced; no follow-up inference is needed. Suggestions
generated by the tutor on substantive turns remain part of its response.

When the tutor does not supply follow-ups, the frontend completes and saves the reply first,
then calls `POST /api/agents/{agent_name}/chat/suggestions` with `question` and `answer`.
The route requires an active account with course access. The request is bounded to 16,000
question characters and 12,000 answer characters, and the model receives at most 2,000 and
6,000 respectively plus the authoritative course name/description. It uses the versioned
`course_followups_v1.md` prompt, structured output, an eight-second timeout, no SDK retries,
no tools, and no stored conversation. Invalid suggestions return a generic 503 without
affecting the completed answer. The client cancels stale requests on navigation or a new
turn and attaches results only to the same saved assistant message.

Ordinary model prose starts streaming after a 160-character prefix passes the existing
refusal/serialized-tool checks. JSON-shaped and ambiguous prefixes remain buffered.
Final text is still persisted once; a subsequent `add_message` tool supersedes provisional
prose. A completed prose answer followed by suggestion tools no longer starts an extra
model round solely to close the turn.

Course setup and agent-definition metadata use independent, bounded 30-second caches with
single-flight loads and copy isolation. Saving/deleting setups and changing agent versions
invalidate relevant entries. Changes made outside the process become visible at TTL expiry.
Membership and active-account checks are not cached by these helpers. Chat clients are
keyed by endpoint, agent, and saved material session; retrieval still applies the current
session restriction and validates document paths.

Prompt assembly removes exact copies of enabled core modules embedded in course-specific
text and repeated identical context. It does not shorten unique safety, teaching, or
assessment rules. Existing Foundry agent versions retain their current instructions until
regenerated; deploying the backend alone does not rewrite those versions. Cold credential,
network, Search, and model initialization delays can still exceed warm-turn latency.

The main Library uses the agent-list metadata for cards, caches teacher/admin lists by
user and role, loads legacy setup details only when their preview is opened, and versions
images by saved update time rather than visit time. Student list requests bypass both
browser and backend roster caches so a refresh reflects assignment changes.

### Course Companion

`POST /api/course-form/assist` accepts `text`, `form` (editable course fields only),
`availablePrerequisites` (course ID/name pairs), `history` (up to six user/assistant messages,
2000 characters each), `allowEdits` (defaults to true), and optional `attachments`. It requires an active teacher or administrator.
The response contains a short `message` and validated `fields`; null fields are omitted and
must be left unchanged. Unsupported resource IDs, file fields, invalid URLs, malformed JSON,
and unknown prerequisite choices are rejected before reaching the browser form.
When `allowEdits` is false, the API returns no field changes even if the model proposes them.
The current draft takes precedence over history, which may describe changes the user has undone.

Existing `form.courseNotes` may contain up to 100,000 characters and are sent intact, not
silently shortened. The serialized form/message/history context is limited to 160,000 characters,
excluding attachment payloads, which have their own limits below. Chat messages remain limited to
16,000 characters. The agent's generated description patches retain their separate 16,000-character
output limit; this input fix does not change the published agent's output schema or version.
Invalid or oversized requests return a readable 422 message without echoing submitted descriptions,
attachment data, or raw validation objects. The browser preserves the draft and unsent request text.

The router calls the Foundry prompt agent `form-fill-assistant`, version `4`, using `gpt-5`
in the existing `AZURE_AI_PROJECT_ENDPOINT` project. Its definition is returned by
`backend.routers.course_form_assistant.agent_definition()` and uses
`prompt_store/agents/form_fill_assistant_v3.md`. The agent answers form-related questions,
asks for missing details, and only proposes requested or confirmed edits. The strict output schema belongs to the agent
definition, not a request-level `text` override. For a new environment, provision this agent
definition in that environment's project before enabling the UI. If deploying a new agent
version, update the pinned version in the router and rerun its regression tests.

The client is initialized once per application lifespan. Requests use a bounded input,
90-second timeout, no automatic model retries, no tools, no conversation ID, and `store=False`.
Recent conversation messages are passed as bounded request context, not saved as a Foundry conversation.
The API does not write a course, persist a draft, or upload files. It returns a generic 503 on
generation/validation errors, leaving the form untouched. Browser cancellation prevents
applying the result but may not stop an inference already running in Foundry.

Course Companion uses the same chat message renderer and composer as TA conversations.
Its History button stores text conversations separately in this browser, scoped to the signed-in user;
it does not sync these conversations to Cosmos or Foundry. Reopening history never restores the form
or reapplies earlier edits; histories from another draft open with form edits disabled. Delete requires
confirmation. At most 30 conversations, 100 messages per conversation, and 1 MB of serialized history
are saved. Storage failures are shown without silently deleting earlier conversations.
File/image bytes, extracted file text, and temporary preview URLs are not saved in history; ordinary
messages may still contain details the user or model quoted from a file. Files must be reattached to
read them again after a reload. Queued course files remain browser draft selections until Create and
are not durable uploads just because they appear in Additional Course Material.

Each chat attachment has `name`, `contentType`, and base64 `data`; at most 3 are accepted per request.
Text/Markdown, DOCX, and PDF inputs are limited to 1 MB each. Extraction is local to the backend,
limited to 8000 characters per document, and uses no OCR or document-indexing service. PDFs must
have at most 5 pages; `pdfinfo` and `pdftotext` have short process timeouts and are provided by the
existing Poppler container dependency. DOCX archive expansion and XML declarations are checked.
Static PNG/JPEG/WebP images must be at most 2 MB and 8 megapixels; the backend strips metadata,
resizes them to a maximum dimension of 1024 pixels, and sends low-detail vision input.
Malformed, oversized, or unsupported chat attachments return 422 before a model call.

The composer also offers Add course materials, which queues PDF/DOC/DOCX/TXT/MD files up to
50 MB in Additional Course Material without reading them. Large documents and legacy DOC files
selected through Read small files take this same queue-only path; they are never base64-encoded
or sent to the companion. Reading a small file does not automatically upload it into the course.

### Syllabus Translations

The translation router requires an active signed-in user with course access.

- `GET /api/agents/{agent_name}/course-curriculum/translations` lists shared default variants and the caller's custom variants for the current curriculum. It also returns `source_hash`, `default_instructions`, and `max_instructions_length` for the dialog.
- `POST /api/agents/{agent_name}/course-curriculum/translations` accepts `language`, `style` (`pure` or `mixed`), `source_hash`, and optional `instructions` (1-2000 characters after normalization). Omitted instructions use the default prompt. It returns an existing matching translation first, otherwise generates and saves a complete translation.
- `GET /api/agents/{agent_name}/course-curriculum/translations/{language}/{style}?source_hash=...&instructions_hash=...` reads a saved variant without model generation. Omit `instructions_hash`, or use `default`, for the shared default translation. Custom variants are scoped to the authenticated user, never a caller-supplied user ID.

Both Pure and Mixed translations use the language's native script. Mixed translations retain English technical terms while surrounding words use native script, not Latin transliteration. Translations include the syllabus, threshold-concept names, definitions, descriptions, and misconceptions. The original curriculum, edit history, and learning-progress keys remain unchanged; private learner notes are not included in shared translations. Variants are saved separately in the existing curriculum Blob container, keyed by course, curriculum content version, language, and style. The `curriculum-native-v3` cache version keeps older Latin-script results separate and does not delete them. Blob leases coordinate concurrent generation; a busy request returns 409 for retry. Storage failures return an error rather than generating an unsaved replacement. The model client uses the existing `CHAT_MODEL` configuration and is shared for the application's lifespan.

The dialog starts with the editable prompt in `prompt_store/tools/syllabus_translation_default_v1.md` and provides a reset control. The system prompt in `prompt_store/tools/syllabus_translation_v4.md` treats custom instructions as translation preferences, subordinate to native-script, content-fidelity, and output-format requirements. Custom instructions are normalized and hashed for cache matching; identical instructions reuse the saved result, while changed instructions create a separate personal variant. The raw custom prompt is sent to the model but is not saved in translation blobs, catalog responses, or browser preferences. Custom results are stored under a separate user-scoped `custom-translations/` prefix; default results and existing saved translations remain intact.

## Running the Server

After the [service configuration](../README.md#configuration), run from
`Agentic Shiksha Platform\Backend`, not this inner package:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

The production lifespan starts cloud-backed material/curriculum workers and
token-usage reconciliation. Do not use placeholder test configuration to launch
the full application. The [factory regression](../tests/test_application_factory.py)
is the offline alternative.

## Dependencies

The API integrates with:
- [../azure_services/](../azure_services/README.md) - Foundry, Search, Blob and Cosmos operations
- [../utils/course_creation.py](../utils/course_creation.py) - Durable agent/curriculum creation workflows
- [../harness/](../harness/) - Canonical conversation and tool-execution runtime
- [../base_agents/](../base_agents/README.md) - Shared lifecycle manager for legacy course creation and runtime compatibility import
- [../teacher_dashboard/](../teacher_dashboard/README.md) - Teacher-scoped analytics in the same application
