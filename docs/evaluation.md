# Evaluation

[Documentation index](README.md)

**Source snapshot: 2026-09-30; Unreleased.** This guide separates implemented
checks from recommended evaluation practice. It reports no new test run, measured
learning benefit, or production certification.

## Key research questions

| Dimension | Question | Evidence to report |
| --- | --- | --- |
| Pedagogy adherence | Does the agent elicit reasoning and use the intended teaching moves? | Expert review against a versioned pedagogical rubric |
| Learning improvement | Does understanding improve and transfer beyond the practiced item? | Appropriate comparison, pre/post and delayed assessments, uncertainty |
| Adaptation quality | Does the next teaching move fit the learner's evidence and unresolved gaps? | Reviewed state/strategy pairs, counterexamples, and ablations |
| Grounding and reliability | Are claims supported, and do failures preserve trustworthy state? | Source checks, calibrated judging, missing-data analysis, and regression tests |

**Results status:** this guide does not contain a validated learning-outcome
study or a comparative provider benchmark. Report actual results with their
protocol and limitations when available; do not turn synthetic examples or test
counts into research findings. [Research evidence status](research.md) separates
source, demos, and deployment evidence.

## Evaluate three different things

| Layer | Question | Suitable evidence |
| --- | --- | --- |
| Software behavior | Are access, contracts, streaming, persistence, and recovery correct? | Deterministic tests, mocked HTTP/browser cases, and authorized integration checks |
| Response and retrieval quality | Is a response grounded and relevant to the supplied context? | Human-labelled examples and calibrated model-judge results |
| Learning | Has this learner changed their understanding and can they transfer it? | Trusted assessment evidence, misconception history, independent probes, and delayed review |

A passing browser test does not validate pedagogy. A judge score is not a learner
mastery score. A legacy progress percentage is not a validated learning outcome.
See [pedagogy](pedagogy/ekalaiva.md) and [evidence](memory/evidence-model.md).

## Existing software verification

