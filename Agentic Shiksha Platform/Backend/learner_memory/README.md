# Learner memory

Persistent, evidence-grounded learner memory inside the existing FastAPI service.
It is **disabled by default** and is separate from conversational summaries and
user-editable teaching preferences. It is not a separate server or graph database.

This is **Part 2: the project's custom learner-memory structure and mechanism**,
not the hosted Memory Store. The [two-part memory README](../../../docs/memory/README.md)
compares this evidence/state model with
[Part 1: conversational storage and recall](../../../docs/memory/memory-store.md).

See the cross-service [memory overview](../../../docs/memory/overview.md),
[state semantics](../../../docs/memory/misconception-state.md), and
[evidence model](../../../docs/memory/evidence-model.md) for the teaching,
runtime, and operational boundaries.

| File | Responsibility |
| --- | --- |
| [__init__.py](__init__.py) | Re-exports typed curriculum, evidence, event, observation, policy, receipt and learner-snapshot contracts from [backend/schemas/learner_memory.py](../backend/schemas/learner_memory.py). |
| [settings.py](settings.py) | Immutable, validated `MemorySettings` and the cached `get_memory_settings` accessor (`get_settings` is an alias). |
| [curriculum.py](curriculum.py) | Stable graph/version validation, arbitrary prerequisite DAGs, and draft-only legacy import. |
| [events.py](events.py) | Durable input, idempotency hashes, ordered streams, immutable records and scoped reads. |
| [observations.py](observations.py) | Versioned, schema-constrained interpretations with exact evidence quotes; no state-writing model tools. |
| [state.py](state.py), [threshold.py](threshold.py) | Deterministic quality/independence aggregation, reversible misconception/concept state and threshold policy. |
| [profile.py](profile.py) | Learning Profile derived from a consistent learner snapshot. |
| [processor.py](processor.py) | Leases, stage checkpoints, retries, atomic state/history/receipt publication and expiry revalidation. |
| [retrieval.py](retrieval.py) | Bounded graph context, conservative freshness views and evidence-free cohort aggregation. |
| [service.py](service.py) | Application facade, immutable assessment instances, server grading, scope registry and version catalog. |

The storage adapter is separate, in
[azure_services/persistence/learner_memory.py](../azure_services/persistence/learner_memory.py).
It provides scoped Cosmos reads/batches, request-unit/read/time budgets, and private
evidence-blob operations. This is distinct from personal learner preferences and the
[hosted Foundry memory-store manager](../azure_services/tools/memory/README.md).
Existing progress behavior remains in place for courses in `off` mode. Graph
Memory's `authoritative` mode must not inherit legacy `learned` claims as crossings.

## Configuration

