# Misconception state and threshold crossing

**Source snapshot: 2026-09-30; Unreleased.** These are the implemented rules in
[state.py](<../../Agentic Shiksha Platform/Backend/learner_memory/state.py>),
[threshold.py](<../../Agentic Shiksha Platform/Backend/learner_memory/threshold.py>)
and the [typed policy/state contracts](<../../Agentic Shiksha Platform/Backend/backend/schemas/learner_memory.py>).
They are illustrative, uncalibrated operating policies, not validated probabilities,
permanent diagnoses, course grades or a claim of deployment.

## Four layers, not one progress score

| Layer | Exact states | Question |
| --- | --- | --- |
| `MisconceptionState` | `NOT_ASSESSED`, `INSUFFICIENT_EVIDENCE`, `SUSPECTED`, `PRESENT`, `RESOLVING`, `CLEARED` | What does retained evidence say about a particular misconception? |
| `ConceptState` | `NOT_ATTEMPTED`, `INSUFFICIENT_EVIDENCE`, `STRUGGLING`, `PROGRESSING`, `MASTERED` | Has the learner demonstrated the TC's required rubric dimensions? |
| `TransferState` | `NOT_ATTEMPTED`, `INSUFFICIENT_EVIDENCE`, `FAIL`, `PASS` | Has a particular reviewed transfer condition been met? |
| `ThresholdState` | `NOT_CROSSED`, `CANDIDATE`, `CROSSED` | Are all explicit crossing conditions satisfied now? |

Snapshots are sparse: no relevant evidence normally means no materialized entry.
Readers supply `NOT_ASSESSED` / `NOT_ATTEMPTED` / `NOT_CROSSED` defaults; they must
not manufacture failure from an absent entry. `Trend` is independently
`UNKNOWN`, `IMPROVING`, `STABLE` or `DECLINING`.

## Meaning and precedence of misconception labels

Reduction recomputes from retained evidence and accepted observations; it is not
an instruction to increment a count or move one step along a ladder.

| Label | Implemented interpretation |
| --- | --- |
| `NOT_ASSESSED` | Default for an unassessed target; the reducer normally leaves such targets absent. |
| `INSUFFICIENT_EVIDENCE` | Related evidence exists, but diagnosis/clearance requirements are not met. One clearing response without prior support can still have this label. |
| `SUSPECTED` | An unexpired supporting interpretation exists but stronger requirements are unmet; even low-quality support may justify this cautious label, not `PRESENT`. |
| `PRESENT` | Enough qualifying independent supporting evidence remains. |
| `RESOLVING` | Some later clearing evidence follows historical support but coverage is incomplete, **or** new support regresses a previously cleared pattern. Check trend/reason codes. |
| `CLEARED` | Fresh, independent, reasoned clearing coverage satisfies the policy and no recent strong supporting evidence blocks it. This is revisable. |

The actual branch order is: complete clearance; partial clearance with historical
support; sufficient independent support; regression after historical clearance;
remaining unexpired support; otherwise insufficient evidence. Thus `RESOLVING`
can have `DECLINING`, not only `IMPROVING`, trend. The state is not a personality
label or a claim that the misconception can never recur.

## State, trend and the next question

Read the state and trend together, not as a linear progress bar.
`RESOLVING` / `IMPROVING` can mean that later clearing evidence is promising but
incomplete; `RESOLVING` / `DECLINING` can instead signal regression after earlier
clearance. Neither label alone establishes mastery or crossing.

The [profile projection](<../../Agentic Shiksha Platform/Backend/learner_memory/profile.py>)
derives `next_recommended_probe`, considering unresolved prerequisites before
the active and candidate concepts. Its current reason codes are:

| Reason code | Teaching implication |
| --- | --- |
| `DIAGNOSTIC_GAP` | The target lacks concept/threshold state; probe before assuming difficulty. |
| `INDEPENDENT_DIAGNOSTIC_REQUIRED` | A required misconception still lacks eligible clearance; seek a reviewed diagnostic from an unused task family. |
| `TRANSFER_REQUIRED` | An explicit transfer condition lacks a fresh pass. |

The recommendation can have `problem_id=null` when no eligible unused diagnostic
is found; it does not fabricate an assessment. Choosing a contextual challenge,
prediction, or explanation is a subsequent tutor decision, not a new persisted
strategy verdict. [See it think](see-it-think.md) makes that distinction concrete.

## What counts toward a change?

An observation `SUPPORTS` the misconception or `CONTRADICTS` it; a correct answer
is not automatically a contradiction. A reviewed `DIAGNOSES` mapping must support
that interpretation, including its answer-outcome semantics.
[Evidence qualification](evidence-model.md) checks source, server provenance,
catalog quality, frozen versions, assistance, confidence and grounded quotations.

The default `PolicySet` is named `example-uncalibrated-v1`, with
`teacher_reviewed=False` and `confidence_calibrated=False`.
Publication requires explicit teacher review. Defaults below are configurable
operating thresholds, not statistical calibration:

| Gate | Default |
| --- | --- |
| `min_present_independent_support` | 2 qualifying independent supports |
| `min_clearance_independent_probes` | 2 qualifying independent clearing probes |
| `min_clearance_contexts`, `min_clearance_families` | 2 distinct contexts and 2 distinct task families |
| `min_strong_observation_confidence`, `min_clearance_confidence` | 0.80 for support; 0.85 for clearance |
| `min_evidence_quality`, `min_catalog_diagnostic_strength` | 0.80 each |
| `min_reasoning_rubric_score` | 0.80 on every required problem-rubric dimension for clearance |
| `evidence_max_age_days`, `recent_support_window_days` | 90 days of diagnostic recency; 14-day strong-support hold |