Use [installation verification](../INSTALL.md#verification) and the
[backend test guide](<../Agentic Shiksha Platform/Backend/tests/README.md>)
for interpreter/dependency setup and the synthetic environment. Do not copy real
configuration or start the production application to make an offline test import.

| Boundary | Representative checks |
| --- | --- |
| HTTP assembly | [Factory tests](<../Agentic Shiksha Platform/Backend/tests/test_application_factory.py>): middleware order, system responses, and substituted lifespans |
| Turn and tool completion | [Prose/turn regressions](<../Agentic Shiksha Platform/Backend/tests/test_plain_text_emission.py>) and [tool definitions](<../Agentic Shiksha Platform/Backend/tests/test_tool_definitions.py>) |
| User and course scope | [Student assignments](<../Agentic Shiksha Platform/Backend/tests/test_student_assignments.py>) and [learner profile](<../Agentic Shiksha Platform/Backend/tests/test_learner_profile.py>) |
| Assessments and progress | [First attempts](<../Agentic Shiksha Platform/Backend/tests/test_quiz_first_attempts.py>) and [concept mapping](<../Agentic Shiksha Platform/Backend/tests/test_concept_inventory_mapping.py>) |
| Memory storage | [Graph-memory persistence](<../Agentic Shiksha Platform/Backend/tests/test_graph_memory_persistence.py>); additional state/integration checks are linked in the [memory guide](memory/overview.md) |
| Clarification and artifacts | [Clarification timing](<../Agentic Shiksha Platform/Backend/tests/test_clarification_timing.py>), [slides](<../Agentic Shiksha Platform/Backend/tests/test_slides.py>), and [circuit simulation](<../Agentic Shiksha Platform/Backend/tests/test_circuit_simulation.py>) |
| UI transport and reload | [Chat browser tests](<../Agentic Shiksha Platform/Frontend/chat-persistence.spec.ts>), [profile cases](<../Agentic Shiksha Platform/Frontend/learner-profile.spec.ts>), and [chat policy cases](<../Agentic Shiksha Platform/Frontend/chat-response.spec.ts>) |
| Independent admin services | [Admin backend tests](../Admin-Dashboard/backend/tests/README.md) and [admin browser configuration](../Admin-Dashboard/frontend/playwright.config.ts) |

After applying the documented offline environment, an example targeted selection
from the main backend service directory is:

```powershell
& '.\.venv\Scripts\python.exe' -m pytest tests\test_application_factory.py tests\test_plain_text_emission.py tests\test_quiz_first_attempts.py -q
```

Report ordinary tests, subtests, skips, and failures separately. A missing
`ngspice` executable can skip numerical integration tests; that is not a
successful simulation check. Backend `TestClient` contexts can start lifespans:
substitute them or avoid entering them in tests intended to remain offline.

The [main frontend build](<../Agentic Shiksha Platform/Frontend/package.json>)
runs TypeScript and Vite; the
[admin frontend build](../Admin-Dashboard/frontend/package.json) runs Vite only.
The current [CI workflow](../.github/workflows/ci.yml) runs main-backend tests,
main-frontend bundling, and main-service image builds. It does not constitute a
full four-service, browser, model-quality, and pedagogical release gate.

## Implemented response-quality pipeline

The separate [admin evaluator](../Admin-Dashboard/backend/groundedness_evaluator.py)
implements **RAGAS-inspired**, not an independently validated RAGAS benchmark,
model-judge metrics:

| Metric | Inputs | Intended judge scale |
| --- | --- | --- |
| Faithfulness / groundedness | Query, assistant response, retrieved or supplied context | 1-5, unsupported to fully supported |
| Answer relevancy | Query and assistant response | 1-5, irrelevant to directly responsive |
| Context precision | Query and retrieved context | 1-5, irrelevant to useful grounding |

`evaluate_rag_metrics` calls the three direct LLM judges separately and averages
non-`None` scores. A failed metric can therefore leave an overall score derived
from fewer metrics. Compare metric coverage as well as values; never treat that
average as an unconditional pass. The separate groundedness helper supports SDK,
LLM, and automatic SDK-to-LLM fallback paths.

[Admin routes](../Admin-Dashboard/backend/main.py) expose single/batch
groundedness, combined RAG evaluation, stored results, and manual triggers.
`evaluate_and_store_groundedness` loads a message group, retrieves context using
its material-session scope when available, and writes an evaluation record in
Cosmos. It does **not** update learner mastery or graph state.

The admin lifespan's evaluator loop is disabled by default (`EVAL_ENABLED=false`).
When explicitly enabled, current defaults are a 5-second interval, 24-hour
lookback, and batch limit of 50. These are configuration defaults, not capacity
recommendations. Running the evaluator consumes model, Search, and Cosmos
resources and reads learner messages. Do not enable it merely to run unit tests.

### Important limitations

- Stored evaluation re-retrieves context; it is not necessarily the exact context
  supplied to the original turn. Index/curriculum changes can alter the result.
- Judge prompts truncate inputs; for groundedness, context is limited to 6,000
  characters and response to 3,000. Long-answer scores concern that visible slice.
- The storage-oriented path can judge against a missing-context placeholder.
  Such a record is not proof of grounding in real course material.
- Missing/invalid judge scores need explicit analysis. The code's generated JSON
  is not a substitute for human calibration or strict score-range validation.
- Stored results contain query/response/context material, not only aggregate
  numbers. Apply access, retention, and redaction rules before export.
- Admin evaluation endpoints inherit the standalone API's access limitations.
  Run them only inside the protected boundary described in [deployment](deployment.md).

The main backend's
[progress-claim guardrail](<../Agentic Shiksha Platform/Backend/azure_services/content_guardrail.py>)
is another, narrower mechanism: it checks claims about prior learning against
available progress. It is not a general response evaluator or an authoritative
crossing decision; unchecked results must not be recorded as a quality pass.

## Recommended research protocol

This section is a proposed evaluation process, not an implemented automated suite.

1. Define the learning objective, curriculum/policy version, cohort, and intended
   decision before selecting a metric.
2. Create a consented, de-identified dataset. Keep training/prompt-tuning examples
   separate from held-out evaluation and use synthetic data for software tests.
3. Have qualified reviewers label explanations, misconceptions, and transfer
   evidence. Record disagreements rather than silently choosing a label.
4. Pin source, agent/prompt/model versions, assessment definitions, retrieved
   context, rubric, and judge settings. Preserve enough provenance for comparison.
5. Evaluate per language, concept, response mode, and evidence condition; include
   interrupted turns, ambiguous answers, contradictions, and missing context.
6. Calibrate judge scores against reviewer labels. Report disagreement, missing
   coverage, uncertainty, latency, token cost, and retrieval quality separately.
7. Assess delayed retention and unfamiliar-context transfer. Do not equate exposure,
   satisfaction, or the number of artifacts generated with understanding.

For enabled memory, include replay/idempotency, learner/course isolation,
contradictory evidence, stale policies, and false crossing cases. A useful
synthetic check is a learner who repeats a correct fact but applies the same
misconception in a new circuit: the test must not pass merely because the previous
answer or tutor summary was positive.

Record exact commands and outcomes for each release in
[release notes](../RELEASE_NOTES.md#release-verification-record), with offline and
live evidence separated. Never infer a deployed result from source presence.
