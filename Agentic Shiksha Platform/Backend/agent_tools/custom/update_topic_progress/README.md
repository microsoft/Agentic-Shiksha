# update_topic_progress

For legacy courses, records a topic's display status and understanding summary.
For authoritative graph-memory courses, it is read-only: it cannot set mastery,
clear misconceptions, or cross thresholds. Learner input is durably captured by
the authenticated chat route independently of this tool.

| | |
|---|---|
| Class | `UpdateTopicProgressTool` |
| Tool name | `update_topic_progress` |
| Schema | [definition.json](definition.json) |
| Frontend event | none — written to Cosmos DB |

## When the agent calls it

- It starts explaining a new topic → `status: "in_progress"`
- A student demonstrates understanding → `status: "learned"`
- A student's understanding evolves within a topic → updated `summary`

## Required context

Like `get_threshold_concepts`, this tool needs **context beyond `arguments`**:

```python
tool.execute(args, agent_name=..., user_id=...)
```

## Arguments

| Field | Notes |
|---|---|
| `topic` | Required — error if blank |
| `status` | Must be `in_progress` or `learned` |
| `summary` | Optional; blank is normalised to `None` |

`agent_name` and `user_id` are both required; either missing returns an error
payload rather than raising.

## Legacy-only fire-and-forget dispatch

The dispatcher in [harness/runtime.py](../../../harness/runtime.py) does
**not** await this tool. It returns an immediate acknowledgement to the model
and runs the Cosmos write on a background daemon thread, because the model
doesn't need the result to compose its reply.

Authoritative graph calls instead require a server-created `memory_context`
alongside `agent_name` and `user_id`. They return the captured event reference
and an explicit read-only result synchronously. Attempts without scope are
rejected before any learner query. The persistence layer also rejects old
progress writes and deletes for authoritative courses.

Consequences worth knowing:

- The model never sees the real result — only the acknowledgement.
- Failures are logged, not surfaced to the conversation.
- The write may complete after the response has been streamed.

## Notes

`output` formats the real result: the new status, an overall
learned / in-progress / percent summary, and a 🎯 note when
`new_status == "threshold_crossed"`. In the fire-and-forget path this string is
only written to the log.
