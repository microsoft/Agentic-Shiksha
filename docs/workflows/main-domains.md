# Main service: domain-router workflows

Source snapshot: **2026-09-30, local source, not deployment verification**.
This guide covers **80 distinct HTTP handlers in the 17 assigned domain modules**,
grouped into **37 workflows**. Multiple decorators on one handler are one primary
assignment. The machine-readable companion is [main-domains.json](main-domains.json).
There are no excluded HTTP handlers among those 17 modules.

**Concurrent source relocation:** `identity.py` (eight handlers) and
`directory.py` (ten handlers) appeared under routers during this audit, moving
concerns assigned to the [main-service guide](main-service.md). All 18 current
handler IDs are explicitly listed as ownership exclusions in this sidecar,
not silently omitted or assigned a second primary workflow. Their companion
mapping and the mounted inventory must use the relocated source identities.

The source prefix for short router filenames below is
`Agentic Shiksha Platform/Backend/backend/routers/`. Full `path::handler`
identities appear in the sidecar; factory-local handlers preserve their actual
qualified name (for example `create_system_router.<locals>.health`) to match
the mounted inventory. Main-module handlers, the teacher-dashboard
implementation, and browser routes have separate owners; their calls are cited
here only where these routers delegate to them. **An API being available is not
evidence that a particular screen exposes it.**

## How to read the boundaries

- **Active account:** [get_current_active_user][auth] verifies a session cookie
  (preferred) or bearer token, re-reads the user profile and requires a matching
  ID, a recognized role and `status == active`. Invalid authentication is 401,
  an inactive/invalid account is 403, and account-store failure is 503.
- **Ordinary course access:** [has_agent_access][agent-access] permits global
  admin/superadmin roles, a teacher who owns the course or appears in
  `teacherIds`, or an active-course student explicitly in `studentIds`
  including a promoted invitation alias. Unlike the student branch, the
  teacher/admin branches do **not** require active course status.
- **Course edit access:** [require_course(edit=True)][materials] additionally
  rejects students and verifies course identity and the saved material session.
  It does not mean owner-only. Circuit/slides tool changes add an owner/admin
  check. Ordinary global administration is not tenant-scoped graph-memory
  administration.
- **Strict memory access:** [resolve_learner_access][learner-access] requires
  the global feature, a non-off course, active course, immutable tenant/institute
  identity, reviewed registry, current curriculum binding and current learning
  epoch. Students target only themselves. Teachers must own/be assigned to the
  course; administrators must be explicitly registered for its scope. A
  teacher/admin target must be an active student in the explicit roster.
- Unless stated otherwise, these HTTP handlers **do not mutate browser
  storage**. A response, downloadable file or suggested form patch is not a
  server-side browser save. Client retries and disconnects must not be
  confused with durable-job retry/cancellation.

**Classification:** `current` = implemented ordinary path; `compatibility` =
retained adapter or legacy representation; `optional` = configuration/runtime
capability must be enabled; `mixed` = meaningful current/legacy or mode-dependent
branches. These labels do not assert rollout or operational health.

## Navigation

