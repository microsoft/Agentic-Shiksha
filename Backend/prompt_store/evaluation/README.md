# prompt_store/evaluation

LLM-as-judge prompts for scoring agent responses. All three are **reference-free**: they
need no ground-truth answer set, only the query, the response and the retrieved context.

| File | Question it answers |
| --- | --- |
| [groundedness_eval.md](groundedness_eval.md) | Is the response supported by the retrieved context? |
| [answer_relevancy_eval.md](answer_relevancy_eval.md) | Does the response address the question that was asked? |
| [context_precision_eval.md](context_precision_eval.md) | Was the retrieved context relevant to the query? |

Run by
[Admin-Dashboard/backend/groundedness_evaluator.py](../../../Admin-Dashboard/backend/groundedness_evaluator.py),
out of band rather than on the chat request path, using the model in `AZURE_EVAL_MODEL`.

The three metrics separate distinct failures, which is why they are not merged: a
response can be perfectly grounded in context that was irrelevant to the question, or
relevant but unsupported. Scores are comparable only against the same judge model —
changing `AZURE_EVAL_MODEL` shifts the baseline, so historical numbers are no longer
directly comparable.

Not to be confused with the inline runtime check in
[azure_services/content_guardrail.py](../../azure_services/content_guardrail.py), which
uses Azure AI Content Safety groundedness detection to police claims about a student's
history.
