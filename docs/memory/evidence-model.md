# Learner evidence: input, interpretation and authority

**Source snapshot: 2026-09-30; Unreleased.** Current local contracts and processing paths,
not live enablement, calibrated accuracy or universal activity coverage.
See [overview](overview.md) for the three memory systems.

## Evidence is what happened; observation is an interpretation

| Contract | Role and boundary |
| --- | --- |
| `LearningEventInput` | Untrusted event identity/type/source, answer/reasoning, source/thread references, occurrence time and optional task/assessment references. It has no scope, grading, quality, observation or state-write authority. |
| `LearningEvent` | Adds server-resolved `MemoryScope`, sequence, receipt time, actor, policy version and semantic content hash. |
| `Evidence` | Retains learner content with task/family/context/lineage, assistance, answer-key provenance, quality and source-event metadata. Its existence does not make it qualifying. |
| `Observation` / `ObservationSet` | Source-linked claims, supporting/contradicting targets, rubric scores, quotations, demonstrations/transfer judgments, confidence and extractor/model/prompt versions. No learner-state mutation fields. |
| `LearnerSnapshot` / `ProcessingReceipt` | Derived state/profile and an independently pollable record of processing progress; an accepted input is not an already updated snapshot. |

The [schema](<../../Agentic Shiksha Platform/Backend/backend/schemas/learner_memory.py>)
forbids extra fields, validates identities/scores and requires aware timestamps.
[Server access resolution](<../../Agentic Shiksha Platform/Backend/backend/dependencies/learner_access.py>)
authorizes access; a caller's "teacher assessed" label does not.

## Confidence belongs to an interpretation, not a learner

`Observation.confidence` is the extractor's confidence in a particular
source-linked interpretation. `confidence_calibrated` is fixed to `false`:
`0.95` is **not** a 95% probability that the learner has mastered a concept,
cleared a misconception, or crossed a threshold. Confidence cannot substitute
for reviewed mappings, trusted provenance, independence, reasoning, or freshness.

The [misconception reducer](<../../Agentic Shiksha Platform/Backend/learner_memory/state.py>)
also emits state-level confidence: the minimum observation score among its
selected supporting or clearing signals, or zero when there are none.
That summary is not a separately calibrated probability. Keep the quoted
evidence, interpretation, reduced state/trend, and next-probe recommendation
separate when explaining a teaching decision.
[See it think](see-it-think.md) shows those layers in one synthetic example.

## Event vocabulary versus connected producers

The exact `EventType` values are `LEARNER_MESSAGE`, `ASSESSMENT_RESPONSE`,
`DIAGNOSTIC_RESPONSE`, `TRANSFER_RESPONSE`, `QUIZ_SUBMISSION`, `EXPOSURE`,
`ENGAGEMENT`, `PROGRESS_PROPOSAL`, `SELECTION`, `REVALIDATION`, `RESET`,
`RECOMPUTE`, `ARTIFACT_SUBMISSION` and `TEACHER_EVIDENCE`.

The exact `EvidenceSource` values are `LEARNER_CHAT`, `DIAGNOSTIC_RESPONSE`,
`QUIZ_RESPONSE`, `TRANSFER_RESPONSE`, `TEACHER_ASSESSMENT`, `TEACHING_EXPOSURE`,
`PROGRESS_PROPOSAL`, `EXPLICIT_SELECTION`, `LEGACY_IMPORT`, `SYSTEM_REVALIDATION`,
`SIMULATION_RESULT`, `ASSIGNMENT_RESPONSE` and `REFLECTION`.
An enum value is not evidence of a producer, endpoint or trusted grading path.

| Producer found in source | Captured event/source | Important qualification |
| --- | --- | --- |
| [Chat ingress](<../../Agentic Shiksha Platform/Backend/backend/routers/chat.py>) | `LEARNER_MESSAGE` / `LEARNER_CHAT` | Stable `event_id` and `occurred_at` required in enabled courses; learner text, not tutor prose. Attachment URLs are hashed in the event, not treated as demonstrated reasoning. |
| [Frozen assessment submission](<../../Agentic Shiksha Platform/Backend/learner_memory/service.py>) | `QUIZ_SUBMISSION`; `DIAGNOSTIC_RESPONSE` for approved catalog items, otherwise `QUIZ_RESPONSE` | Builds item-level evidence; approved transfer tasks produce `TRANSFER_RESPONSE` evidence. |
| [Legacy evidence import](<../../Agentic Shiksha Platform/Backend/learner_memory/service.py>) | `ENGAGEMENT` / `LEGACY_IMPORT` | Append-only historical context, not promotion of old progress labels. |
| [Reset/recompute routes](<../../Agentic Shiksha Platform/Backend/backend/routers/learner_memory.py>) and expiry worker | `RESET` or `REVALIDATION` / `SYSTEM_REVALIDATION` | Control operations create no learner evidence; recomputation currently emits `REVALIDATION`, not every declared event type. |

