# get_threshold_concepts

Provides the structured threshold concepts and learning state derived from
textbook research. Returns the learning state (topic map with progress) when a
`user_id` is available, and falls back to the full course curriculum otherwise.

| | |
|---|---|
| Class | `GetThresholdConceptsTool` |
| Tool name | `get_threshold_concepts` |
| Schema | [definition.json](definition.json) |
| Frontend event | none — the result goes back to the model |

## Required context

This is one of only two tools that need **context beyond `arguments`**:

```python
tool.execute(args, agent_name=self.agent_name, user_id=user_id)
```

Both are read from `**context` and default to `""`. Without `agent_name` the
tool returns an error payload, since it can't locate the curriculum.

> `user_id` is threaded through as a **per-request argument**, never read off
> the agent instance — `GeneralAgent` is cached and shared by every student on
> the agent, so instance state would leak across students.

## Flow

**With `user_id`:**
1. Check Cosmos DB for an existing learning state for this user + agent.
2. If found → return the topic map with per-topic statuses and an overall
   progress summary.
3. If not → fetch the full curriculum from blob, initialise the learning state,
   and return it.

**Without `user_id`** (or when called from the frontend endpoint):
1. Return the full raw course curriculum from blob or local file.

## Notes

`output` returns `json.dumps(result)` — the model consumes the whole topic map
directly rather than a summary sentence.

The module also exposes two backward-compatible aliases:
`handle_get_course_curriculum` and `GET_COURSE_CURRICULUM_TOOL_DEFINITION`.
A separate module-level `get_tool_output_message(agent_name)` reports whether
threshold concepts are available for an agent; it is **not** the tool's `output`
method and is used independently.
