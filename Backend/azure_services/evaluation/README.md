# azure_services/evaluation

Quality measurement for agent responses.

The evaluator itself now lives in the Admin Dashboard —
[Admin-Dashboard/backend/groundedness_evaluator.py](../../../Admin-Dashboard/backend/groundedness_evaluator.py)
— so that scoring runs out of band rather than on the chat request path. This package is
the backend-side seam that remains.

The prompts the judge uses are in
[prompt_store/evaluation/](../../prompt_store/evaluation): groundedness, answer relevancy
and context precision. All three are reference-free, so no ground-truth answer set is
needed.

Not to be confused with [../content_guardrail.py](../content_guardrail.py), which is an
inline safety check on claims about a student's history rather than a quality metric.
