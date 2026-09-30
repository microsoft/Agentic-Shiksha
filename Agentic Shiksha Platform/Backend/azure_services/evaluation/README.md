# azure_services/evaluation

Reserved namespace for response-quality evaluation. At present it contains only
`__init__.py` and this README: there is no local evaluator, CLI or background worker.

The evaluator itself now lives in the Admin Dashboard —
[Admin-Dashboard/backend/groundedness_evaluator.py](../../../../Admin-Dashboard/backend/groundedness_evaluator.py)
— so that scoring runs out of band rather than on the chat request path.

Reference judge prompts are in
[prompt_store/evaluation/](../../prompt_store/evaluation): groundedness, answer relevancy
and context precision. Their presence does not mean that this package executes all
three metrics or that the separate dashboard evaluator consumes these files.

Not to be confused with [../content_guardrail.py](../content_guardrail.py), which is an
inline safety check on claims about a student's history rather than a quality metric.
