# See it think: evidence to the next teaching move

**Source snapshot: 2026-09-30; Unreleased.** "See it think" is an explanatory
view of observable agent inputs and outputs: learner evidence, an extracted
interpretation, policy-derived state, and a proposed next probe. It is **not**
hidden chain-of-thought, a transcript of private model reasoning, or a claim of
educational efficacy. The current inspection panel is named **Graph Memory**.

## One synthetic example

All identifiers, quotations, scores, and times below are invented for explanation,
not a real learner record or a measured result. Assume a reviewed, published
simple-path curriculum: `M-repeat` is required for `TC-paths`; `P-path-A` and
`P-path-B` are approved diagnostics from distinct families and contexts.
Graph memory is hypothetically authoritative and processing has completed.

Two independent diagnostic explanations from other reviewed task families
supported `M-repeat` 30 and 29 days before the snapshot. A reasoned clearing
response to `P-path-A` followed 10 days before it; `P-path-B` is still unused.
Assume all relevant provenance, rubric, confidence, assistance, and recency gates
in the [state policy](misconception-state.md) are met; no newer support or second
clearing probe is present.

| Observable layer | Synthetic input or output |
| --- | --- |
| Misconception being tested | `M-repeat`: a simple path may repeat a vertex if no edge repeats. This is the observer's diagnostic label, not a misconception to announce unprompted to the learner. |
| Supporting and counter-evidence | Earlier quoted reasoning: "A simple path can revisit a vertex if no edge repeats." Later learner reasoning in `E-clear-A`: "A simple path cannot repeat a vertex; a walk can." Distinct source records, not repeated summaries, support the history. |
| Extracted interpretation | An observation cites `E-clear-A`, quotes that later explanation, and records `contradicts=["M-repeat"]`, `reasoning_result="SATISFIES_RUBRIC"`, and uncalibrated extraction confidence `0.95`, with `confidence_calibrated=false`. This is not a mastery probability. |
| Committed state and trend | `M-repeat` is `RESOLVING` / `IMPROVING`: one later clearing probe does not meet the two-family/two-context requirement. `TC-paths` remains `CANDIDATE`, not `CROSSED`. |
| Proposed next teaching strategy | Invite one prediction about a changed route, elicit the learner's explanation, then use unused-family diagnostic `P-path-B` in a different context. This teaching phrasing is illustrative; the backend recommendation is an ID plus `INDEPENDENT_DIAGNOSTIC_REQUIRED`, not a generated strategy field. |

Selected `LearningProfile` fields illustrate the last two rows. This is a
**synthetic projection**, not a complete persisted snapshot or a state-write
request; other profile fields, version/freshness metadata, and the evidence
ledger are omitted.

```json
{
  "active_tc": "TC-paths",
  "active_misconceptions": {
    "M-repeat": {"state": "RESOLVING", "trend": "IMPROVING"}
  },
  "learning_trend": "IMPROVING",
  "next_recommended_probe": {
    "tc_id": "TC-paths", "misconception_id": "M-repeat",
    "problem_id": "P-path-B",
    "reason_code": "INDEPENDENT_DIAGNOSTIC_REQUIRED"
  }
}
```

A second correct answer still needs qualifying independent reasoning; any
required transfer conditions must also pass before crossing. New contradictory
evidence or expiry can reverse a verdict. Missing evidence is not failure.
See the [longer state example](misconception-state.md#synthetic-example).

## What is observable today?

| Current source surface | What it exposes; what not to infer |
| --- | --- |
| [GraphMemoryPanel][panel] | Snapshot/curriculum versions, pending processing and freshness, separate mastery/crossing labels, misconception states/trends and counts, a next-probe recommendation, and evidence citations loaded on demand. Shadow is labelled experimental. It does not render the five-row explanation above or an extraction-confidence badge. |
| [Bounded context retrieval][retrieval] | Source-linked evidence excerpts and observation claims with `supports`, `contradicts`, uncalibrated confidence, and a next probe. Access, learner-facing redaction, freshness, and context limits apply; this is not an unrestricted ledger or a private reasoning trace. |
| [Observation/state contracts][schema], [reducer][reducer] and [profile projection][profile] | Typed interpretations, deterministic state/trend, and a recommendation derived from retained facts. A model proposes an observation; it does not directly set clearance, mastery, or crossing. |
| This document | The synthetic course, values, compact layout, and teaching-strategy wording explain existing contracts. They are not a new shipped "See it think" screen, a real session replay, or a result of running a live agent. |

Graph memory and its worker are disabled by default. `off`, `shadow`, and
`authoritative` are distinct [configuration modes](overview.md#opt-in-configuration-and-modes):
shadow can write/process evidence without replacing legacy teaching-state
authority. Publishing a reviewed graph does not activate it. Only an authorized,
fresh committed authoritative verdict supports a verified crossing claim.

Continue with [evidence and confidence](evidence-model.md),
[state and trend](misconception-state.md), the
[six pedagogical explanations](../pedagogy/ekalaiva.md#six-source-grounded-pillars),
[agent dataflow](../agent-dataflow.md), and [research evidence](../research.md).

[panel]: <../../Agentic Shiksha Platform/Frontend/src/features/memory/GraphMemoryPanel.tsx>
[retrieval]: <../../Agentic Shiksha Platform/Backend/learner_memory/retrieval.py>
[schema]: <../../Agentic Shiksha Platform/Backend/backend/schemas/learner_memory.py>
[reducer]: <../../Agentic Shiksha Platform/Backend/learner_memory/state.py>
[profile]: <../../Agentic Shiksha Platform/Backend/learner_memory/profile.py>