Clearance requires learner reasoning, `SATISFIES_RUBRIC`, the reviewed clearing
semantics, and enough qualifying probes **after the latest historically qualified
support**. Historical qualification includes otherwise valid evidence excluded
only for being stale. Recent strong support blocks clearance even after two
correct responses. Waiting alone cannot make clearing evidence that preceded new
support become eligible again.

Independence is a conservative deterministic subset, not raw response count:

- Retries sharing lineage/source, the same observation or the same
  `(assessment_instance_id, problem_id)` are not counted again.
- By default families and contexts must also differ. Context resolves from
  `context_id`, then `independence_key`, then `assessment_instance_id`.
- Frozen responses from one assessment share context/lineage; multiple items in
  one quiz do not by themselves provide independent clearing contexts.
- Conflicting interpretations of the same evidence are excluded. Superseded
  events are removed from the effective fact set, without deleting their history.

`raw_evidence_count`, `qualifying_evidence_count` and selected independent counts
are different measurements. Bounded evidence-reference lists are explanations,
not the complete ledger and not the basis for silently dropping required facts.

## Mastery, transfer and crossing are deliberately different

Concept mastery requires at least
`min_mastery_independent_demonstrations=2` qualifying passes after the latest
historically qualified failure, and coverage of all required TC rubric dimensions
(`min_mastery_rubric_coverage=1.0`). Some valid passes give `PROGRESSING`;
`STRUGGLING` needs `min_struggle_independent_failures=2` independent rubric
failures, not merely missing evidence or a suspected misconception.
Concept confidence defaults to 0.85 and recency to 90 days.

Transfer is evaluated separately for each required `HAS_TRANSFER_PROBE` condition.
The default needs one qualifying pass after the latest current qualifying failure,
confidence at least 0.90, complete reasoned problem-rubric performance at 0.80,
and 30-day recency. A later qualifying failure can revoke a pass. Matching a
problem ID does not replace matching the condition and frozen assessment/rubric
versions. Novel transfer families are optional (`require_novel_transfer_family=False`).

`CROSSED` requires all of the following, recomputed from facts:

1. Activity, a published-ready graph and teacher-reviewed policies.
2. A **nonempty** set of `ASSOCIATED_WITH` edges explicitly marked
   `required_for_crossing=True`.
3. Every required misconception labelled `CLEARED` **and** independently
   revalidated against fresh qualifying evidence under the correct policy and
   curriculum version: `required_coverage=1.0`.
4. All explicitly required transfer conditions passing. The default
   `require_transfer_for_crossing=True` also requires such conditions to exist.

No empty-set shortcut is allowed. With activity but unmet gates the result is
`CANDIDATE`; without activity it is `NOT_CROSSED`. `required_cleared` counts labels;
`required_covered` checks their current evidential eligibility. They can differ.
**Concept mastery and prerequisite crossing are not extra crossing gates.**
Prerequisites guide diagnosis and teaching order, not an undocumented prerequisite
test. Optional "blocking" misconceptions are not silently promoted to required ones.

## Synthetic example

Assume a published, reviewed simple-path curriculum. `M-repeat` is required for
`TC-paths`; two reviewed task families diagnose it and a transfer condition is
required. Every qualifying item below has trusted provenance, no recorded hint,
grounded reasoning and sufficient rubric/quality/confidence scores.
Times are relative to a common evaluation time; no real learner is represented.

| Retained facts added | Misconception result | Threshold implication |
| --- | --- | --- |
| No facts | Absent / `NOT_ASSESSED` | `NOT_CROSSED`, not failure |
| Independent wrong explanations, 30 and 29 days ago | `PRESENT` | `CANDIDATE` |
| One reasoned clearing probe, 10 days ago | `RESOLVING`, `IMPROVING` | Still candidate |
| Another clearing probe, 9 days ago, distinct family/context | `CLEARED` | Still candidate until transfer |
| Reviewed transfer pass, 1 day ago | Clearance remains eligible | `CROSSED` if these are all required conditions |
| New qualifying support after those probes | Clearance revoked; possibly `RESOLVING`, `DECLINING` | No longer crossed |

An example clearing explanation is "A simple path cannot repeat a vertex; a walk
can." A quotation alone does not meet the gates above. If the wrong explanation
instead occurred three days ago, two later clearing probes would still encounter
the 14-day support hold. If there is no concept-demonstration evidence, crossing
need not imply `MASTERED`.

## Time, revisions and review

The pure reducer uses an explicit timezone-aware `as_of`, observation chronology,
curriculum/epoch scope and retained evidence. Repeating the same facts at the
same time is deterministic. State versions change when derived content changes;
snapshots also carry the processed event watermark.

The [processor](<../../Agentic Shiksha Platform/Backend/learner_memory/processor.py>)
schedules expiry revalidation and records transitions; a lost crossing can carry
`REGRESSION_AFTER_CROSSING`. The [freshness view](<../../Agentic Shiksha Platform/Backend/learner_memory/retrieval.py>)
conservatively masks expired claims while durable revalidation is pending.
Expiry is not deletion. Reset creates a new epoch, not a clean bill of learning.

Representative cases are in [policy tests](<../../Agentic Shiksha Platform/Backend/tests/test_graph_memory_policy.py>),
[processing tests](<../../Agentic Shiksha Platform/Backend/tests/test_graph_memory_processing.py>) and
[retrieval tests](<../../Agentic Shiksha Platform/Backend/tests/test_graph_memory_retrieval.py>).
These are source references, not newly executed results.
See [overview](overview.md), [pedagogy](../pedagogy/ekalaiva.md) and
[evaluation](../evaluation.md) for the teaching and validation boundaries.
