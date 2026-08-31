# logging_agent_tools

Read-only access to student learning data in Cosmos DB, for the logging /
analytics agent. These tools let it answer questions about learning
trajectories across students and agents.

**This is the only multi-tool package** — one module ships four tools, so it
holds four named `*.json` schemas instead of a single `definition.json`.

| Class | Tool name | Schema |
|---|---|---|
| `ListAllStudentsTool` | `list_all_students` | [list_all_students.json](list_all_students.json) |
| `GetStudentProgressTool` | `get_student_progress` | [get_student_progress.json](get_student_progress.json) |
| `GetAgentOverviewTool` | `get_agent_overview` | [get_agent_overview.json](get_agent_overview.json) |
| `ListAgentsTool` | `list_agents` | [list_agents.json](list_agents.json) |

## Shared base

All four subclass a small private `_LoggingQueryTool`, which supplies the
uniform interface:

- `execute` delegates to the module-level `handle_*` query function.
- `output` echoes the result, because these tools **already return a JSON
  string** — unlike the content tools, which return a dict and need a
  confirmation sentence.

## Usage

The dispatcher routes these by name rather than by named instance:

```python
LOGGING_TOOLS = {
    tool.name: tool
    for tool in (ListAllStudentsTool(), GetStudentProgressTool(),
                 GetAgentOverviewTool(), ListAgentsTool())
}

if func_name in LOGGING_TOOLS:
    tool = LOGGING_TOOLS[func_name]
    result = tool.execute(args)
```

That dict is built in [general_agent.py](../../../base_agents/general_agent.py).

## Notes

Queries are **cross-partition** by design (admin-facing reporting), which is
more expensive than partition-scoped reads — see
[cosmosdb-best-practices](https://learn.microsoft.com/azure/cosmos-db/) if these
grow hot.

Every handler catches its own exceptions and returns
`json.dumps({"error": ...})`, so a failed query becomes a readable message to
the model rather than a raised exception.