`MemorySettings` uses `pydantic-settings`, now pinned in the service
[requirements.txt](../requirements.txt). Follow the normal Python 3.13.5
[service installation](../README.md#local-setup-powershell); there is no separate
package installation or native executable for these settings.

Environment names use the `GRAPH_MEMORY_` prefix. The settings reader has
`env_file=None`: it does not discover or load dotenv files itself. It reads the
process environment, including values already loaded by an application caller.
The accessor caches one settings instance; changing process variables does not
replace that cached instance automatically. Restart the process after changes.

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `GRAPH_MEMORY_ENABLED` | `false` | Opt-in feature flag; leave disabled during ordinary installation. |
| `GRAPH_MEMORY_WORKER_ENABLED` | `false` | Separate worker opt-in; invalid while the feature flag is false. This setting alone does not start a worker. |
| `GRAPH_MEMORY_OBSERVATION_MODEL` | unset | Existing Foundry deployment supporting Responses structured output; no new model is provisioned. |
| `GRAPH_MEMORY_GRAPH_CONTAINER` | `curriculum_graph_v1` | Shared curriculum-graph Cosmos container. |
| `GRAPH_MEMORY_LEARNER_CONTAINER` | `learner_memory_v1` | Learner-state/event Cosmos container. |
| `GRAPH_MEMORY_EVIDENCE_CONTAINER` | `learner-evidence-v1` | Private evidence Blob container. |
| `GRAPH_MEMORY_WORKER_BATCH_SIZE`, `GRAPH_MEMORY_WORKER_CONCURRENCY` | `10`, `2` | Declared worker batch/concurrency limits. |
| `GRAPH_MEMORY_WORKER_POLL_SECONDS`, `GRAPH_MEMORY_LEASE_SECONDS` | `5`, `120` | Polling interval and lease duration. |
| `GRAPH_MEMORY_QUERY_PAGE_SIZE`, `GRAPH_MEMORY_MAX_QUERY_PAGES`, `GRAPH_MEMORY_MAX_QUERY_ITEMS`, `GRAPH_MEMORY_MAX_QUERY_RU` | `100`, `10`, `1000`, `100` | Query-budget settings. |
| `GRAPH_MEMORY_MAX_CONTEXT_CHARS`, `GRAPH_MEMORY_MAX_CONTEXT_TOKENS` | `12000`, `3000` | Context-size settings. |

[settings.py](settings.py) is the full inventory, including graph, snapshot,
event/replay, retrieval, retry and cohort limits. It validates distinct
graph/learner containers, a lease longer than polling, and page size within the
item budget. The former `*_container_name` Python properties remain compatibility
aliases; use the canonical environment names above.

The adapter expects Cosmos containers partitioned by `/partitionKey`, without
automatic history expiration, and a private evidence Blob container. It validates
existing resources; these defaults do **not** provision them. Keep this an
optional feature, not a required installation or automatic migration step.

## Data and authority

The two new Cosmos containers use `/partitionKey`:

- A shared graph partition identifies `(tenant, curriculum, immutable version)`.
  One bounded version document contains typed nodes and relationships. Multiple
  compatible course offerings/students point to that version; learner records do
  not duplicate pedagogical definitions. A separate small version catalog supports
  history lookup.
- A learner partition identifies `(tenant, institute, course offering, learner)`.
  Events, evidence, accepted observation sets, processing receipts, stream cursors,
  transition history and sparse snapshots live together. Version/epoch-specific
  snapshot identities prevent old crossings becoming new-version crossings.

Scope comes from authenticated account/course access, a server-owned institute
binding and explicit rosters, not client profile strings or an LLM argument.
Scoped administrator grants are registered separately from course membership.

Input and its receipt/cursor are one transaction. A first assessment submission
joins that same transaction, eliminating the asset/event dual-write gap.
Evidence and observation sets are create-only. Snapshot, derived profile,
transition history and completed receipt publish atomically with ETag checks.
The last complete snapshot remains available with honest pending/failure status.

Large inline input is also archived unchanged in the private evidence container.
Artifact references contain a content hash and byte size; downloads verify the
learner partition and integrity. Course-material search never indexes this
container. Inline learner images are retained in a private, hashed artifact
bundle, not reduced to unrecoverable hashes. The initial extractor interprets text;
an image without interpretable text/rubric evidence is not a qualifying assessment.
Failed intake can leave an unreferenced private upload; retention
administration must account for those scoped objects as well as ledger references.

An LLM may interpret evidence but cannot set a state or modify policy. Catalog
versions, diagnostic reliability, frozen answer keys and assistance provenance
are server-owned. Model confidence is explicitly **uncalibrated**, not a
probability of mastery.

## State semantics

- Misconception: `NOT_ASSESSED`, `INSUFFICIENT_EVIDENCE`, `SUSPECTED`, `PRESENT`,
  `RESOLVING`, `CLEARED`.
- Concept: `NOT_ATTEMPTED`, `INSUFFICIENT_EVIDENCE`, `STRUGGLING`, `PROGRESSING`,
  `MASTERED`.
- Threshold: `NOT_CROSSED`, `CANDIDATE`, `CROSSED`.
- Transfer: `NOT_ATTEMPTED`, `INSUFFICIENT_EVIDENCE`, `FAIL`, `PASS`.
- Trend: `UNKNOWN`, `IMPROVING`, `STABLE`, `DECLINING`, independently of state.

One correct answer never clears a misconception. Only qualifying, independent
probes with the reviewed reasoning/recency/quality requirements can do so.
Repeated variants and assisted/revealed answers cannot inflate independent
evidence. Later contrary evidence may revoke clearance/crossing.
First submissions atomically register answer exposure. A new quiz ID cannot turn
the same previously revealed task into a fresh independent demonstration.

Crossing requires every explicitly required misconception cleared, complete
qualifying coverage, sufficient fresh evidence, required transfer conditions and
valid versions. `threshold_relevance` is descriptive; `required_for_crossing`
controls the gate. An empty requirement set cannot cross. Mastery and crossing
are different, and prerequisite numbering has no meaning.

Policy defaults are conservative **research examples**. Publishing requires an
identified teacher review, adequate independent diagnostic families and pinned
rubrics/assessments. Nothing here certifies those pedagogical thresholds as
scientifically calibrated.

Reset records an event and opens a new learning epoch; it never deletes the old
evidence or transitions. Ordinary read views mask expired claims pending durable
revalidation. The processor still reads the original committed snapshot, so the
eventual revocation transition retains its historical crossing.

## Retrieval

TA/individual context contains a bounded graph neighborhood, selected state,
evidence/observation citations, prerequisite diagnostic gaps and a next probe.
Missing prerequisite evidence means "diagnose", not "struggling".
The complete graph/policy requirement set is evaluated before retrieval;
truncating a context cannot cause a crossing.

Cohort summaries read narrow learner snapshots, not everyone's chat/evidence.
Unassessed enrolled learners stay in the denominator. Read/RU/time and cohort
limits yield explicit partial coverage and `next_offset`; clients must not label
a page as an exact whole-class result. Evidence is loaded only on an authorized
individual drilldown. Context uses a conservative UTF-8-byte token upper bound.

## Provisioning and migration

These commands are **operator actions**, not startup hooks. Run them from this
backend directory with the existing active-database/Storage settings in the
process environment. Do not use a frozen study database. Dry runs do not make
cloud calls:

```powershell
python -m scripts.graph_memory provision
python -m scripts.graph_memory validate --input reviewed-graph.json
python -m scripts.graph_memory register-scope --input scope-registry.json
```

After separately reviewing the target resources, `--apply` authorizes the
selected operation:

```powershell
python -m scripts.graph_memory provision --apply
python -m scripts.graph_memory register-scope --input scope-registry.json --apply
```

A scope registry input has `tenant_id`, `institute_id` and a nonempty
`administrator_ids` list. Do not commit real account mappings. Configure
`GRAPH_MEMORY_ENABLED`, `GRAPH_MEMORY_WORKER_ENABLED` and the observation model
explicitly and restart the backend before processing events.

Legacy curriculum import produces an **unreviewed draft**, never a published
graph or migrated crossing:

```powershell
python -m scripts.graph_memory import-curriculum --input legacy.json --output draft.json --tenant-id example-tenant --institute-id example-institute --course-id example-course --curriculum-id example-curriculum --version draft-v1 --apply
```

The output must not already exist. Edit/review stable IDs, arbitrary prerequisite
edges, required misconceptions, independent problem families, rubrics and
transfer conditions before publication. Use the course's Graph Memory controls
to bind the reviewed version and choose `shadow` before `authoritative`.
The Graph editor also offers **Import existing course curriculum**, which reads
the existing course content and saves an unreviewed draft through the same
importer. It does not infer TC prerequisite edges from module numbers.

`import-evidence` accepts a JSON object with `scope` and `records`; it stores old
progress/first-attempt records as non-qualifying historical evidence, retaining
source timestamps. Repeating the import is idempotent. It does not upgrade old
client-scored results or hosted conversation summaries into verified mastery.

`recompute --input learner-scope.json --apply` queues a replay for one explicit
learner scope. `verify --input learner-scope.json --apply` checks its graph,
snapshot version and pending count. Inspect processing receipts for failures;
never fix a failed job by manually setting `CROSSED`.
An authorized recomputation also requeues the oldest failed input with an
append-only retry audit. The profile API exposes its processing receipt, and the
teacher's individual view provides a retry action. Retries retain the original
accepted extraction rather than creating new model interpretations silently.

Key HTTP surfaces (all under `/api`, authenticated and scope checked):

| Path suffix | Operation |
| --- | --- |
| `/agents/{agent}/memory/config` | Read configuration; scoped administrators conditionally bind/enable it. |
| `/agents/{agent}/course-curriculum/graph` | Read/save a typed draft with an ETag revision. |
| `/agents/{agent}/course-curriculum/graph/import` | Explicitly import existing generated content as a draft. |
| `/agents/{agent}/course-curriculum/publish` | Review and publish an immutable graph; activation is separate. |
| `/agents/{agent}/learners/{learner}/memory` | Consistent state/profile, freshness, pending count and processing receipt. |
| `/agents/{agent}/learners/{learner}/memory/context` | Bounded context; private diagnostic data is redacted for students. |
| `/agents/{agent}/learners/{learner}/memory/evidence/{id}` | Authorized evidence provenance and response; `/artifact` streams private payloads. |
| `/agents/{agent}/learners/{learner}/memory/events` | Assigned-teacher evidence intake, not a student state/observation setter. |
| `/agents/{agent}/learners/{learner}/memory/events/{id}` | Durable processing receipt, including an explicitly requested historical epoch. |
| `/agents/{agent}/learners/{learner}/memory/recomputations` | Audited retry/replay request. |
| `/agents/{agent}/learners/{learner}/memory/reset` | New epoch, retaining prior evidence/history. |
| `/teacher-dashboard/memory/cohorts/{agent}` | Scoped narrow aggregation with offset and explicit partial coverage. |

Existing quiz paths remain: public instances have `assessmentInstanceId`,
`curriculumVersion`, stable option keys and no pre-submit answer keys.
`/quiz-attempts/{id}/first` returns the saved server grade after submission so a
reload does not depend on a mutable legacy asset for correctness.

This workflow does not deploy the service or mutate remote Foundry agent
definitions. Authoritative activation must verify that the agent's tools cannot
use unverified hosted memory or bypass scoped progress/assessment handling.

## Recovery and limits

The worker renews leases, preserves completed extraction results across retries,
and refuses stale ETags. Failed extraction does not become a successful
assessment. Event ordering is per learner/version/epoch, not event-ID sorting.
Expired evidence schedules an idempotent revalidation event.

The repository checks the Cosmos 100-operation and safe sub-2-MB transaction
budget. Configured graph/snapshot/event/replay limits fail explicitly; policy
inputs are never silently truncated. If a curriculum/history exceeds the
prototype's supported envelope, adjust reviewed operating limits or evolve the
physical projection before enabling it. Do not assume a single partition has
unlimited storage or throughput.

Logs use opaque learner/event references and error types rather than raw answers.
Append-only is the ordinary application contract, not a regulatory WORM claim.
Privacy erasure and retention remain separately authorized, audited operations.

## Offline checks

Use the [offline test environment](../tests/README.md#offline-test-environment)
and run from the backend service directory:

```powershell
$tests = Get-ChildItem tests -Filter "test_graph_memory*.py" | ForEach-Object FullName
.\.venv\Scripts\python.exe -m pytest $tests -q
```

These tests use synthetic fixtures, mocked model clients and
[graph_memory_fakes.py](../tests/graph_memory_fakes.py) to check partition
boundaries, conditional writes, conflicts, independent evidence, reversible
policies, server grading, worker recovery, reset epochs, private artifacts,
bounded retrieval, migration and API authorization. They exercise the local
worker against the transactional fake, not a deployed Cosmos account.
Live resource/SDK transaction verification and deployment remain separate gates.
