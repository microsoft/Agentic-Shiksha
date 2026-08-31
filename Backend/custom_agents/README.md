# custom_agents

Course-specific teaching agent runtime — the agents students actually talk to.

| Module | Purpose |
| --- | --- |
| [learning_agent_manager.py](learning_agent_manager.py) | Runs a course Teaching Assistant: assembles instructions, wires the tool set, and drives the turn loop. |

Where [base_agents/](../base_agents) provides a generic runtime, this package adds the
teaching behaviour: curriculum grounding through retrieval, threshold-concept progress
tracking, and the structured output tools in [agent_tools/custom/](../agent_tools/custom).

Instructions come from [prompt_store/core_agent_prompts/](../prompt_store/core_agent_prompts)
via the unifier in [utils/prompt_unifier.py](../utils/prompt_unifier.py). They are baked
into the Foundry agent version at creation, so editing a prompt only affects newly
created agents.
