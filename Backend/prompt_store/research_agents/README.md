# prompt_store/research_agents

Prompts for the research agents — the ones that gather source material rather than teach.

| File | Agent |
| --- | --- |
| [institute_research_agent.md](institute_research_agent.md) | Researches institutions and departments via web search, returning structured output. |
| [textbook_research_agent.md](textbook_research_agent.md) | Finds textbook references — chapters, sections, subtopics. |
| [threshold_concept_research_agent.md](threshold_concept_research_agent.md) | Turns a reframed syllabus into threshold concepts. |
| [economic_research_agent.md](economic_research_agent.md) | Economic analysis with sourced, cited reports. |
| [deep_research_default.md](deep_research_default.md) | Default instructions for the Deep Research tool. |
| [web_search_assistant.md](web_search_assistant.md) | General research assistant for Agentic Shiksha. |
| [automatic_web_search_request.md](automatic_web_search_request.md) | Request template for automatic live web grounding. |
| [automatic_web_search_context.md](automatic_web_search_context.md) | Context block marking results as verified live web search. |

Several of these are expected to return **structured JSON**. Parsing is deliberately
tolerant — see
[Admin-Dashboard/backend/research_json.py](../../../Admin-Dashboard/backend/research_json.py),
which applies a narrow repair fallback rather than trusting the model to emit valid JSON
every time. Changing an output-shape instruction here can break that parser.

`threshold_concept_research_agent.md` feeds the concept model that student progress is
tracked against, so its output shape is load-bearing well beyond the research flow.
