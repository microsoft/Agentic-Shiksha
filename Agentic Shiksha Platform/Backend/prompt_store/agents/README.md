# prompt_store/agents

Prompts for conversation tasks and the course-form companion. Core teaching
instructions live in [../core_agent_prompts/](../core_agent_prompts).

| File | Purpose |
| --- | --- |
| [conversation_title.md](conversation_title.md) | Generates a 3–6 word title for a conversation. |
| [answer_depth_v2.md](answer_depth_v2.md) | Per-turn context wrapping the selected answer style; loaded by the harness. |
| [answer_style_concise_v1.md](answer_style_concise_v1.md), [answer_style_balanced_v1.md](answer_style_balanced_v1.md), [answer_style_comprehensive_v1.md](answer_style_comprehensive_v1.md) | Display styles mapped to existing `quick`, `balanced`, `detailed` wire values. |
| [form_fill_assistant_v3.md](form_fill_assistant_v3.md) | Current typed course-form companion instructions. |
| `answer_depth_v1.md`, `form_fill_assistant_v1.md`, `form_fill_assistant_v2.md` | Retained prior versions; current callers explicitly select the versions above. |

The [harness](../../harness/README.md) loads title/answer-style context. The
[form router](../../backend/routers/course_form_assistant.py) loads companion
instructions for its own model calls. These files are used at runtime; they are
not all merely background-task reference material.

`conversation_title.md` requires a bare title as output — no quotes, no prefix, no
explanation — because the result is written straight into the thread list in
[Frontend/src/features/projects/ThreadList.tsx](../../../Frontend/src/features/projects/ThreadList.tsx).
Any preamble the model adds becomes part of the visible title.
