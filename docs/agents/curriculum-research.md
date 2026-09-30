# Curriculum research: textbook and threshold-concept agents

> Source snapshot: 2026-09-30; Unreleased; source presence is not deployed configuration.

Curriculum generation is a persisted workflow that calls three existing
named-agent references in [main.py][main]:

| Stage | Agent name in source | Responsibility |
| --- | --- | --- |
| Reframe the syllabus | `course-agent-creation-agent` | Turn the teacher's course context into a structured syllabus. This is the same CACA reference used by [course creation](course-creation.md). |
| Research textbook coverage | Configured `TEXTBOOK_RESEARCH_AGENT_NAME` | Enrich modules with textbook references and relevant coverage. |
| Research threshold concepts | Configured `THRESHOLD_CONCEPT_RESEARCH_AGENT_NAME` | Propose concepts, misconceptions and example diagnostic questions. |

The [threshold research prompt][prompt] is a local prompt asset, not proof of
the deployed agent's instructions. The worker that schedules these calls is
ordinary backend code, not another agent.
The two research references have no built-in default in
[deployment_settings.py][settings]; `require_configured` checks their values
before the named-agent call. Older comments mentioning particular agent or
model names are not a substitute for that configuration.

## Purpose, inputs, and outputs

The threshold-concept agent proposes a course-wide map to support later teaching and
diagnostic-question design. It does not assess a particular learner or declare
that anyone has crossed a threshold.

| Contract | Actual content |
| --- | --- |
| Research inputs | Course name/level, module IDs/titles, topics, learning objectives, teacher context, and available textbook references. |
| Concept index | `all_threshold_concepts`, an ordered list of concept names. |
| Concept details | Top-level objects keyed by concept name, with `description`, `why_threshold`, and `related_modules`. |
| Diagnostic draft | `misconceptions` and example `concept_inventory_questions`, including proposed answers, distractors, explanations, and a target misconception. |
| Curriculum result | Syllabus plus concept index/details persisted as the course curriculum. |

The prompt targets 8-15 concepts for the whole course, with focused
misconceptions and example MCQs. This is generation guidance, not proof of
research quality or a schema-enforced pedagogical standard. These questions are
examples; they are not automatically approved graph diagnostics.

Generated concept names are not stable published graph identifiers.
`related_modules` uses module IDs rather than chapter titles. Compatibility
`related_chapters` values may also be produced during normalization; neither
field establishes threshold-to-threshold prerequisites.

## Execution sequence and ownership

1. [Course creation][creation] enqueues a persisted `CurriculumResearchJob`.
   Automatic enqueue currently requires configured textbooks; manual generation
   can use a saved course description or textbooks.
2. `run_curriculum_worker` claims and renews the job lease.
   `run_curriculum_research` loads saved inputs or the completed creation job.
3. Full generation calls `_background_textbook_research` in [main.py][main]:
   CACA reframes the syllabus, textbook research enriches module references, and
   threshold research generates the concept/misconception/question drafts.
4. Threshold requests are sent in module batches. Results are merged,
   name-deduplicated, and optionally consolidated by another research response;
   module links are normalized against the syllabus.
5. [Persistence][persistence] writes curriculum JSON to Blob Storage, updates its
   Cosmos metadata reference/cache, and attempts an initial history version.
   The research helper retains a local-file fallback if the main save fails.
6. The durable worker checks that a complete curriculum was actually persisted
   before recording successful completion.
7. A threshold-only retry calls `_background_threshold_concept_research` using
   saved syllabus artifacts rather than recreating the course TA.

The actual calls use named-agent references in the Conversations/Responses API.
Older comments describe particular models or say "saved to Cosmos"; inspect the
call and persistence implementation rather than treating those comments as a
deployment contract. The local prompt file alone does not prove the remote
agent's current instructions, tools, or model.

## Public entry points

Routes are owned by [backend/routers/course_creation.py][routes].

| Route | Responsibility |
| --- | --- |
| `GET /api/agents/{agent_name}/course-curriculum` | Read curriculum/status; supports `status_only`. |
| `POST /api/agents/{agent_name}/course-curriculum/retry` | Queue full generation when retry is allowed. |
| `POST /api/agents/{agent_name}/retry-textbook-research` | Compatibility entry to the same full-generation guard. |
| `POST /api/agents/{agent_name}/retry-threshold-research` | Queue threshold-only recovery with saved syllabus inputs. |

These endpoints operate on course-curriculum jobs and outputs. Tool calls such as
`get_threshold_concepts` and `add_quiz` belong to the subsequent
[course TA flow](course-ta.md), not this research worker.

## State, memory, and lifecycle

Research jobs are course-scoped and owner-associated, with persisted inputs,
status, attempts, lease information, and an output reference. They are not
learner learning profiles. Curriculum and raw research artifacts are course
resources; keep raw model output out of public examples and learner transcripts.

The public curriculum states are `not_available`, `processing`, `ready`, and
`failed`. A partial syllabus artifact does not mean generation is still running
or complete; active durable job state takes precedence. Duplicate retry requests
do not restart an active job.

The worker has bounded retry handling and verifies lease ownership. The research
helpers additionally perform long-running streaming calls, retries, and batch
splitting; generation can outlive the TA-creation response. For threshold-only
recovery, the queue guard requires the saved syllabus artifact; if unavailable,
use full generation rather than guessing replacements.

## Review, errors, and security boundaries

- The routes require active-user/course access, and generation retries require
  course edit access. A curriculum's course name is not an authorization token.
- Missing inputs or invalid retry conditions produce safe API errors. Failed
  jobs may retain partial outputs for recovery; do not mistake them for approval.
- JSON extraction and name deduplication do not verify factual references,
  conceptual distinctness, distractor validity, or module coverage.
- Teacher review should verify threshold selection, misconceptions, diagnostic
  mappings, explicit prerequisites, and transfer requirements before using them
  as authoritative evidence.
- Research completion is not graph publication. The supplied graph-memory
  design is a proposal, not the implementation baseline. Current source has
  graph-memory integration and a conditional worker, both
  [disabled by default][memory-settings]. Its publication contract is documented
  in the [memory overview](../memory/overview.md).

## Verification and related guides

[Generation regressions][tests] cover durable enqueue, recovery of completed
outputs, active-job/partial-artifact status, duplicate retries, and edit-access
checks. [Curriculum-cache tests][cache-tests] cover retrieval/cache behavior.
These checks do not certify generated concepts or live remote-agent behavior.

See [Ekalaiva pedagogy](../pedagogy/ekalaiva.md), [evaluation](../evaluation.md),
[architecture](../architecture.md), and [deployment](../deployment.md).

[prompt]: <../../Agentic Shiksha Platform/Backend/prompt_store/research_agents/threshold_concept_research_agent.md>
[creation]: <../../Agentic Shiksha Platform/Backend/utils/course_creation.py>
[main]: <../../Agentic Shiksha Platform/Backend/backend/main.py>
[settings]: <../../Agentic Shiksha Platform/Backend/deployment_settings.py>
[persistence]: <../../Agentic Shiksha Platform/Backend/azure_services/persistence/cosmos_db.py>
[routes]: <../../Agentic Shiksha Platform/Backend/backend/routers/course_creation.py>
[tests]: <../../Agentic Shiksha Platform/Backend/tests/test_knowledge_indexing.py>
[cache-tests]: <../../Agentic Shiksha Platform/Backend/tests/test_course_curriculum_cache.py>
[memory-settings]: <../../Agentic Shiksha Platform/Backend/learner_memory/settings.py>