The service has a catalog-backed `TEACHER_ASSESSMENT` evidence-building branch,
not permission for browsers to supply trusted provenance. The schema does not
prove generic assignment/reflection/simulation capture or complete assistance
tracking. Authoritative model progress proposals return `read_only`, not mastery.

## Frozen assessment authority

[Assessment handling](<../../Agentic Shiksha Platform/Backend/backend/routers/assessments.py>)
requires a server-issued `assessmentInstanceId`, matching `quizId`, curriculum
version and stable submission event ID. Catalog problem IDs select server task
text, options, keys and mappings. Pre-submission questions omit keys/explanations.

Grading uses selected options and learner reasoning, not client-supplied keys,
scores, task text or mappings. The immutable first submission survives identical
retries; changed answers conflict. The quiz asset is a repairable presentation
copy, not grading/state authority or part of the learner-ledger transaction.

Generated practice can be frozen and server-scored, but `catalog_approved=False`
prevents qualification as reviewed diagnostics. This frozen-assessment path
expects authored multiple-choice options/keys; other task types do not prove an
equivalent grading UI/path. `NO_RECORDED_HINT` records no known hint, not proof
that the learner received no assistance elsewhere.

## Trust and qualification

[threshold.py](<../../Agentic Shiksha Platform/Backend/learner_memory/threshold.py>)
qualifies claims separately from storing them:

1. The default qualifying sources are `DIAGNOSTIC_RESPONSE`, `QUIZ_RESPONSE`,
   `TRANSFER_RESPONSE` and `TEACHER_ASSESSMENT`. Source membership alone is insufficient.
2. Evidence must be server verified, catalog approved, quality attributed and
   sufficiently reliable; the active task must have the corresponding approval.
3. Problem/rubric/assessment versions and family identity must match; reviewed
   diagnosis/transfer mappings must match the task and outcome/condition.
4. Answer-key provenance must be `SERVER_FROZEN_ASSESSMENT`,
   `CATALOG_REVIEWED_RUBRIC` or `TEACHER_REVIEWED`; frozen provenance also needs a
   frozen assessment instance. `NONE` cannot qualify.
5. Default qualifying assistance is only `NO_RECORDED_HINT`. `UNKNOWN`,
   `HINT_USED`, `ASSISTED` and `ANSWER_REVEALED` do not pass the default gate.
6. Observations need sufficient confidence, source-grounded quotations, extractor
   provenance and the target-specific reasoning/rubric requirements. Conflicting
   interpretations, stale evidence and missing/version-mismatched facts are excluded.

Retained observations can be excluded from strong inference, with reasons such as
`UNTRUSTED_ANSWER_KEY`, `CLEARANCE_REQUIRES_REASONING`, `CONFLICTING_OBSERVATIONS`
or `EVIDENCE_STALE`. See [misconception state](misconception-state.md) for count gates.

The [Foundry extractor](<../../Agentic Shiksha Platform/Backend/learner_memory/observations.py>)
uses structured output, `tools=[]`, `tool_choice="none"` and `store=False`.
It separates `TRUSTED_CATALOG` from `UNTRUSTED_LEARNER_EVIDENCE`; validation rejects
invented quotations, unknown targets and unsupported passes. It cannot add graph
nodes or issue state writes. Neutral exposure/proposal/selection/legacy sources
skip model calls. Other content can reach the configured model; `store=False`
is not an end-to-end retention policy.

## Synthetic evidence and interpretation

This is an abridged explanation of stored fields, **not** a complete API request.
Assume a reviewed catalog problem `P-path-A` and a frozen assessment `quiz-example-a`.

| Evidence field | Synthetic value |
| --- | --- |
| `answer`, `reasoning` | `A`; "A simple path cannot repeat a vertex; a walk can." |
| `source`, `answer_key_source` | `DIAGNOSTIC_RESPONSE`; `SERVER_FROZEN_ASSESSMENT` |
| `problem_id`, `family_id`, `context_id` | `P-path-A`; `family-path-A`; `quiz-example-a` |
| `assistance` | `NO_RECORDED_HINT` |
| Interpretation | Quote the learner's explanation; `contradicts=["M-repeat"]`, `reasoning_result="SATISFIES_RUBRIC"`, reviewed rubric scores, uncalibrated extraction confidence `0.95`. |

