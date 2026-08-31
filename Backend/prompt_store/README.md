# Agent Prompts

Modular prompt components stored as markdown files.
Loading/unification logic is in `utils/prompt_unifier.py`.

## Structure

```
prompt_store/
├── README.md
└── core_agent_prompts/      # Core agent prompts
    ├── agent_behavior.md
    ├── pedagogical.md
    ├── pedagogical_framework.md
    ├── knowledge_grounding.md
    ├── tool_handling.md
    └── safety_guardrails.md

utils/
└── prompt_unifier.py        # Loading & unification logic
```

## Usage

```python
from utils.prompt_unifier import unify_agent_prompts

# Get unified prompt for a teaching assistant
final_instructions = unify_agent_prompts(
    course_name="Machine Learning",
    course_level="Intermediate",
    learning_prompt="...",  # From CACA
)
```

### Loading Individual Prompts

```python
from utils.prompt_unifier import (
    get_agent_behavior_prompt,
    get_pedagogical_prompt,
    load_prompt,
)

# Load specific prompts
behavior = get_agent_behavior_prompt()
pedagogy = get_pedagogical_prompt()
```

## Character Count
All prompts optimized for size. Unified total: ~11,000 chars (down from ~26,000).
