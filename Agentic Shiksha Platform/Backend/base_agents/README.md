# base_agents

Legacy agent lifecycle helpers and the compatibility import for the agent harness.
The canonical conversation and tool-execution runtime is in [../harness/](../harness/).

| Module | Purpose |
| --- | --- |
| [agent_manager.py](agent_manager.py) | Base lifecycle manager for creating, looking up, chatting with and deleting agents. |
| [general_agent.py](general_agent.py) | Compatibility alias to [../harness/runtime.py](../harness/runtime.py), including its tool objects and cache. |

Legacy course-agent creation in [../backend/main.py](../backend/main.py) uses
`BaseAgentManager` directly, calling `create_agent` with `save_to_config=False`.
This avoids writing local agent configuration while retaining the manager's
local and remote duplicate-name checks. Course instructions are assembled by
[../utils/prompt_unifier.py](../utils/prompt_unifier.py), not by a separate manager
subclass.

Use `harness.runtime` for new runtime imports. Existing `base_agents.general_agent`
imports remain supported and resolve to the same module, so callers and monkeypatches
do not create a second runtime or cache.