One qualifying item cannot meet the default two-family/two-context clearance gate.
Repeated quotes, summaries or submission retries are not independent demonstrations.

## Partitioning, idempotency and publication

The [repository](<../../Agentic Shiksha Platform/Backend/azure_services/persistence/learner_memory.py>)
expects both Cosmos containers to use `/partitionKey` and no automatic TTL
deletion; its evidence Blob container must be private. Validation of existing
resources is not provisioning.

`opaque_key` hashes an unambiguous JSON tuple with SHA-256:

- Learner partition: `opaque_key("lm", tenant_id, institute_id, course_id, student_id)`.
- Graph partition: `opaque_key("cg", tenant_id, curriculum_id, curriculum_version)`.
- Learner snapshot/cursor IDs additionally include curriculum ID/version and epoch;
  the learner partition stays stable across them. Record parsing checks the full
  scope, not just the partition. Event/receipt IDs hash the event ID within that
  partition; do not reuse an event ID for a different curriculum/epoch or input.

[Intake](<../../Agentic Shiksha Platform/Backend/learner_memory/events.py>) atomically
creates the event, `PENDING` receipt, ETag-protected cursor and any first submission.
The hash binds scope/input/actor but excludes `occurred_at` for retries; the first
accepted time remains recorded. Future times and same-ID/different-input conflicts
are rejected.

[Processing](<../../Agentic Shiksha Platform/Backend/learner_memory/processor.py>)
claims the next contiguous sequence in the curriculum/epoch stream. ETags and
expiring owner leases prevent lost updates. Defaults are
`GRAPH_MEMORY_LEASE_SECONDS=120`, `GRAPH_MEMORY_MAX_ATTEMPTS=5` and
`GRAPH_MEMORY_WORKER_RETRY_BASE_SECONDS=5`; the async worker renews leases,
limits concurrency and retries with exponential delays.

The normal receipt path is `PENDING -> PROCESSING -> COMPLETED`; failures can
become `RETRY_PENDING` and then terminal `FAILED`, and closed epochs are `REJECTED`.
`ACCEPTED` and `SUPERSEDED` also exist in the contract but are not steps assumed
in this normal path. Stages are `INTAKE`, `EVIDENCE`, `EXTRACTION`, `REDUCTION`,
`PUBLICATION`, `COMPLETED`. A failed earlier sequence can block later processing;
these docs do not promise automatic dead-letter recovery.

Evidence/observation sets are immutable append records; retries reuse saved
extractions. Snapshot, transition history and completed receipt publish atomically
in one partition. Failure leaves the last complete snapshot intact, even if
evidence/extraction records were saved. Reset also advances the epoch and creates
its empty snapshot atomically, retaining history. Recompute appends a control
event, not a learner answer or manual state override.

## Retrieval, retention and validation boundaries

Replay is bounded; exceeding evidence/observation/snapshot budgets fails rather
than publishing a state derived from silently truncated history.
[Retrieval](<../../Agentic Shiksha Platform/Backend/learner_memory/retrieval.py>)
separately bounds traversal, nodes, edges, evidence and context with explicit
`truncated` / `bounds_applied`, using a conservative byte bound, not exact token
counting. Cohort pages aggregate snapshots without raw evidence and report coverage/offsets.

Raw answers/reasoning can reside in Cosmos events/evidence. Blob artifact helpers
use private content-hashed references and validate partition, size and digest;
the main processor does not automatically upload every event to Blob. Artifact
reads pass through authorized routes, not public URLs. Student context has
diagnostic redaction; teacher-model cohort bundles remove raw student IDs, but
free-text evidence can still identify people. Hashing is not anonymization.

Representative checks: [observations](<../../Agentic Shiksha Platform/Backend/tests/test_graph_memory_observations.py>),
[persistence](<../../Agentic Shiksha Platform/Backend/tests/test_graph_memory_persistence.py>),
[processing](<../../Agentic Shiksha Platform/Backend/tests/test_graph_memory_processing.py>),
[migration](<../../Agentic Shiksha Platform/Backend/tests/test_graph_memory_migration.py>) and
the [transactional fake](<../../Agentic Shiksha Platform/Backend/tests/graph_memory_fakes.py>).
They are not newly executed results or live Cosmos/Foundry certification.
See [evaluation](../evaluation.md), [deployment](../deployment.md) and
[INSTALL.md](../../INSTALL.md) before planning operational use.