| Area | Workflows |
| --- | --- |
| Public service | [Liveness/config](#domain-system-status) |
| Membership | [Student roster](#domain-agent-roster), [member mutations](#domain-agent-membership), [code/list](#domain-agent-connect-list), [placement](#domain-course-placement) |
| Course setup | [Course Companion](#domain-course-form-companion), [CACA creation](#domain-course-creation), [curriculum/research](#domain-course-curriculum), [translations](#domain-curriculum-translations) |
| Materials | [Preflight](#domain-material-preflight), [draft/upload](#domain-material-draft-upload), [processing/events](#domain-material-processing), [files/removal](#domain-material-files), [index refresh](#domain-material-index) |
| Conversation | [Chat/harness/tools](#domain-chat-turn), [suggestions](#domain-chat-suggestions), [clarification](#domain-chat-clarification), [sharing](#domain-chat-share) |
| Assessment/profile | [First attempt](#domain-assessment-first-attempt), [feedback](#domain-assessment-feedback), [instructions](#domain-learner-profile), [legacy learning view](#domain-learner-learning-compatibility) |
| Opt-in memory | [Configuration](#domain-memory-config), [draft/import](#domain-memory-graph-draft), [publish](#domain-memory-graph-publish), [reads](#domain-memory-read), [teacher evidence/worker](#domain-memory-teacher-evidence), [recompute](#domain-memory-recompute), [reset](#domain-memory-reset), [cohort](#domain-memory-cohort), [legacy adapters](#domain-memory-legacy-progress) |
| Rich artifacts/voice | [Circuit control](#domain-circuit-tool-control), [simulation](#domain-circuit-simulation), [slides control](#domain-slides-tool-control), [PPTX/copy](#domain-slides-export-copy), [narration](#domain-slides-narration), [voice-input token](#domain-speech-token) |

## Public service

<a id="domain-system-status"></a>
### Public liveness and client configuration

**Classification:** current. **Actors:** anonymous clients, browser configuration
loader and liveness probes. **Agent/tool/worker:** none.

| Trigger | Handler in [system.py][system] |
| --- | --- |
| `GET /api/health` | `health` |
| `GET /api/healthz` | `healthz` |
| `GET /api/config` | `get_config` |

**Permissions and sequence:** `create_system_router` closes over explicitly
injected `PublicConfiguration`; it performs no authentication or cloud reads.
`health` returns fixed liveness and is hidden from OpenAPI. `healthz` returns
status, version and sorted allowed models. `get_config` returns the injected
default/agent/allowed models and version.

**State:** none in persistence or browser storage; config permits public caching
for 300 seconds. **Failure/retry/cancel:** repeatable reads, no job or cancellation.
A 200 does not verify model availability, storage, workers, configuration
compatibility elsewhere, or cloud readiness.

**Evidence:** `create_system_router` in [system.py][system], `create_app` in
[app.py][app]. Related: [router guide][router-guide].

## Membership and placement

<a id="domain-agent-roster"></a>
### Administrator-managed student assignments

**Classification:** current. **Actors:** active admins/superadmins.
**Agent/tool/worker:** none; Cosmos membership/directory helpers.

**Trigger/handlers:** `GET` and `PUT /api/agents/{agent_id}/students` map to
`get_student_assignments` and `set_student_assignments` in
[agent_membership.py][membership].

**Permissions:** `require_admin` is a global-role check, not a tenant/institute
registry check. Teachers and students cannot use this directory/replace-roster
surface. Candidate queries select active/invited student profiles and
invited/promoted student invitations. Promoted invitation IDs map to their
canonical OAuth student ID for display/access; unavailable existing assignments
are retained as removable placeholders, not valid save candidates.

**Success/state:** GET returns assignments, sorted candidates and course ETag.
PUT deduplicates IDs, validates every candidate and the submitted revision, then
conditionally replaces `studentIds`/`updatedAt` and invalidates agent-list caches.
It does not infer enrollment from institute, department, chat history or a code.
No browser state is written.

**Failure/retry/cancel:** missing course 404; invalid candidates 422; mismatched
ETag or Cosmos 412 becomes 409; storage failures 503. Reload/reconcile before
retrying a conflict. Replaying a successful PUT with the old revision conflicts,
rather than overwriting a newer roster. No cancellation endpoint.

**Evidence:** `student_directory`, `set_student_assignments` in
[membership router][membership]; `list_student_assignment_candidates`,
`get_student_assignment_ids`, `set_agent_students` in [Cosmos persistence][cosmos].
Related: [router guide][router-guide].

<a id="domain-agent-membership"></a>
### Teacher membership and compatibility member mutations

**Classification:** mixed. **Actors:** course owners/assigned teachers and global
admins/superadmins. **Agent/tool/worker:** none.

| Trigger | Handler in [agent_membership.py][membership] |
| --- | --- |
| `GET /api/agents/{agent_id}/members` | `get_members` |
| `POST /api/agents/{agent_id}/members` | `add_member` |
| `DELETE /api/agents/{agent_id}/members/{target_user_id}` | `remove_member` |

**Permissions:** `require_manager` rejects students, rejects a different optional
`requester_id`, then applies ordinary course access. This is **not owner-only**.
An assigned co-teacher may add a teacher member or remove a teacher-only member.
Student addition additionally requires admin role and a directory candidate;
removal of an ID currently in `studentIds` also requires admin role. Teacher
addition does not independently verify the target account exists or has teacher
role. GET exposes both member ID arrays to an authorized manager.

**Success/state:** POST invokes the matching persistence helper. DELETE invokes
teacher removal followed by student removal, and can remove a dual membership.
List caches, and applicable teacher-scope caches, invalidate. No browser write.

**Failure/retry/cancel:** 403/404 for authorization/missing course, mapped 409/503
for persistence problems. DELETE is **two writes**, not a transaction. These
compatibility mutations have no caller ETag contract; re-read after an uncertain
write instead of assuming full replacement or rollback. No cancel endpoint.

**Evidence:** `require_manager`, `add_member`, `remove_member` in
[membership router][membership]; [ordinary access][agent-access].
Related: [router guide][router-guide].

<a id="domain-agent-connect-list"></a>
### Manage-code connection and caller-scoped TA listing

**Classification:** mixed. **Actors:** all active roles.
**Agent/tool/worker:** none; manage-code persistence and a main-module list adapter.

**Trigger/handlers:** `POST /api/agents/connect-by-code` -> `connect_agent_by_code`;
`GET /api/azure/agents/list` -> `list_agents`.

**Permissions and success:** normalize the six-character code and look up a TA.
A **student must already be assigned** and returns `already_joined=true`; a code
is not student self-enrollment. A teacher without access may be added to
`teacherIds`; an admin already satisfies ordinary access. Listing passes
authenticated ID/role to `main.azure_agents_list`, rejects a different optional
`user_id`, and applies `created_by_id` only as a further filter. Underlying
membership listing selects active agents and explicit memberships/aliases.

**State:** successful new teacher connection updates membership and invalidates
list/teacher-scope caches. Non-student listing uses a 30-second user/role cache
and in-flight-fill coordination; student listing re-reads membership so a roster
removal is not deferred by that TTL. Hidden meta-agents are filtered. If Cosmos
listing fails, only admins/superadmins may fall back to the unscoped remote
Foundry listing; students/teachers fail closed. Neither route writes browser
storage or student assignments.

**Failure/retry/cancel:** unknown code 404, unassigned student/identity mismatch
403, failed persistence 503. Reconnecting an authorized account is a no-op;
listing can be repeated or force-refreshed. Neither a chat share token nor
possession of a course URL substitutes for authorization. No cancel operation.

**Evidence:** `connect_agent_by_code`, `list_agents` in
[membership router][membership]; `list_agents_for_user` in [Cosmos][cosmos];
`azure_agents_list` in [main.py][main]. Related: [router guide][router-guide].

<a id="domain-course-placement"></a>
### Administrator course placement

**Classification:** current. **Actors:** active admins/superadmins.
**Agent/tool/worker:** none.

**Trigger/handlers:** `GET`/`PUT /api/agents/{agent_id}/placement` ->
`get_course_placement` / `set_course_placement` in [course_placement.py][placement].

**Permissions:** global administrator role; no graph-memory registry check.
Records containing `job_type` are not TAs. Request values forbid control
characters and require both institute/department or neither; the handler does
not resolve these labels against a directory registry.

**Success/state:** GET uses legacy `institution` if `institute` is absent and
normalizes an incomplete stored pair to two empty strings. PUT checks the course
revision and conditionally sets `institute`, `department`, and an empty
`departmentId`, returning the new revision. It invalidates list caches, not
teacher-scope caches. This is not student assignment or a graph-scope change.
No browser storage is written.

**Failure/retry/cancel:** invalid saved values 422, missing TA 404, stale ETag 409,
service failure 503. Reload after a conflict/uncertain write. No automatic
organization membership cascade, cancel endpoint or stale-revision replay.

**Evidence:** `_placement_from_agent`, `set_course_placement` in
[router][placement]; [CoursePlacementUpdate][placement-schema].
Related: [router guide][router-guide].

## Course setup and materials

<a id="domain-course-form-companion"></a>
### Course Companion form assistance

**Classification:** current. **Actors:** active teachers/admins/superadmins.
**Trigger/handler:** `POST /api/course-form/assist` -> `assist_course_form`.

**Actual runtime:** [course_form_assistant.py][form] references the existing
**`form-fill-assistant`, version `4`**, through a lifespan-owned Responses client.
This Course Companion suggests form fields. It is **not** CACA, the per-course
TA, a learner-memory worker or proof of a separate lifelong learner agent.
The local `agent_definition` declares `gpt-5`, no tools and strict JSON schema,
but the request does not publish that definition; deployed contents remain an
external dependency.

**Permissions:** role check only, not authorization to a particular existing
course. Prerequisites are checked against the **caller-supplied**
`availablePrerequisites` plus `__none__`. `allowEdits=false` returns null for all
fields even if the model suggested changes.

**Success/state:** validate current form, message, up to six history turns and
three attachments. `form_agent_input` reads bounded TXT/Markdown/DOCX/PDF text
or normalizes static images. PDF text extraction uses local `pdfinfo`/`pdftotext`
and accepts at most five pages; no OCR is done here. The model call uses
`store=False`, a 90-second timeout, `max_retries=0`, and completed output must
validate as `CourseFormResult`. Returned fields may be applied by the client.
No course, agent, material index or learner record is saved; browser persistence
is not performed by this endpoint. Local extraction data is request-scoped.

**Failure/retry/cancel:** malformed/oversized request or attachment 422; failed,
incomplete or invalid model response 503, with “form has not been changed”
semantics. Repeating the form request makes another inference call, not a
durable job resume. No server undo/cancel API. The model client closes at
lifespan exit.

**Evidence:** `assist_course_form`, `form_assistant_lifespan` in [router][form];
[form_agent_input][form-attachments]; [validate_form_result][form-schema].
Related: [course creation guide][creation-guide].

<a id="domain-material-preflight"></a>
### Local material acceptance checks

**Classification:** current. **Actors:** active non-student accounts.
**Trigger/handler:** multipart `POST /api/knowledge/preflight` ->
`preflight_materials`. **Agent/tool/worker:** none; local inspection.

**Permissions:** `require_teacher` rejects students; no course/draft is needed
to inspect a prospective upload.

**Success/state:** [inspect_material][uploads] accepts only PDF, DOCX, UTF-8
TXT/Markdown and the listed raster formats. The batch allows 1–100 files and
250 MiB; a file is at most 100 MiB, non-PDF indexing inputs at most 16 MB, and
PDFs 1–2,000 pages. It checks format/readability, encryption/repair conditions
and bounded expansion, derives hashes/source IDs and safe stored names, and
returns per-file acceptance/preparation/OCR indicators. **No upload, OCR or
indexing occurs**, and no durable/browser state changes.

**Failure/retry/cancel:** an individual rejection appears in its report; invalid
batch limits are 422 and operational failures map to 409/503. Re-inspection is
side-effect-free. No job/cancel endpoint.

**Evidence:** `preflight_materials`, `upload_limits` in [materials router][materials];
`inspect_material` in [material_uploads.py][uploads]. Related: [router guide][router-guide].

<a id="domain-material-draft-upload"></a>
### Owned material drafts and original uploads

**Classification:** current. **Actors:** teacher/admin creator or course editor.
**Agent/tool/worker:** none during these requests.

| Trigger | Handler in [course_materials.py][materials] |
| --- | --- |
| `POST /api/knowledge/drafts` | `create_material_draft` |
| multipart `POST /api/knowledge/build` | `knowledge_build` |

**Permissions:** students are rejected. An unattached draft is accessible only
to its owner; an attached job requires matching course session and edit access.
When `agent_name` is supplied, the authorized course resolves the session.

**Success/state:** draft ID/session are deterministic from owner plus
`request_id`, so an unchanged create returns the existing owned job. Build
validates each file and stores originals under the material manifest, with
`AzureSearch_Skip` metadata. Identity derives from original name/content hash;
same source/scope upload reuses its entry. A removed source can be restored with
a new generation. ETag-checked manifest updates record upload status.
The operation does not itself mean processing/index readiness; browser storage
is unchanged.

**Failure/retry/cancel:** bad file 422; changed/leased/processing job 409; service
failure 503. The upload loop is sequential, not atomic: earlier originals may
remain if a later file fails. Retry the same request ID/files and inspect
status. No rollback or cancel endpoint.

**Evidence:** `require_material_job`, `knowledge_build` in [router][materials];
`create_draft`, `store_upload`, `ensure_edit_job` in [material_jobs.py][jobs].
Related: [creation guide][creation-guide].

<a id="domain-material-processing"></a>
### Durable material processing, polling and events

**Classification:** current. **Actors:** authorized draft owner/course editor
and application worker. **Agent/tool:** no material-processing agent; local
preparation, Blob copies, shared Search indexer and scoped verification.

| Trigger | Handler in [course_materials.py][materials] |
| --- | --- |
| `GET /api/knowledge/jobs/{job_id}` | `material_job_status` |
| `POST /api/knowledge/jobs/{job_id}/process` | `process_material_job` |
| `GET /api/knowledge/jobs/{job_id}/events` | `material_job_events` |

**Permissions:** `require_material_job` applies non-student ownership/editing
and exact session checks. SSE checks once before streaming and again through
its repeated authorized status calls.

**Success/state:** process starts/resumes selected failed sources; already-active
preparing/indexing work returns its status. The worker claims a five-minute
lease, renews it during work and saves checkpoints. PDFs become bounded page
parts, text/Markdown becomes escaped HTML chunks, and other supported files
become deterministic copies. Prepared-copy generations and hashes protect
retry consistency. Indexing requires a **fresh** execution plus verifiable
expected copies in the correct session/scope; a successful indexer response
alone is insufficient. A creation subjob may be advanced before materials,
so TA creation can finish while knowledge is pending.

GET normalizes terminal jobs stuck in preparing/indexing as failed, including
file/TA error messages. SSE emits every two seconds, at most 600 iterations,
stopping for `COMPLETED`, `FAILED` or disconnect. It does not own the job.
Durable state is Cosmos job/manifest/lease and Blob/Search copies; browser
storage is not written.

**Failure/retry/cancel:** permanent errors or four failures stop processing;
transient retries back off. Uncertain/unmatched indexer errors fail closed;
indexing times out after two hours. Explicit process retries selected failures
with new generation/attempt state, preserving successful files. Originals are
retained. There is no user job-cancel API.

**Worker lifecycle:** `materials_lifespan` initializes Search/creation clients,
starts material and curriculum workers, signals `stop` and research shutdown,
awaits both workers, then closes clients. In-flight threaded work is awaited;
lost/expired leases and persisted checkpoints support later recovery.
Disconnecting a status stream does not cancel any of this.

**Evidence:** `materials_lifespan`, `material_job_events` in [router][materials];
`start_processing`, `run_worker`, `advance_job`, `check_indexing`, `job_status`
in [jobs][jobs]; [prepared_parts][uploads]. Related: [creation guide][creation-guide].

<a id="domain-material-files"></a>
### List, download and remove course materials

**Classification:** mixed. **Actors:** editors for list/remove; course members
including assigned students for download. **Agent/tool/worker:** no agent;
manifest/Blob operations and the existing material worker for removal.

| Trigger | Handler in [course_materials.py][materials] |
| --- | --- |
| `GET /api/agents/{agent_name}/course-materials` | `list_course_materials` |
| `GET /api/agents/{agent_name}/course-materials/file` | `download_material` |
| `DELETE /api/agents/{agent_name}/course-materials/file` | `remove_course_material` |

**Permissions:** list/remove require edit access, **not** student access.
Download requires ordinary membership and a safe filename. `source_id` download
also verifies job/course, source, scope and exact filename. Session comes from
saved course setup. Protected material links are not public-share capabilities.

**Success/state:** list combines original manifest entries and legacy flat blobs,
hiding prepared copies and pending removals. Download resolves the authorized
original (or legacy blob) and streams a private/no-store attachment. Remove
marks a manifest operation and returns a job in **`uploading`**: the caller must
subsequently invoke **process**. The worker then deletes matching Search
documents and prepared copies and marks the entry removed. Original blobs
remain. Reads and browser storage have no persistence changes.

**Failure/retry/cancel:** missing source/blob 404; session/processing conflicts
409; service failures 503. Already removed is a no-op. A 202 removal response
is not proof of deletion. No arbitrary-path deletion, original-erasure promise,
rollback or cancel route.

**Evidence:** handlers in [router][materials]; `remove_material`,
`remove_indexed_part`, `prepare_next_file` in [jobs][jobs].
Related: [router guide][router-guide].

<a id="domain-material-index"></a>
### Explicit common-index refresh

**Classification:** mixed. **Actors:** active course editors.
**Agent/tool/worker:** no agent; common Search indexer plus verifier.

**Trigger/handlers:** multipart `POST /api/knowledge/update-index` ->
`update_course_index`; `GET /api/knowledge/index-status` -> `get_index_status`.

**Permissions:** edit access and matching `session_uuid`. Status requires the
stored operation ID and session, not an arbitrary index request.

**Success/state:** POST stores a new `materialIndexing` operation with expected
files/request time, then requests the common pipeline. GET checks unchanged
files, execution started after the request, successful completion without errors,
and exact scoped filename coverage. It can persist a terminal/changed state;
it is not a purely side-effect-free GET. No browser write.

**Failure/retry/cancel:** changed file set -> `changed`; failing execution or
15-minute limit -> `failed`; missing/stale operation 404/409; unavailable
pipeline 503. Each POST creates a new ID, not idempotent replay. Recheck status
after an uncertain request and retry explicitly. No common-indexer cancellation.

**Evidence:** handlers in [materials router][materials]; `new_operation`,
`check_operation`, `save_operation` in [course_materials utility][material-utils].
Related: [router guide][router-guide].

<a id="domain-course-creation"></a>
### Durable CACA-assisted course TA creation

**Classification:** current. **Actors:** teacher/admin creator, authorized job
reader/editor and material worker.

| Trigger | Handler in [course_creation.py][creation] |
| --- | --- |
| `POST /api/agents/create-async` | `create_agent` |
| `GET /api/agents/creation-jobs/{job_id}` | `creation_status` |
| `POST /api/agents/creation-jobs/{job_id}/retry` | `retry_creation` |

**Actual agent:** **CACA = `course-agent-creation-agent`** generates a validated
`description`/`instructions` specification with `tool_choice="none"` and
`store=False`. Application code, not another agent, reserves a name, composes
shared prompts, builds tools and provisions the per-course prompt TA. This is
different from Course Companion's `form-fill-assistant` and from learner chat's
`GeneralAgent`. No LACA/TCA/“LearningAgent” is inferred from old labels.

**Permissions:** creation requires non-student role and **exact draft owner**;
a different `createdById` is rejected. Status/retry uses owned-draft or
attached-course edit/session authorization. Server settings select allowed
model/index values; ownership metadata ties reservations, setup and remote
versions to the creation job.

**Success/state:** normalize request and save digest/name reservation ->
`preparing` -> `creating` -> `saving` -> `created`. Preparing obtains CACA
specification and applicable hosted-memory setup concurrently, checkpointing
each success. If global graph memory is enabled, hosted-memory setup returns
empty and the new TA does not receive it; this does **not** activate graph
memory for that course. The TA receives session-filtered Search and supported
tools, with ordinary hosted web search disabled on this path. Setup is saved
in Blob, course metadata in Cosmos, metadata caches invalidate, and textbooks
can cause a separate curriculum job to be enqueued.

The result reports TA success independently of `knowledge_pending`, materials
and curriculum readiness. No learner mastery or browser storage is created.

**Failure/retry/cancel:** unchanged normalized digest returns existing work;
changed input/name ownership is 409. Invalid/incomplete CACA JSON is a bounded
failure, not raw text accepted as instructions. Successful checkpoints survive
retry; transient failures back off and stop after four failures, permanent
ones sooner. `agent_create_started` plus owned-version lookup prevent blind
duplicate creation after an uncertain remote result. Stopped parent jobs
surface as failed. Explicit retry resumes failed phases. No cancellation,
rollback or cross-service transaction.

**Evidence:** handlers in [router][creation]; `start_creation`,
`generate_specification`, `prepare_memory`, `create_foundry_agent`,
`advance_creation`, `persist_created_course` in [creation utility][creation-utils].
Related: [CACA guide][creation-guide], [curriculum research guide][research-guide].

<a id="domain-course-curriculum"></a>
### Legacy curriculum editing, status and research recovery

**Classification:** mixed. **Actors:** course members reading; editors
writing/retrying; curriculum worker.

| Trigger | Handler in [course_creation.py][creation] |
| --- | --- |
| `GET /api/agents/{agent_name}/course-curriculum` | `get_course_curriculum` |
| `PUT /api/agents/{agent_name}/course-curriculum` | `update_course_curriculum` |
| `POST /api/agents/{agent_name}/course-curriculum/retry` | `retry_course_curriculum` |
| `POST /api/agents/{agent_name}/retry-textbook-research` | `retry_textbook_research` |
| `POST /api/agents/{agent_name}/retry-threshold-research` | `retry_threshold_research` |

**Permissions:** GET requires ordinary course/session access and computes
editor retry eligibility. PUT rejects students, checks course access and
matching optional `user_id`, and explicitly rejects authoritative graph mode:
edit a graph draft and publish instead. Research retries require edit access;
the textbook alias delegates to the full retry handler.

**Agent/tool/worker:** reads and manual PUT use no agent. Durable research invokes
`main._background_textbook_research` or
`main._background_threshold_concept_research`; their references distinguish
CACA from configured `TEXTBOOK_RESEARCH_AGENT_NAME` and
`THRESHOLD_CONCEPT_RESEARCH_AGENT_NAME`. Configuration names are not evidence
of particular deployed identities. The durable worker is application code.
Full research first reframes the syllabus through CACA, enriches module/textbook
coverage with the textbook agent, then batches threshold concepts, misconceptions
and example questions through the threshold agent. Module outputs are merged,
deduplicated and normalized; optional consolidation is another research call,
not learner assessment. Generated question examples are not approved graph
diagnostics.

**Success/state:** GET returns `not_available`, `processing`, `failed` or `ready`,
optionally without content via `status_only`; `_error` is not exposed as raw
curriculum error content. PUT strips `_status`/`_error`, saves curriculum, saves
history only when `commit_message` is supplied, then invalidates cache.
Canonical curriculum JSON is overwritten in Blob; the Cosmos pointer/timestamp
update is best-effort, so its failure does not undo a saved Blob. Complete
curricula can be cached; partial saves evict the cache. History is a separate
Blob-backed Git operation, not an automatic part of every curriculum save.
Full retry reads saved description/textbooks; threshold-only retry additionally
needs the saved local `syllabus_research_raw.txt`. It queues only eligible
failed/not-available work. The worker requires complete saved syllabus **and**
nonempty threshold concepts before success. Durable research status, source
outputs and curriculum persist separately. No graph publication, graph
activation or browser persistence happens here.

**Failure/retry/cancel:** ready/processing returns current status rather than
duplicating work. Missing saved inputs 422; storage/queue failures 503.
Five-minute leases are renewed; failed research is retried up to two job attempts
before explicit recovery, with inner streaming/batch retry and splitting behavior
inside the helpers. Raw artifacts and partial curriculum can survive a failure.
Research shutdown is cooperative, not a user cancel route. Curriculum/history
are not a single transaction. Retry handlers do not perform PUT's explicit
authoritative-mode guard; do not present legacy research recovery as reviewed
graph publication.

`ResearchShutdown` deliberately derives from `BaseException`, so the helpers'
and curriculum worker's broad `except Exception` retries/finalization do not
swallow it. Interruption can leave the prior durable checkpoint and lease for
later recovery rather than immediately marking the job failed. Normal shutdown
signals the process-local flag and cancels queued shared-executor futures;
neither action forcibly cancels an in-flight remote request. Worker normal-path
client cleanup should not be mistaken for a guarantee after every abnormal exit.

**Evidence:** handlers in [router][creation]; `curriculum_status`,
`retry_curriculum`, `run_curriculum_research`, `run_curriculum_worker` in
[utility][creation-utils]; delegated research helpers in [main.py][main].
Persistence details: `save_course_curriculum` in [Cosmos][cosmos].
Related: [research guide][research-guide], [creation guide][creation-guide].

<a id="domain-curriculum-translations"></a>
### Shared-default and private-custom syllabus translations

**Classification:** current. **Actors:** active course members, including students.
**Agent/tool:** direct configured `CHAT_MODEL` Responses calls, **not** a named
translation agent; strict `TranslationBatch` output.

| Trigger under `/api/agents/{agent_name}/course-curriculum/translations` | Handler |
| --- | --- |
| `GET` base path | `get_translation_catalog` |
| `GET /{language}/{style}` | `get_saved_translation` |
| `POST` base path | `create_translation` |

**Permissions:** ordinary membership, existing syllabus and matching source hash.
Default instructions are shared within the course. Custom instructions are
fingerprinted and keyed to the authenticated user; listing combines only the
shared/default and caller-custom prefixes. Custom translation does not make
another user's private variant visible.

**Success/state:** derive unique syllabus strings/source version hash; reuse
validated result if present; otherwise acquire renewable 60-second Blob lease,
recheck cache, translate bounded batches and save immutable complete result.
At most 800 source strings/80,000 characters; each source at most 8,000;
batches up to 80 strings/10,000 characters. Calls use at most 90 seconds each,
no SDK retries and a 180-second request deadline. Source curriculum is untouched.
Lease heartbeat is process-local; no browser storage write.

**Failure/retry/cancel:** absent syllabus/result 404; source changed, busy or
lost lease 409; too-large syllabus 413; incomplete/invalid output or failed
save 503. Retrying uses the same result identity; incomplete batches are not
published as a successful translation. No durable job or user cancel endpoint.
Lifespan owns/closes the model client.

**Evidence:** [translation router][translation] (`require_curriculum`,
`translate_texts`, all three handlers); [translation utility][translation-utils]
(`translation_blob_name`, `_translation_lease`, `get_or_create_translation`).
Related: [router guide][router-guide].

## Conversation and actual harness/tool behavior

<a id="domain-chat-turn"></a>
### Typed TA chat, compatibility adapters and actual harness

**Classification:** mixed. **Actors:** active course members on legacy courses;
only the enrolled student account on graph-enabled learner chat.

| Trigger under `/api/agents/{agent_id}/chat` | Handler in [chat.py][chat] |
| --- | --- |
| `POST /stream` | `chat_stream` |
| `POST /agui` | `chat_agui` |
| `POST /start` | `chat_start` |
| `POST /continue` | `chat_continue` |

**Permissions and ingress:** ordinary course access plus active-account checks;
`user_id` must match the account. Text or images is required; depth is
`quick|balanced|detailed`. Graph-off/global-disabled passes through without
ledger capture. Shadow/authoritative requires stable non-reserved `event_id`,
strict learner scope, and **rejects teacher/admin preview**. Server time, not
optional client `occurred_at`, timestamps captured chat. Explicit edits need a
new ID plus `supersedes_event_id`; only that learner's chat input can be
superseded, not teacher evidence or a frozen assessment. Inline raster image
evidence is privately archived under bounded size/type checks.

Graph capture occurs **before opening inference**. Failure is an HTTP error,
not a successful response followed by a best-effort background write.
`X-Memory-Event-Id`/`X-Memory-Status` expose the receipt on streaming responses.
Both graph modes bind/verify conversation metadata to learner, curriculum and
epoch. Authoritative requests additionally read the remote TA definition, reject
unverified hosted memory and pin its version. Legacy continuation paths do not
perform that graph-metadata ownership check.

**Actual agent:** the **course's existing named prompt TA**, called via
`GeneralAgent` in [harness/runtime.py][runtime]. The old
`base_agents.general_agent` path aliases the exact same module/cache. Instances
are shared by endpoint, TA and material session; user identity and
`MemoryToolContext` are request-local, including parallel calls. In the current
source, runtime methods delegate to [dispatch.py][dispatch] for tools/waits,
[output.py][output] for validated prose/raw-call fallback,
[events.py][events] for event starts, [telemetry.py][telemetry] for usage/citation
helpers and [turn_policy.py][turn-policy] for pure stopping/rewind rules.

**Success sequence:**

1. SSE/AG-UI handlers delegate to `main.agent_chat_stream` /
   `main.agent_chat_agui` after typed preparation. SSE has its own setup;
   AG-UI and graph nonstream use `_open_agent_stream` to select start/continue.
   **Both stream entry paths hardcode `web_search_enabled=False`**, despite
   accepting that payload field. `research_mode` only forces
   `tool_choice="required"`; it does not launch a deep-research agent.
2. The streaming harness emits conversation ID and `context_status=preparing`,
   builds answer-depth, profile/custom-instruction, saved institutional research
   and optional web/course context, then emits `ready` before inference.
   Context status is control metadata, not saved prose.
3. The harness retains a direct `web_search_preview` model helper for callers
   that enable it, but the domain route adapters above do **not** enable it.
   Saved institutional/departmental research can still be profile context.
   Course-material requests use the TA's single configured Search tool plus a
   server-enforced session filter.
   Retrieval checks source identity, translates prepared-copy citations to
   authorized originals and bounds passages. Retrieval failure stops that
   preparation path rather than inventing grounding.
4. TA calls use `extra_body.agent_reference`. The harness emits validated prose,
   content placeholders/blocks, runs tool calls (up to six parallel threads),
   waits for clarification only after emitting its card, submits tool outputs,
   and emits citations/usage/completion. `with_suggested_queries` buffers existing
   suggestion events until after answer content; greeting starters are
   deterministic rather than another general inference request.
5. On continued turns, replacing custom instructions deletes all old injected
   profile snapshots and confirms absence; explicit empty instructions clear
   them, omitted instructions do not. Authoritative turns replace old injected
   graph snapshots. Ordinary transcript/tool items are not wholesale deleted.

**Nonstream distinction:** `_nonstream` with memory context consumes the streaming
runtime and aggregates `message_block` plus quiz/document/challenge/circuit/slides.
It does not return every streaming event (for example image, citation,
clarification and usage events). With no memory context it calls legacy
`main.agent_chat_start/continue`, whose simple `GeneralAgent.start_chat/continue`
Responses calls are **not** the same custom-tool streaming loop: they do not
apply image, depth, research-mode or profile injection from the shared request
contract. A continuation ID is mandatory. Do not imply feature parity merely
because all four routes share a typed request.

**Concrete dispatched tools and side effects**

| Tool(s) | Actual behavior, not a separate workflow endpoint |
| --- | --- |
| `add_message`, `add_document`, `add_challenge` | Produce typed/event payloads; document rejects blank content; challenge normalizes type/difficulty/hints. They do not themselves save an asset or run learner code. |
| `add_quiz` | Legacy mode validates/normalizes quiz data, including legacy answer-key fallback and optional curriculum mappings. With either shadow or authoritative memory, freezes a server-issued assessment using trusted scope/tool-call identity. Raw-JSON quiz fallback also carries the memory context. |
| `add_circuit` | Validates `CircuitSpec` **and runs the same local simulator** before returning circuit/result; later edited reruns use the simulation endpoint. |
| `add_slides` | Validates the deck and performs PPTX render/layout preflight before emitting a new block; it is not the private-copy save operation. |
| `add_tikz_diagram` | Direct configured generator/discriminator/polisher **chat-completions model calls**, local sanitized TikZ compilation, bounded feedback/compile retries and scored-candidate retention. Named-agent labels/provisioning helper exist in the module, but the executed generator path is not a named-agent-reference request and sends no Bing tool. Failure produces a tool error/placeholder cancellation; optional geometry checking is shadow measurement, not a mastery gate. |
| `generate_image` | Configured image model, server-owned size/quality bounds, per-user/course weekly quota and Blob upload. Quota-store exceptions currently allow generation; generation can consume allowance before failing. Failed upload still returns inline image for the current session; durable image availability is not guaranteed by rendering success. |
| `ask_clarification` | Validates one to three questions with four distinct options, registers an owner-scoped in-process wait; see the clarification workflow. |
| `suggest_next_queries` | Emits validated follow-up payload; only ends a turn after actual content and no remaining declared plan. Independent suggestion API has its own direct model/fallback behavior. |
| `declare_plan` | Validates an allowed tool sequence; skips an unnecessary message-only plan. Subsequent rounds can force planned tools, then disable tools for final text. It does not schedule a durable worker. |
| `get_threshold_concepts` | Authoritative mode reads committed graph context; legacy/shadow resolves curriculum and legacy progress, potentially initializing/migrating legacy state. |
| `update_topic_progress` | Legacy without memory context launches a daemon write and immediately acknowledges; shadow calls the legacy write synchronously. Authoritative returns read-only explanation and cannot set mastery, clear misconceptions or cross thresholds. |
| `list_all_students`, `get_student_progress`, `get_agent_overview`, `list_agents` | Legacy read-only analytics wrappers. Memory-scoped dispatch denies them, and `_LoggingQueryTool` also refuses when the global memory feature is enabled. The global-disabled legacy dispatch has no equivalent per-caller role/scope check; remote tool exposure is not established by local availability. |
| Retired/unknown tool names | `add_flashcard` is explicitly rejected. An otherwise unknown function name currently returns a success-like output without executing an implementation; it is not evidence of tool capability. |

**State:** Foundry conversation and tool-result items; shared runtime/definition
caches; optional durable learner event/artifact/receipt; actual tool-specific
Blob/quota/legacy progress writes. Chat setup uses `main._load_setup_json`, which
can migrate a local setup or reconstruct course metadata into Blob on a read.
That differs from `require_course`'s cached Blob-only setup loader.
Both streaming adapters persist usage
best-effort and can start a daemon progress-claim check on collected plain-text
deltas. That optional Content Safety check logs diagnostics; it neither blocks
nor rewrites a reply and can skip when unconfigured/unavailable.

SSE alone additionally calls `record_taught_topics` on `done`, using user text
and collected assistant text to initialize legacy state and mark at most three
matching, previously not-started multiword topics **in progress**, never learned.
It is skipped in authoritative mode; AG-UI does not perform this inference.
Graph nonstream aggregation omits those transport-level usage/guardrail/inference
wrappers. These distinctions are not changes made by this documentation.

The typed routers do not themselves persist browser state or implement a
whole-turn exactly-once result cache. Transcript and asset APIs elsewhere are
distinct from emitting a content block.

**Failure/retry/cancel:** 400 for empty turn, 422 for bad depth/missing IDs, 403 for
identity/scope mismatch. Same event ID and same learner input reuses the memory
receipt, **not necessarily the model response**; changed input conflicts.
Pre-inference context replacement must succeed. Tool errors emit `block_cancel`
for placeholders and correction output for the model. Plan-step rewind is
bounded by plan length/round history; the `while pending_tool_calls` loop has
**no general hard round cap**. Final tool-output save failure emits an error.
Some follow-up exceptions break the loop and still reach `done`; `done` must
not be interpreted as proof every requested artifact completed.

Both streaming adapters use `_with_sse_keepalive`: a daemon producer, one-slot
queue and 15-second comment keepalives. Consumer cleanup sets a stop event to
release the producer; it does **not** forcibly interrupt an already-running
model, tool or clarification wait. Producer exceptions are re-raised to the
consumer. There is no cancellation endpoint and no rollback of accepted evidence
or completed tool writes on disconnect. Legacy daemon progress writes are not
durable jobs. Retrying can repeat paid inference/tool effects.

**Evidence:** [chat router][chat] (`prepare_chat`, `_nonstream`); [main.py][main]
(`_open_agent_stream`, chat adapters); [runtime][runtime]
(`start_chat_stream`, `continue_chat_stream` and dispatch adapters);
[dispatch][dispatch] (`dispatch_tool_call`, `execute_tools_parallel`),
[turn policy][turn-policy] (`round_ends_turn`, `rewind_failed_plan_step`);
[inferred progress][progress-inference] (`record_taught_topics`);
[memory integration][integration] (`capture_chat`, `validate_tool_context`,
`freeze_tool_quiz`, `verify_memory_conversation`);
[course retrieval][material-utils]; [custom tools][custom-tools],
[TikZ tool][tikz-tool], [image tool][image-tool], [logging tools][logging-tools].
Related: [TA guide][ta-guide], [harness guide][harness-guide], [memory overview][memory-guide].

<a id="domain-chat-suggestions"></a>
### Independent course-grounded follow-up suggestions

**Classification:** current. **Actors:** active course members.
**Trigger/handler:** `POST /api/agents/{agent_name}/chat/suggestions` ->
`suggest_questions`.

**Permissions:** ordinary course/session access. Submitted question/answer is
bounded generation context, not a progress event.

**Agent/tool and success:** obtain the cached per-course runtime, then
`generate_next_queries` uses a **direct configured chat-model** Responses call
with strict `CourseSuggestions`, `store=False`, eight-second timeout and no
SDK retries. Greeting-only inputs use deterministic course-name starters.
This is not another TA conversation or a new named agent.

**State:** no durable learner/conversation write, only possible runtime cache
initialization; no browser write. **Failure/retry/cancel:** incomplete, invalid
or failed model output returns `[]`; failures outside that fallback become 503
and course denial retains its HTTP error. Suggestions can be retried without
re-running the answer. No job or cancel route.

**Evidence:** [suggestions router][suggestions], `GeneralAgent.generate_next_queries`
in [runtime][runtime]. Related: [TA guide][ta-guide].

<a id="domain-chat-clarification"></a>
### Owner-only clarification waits and answer windows

**Classification:** current. **Actors:** active clarification owner and waiting
TA harness. **Agent/tool:** `ask_clarification`, not a second agent.

| Trigger | Handler in [clarification.py][clarification] |
| --- | --- |
| `GET /api/clarify/{clarify_id}` | `get_clarification` |
| `PATCH /api/clarify/{clarify_id}` | `save_clarification_draft` |
| `POST /api/clarify/{clarify_id}` | `submit_clarification` |
| `POST /api/clarify/{clarify_id}/extend` | `extend_clarification` |

**Permissions:** active account must match registry owner. No caller-supplied
course/user override; ownership was recorded by the trusted harness.

**Success/state:** in-process registry stores question count, monotonic deadline,
revision, answer draft and submitted flag behind a condition lock. Default
answer window is 60 seconds (configurable) plus ten-second decision window.
GET gives server-relative timer data with private/no-store; PATCH updates drafts;
POST submits and wakes the wait. Extend requires the matching revision **after**
the answer deadline and before decision expiry, then starts a new answer window.
No extension count cap is implemented.

The harness must emit questions before waiting. Timeout retains available
drafts; no answers instructs the TA to choose a reasonable assumption and
continue the original turn. Completion removes the entry and emits
`clarification_done`. No durable record or browser persistence.

**Failure/retry/cancel:** wrong owner 403; missing/expired/submitted entry 410;
premature or stale extension 409; wrong answer count 422; unexpected error 503.
Submission is not replayable after acceptance. Process restart or another worker
cannot recover the wait: affinity matters. `registry.cancel` is an internal
helper, not an HTTP cancel endpoint; disconnect alone is not durable cancellation.

**Evidence:** [clarification router][clarification]; `register`, `wait`, `extend`,
`cancel` in [registry][clarification-registry]; [clarification tool][clarification-tool];
`GeneralAgent._resolve_clarification` in [runtime][runtime].
Related: [harness guide][harness-guide].

<a id="domain-chat-share"></a>
### Bounded owner-created transcript shares

**Classification:** mixed. **Actors:** active thread owner; public token holder
through the separately owned main read handler. **Agent/tool/worker:** none.

**Trigger/handlers:** `POST`/`DELETE /api/chat/thread/{thread_id}/share` ->
`share_thread` / `revoke_thread_share` in [chat_sharing.py][sharing].

**Permissions and success:** authenticate; reject different optional `user_id`;
read the thread from the authenticated owner's partition and verify `userId`.
New/refresh shares validate nonempty, unique selected saved message IDs as a
subset of latest persisted messages, then save `shareToken`, `sharedMessageIds`,
`sharedTitle`, `sharedAt` and `updatedAt` with ETag protection when available.
An existing token with `refresh=false` returns immediately: it **does not**
extend/revalidate the requested selection. Explicit refresh updates the boundary
while keeping that token.

Public reading is bounded by saved IDs; legacy links without those IDs use a
validated timezone-aware original share time. Future messages are not
automatically exposed. The main public reader selects top-level thread/message
fields and re-signs eligible generated images, but still returns message
`content`, `metadata` and `imageUrls`. It is not a blanket recursive privacy
sanitizer. The token is **not** course membership, an asset editor, memory access,
a TA manage code or permission to execute tools. “Read-only” does not mean
user-authored prose or embedded metadata was automatically scrubbed.

**State:** only sharing fields in the thread; no model, graph or browser write.
DELETE removes token/boundary fields; missing owner thread returns `success=false`.

**Failure/retry/cancel:** unsaved selection/stale conditional write 409, absent
thread on creation 404, service failure 503. Reuse versus explicit refresh is
the idempotency boundary. Revocation is not ETag-conditional; recheck after an
uncertain result. It blocks later server reads but cannot recall downloaded
copies. No share job/cancellation beyond explicit revoke.

**Evidence:** [sharing router][sharing]; `create_share_token_for_thread`,
`revoke_share_token`, `get_messages_for_shared_thread` in [Cosmos][cosmos];
`get_shared_chat` in [main.py][main].
Related: [router guide][router-guide].

## Assessments and self-service profile

<a id="domain-assessment-first-attempt"></a>
### Frozen server-graded assessments and legacy quiz passthrough

**Classification:** mixed. **Actors:** active authorized quiz participant;
graph-enabled paths require the enrolled learner scope.

| Trigger | Handler in [assessments.py][assessments] |
| --- | --- |
| `POST /api/quiz-assets` | `upsert_quiz_asset_endpoint` |
| `GET /api/quiz-attempts/{quiz_id}/first` | `get_first_quiz_attempt_status` |
| `POST /api/quiz-attempts/first` | `submit_first_quiz_attempt` |

**Permissions/branching:** optional `userId` must match the authenticated account,
and ordinary course access is checked. With global memory disabled or course
mode off, the router validates a legacy model and invokes the corresponding
main helper. Legacy `_normalize_first_quiz_attempt` compares selections against
the **caller-supplied correct indices**, with concept mapping as best-effort
enrichment; it is not frozen server grading. Both shadow and
authoritative modes instead resolve strict current learner/curriculum/epoch
scope; quiz saves/submissions require `quizId == assessmentInstanceId` and a
matching `curriculumVersion`. Submission requires stable non-`operation_`
`event_id`.

**Actual agent/tool:** TA `add_quiz` is an **upstream producer**. It freezes an
instance under trusted event/tool-call identity before returning a public quiz.
Published problem IDs select authored options, keys and catalog approval.
Model-generated practice questions can also be frozen/graded, but remain
non-qualifying practice. HTTP grading is deterministic, not another agent or
LLM judge; memory observation extraction is later and separate.

**Success/state:**

1. Pre-submission public quiz includes IDs, options/option keys and multiple-choice
   shape, **not correct keys or explanations**. Saving the quiz asset uses the
   server's title/questions/type, not browser claims.
2. Status checks the frozen instance and existing first submission. Submit
   forwards only `problemId`, selections and reasoning; browser question text,
   correct answer, score and misconception mapping never become grading authority.
3. Frozen options/keys determine correctness. First submission, exposure records,
   learning input, sequence cursor and processing receipt commit together.
   Returned grading includes feedback only after durable submission.
4. Reused/exposed approved problems are marked `ANSWER_REVEALED` on later
   instances. Published mappings, version/rubric/family and assistance qualify
   downstream evidence; correct selection alone does not certify understanding.
5. A private Cosmos attempt asset is written **after** the ledger operation.
   It is a compatibility cache, not state authority. No browser write here.

**Failure/retry/cancel:** invalid instance/input 422; changed curriculum,
different first answer or contested write 409; authorization 403. Same normalized
answers return the original saved submission/event receipt even on a repeated
request; changed answers conflict on the graph path. The legacy asset helper
instead returns its existing first attempt even if a later valid submission
differs, and uses up to three conditional-write attempts. If cache saving fails
after ledger acceptance, retry the same submission to repair it. A missing
worker leaves accepted memory work pending, without undoing the server grade.
No first-attempt replacement, cancellation or evidence deletion API.

**Evidence:** `_access`, `_instance_id`, handlers in [assessments router][assessments];
[freeze_tool_quiz][integration]; `freeze_assessment`, `public_assessment`,
`submit_assessment`, `build_evidence` in [MemoryService][memory-service];
`accept_learning_event` in [events][memory-events].
Related: [evidence guide][evidence-guide], [TA guide][ta-guide].

<a id="domain-assessment-feedback"></a>
### Persist quiz feedback without granting grading authority

**Classification:** compatibility. **Actors:** authorized quiz participant.
**Trigger/handler:** `POST /api/quiz-attempts/{quiz_id}/feedback` ->
`append_quiz_feedback_endpoint`. **Agent/tool:** none at this endpoint.

**Permissions and success:** same identity/course checks as other assessments.
Graph-enabled mode additionally requires the frozen first submission to exist,
otherwise 409. The route then always validates the legacy feedback request and
delegates to `main.append_quiz_feedback_endpoint`. The path quiz ID remains
the lookup; the optional instance field is not a scope bypass.

**State:** the first nonempty `agentFeedback` and timestamp in the compatibility
asset, not an authoritative grade, accepted observation or direct learner-state
update. Despite “append” naming, existing feedback wins and later different
text is not appended. Caller-provided feedback does not prove an agent produced
it. No browser storage.

**Failure/retry/cancel:** missing submitted asset 404; storage failures use
delegated/memory error semantics. The helper retries conditional conflicts up
to three times and reuses an existing feedback value, but exposes no stable
event receipt. Read saved feedback after uncertain completion. No cancellation.

**Evidence:** handler in [assessments.py][assessments] and same-named delegate in
[main.py][main]; `append_quiz_agent_feedback` in [Cosmos][cosmos].
Related: [evidence guide][evidence-guide].

<a id="domain-learner-profile"></a>
### Self-service learner instructions

**Classification:** current. **Actors:** any active account acting on self.
**Agent/tool/worker:** none for profile operations.

**Trigger/handlers:** `GET`/`PUT /api/learner-profile` ->
`get_learner_profile` / `update_learner_profile` in [learner_profile.py][profile].

**Permissions and sequence:** there is no target-user selector. Authenticated ID
selects the profile; response identity is verified. GET normalizes null
instructions to empty. PUT writes validated `customInstructions`, then requires
the acknowledgement to include matching content and a timestamp. Both are
private/no-store.

**State:** profile instructions/`updatedAt`; no browser write or remote-agent
definition change. Later TA turns inject them as **learner-scoped preferences**,
not new system authority. The harness confirms stale injected snapshots were
removed before using replacements; explicit empty clears, omission preserves.

**Failure/retry/cancel:** missing profile 404; inconsistent acknowledgement or
service failure 503. No ETag/idempotency token: read back after uncertain save.
A later failure to replace conversation context stops that turn rather than
claiming preferences took effect. No profile-save cancellation.

**Evidence:** [profile router][profile]; `_clear_prior_learner_instruction_context`
in [runtime][runtime]. Related: [harness guide][harness-guide].

<a id="domain-learner-learning-compatibility"></a>
### Typed self-only legacy learning view

**Classification:** compatibility. **Actors:** active course member reading self.
**Trigger/handler:** `GET /api/learner-profile/learning/{agent_id}` ->
`get_learner_learning`. **Agent/tool/worker:** none.

**Permissions:** ordinary course membership and authenticated self; stored record
key, partition, user/course IDs are verified. **Success/state:** read existing
legacy learning state and profile preference; return `ok` with typed progress
or `no_state`, plus a list containing a nonblank saved preference. No creation,
mutation, browser storage or automatic graph projection. Response is private/no-store.

**Failure/retry/cancel:** missing profile 404; storage/schema/identity failure
503. Repeatable read, no cancellation/job. This representation must not be
advertised as the authoritative graph state merely because graph mode exists
elsewhere.

**Evidence:** `get_learner_learning` in [profile router][profile];
`StoredLearnerLearningState` in [profile schema][profile-schema].
Related: [memory overview][memory-guide].

## Opt-in graph memory

<a id="domain-memory-config"></a>
### Opt-in memory scope, mode and activation

**Classification:** optional. **Actors:** authorized course readers and registered
scoped administrators. **Trigger/handlers:** `GET`/`PUT
/api/agents/{agent_id}/memory/config` -> `memory_configuration` /
`update_memory_configuration`. **Agent/tool:** no new agent.

**Permissions:** `GRAPH_MEMORY_ENABLED` defaults false. GET can disclose the
feature/configuration status to an ordinary member when no memory scope exists,
or a strict course actor when it does. PUT requires global enablement and an
admin/superadmin **listed in the exact tenant/institute scope registry**, including
first binding. Existing `memory_scope` cannot be changed. `can_manage` is only
a role-based hint: it does not prove registry authorization.

**Success/state:** validate active course actor and revision. Non-off activation
requires a published, teacher-reviewed, correctly scoped curriculum.
Authoritative activation additionally **reads** the existing TA definition to
reject hosted-memory tools; it does not silently remove them. Conditional course
replacement changes `memory_scope`, `curriculum_binding`, `graph_memory_mode`
and invalidates metadata/teacher caches.

| Mode | Consequence |
| --- | --- |
| Global disabled / course `off` | Existing legacy paths; global-disabled chat avoids graph ingress. |
| `shadow` | Durable graph capture/processing and frozen quizzes; TA context/progress compatibility remains legacy. |
| `authoritative` | Committed scoped graph context becomes authority; legacy progress writes are blocked and graph-bound conversations/version pinning apply. |

No graph is published, no evidence migration/replay or learner snapshot reset is
performed by this update, and no browser state is written. **Publication,
activation and worker enablement are separate actions.**

**Failure/retry/cancel:** disabled PUT 404, unauthorized registry 403,
scope/graph/hosted-memory/revision conflict 409, verification/storage failure
503. Reload configuration after uncertain save. No automatic model/remote
definition update or cancellation.

**Evidence:** [memory router][memory-router] (`_config`,
`update_memory_configuration`, `_replace_binding`); [learner access][learner-access];
[verify_hosted_memory_disabled][integration]; [MemorySettings][memory-settings].
Related: [memory overview][memory-guide], [hosted-memory guide][hosted-memory-guide].

<a id="domain-memory-graph-draft"></a>
### Scoped curriculum graph drafting and legacy import

**Classification:** optional. **Actors:** assigned teacher/course owner or
registered scoped admin. **Agent/tool:** none; deterministic import and graph
validation.

| Trigger under `/api/agents/{agent_id}/course-curriculum/graph` | Handler |
| --- | --- |
| `GET` | `get_graph_draft` |
| `PUT` | `put_graph_draft` |
| `POST /import` | `import_existing_curriculum` |

**Permissions:** `_editor` requires enabled global feature, active course,
editing actor, memory identity, registry and binding. Students cannot edit.
Graph tenant/curriculum matches binding, institute set equals the authorized
institute, and any course restriction includes this TA. A requested different
version can belong to this curriculum without becoming the active version.

**Success/state:** GET returns a selected/bound draft, falling back to an
immutable published graph with null revision. PUT forces
`DRAFT`/`published_ready=false`, validates graph/budgets and conditionally writes
the draft. Import requires complete legacy curriculum/threshold concepts,
converts it deterministically into a reviewable draft and saves that revision.
No source curriculum, learner record or browser storage is changed.

**Failure/retry/cancel:** no graph 404, incomplete import or changed revision
409, invalid/over-budget graph 422. Published versions cannot be edited; use a
new version and reload current draft revision for retry. Import does not
automatically approve diagnostic rubrics or activate memory. No cancel job.

**Evidence:** `_editor`, `_scoped_graph`, three handlers in
[memory router][memory-router]; `save_draft` in [service][memory-service];
`import_legacy_curriculum` in [curriculum helper][memory-curriculum].
Related: [memory overview][memory-guide], [evidence guide][evidence-guide].

<a id="domain-memory-graph-publish"></a>
### Reviewed immutable graph publication

**Classification:** optional. **Actors:** assigned teacher/owner or registered
scoped administrator. **Agent/tool/worker:** none.

**Trigger/handler:** `POST /api/agents/{agent_id}/course-curriculum/graph/publish`
and compatibility `POST /api/agents/{agent_id}/course-curriculum/publish`
both map to **one** `publish_graph_draft`.

**Permissions and success:** strict editor scope, matching course ETag and draft
revision, and literal `reviewed=true`. The server supplies reviewer/time, marks
policy review, validates a publishable graph, and appends immutable graph and
version-catalog records. The response has no draft revision.

**State:** published graph/catalog only. **It does not update curriculum_binding,
enable memory, migrate evidence, enqueue replay or write browser storage.**
Activation remains a separate scoped-admin config PUT.

**Failure/retry/cancel:** revision/immutable-content conflict 409; invalid policy
422. Same-reviewer retries reuse saved review time, supporting equal-content
replay. Graph/catalog are separate immutable writes and can be repaired by retry.
The required request `event_id` is **not used** as a publication receipt or
deduplication key in the handler. No unpublish/cancel endpoint.

**Evidence:** `publish_graph_draft` in [router][memory-router];
`publish_graph` in [service][memory-service]; [validate_graph][memory-curriculum].
Related: [memory overview][memory-guide].

<a id="domain-memory-read"></a>
### Scoped learner snapshots, context, evidence and receipts

**Classification:** optional. **Actors:** enrolled student/self, assigned
teacher, scoped administrator. **Agent/tool/worker:** none on reads.

| Trigger under `/api/agents/{agent_id}/learners/{student_id}` | Handler |
| --- | --- |
| `GET /memory` | `get_learner_memory` |
| `GET /memory/context` | `get_learner_context` |
| `GET /memory/evidence/{evidence_id}` | `get_learner_evidence` |
| `GET /memory/evidence/{evidence_id}/artifact` | `get_learner_artifact` |
| `GET /memory/events/{event_id}` | `get_memory_receipt` |

**Permissions:** strict current learner scope; cross-student requests from a
student are rejected before scope metadata reads. Teachers/admins need an
active student target on the explicit roster, with invitation alias handling.
Admin role alone does not bypass the registry. `mode=individual` context
rejects students.

**Success/state:** snapshot gives conservative freshness, pending count and next
receipt separately from committed state. No snapshot creates an empty typed
view, not invented mastery. Context bounds nodes, edges, evidence, graph hops,
characters/tokens and references. Evidence verifies the full scope. Artifact
reads go through evidence identity, not an arbitrary blob path, and return
attachment/no-store/nosniff headers. Receipt may request an earlier
`learning_epoch`, but not a future one, within the currently authorized
curriculum binding. No persistent/browser mutation.

**Redaction distinction:** student context removes misconception nodes,
diagnostic edges and observations, marking truncation; direct evidence clears
`misconception_ids`. **The full snapshot endpoint does not apply that same
diagnostic redaction.** Do not promise all student-facing memory responses hide
the same fields.

**Failure/retry/cancel:** disabled/off 404; unauthorized actor/roster/scope/future
epoch 403; absent evidence/receipt 404; invalid/budget request 422; operational
or integrity failure 503 through `memory_api_errors`. Stale or pending data is
not proof of current crossing. Repeat reads are safe; no cancel job or arbitrary
historical-curriculum selector.

**Evidence:** handlers in [memory router][memory-router];
[resolve_learner_access][learner-access]; `student_context`,
`fresh_snapshot_view` in [retrieval][memory-retrieval].
Related: [memory overview][memory-guide], [evidence guide][evidence-guide],
[inspection guide][see-guide].

<a id="domain-memory-teacher-evidence"></a>
### Verified teacher evidence and asynchronous state derivation

**Classification:** optional. **Actors:** assigned teacher/scoped admin supplying
verified learner work, plus memory worker.
**Trigger/handler:** `POST /api/agents/{agent_id}/learners/{student_id}/memory/events`
-> `append_teacher_evidence`.

**Permissions:** editable strict learner scope, active enrolled target and
literal `verified_learner_work=true`; students cannot append through this
teacher route. Published TC/problem IDs are validated. Server binds actor,
time and `teacher_evidence` identity derived from actor plus client event ID.
This is an evidence input, **not** a request to set a state label.

**Success and durable state:**

1. `accept_learning_event` computes a semantic hash, validates graph/scope,
   stores input, sequence cursor and receipt atomically, and returns 202.
   Large input/image artifacts live in private evidence blobs with references.
   Same actor/event/input reuses the receipt; changed input conflicts.
2. The separately enabled worker claims the **next sequence** under lease,
   builds catalog-derived evidence, and persists immutable evidence records.
   Teacher-approved catalog tasks carry authored provenance/quality;
   ordinary dialogue/prose does not become an approved assessment.
3. **Observation is a model call, not an agent.**
   `FoundryObservationExtractor` calls the configured observation model with
   `responses.parse`, `tools=[]`, `tool_choice="none"`, `store=False`, no
   SDK retry and a 90-second timeout. It separates trusted catalog from
   untrusted learner text. Unsupported neutral evidence can skip inference.
4. Server validators require real evidence IDs, exact learner quotes, known
   misconceptions and approved rubric dimensions. Unapproved tasks cannot
   certify concept/transfer passes; a server-scored wrong answer cannot be
   promoted to a passing demonstration. Invalid output is not a permissive fallback.
5. **Reducer is deterministic application code.** Retained evidence and
   observations, independent-context/assistance/recency rules, misconception
   clearance and transfer policies determine state/trajectory/thresholds.
   Saved observation sets are reused on lease recovery rather than rejudged
   each retry. Snapshot, transition and completed receipt publish atomically.

**Worker lifecycle/failure:** global feature and worker settings both default
off. With feature on but worker off, acceptance succeeds and receipts can
remain pending. Main lifespan starts the worker only when configured, signals
stop on shutdown, waits up to 30 seconds then cancels its asyncio task if
necessary. Task cancellation is not a guarantee an already-running
`asyncio.to_thread` inference has stopped. Leases and checkpoints support recovery.
Model, validation, storage or reduction failures preserve the last committed
snapshot and become `RETRY_PENDING`, then `FAILED` at configured attempt limit
(default five), with backoff and failure records. Partial immutable
evidence/observations can exist without a published snapshot.

**No browser write; no state-write/cancel endpoint.** An accepted input or correct
grade is not itself a mastery or threshold-crossing verdict.

**Evidence:** `append_teacher_evidence` in [router][memory-router];
[events][memory-events] (`accept_learning_event`);
[service][memory-service] (`build_evidence`);
[observations][observations] (`FoundryObservationExtractor`,
`validate_observation_set`, `proposals_to_observations`);
[state reducer][state-reducer], [threshold policy][threshold-policy],
[processor][memory-processor] (`process_claimed`, `run`);
`lifespan` in [main.py][main].
Related: [evidence guide][evidence-guide], [state guide][state-guide],
[memory overview][memory-guide].

<a id="domain-memory-recompute"></a>
### Audited retry and deterministic memory revalidation

**Classification:** optional. **Actors:** assigned teacher/scoped administrator
and memory worker. **Agent/tool:** no recomputation agent.

**Trigger/handler:** `POST /api/agents/{agent_id}/learners/{student_id}/memory/recompute`
and `/memory/recomputations` -> one `recompute_memory`.

**Permissions:** strict editable learner scope; no student recompute permission.
Only current-epoch failed work is reopened. The caller does not choose an
arbitrary failed record.

**Success/state:** derive a stable graph/event-based operation identity;
`retry_failed_input` reopens the **next** failed input once per audited operation,
clearing attempts/error/lease and setting pending. Return an existing operation
receipt or append ordered system revalidation. Revalidation reduces retained
facts under the published policy, rather than asking a model to overwrite
mastery. A retried preceding input may still need observation extraction.
Worker also schedules deterministic expiry events from stale snapshots without
an HTTP endpoint. No deletion/browser write.

**Failure/retry/cancel:** same operation returns prior receipt; conflicts 409,
disabled/unauthorized 404/403, processing errors retain prior committed state.
Sequence gaps/failed earlier events block later inputs instead of silently
skipping them. Exhausted recovery needs a new authorized operation; saved
extractions are reused. No user cancel or force-success branch.

**Evidence:** `recompute_memory` in [router][memory-router]; `retry_failed_input`
in [service][memory-service]; `claim`, `schedule_expired`, `run` in
[processor][memory-processor]. Related: [evidence guide][evidence-guide].

<a id="domain-memory-reset"></a>
### Queued learner reset into a new learning epoch

**Classification:** optional. **Actors:** enrolled learner/self or scoped admin,
plus worker. **Agent/tool:** none.
**Trigger/handler:** `POST /api/agents/{agent_id}/learners/{student_id}/memory/reset`
-> `reset_memory`.

**Permissions:** strict learner access; teachers are **explicitly denied**, even
course owners. Admin must be in the scope registry and target an active rostered
student. Student can target only self.

**Success/state:** accept stable reset operation into current event order.
Repeated operation returns receipt, including immediately previous-epoch receipt
recovery after application. Worker commits reset transition/receipt, increments
epoch and creates a new empty snapshot atomically. Historical evidence/artifacts
remain; old conversation scope no longer matches the new epoch. No browser
state is directly cleared.

**Failure/retry/cancel:** 202 means queued, not immediate reset. Earlier pending/
failed input or disabled worker can delay it. Older-epoch identity conflicts
can require loading the original receipt (409). Ordinary access errors remain
403/404; backend failures 503. No history deletion, automatic evidence replay,
undo or cancellation endpoint.

**Evidence:** `reset_memory` in [router][memory-router]; `MemoryService.reset`
in [service][memory-service]; `_epoch_operations` in [processor][memory-processor].
Related: [memory overview][memory-guide], [evidence guide][evidence-guide].

<a id="domain-memory-cohort"></a>
### Explicit-roster memory cohort summaries

**Classification:** optional. **Actors:** assigned teacher/owner or scoped admin.
**Agent/tool/worker:** none; bounded snapshot aggregation.

**Trigger/handler:** `GET /api/agents/{agent_id}/memory/cohort` and
`GET /api/teacher-dashboard/memory/cohorts/{agent_id}` -> one `get_memory_cohort`.
The alias does not transfer ownership of other teacher-dashboard handlers here.

**Permissions:** students rejected; active course, non-off mode, registry and
binding required. `resolve_course_roster` uses **only explicit studentIds**,
resolves promoted invitations to active canonical student profiles and
deduplicates them. Invited-but-not-active/disabled/non-student entries are not
silently counted as active students. Chat participation does not enroll anyone.

**Success/state:** validate optional TC and offset; aggregate committed snapshots
in bounded pages. Return curriculum/policy identity, coverage, complete/partial,
unassessed/stale counts, blockers/trends and next offset. `evidence_loaded=false`:
raw evidence is not loaded. Rows include authorized student IDs and `student_ref`;
this is not an anonymous-only result. No persistent/browser writes.

**Failure/retry/cancel:** invalid TC/offset or oversized roster 422; missing
authorization 403; disabled/off 404. Capacity after some rows may yield partial
coverage with `next_offset`; never present it as a complete cohort. Repeat/paginate
reads; no job cancellation.

**Evidence:** `get_memory_cohort` in [router][memory-router];
`resolve_course_roster` in [access][learner-access];
`_cohort_summary` in [retrieval][memory-retrieval].
Related: [memory overview][memory-guide].

<a id="domain-memory-legacy-progress"></a>
### Progress compatibility reads and reset branching

**Classification:** compatibility. **Actors:** active course members, with
different target/reset permissions by mode. **Agent/tool:** none.

| Trigger | Handler in [learner_memory.py][memory-router] |
| --- | --- |
| `GET /api/agents/{agent_name}/progress/{user_id}` | `legacy_learning_progress` |
| `POST /api/agents/{agent_name}/reset-progress/{user_id}` | `legacy_reset_progress` |

**Permissions:** every branch authenticates and checks ordinary course access;
students can target only self. Authoritative reads resolve strict enrolled
learner scope. Authoritative reset requires stable event body and denies
teachers; no body gives 409 with instruction to use `memory/reset`.
**Off/shadow branches do not apply that authoritative target-roster check**
before delegating to main's legacy helpers.

**Success/state:** authoritative GET is a read-only graph projection with
threshold names/state, freshness and compatibility percentage, not a second
mastery authority or legacy-state initializer. Authoritative POST queues a new
epoch, returns pending and retains graph history. Off/shadow executes
`main.get_learning_progress` / `main.reset_learning_progress`, retaining legacy
behavior rather than fabricating parity with graph reset: GET calls
`ensure_learning_state` and can create legacy state on first read; POST deletes
that legacy state/cache and a later read/chat can initialize it again.
No browser write.

**Failure/retry/cancel:** graph operations use scoped receipt/epoch conflict
semantics; legacy path has no equivalent operation receipt and delegated
exceptions can remain HTTP 500. Repeating legacy reset can delete progress
recreated since an earlier reset. Identity mismatch
403; missing stable authoritative body 409. No automatic migration, whole
request idempotency or cancel endpoint.

**Evidence:** both handlers in [memory router][memory-router];
`legacy_projection` in [integration][integration];
legacy helpers in [main.py][main]. Related: [memory overview][memory-guide].

## Circuit, presentations and voice

<a id="domain-circuit-tool-control"></a>
### Explicit circuit tool enablement and schema update

**Classification:** optional. **Actors:** active course owner or global
admin/superadmin. **Agent/tool:** no inference; remote TA definition update.

**Trigger/handlers:** `GET`/`POST /api/agents/{agent_name}/circuit/tool` ->
`get_circuit_tool` / `enable_circuit_tool`.

**Permissions:** `require_tool_owner` requires edit access **and** owner/admin;
assigned co-teacher alone is insufficient. Local `ngspice` must exist to enable/
update; new tool versions require a prompt-based TA.

**Success/state:** GET compares local `add_circuit` schema/description with
remote latest and reports engine availability/version. POST acquires the
shared 60-second Blob tool-update lease, reads latest, returns unchanged if
already enabled/current, otherwise validates expected version and creates a
new TA version replacing/adding the tool while preserving other fields.
Metadata cache invalidates; no learner/deck/browser state.

**Failure/retry/cancel:** circuit's current-tool no-op occurs **before** expected
version comparison. Other stale/non-prompt/contention cases 409; unavailable
engine or unconfirmed write 503. `create_version` disables SDK retry; recheck
status after uncertainty. Failed lease release expires naturally. No disable,
simulation-time auto-enable or cancel endpoint.

**Evidence:** `require_tool_owner`, `tool_update_lock`, `enable_circuit_tool` in
[circuit.py][circuit]. Related: [router guide][router-guide].

<a id="domain-circuit-simulation"></a>
### Bounded educational circuit simulation

**Classification:** optional. **Actors:** active course members including students.
**Trigger/handler:** `POST /api/agents/{agent_name}/circuit/simulate` ->
`simulate_course_circuit`. **Agent/tool:** no agent; local deterministic
netlist construction and `ngspice`.

**Permissions:** ordinary course access; neither owner role nor remote tool
enablement is required to call this endpoint. Typed `CircuitSpec` bounds supported
components, values, identifiers, topology, events, instruments and analysis;
no raw command/netlist is accepted.

**Success/state:** acquire a nonblocking process-local slot, construct/run the
netlist with controlled process input/environment, optionally apply `prlimit`,
parse bounded output and return simulation traces/readings. Local intermediate
files and slot are request-scoped; no durable asset, learner or browser write.
The TA `AddCircuitTool` separately uses this same simulation utility when
producing its initial block.

**Failure/retry/cancel:** missing/busy engine 503; invalid/unsolved/timed-out
circuit 422. Eight-second subprocess timeout and output/parser bounds apply;
slot releases in `finally`. Retry busy runs or simplify the circuit. No durable
job/cancel API and **no hardware safety certification**.

**Evidence:** handler in [circuit router][circuit]; [CircuitSpec][circuit-schema];
[simulate_circuit][simulator]; [AddCircuitTool][circuit-tool].
Related: [router guide][router-guide].

<a id="domain-slides-tool-control"></a>
### Explicit presentation tool enablement and schema update

**Classification:** optional. **Actors:** active course owner or admin/superadmin.
**Agent/tool:** no inference; remote `add_slides` definition mutation.

**Trigger/handlers:** `GET`/`POST /api/agents/{agent_name}/slides/tool` ->
`get_slides_tool` / `enable_slides_tool`.

**Permissions and success:** owner/admin plus edit access; use the same Blob
lease as circuit changes. GET reports enabled/update/version. POST checks
`expected_version` **before** the current-tool no-op (unlike circuit), requires
prompt-based definition for change, then creates a version with current schema/
description, preserving other tools, metadata and description.

**State:** remote version and metadata cache; no deck, learner or browser write.
**Failure/retry/cancel:** stale/non-prompt/contention 409; uncertain write 503.
No automatic retry on version creation; recheck status. Changing a local schema
does not automatically update remote agents. No disable/cancel endpoint.

**Evidence:** `tool_status`, `enable_slides_tool` in [slides.py][slides];
`tool_update_lock` in [circuit.py][circuit]. Related: [router guide][router-guide].

<a id="domain-slides-export-copy"></a>
### Validated PowerPoint export and private presentation copies

**Classification:** current. **Actors:** active authorized course members.
**Agent/tool:** no inference; typed deck validation and local PPTX rendering.

**Trigger/handlers:** `POST /api/agents/{agent_name}/slides/export` ->
`export_slides`; `POST /api/agents/{agent_name}/slides/save` -> `save_slides`.

**Permissions:** ordinary course access, not tool-owner permissions.
Remote `add_slides` need not be enabled. Deck constraints include 1–20 slides,
supported layouts, bounded notes/text, valid component targets and HTTP(S)
sources; render preflight also rejects overcrowded layouts.

**Success/state:** export returns editable PPTX bytes with attachment/private
no-store/nosniff headers and no durable write. Save performs the same preflight,
creates a new `slidesId` and private `presentation` JSON asset owned by the
authenticated user, then returns asset/block. It does not overwrite the
received/original deck or write browser storage.

**Failure/retry/cancel:** layout failures 422, preparation/persistence problems
503. Repeating export is side-effect-free; repeating save can create another
copy because there is no idempotency key. An uncertain save explicitly asks
the caller to inspect assets before retrying. No save/export cancel endpoint.

**Evidence:** handlers in [slides router][slides]; [SlideDeck][slides-schema];
[render_presentation][slide-export]; [AddSlidesTool][slides-tool].
Related: [router guide][router-guide].

<a id="domain-slides-narration"></a>
### Course-authorized slide voice catalog and narration

**Classification:** optional. **Actors:** active course members.
**Agent/tool:** Speech synthesis, **not** a script-writing model or agent.

**Trigger/handlers:** `GET /api/agents/{agent_name}/slides/voices` ->
`get_slide_voices`; `POST /api/agents/{agent_name}/slides/speech` ->
`generate_slide_speech`.

**Permissions:** `require_speech_course` runs before raw body parsing. Supplied
text/voice is validated; only four Indian English/Hindi voices are allowed.
Server builds escaped SSML rather than accepting arbitrary SSML.

**Success/state:** catalog reports configured availability and voice list.
Synthesis uses server identity, disallows redirects, checks media/encoding/
length, and returns bounded MP3 with private/no-store/nosniff. No durable
audio, deck, learner or browser write; cached settings and request bytes only.

**Failure/retry/cancel:** invalid body 422, missing config/authentication 503,
bad upstream response 502, timeout 504; 429 carries bounded `Retry-After`
(1–60 seconds). Audio limit is 2 MiB and stream deadline 30 seconds.
No automatic synthesis retry, persisted audio job or cancel endpoint.

**Evidence:** `require_speech_course`, `speech_request_body`,
`generate_slide_speech` in [slides.py][slides];
`synthesize_speech`, `build_ssml` in [slide_speech.py][slide-speech].
Related: [router guide][router-guide].

<a id="domain-speech-token"></a>
### Authenticated browser voice-input token exchange

**Classification:** optional. **Actors:** any active signed-in account.
**Trigger/handler:** `GET /api/speech/token` -> `get_speech_token`.
**Agent/tool:** none; service identity and Speech STS exchange.

**Permissions and success:** this migrated route **requires authentication**,
but not course membership or teacher role. Read configured Speech resource/
region, acquire the service identity token, exchange it with a ten-second
no-redirect HTTP request, validate a bounded nonempty result, return token/region
with private/no-store. It does not perform recognition or transcribe a recording.

**State:** no durable learner/course data or browser write; client receives a
token for its voice-input operation. **Failure/retry/cancel:** missing config
or exchange failure 503; normal account 401/403 applies. Identity acquisition
can retry via its helper; there is no durable result replay, transcription job
or cancellation endpoint in this handler.

**Evidence:** `get_speech_token` in [speech.py][speech]; `get_speech_settings`
in [slide speech utility][slide-speech]; [active-account dependency][auth].
Related: [router guide][router-guide].

## Verification and interpretation limits

- The two new files are a **source audit**, not a claim of running Azure,
  importing the application, enabling memory, publishing agents, testing a
  live learner or validating cloud deployment.
- Coverage validation compares every HTTP decorator/function in the assigned
  router files (including the nested system-router factory and the three
  multi-decorated memory handlers) with exactly one sidecar assignment.
  The additional identity/directory factory handlers have explicit main-service
  ownership exclusions. IDs, required metadata, source symbols and local links
  are checked separately; no assigned domain handler is excluded.
- Important differences from broad/older descriptions: Course Companion is not
  CACA; course completion is not material/curriculum readiness; removal marking
  still needs processing; accepted memory is not completed processing; both
  shadow and authoritative quiz paths use frozen grading; graph publication
  does not activate; ordinary/global-admin access is weaker than memory registry
  access; legacy nonstream chat is not streaming-tool parity.
- No blanket permission/redaction guarantee is made: legacy member mutation
  target validation, legacy progress target-roster checks, global-disabled
  analytics-tool dispatch and full-snapshot diagnostic exposure differ from
  stricter neighboring paths. These are documented behavior boundaries, not
  exploit testing or fixes.
- Runtime behavior still depends on externally configured named-agent versions,
  models, tool exposure, storage/index contents, optional local executables,
  flags, worker liveness and load. They were not queried. Dynamic callbacks,
  workers and helper functions are explained under their triggering workflows,
  not fabricated as HTTP endpoints.

[system]: <../../Agentic Shiksha Platform/Backend/backend/routers/system.py>
[app]: <../../Agentic Shiksha Platform/Backend/backend/app.py>
[auth]: <../../Agentic Shiksha Platform/Backend/backend/dependencies/auth.py>
[agent-access]: <../../Agentic Shiksha Platform/Backend/backend/dependencies/agent_access.py>
[learner-access]: <../../Agentic Shiksha Platform/Backend/backend/dependencies/learner_access.py>
[membership]: <../../Agentic Shiksha Platform/Backend/backend/routers/agent_membership.py>
[placement]: <../../Agentic Shiksha Platform/Backend/backend/routers/course_placement.py>
[placement-schema]: <../../Agentic Shiksha Platform/Backend/backend/schemas/course_placement.py>
[materials]: <../../Agentic Shiksha Platform/Backend/backend/routers/course_materials.py>
[jobs]: <../../Agentic Shiksha Platform/Backend/utils/material_jobs.py>
[uploads]: <../../Agentic Shiksha Platform/Backend/utils/material_uploads.py>
[material-utils]: <../../Agentic Shiksha Platform/Backend/utils/course_materials.py>
[form]: <../../Agentic Shiksha Platform/Backend/backend/routers/course_form_assistant.py>
[form-schema]: <../../Agentic Shiksha Platform/Backend/backend/schemas/course_form.py>
[form-attachments]: <../../Agentic Shiksha Platform/Backend/utils/form_attachments.py>
[creation]: <../../Agentic Shiksha Platform/Backend/backend/routers/course_creation.py>
[creation-utils]: <../../Agentic Shiksha Platform/Backend/utils/course_creation.py>
[translation]: <../../Agentic Shiksha Platform/Backend/backend/routers/curriculum_translation.py>
[translation-utils]: <../../Agentic Shiksha Platform/Backend/utils/curriculum_translation.py>
[chat]: <../../Agentic Shiksha Platform/Backend/backend/routers/chat.py>
[runtime]: <../../Agentic Shiksha Platform/Backend/harness/runtime.py>
[dispatch]: <../../Agentic Shiksha Platform/Backend/harness/dispatch.py>
[output]: <../../Agentic Shiksha Platform/Backend/harness/output.py>
[events]: <../../Agentic Shiksha Platform/Backend/harness/events.py>
[telemetry]: <../../Agentic Shiksha Platform/Backend/harness/telemetry.py>
[turn-policy]: <../../Agentic Shiksha Platform/Backend/harness/turn_policy.py>
[progress-inference]: <../../Agentic Shiksha Platform/Backend/azure_services/persistence/progress_inference.py>
[main]: <../../Agentic Shiksha Platform/Backend/backend/main.py>
[suggestions]: <../../Agentic Shiksha Platform/Backend/backend/routers/chat_suggestions.py>
[clarification]: <../../Agentic Shiksha Platform/Backend/backend/routers/clarification.py>
[clarification-registry]: <../../Agentic Shiksha Platform/Backend/utils/clarification_registry.py>
[clarification-tool]: <../../Agentic Shiksha Platform/Backend/agent_tools/custom/ask_clarification/__init__.py>
[sharing]: <../../Agentic Shiksha Platform/Backend/backend/routers/chat_sharing.py>
[cosmos]: <../../Agentic Shiksha Platform/Backend/azure_services/persistence/cosmos_db.py>
[assessments]: <../../Agentic Shiksha Platform/Backend/backend/routers/assessments.py>
[profile]: <../../Agentic Shiksha Platform/Backend/backend/routers/learner_profile.py>
[profile-schema]: <../../Agentic Shiksha Platform/Backend/backend/schemas/learner_profile.py>
[memory-router]: <../../Agentic Shiksha Platform/Backend/backend/routers/learner_memory.py>
[memory-settings]: <../../Agentic Shiksha Platform/Backend/learner_memory/settings.py>
[integration]: <../../Agentic Shiksha Platform/Backend/learner_memory/integration.py>
[memory-service]: <../../Agentic Shiksha Platform/Backend/learner_memory/service.py>
[memory-curriculum]: <../../Agentic Shiksha Platform/Backend/learner_memory/curriculum.py>
[memory-events]: <../../Agentic Shiksha Platform/Backend/learner_memory/events.py>
[memory-retrieval]: <../../Agentic Shiksha Platform/Backend/learner_memory/retrieval.py>
[observations]: <../../Agentic Shiksha Platform/Backend/learner_memory/observations.py>
[memory-processor]: <../../Agentic Shiksha Platform/Backend/learner_memory/processor.py>
[state-reducer]: <../../Agentic Shiksha Platform/Backend/learner_memory/state.py>
[threshold-policy]: <../../Agentic Shiksha Platform/Backend/learner_memory/threshold.py>
[circuit]: <../../Agentic Shiksha Platform/Backend/backend/routers/circuit.py>
[circuit-schema]: <../../Agentic Shiksha Platform/Backend/backend/schemas/circuit.py>
[simulator]: <../../Agentic Shiksha Platform/Backend/utils/circuit_simulation.py>
[slides]: <../../Agentic Shiksha Platform/Backend/backend/routers/slides.py>
[slides-schema]: <../../Agentic Shiksha Platform/Backend/backend/schemas/slides.py>
[slide-export]: <../../Agentic Shiksha Platform/Backend/utils/slide_export.py>
[slide-speech]: <../../Agentic Shiksha Platform/Backend/utils/slide_speech.py>
[speech]: <../../Agentic Shiksha Platform/Backend/backend/routers/speech.py>
[custom-tools]: <../../Agentic Shiksha Platform/Backend/agent_tools/custom/README.md>
[circuit-tool]: <../../Agentic Shiksha Platform/Backend/agent_tools/custom/add_circuit/__init__.py>
[slides-tool]: <../../Agentic Shiksha Platform/Backend/agent_tools/custom/add_slides/handler.py>
[tikz-tool]: <../../Agentic Shiksha Platform/Backend/agent_tools/custom/add_tikz_diagram/__init__.py>
[image-tool]: <../../Agentic Shiksha Platform/Backend/agent_tools/custom/generate_image/__init__.py>
[logging-tools]: <../../Agentic Shiksha Platform/Backend/agent_tools/custom/logging_agent_tools/__init__.py>
[router-guide]: <../../Agentic Shiksha Platform/Backend/backend/routers/README.md>
[harness-guide]: <../../Agentic Shiksha Platform/Backend/harness/README.md>
[creation-guide]: ../agents/course-creation.md
[research-guide]: ../agents/curriculum-research.md
[ta-guide]: ../agents/course-ta.md
[memory-guide]: ../memory/overview.md
[hosted-memory-guide]: ../memory/memory-store.md
[evidence-guide]: ../memory/evidence-model.md
[state-guide]: ../memory/misconception-state.md
[see-guide]: ../memory/see-it-think.md
