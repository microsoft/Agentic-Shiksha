# Agent Prompts

Modular prompt components stored as markdown files. Loading/unification logic is
in [utils/prompt_unifier.py](../utils/prompt_unifier.py). Files are selected by their
callers, not automatically loaded just because they are in this directory.

## Structure

| Location | Role |
| --- | --- |
| [core_agent_prompts/](core_agent_prompts/README.md) | Five core teaching components assembled with course-specific instructions. |
| [agents/](agents/README.md) | Conversation titles, answer-style context and the course-form companion. |
| [research_agents/](research_agents/README.md) | Research-agent definitions and automatic web-grounding context. |
| [tools/](tools/README.md) | Material grounding, creation, translation, learner preferences, document transcription and legacy TikZ prompts. |
| [evaluation/](evaluation/README.md) | Reference judge prompts; evaluation runs separately from the main chat path. |
| [custom_agents/](custom_agents/README.md) | README-only reserved directory. |
| `agent_prompt.md`, `caca_prompt.md`, `full_agent_prompt.md` | Root-level templates/snapshots; not the five-file core prompt set. |

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
    load_prompt_file,
)

# Load specific prompts
behavior = get_agent_behavior_prompt()
pedagogy = get_pedagogical_prompt()
```

`load_prompt(name)` reads a named markdown file in `core_agent_prompts`.
`load_prompt_file(relative_path)` reads a selected file anywhere under this store.
Both fail when the requested file is missing. The core unifier reads
`agent_behavior`, `pedagogical_framework`, `tool_handling`, `knowledge_grounding`
and `safety_guardrails`; there is no current `pedagogical.md`.

## Updating prompts

Remote agent instructions are captured in a Foundry agent version. Editing a core
file does not update existing versions automatically. Request-context prompts
(for example answer depth and learner instructions) are instead used by local
runtime code; several are read at module import, so a server restart may be needed
to pick up edits. Older versioned files are not selected automatically.

Prompt size depends on the selected files and course content; no fixed character
count is guaranteed. Preserve placeholders expected by the caller and run the
relevant [offline regressions](../tests/README.md).
