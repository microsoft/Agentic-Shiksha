# prompt_store/core_agent_prompts

The instructions actually loaded at runtime. Everything else under
[prompt_store/](..) is either agent-specific or reference material — this is the set that
composes a course Teaching Assistant.

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

Progress tracking depends on this text. The requirement to call `update_topic_progress`
lives in `tool_handling.md` as a mandatory per-turn block, because when it was optional
guidance buried in a very long prompt it fired five times platform-wide, ever. Server-side
inference in
[azure_services/persistence/progress_inference.py](../../azure_services/persistence/progress_inference.py)
now backs it up so tracking no longer depends on model compliance.

Name tokenization in `safety_guardrails.md` means the student's real name is replaced
before messages reach the model. Instructions that ask the model to use the name
literally will therefore produce the token.
