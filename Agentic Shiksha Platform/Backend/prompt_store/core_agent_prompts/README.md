# prompt_store/core_agent_prompts

The five core components assembled into a course Teaching Assistant's
instructions. Other folders under [prompt_store/](../README.md) also have active
callers, including turn-context, course-form, research and tool prompts.

| File | Role |
| --- | --- |
| [agent_behavior.md](agent_behavior.md) | Identity and operating frame for Project Ekalaiva. |
| [pedagogical_framework.md](pedagogical_framework.md) | Teaching model: learning vs. exam modes, and how tools serve the concept crossing. |
| [knowledge_grounding.md](knowledge_grounding.md) | How to use course textbooks, notes, question papers and supplementary material via retrieval. |
| [tool_handling.md](tool_handling.md) | Tool rules. These override everything below them. |
| [safety_guardrails.md](safety_guardrails.md) | Safety and privacy, including name tokenization. |
| `*_old.md` | Superseded versions, kept for comparison. **Not loaded.** |

Assembled by [utils/prompt_unifier.py](../../utils/prompt_unifier.py), which combines
these modules with the learning and exam prompts produced by CACA.

## Two things to know before editing

- **Precedence is real.** `tool_handling.md` opens by asserting that its rules override
  everything below. Adding a contradicting instruction elsewhere does not soften it — it
  just creates a conflict the model resolves unpredictably.
- **Edits do not reach existing agents.** Instructions are baked into a Foundry agent
  version at creation, so changing a file here affects only newly created agents.

The instruction to call `update_topic_progress` lives in `tool_handling.md`.
Server-side inference in
[azure_services/persistence/progress_inference.py](../../azure_services/persistence/progress_inference.py)
also records in-progress topics so progress is not solely dependent on model
compliance. It does not independently certify that a topic has been learned.

The name-tokenization instructions in `safety_guardrails.md` are a prompt contract,
not proof that every input path has redacted personal data. Do not treat prompt
text as a replacement for identity isolation or data-handling checks in code.
