# update_topic_progress

Records what a student has learned or is working on. Each call updates a single
topic's status and latest understanding summary in the learning state (Cosmos DB).

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

## Fire-and-forget dispatch

The dispatcher in [general_agent.py](../../../base_agents/general_agent.py) does
**not** await this tool. It returns an immediate acknowledgement to the model
and runs the Cosmos write on a background daemon thread, because the model
doesn't need the result to compose its reply.

Consequences worth knowing:

- The model never sees the real result — only the acknowledgement.
- Failures are logged, not surfaced to the conversation.
- The write may complete after the response has been streamed.

## Notes

`output` formats the real result: the new status, an overall
learned / in-progress / percent summary, and a 🎯 note when
`new_status == "threshold_crossed"`. In the fire-and-forget path this string is
only written to the log.
