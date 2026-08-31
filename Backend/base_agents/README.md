# base_agents

Course-independent agent runtimes. These agents have no curriculum attached — compare
[custom_agents/](../custom_agents), which layers the teaching behaviour on top.

| Module | Purpose |
| --- | --- |
| [agent_manager.py](agent_manager.py) | Base manager: creates, looks up and runs an agent, and owns the shared conversation loop. |
| [general_agent.py](general_agent.py) | General-purpose agent built on `AIProjectClient` with the conversations/responses API. |

`GeneralAgent` uses the conversations/responses surface rather than the older threads API
because that is what supports MCP tool authentication.
