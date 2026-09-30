"""
GeneralAgent - Using AIProjectClient with OpenAI conversations/responses API

This module uses the AIProjectClient with the conversations/responses API
which properly supports MCP tool authentication.

Reference: https://learn.microsoft.com/en-us/azure/search/agentic-retrieval-how-to-create-pipeline
"""

import os
from deployment_settings import AzureSettings, RuntimeSettings, get_settings
import re
import json
import logging
from time import monotonic
from typing import Optional, Dict, Any, List, Generator, Tuple

import httpx
import openai
from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from azure.ai.projects import AIProjectClient

# Custom function tools — each class exposes a uniform
# .execute(args, **context) / .output(result, args) interface.
from agent_tools.custom import (
    AddDocumentTool,
    AddMessageTool,
    AddQuizTool,
    AddChallengeTool,
    AddCircuitTool,
    AddSlidesTool,
    GetThresholdConceptsTool,
    UpdateTopicProgressTool,
    AddTikzDiagramTool,
    GenerateImageTool,
    AskClarificationTool,
    SuggestNextQueriesTool,
    DeclarePlanTool,
    ListAllStudentsTool,
    GetStudentProgressTool,
    GetAgentOverviewTool,
    ListAgentsTool,
)

from utils.prompt_unifier import load_prompt_file
from utils import clarification_registry
from utils.course_materials import retrieve_course_passages
from utils.metadata_cache import definition_cache
from utils.log_safe import scrub
from backend.schemas.chat_suggestions import CourseSuggestions
from backend.schemas.chat_preferences import AnswerDepth
from learner_memory.integration import (
    MemoryToolContext,
    context_agent_reference,
    conversation_memory_metadata,
    memory_tool_context,
    validate_tool_context,
    verify_memory_conversation,
)

from harness.dispatch import (
    Tool, ToolResult, dispatch_tool_call, execute_tools_parallel, resolve_clarification,
)
from harness.events import RuntimeEvent, BLOCK_START_EVENTS, BLOCK_TOOLS, tool_start_events as _tool_start_events
from harness.executor import TurnDependencies, TurnExecutor
from harness.state import TurnRequest
from harness.output import (
    ValidatedProse as _ValidatedProse, _is_upstream_refusal,
    _try_parse_raw_function_call, render_plain_text,
)
from harness.telemetry import (
    _extract_citations_from_response, _extract_citation_from_annotation_event,
    _log_response_completion,
)
from harness.turn_policy import (
    NON_CONTENT_TOOLS, TURN_ENDING_TOOLS, TOOL_ERROR_PREFIX, RETIRED_FLASHCARD_MESSAGE,
    rewind_failed_plan_step as _rewind_failed_plan_step,
    round_ends_turn as _round_ends_turn,
)

logger = logging.getLogger("base_agents.general_agent")
_GRAPH_MEMORY_PROMPT = load_prompt_file("core_agent_prompts/graph_memory_context_v1.md")

# Tools are stateless (no __init__, no instance state), so one shared instance
# each is safe — including under the parallel ThreadPoolExecutor dispatch below.
add_document_tool = AddDocumentTool()
add_message_tool = AddMessageTool()
add_quiz_tool = AddQuizTool()
add_challenge_tool = AddChallengeTool()
add_circuit_tool = AddCircuitTool()
add_slides_tool = AddSlidesTool()
add_tikz_diagram_tool = AddTikzDiagramTool()
generate_image_tool = GenerateImageTool()
ask_clarification_tool = AskClarificationTool()
suggest_next_queries_tool = SuggestNextQueriesTool()
declare_plan_tool = DeclarePlanTool()
get_threshold_concepts_tool = GetThresholdConceptsTool()
update_topic_progress_tool = UpdateTopicProgressTool()



def _runtime_tools() -> Dict[str, Tool]:
    """Snapshot the explicit legacy tool bindings for one invocation."""
    return {
        "add_document": add_document_tool,
        "add_message": add_message_tool,
        "add_quiz": add_quiz_tool,
        "add_challenge": add_challenge_tool,
        "add_circuit": add_circuit_tool,
        "add_slides": add_slides_tool,
        "add_tikz_diagram": add_tikz_diagram_tool,
        "generate_image": generate_image_tool,
        "ask_clarification": ask_clarification_tool,
        "suggest_next_queries": suggest_next_queries_tool,
        "declare_plan": declare_plan_tool,
        "get_threshold_concepts": get_threshold_concepts_tool,
        "update_topic_progress": update_topic_progress_tool,
    }

_RESEARCH_CONTEXT_MAX_CHARS = 6000
_WEB_SEARCH_CONTEXT_MAX_CHARS = 12000
_DEFAULT_WEB_SEARCH_MODEL = "gpt-4.1"
_GREETING_ONLY_PATTERN = re.compile(
    r"^\s*(?:hi|hello|hey|hiya|howdy|good\s+(?:morning|afternoon|evening)|"
    r"namaste|thanks|thank\s+you)[\s!,.?]*$",
    re.IGNORECASE,
)
_GREETING_RESPONSE_RULE = (
    "GREETING RESPONSE RULE: This turn is only a greeting. Reply in at most two "
    "short sentences. Do not enumerate or summarize the student's profile, interests, "
    "institution, department, prior activity, course concepts, or capabilities. Ask one "
    "simple question about what they would like help with."
)
_FOUNDRY_CONNECT_TIMEOUT_SECONDS = get_settings(RuntimeSettings).FOUNDRY_CONNECT_TIMEOUT_SECONDS
_FOUNDRY_READ_TIMEOUT_SECONDS = get_settings(RuntimeSettings).FOUNDRY_READ_TIMEOUT_SECONDS
_WEB_SEARCH_REQUEST_PROMPT = load_prompt_file(
    "research_agents/automatic_web_search_request.md"
)
_WEB_SEARCH_CONTEXT_PROMPT = load_prompt_file(
    "research_agents/automatic_web_search_context.md"
)
_COURSE_MATERIALS_CONTEXT_PROMPT = load_prompt_file(
    "tools/course_material_grounding_context_v2.md"
)
_COURSE_FOLLOWUPS_PROMPT = load_prompt_file("tools/course_followups_v1.md")
_SIMULATION_REQUEST_CONTEXT_PROMPT = load_prompt_file("tools/simulation_request_context_v1.md")
_LEARNER_CUSTOM_INSTRUCTIONS_PROMPT = load_prompt_file(
    "tools/learner_custom_instructions_context_v1.md"
)
_LEARNER_PROFILE_CONTEXT_PREFIX = "[SYSTEM CONTEXT - Student Profile & Environment] "
_ANSWER_DEPTH_PROMPT = load_prompt_file("agents/answer_depth_v2.md")
_ANSWER_STYLE_PROMPTS = {
    "quick": load_prompt_file("agents/answer_style_concise_v1.md"),
    "balanced": load_prompt_file("agents/answer_style_balanced_v1.md"),
    "detailed": load_prompt_file("agents/answer_style_comprehensive_v1.md"),
}
_COURSE_MATERIALS_REQUEST_PATTERN = re.compile(
    r"\b(?:uploaded|attachments?|textbooks?|handouts?|"
    r"course\s+(?:files?|materials?|documents?)|lecture\s+notes?|"
    r"question\s+papers?|supplementary\s+materials?|"
    r"(?:this|that|the|my|our)\s+(?:files?|documents?|papers?|notes?))\b|"
    r"\.(?:pdf|docx?|pptx?|xlsx?|txt|md)\b",
    re.IGNORECASE,
)
_RESEARCH_METADATA_FIELDS = {
    "status",
    "research_type",
    "institute_name",
    "department_name",
    "started_at",
    "completed_at",
    "research_duration_seconds",
    "error",
    "raw_response",
}


def _research_context(data: Optional[Dict[str, Any]]) -> Optional[str]:
    """Return bounded context from either legacy text or structured research JSON."""
    if not data or data.get("status") != "completed":
        return None

    legacy = data.get("result")
    if isinstance(legacy, str) and legacy.strip():
        return legacy.strip()[:_RESEARCH_CONTEXT_MAX_CHARS]

    payload = {
        key: value
        for key, value in data.items()
        if key not in _RESEARCH_METADATA_FIELDS and value not in (None, "", [], {})
    }
    if not payload:
        return None

    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    if len(serialized) > _RESEARCH_CONTEXT_MAX_CHARS:
        serialized = serialized[:_RESEARCH_CONTEXT_MAX_CHARS] + "...[truncated]"
    return serialized


def _should_retrieve_live_web(user_text: str, web_search_enabled: bool) -> bool:
    """Treat web mode as opt-in permission, never as a reason to browse greetings."""
    return bool(
        web_search_enabled
        and user_text.strip()
        and not _GREETING_ONLY_PATTERN.fullmatch(user_text)
    )


def _is_greeting_only(user_text: str) -> bool:
    return bool(_GREETING_ONLY_PATTERN.fullmatch(user_text))


def _profile_research_instructions(user_profile: Dict[str, Any]) -> Optional[str]:
    """Build student context, including completed institute/department research."""
    parts = [
        "Address this student as {{preferred_name}} when greeting or referring to them by name."
    ]
    college = user_profile.get("college") or user_profile.get("institute")
    department = user_profile.get("department")
    if college and department:
        parts.append(f"The student studies in the {department} department at {college}.")
    elif college:
        parts.append(f"The student studies at {college}.")
    elif department:
        parts.append(f"The student is in the {department} department.")

    profile_fields = (
        ("language", "The student's primary language (other than English) is {}."),
        ("currentLocation", "The student is currently located in {}."),
        ("passionateAbout", "Passionate about: {}"),
    )
    for field, template in profile_fields:
        value = user_profile.get(field)
        if value:
            parts.append(template.format(value))

    if "customInstructions" in user_profile:
        custom_instructions = user_profile["customInstructions"]
        if custom_instructions is None:
            custom_instructions = ""
        if isinstance(custom_instructions, str):
            parts.append(_LEARNER_CUSTOM_INSTRUCTIONS_PROMPT.replace(
                "{{custom_instructions}}", json.dumps(custom_instructions, ensure_ascii=False),
            ))

    if college:
        try:
            from azure_services.persistence.cosmos_db import get_institute_research

            context = _research_context(get_institute_research(college))
            if context:
                parts.append(f"Institute context ({college}): {context}")
                logger.info("Injected institute research context for '%s'", scrub(college))
        except Exception as error:
            logger.warning("Could not load institute research for '%s': %s", scrub(college), scrub(error))

    if college and department:
        try:
            from azure_services.persistence.cosmos_db import get_department_research

            context = _research_context(get_department_research(college, department))
            if context:
                parts.append(f"Department context ({department} at {college}): {context}")
                logger.info(
                    "Injected department research context for '%s@%s'",
                    scrub(department),
                    scrub(college),
                )
        except Exception as error:
            logger.warning(
                "Could not load department research for '%s@%s': %s",
                scrub(department),
                scrub(college),
                scrub(error),
            )

    return " ".join(parts) if parts else None


def _is_learner_instruction_snapshot(item: Any) -> bool:
    if getattr(item, "type", None) != "message" or getattr(item, "role", None) != "user":
        return False
    content = getattr(item, "content", None)
    if not isinstance(content, list):
        return False
    text_parts = []
    for part in content:
        text = getattr(part, "text", None)
        if getattr(part, "type", None) not in {"input_text", "text", "output_text"} or not isinstance(text, str):
            return False
        text_parts.append(text)
    text = "".join(text_parts)
    template_prefix = _LEARNER_CUSTOM_INSTRUCTIONS_PROMPT.partition("{{custom_instructions}}")[0]
    return text.startswith(_LEARNER_PROFILE_CONTEXT_PREFIX) and template_prefix in text


def _is_graph_memory_snapshot(item: Any) -> bool:
    if getattr(item, "type", None) != "message" or getattr(item, "role", None) != "user":
        return False
    content = getattr(item, "content", None)
    if not isinstance(content, list):
        return False
    text = "".join(
        part.text for part in content
        if getattr(part, "type", None) in {"input_text", "text", "output_text"}
        and isinstance(getattr(part, "text", None), str)
    )
    return text.startswith(_GRAPH_MEMORY_PROMPT)


# Name -> instance, for the read-only analytics tools routed by function name.
LOGGING_TOOLS: Dict[str, Any] = {
    tool.name: tool
    for tool in (
        ListAllStudentsTool(),
        GetStudentProgressTool(),
        GetAgentOverviewTool(),
        ListAgentsTool(),
    )
}

def get_credential():
    """Get centralized credential (cached) to avoid Windows file locking."""
    try:
        from common_azure_auth import get_sync_credential
        return get_sync_credential()
    except ImportError:
        return DefaultAzureCredential()


def with_suggested_queries(stream, agent: "GeneralAgent", user_text: str):
    """Place existing suggestions after the answer without another inference call."""
    pending_suggestions = None

    for event_type, data, conv_id in stream:
        if event_type == "suggested_queries":
            pending_suggestions = (event_type, data, conv_id)
            continue
        if event_type == "done":
            if _is_greeting_only(user_text):
                queries = agent.generate_next_queries(user_text, "")
                pending_suggestions = (
                    "suggested_queries",
                    json.dumps({"type": "suggested_queries", "queries": queries}),
                    conv_id,
                ) if queries else None
            if pending_suggestions is not None:
                yield pending_suggestions
                pending_suggestions = None

        yield (event_type, data, conv_id)

    # Streams that error out never emit "done"; don't swallow suggestions already produced.
    if pending_suggestions is not None:
        yield pending_suggestions




class GeneralAgent:
    """
    Agent chat handler using AIProjectClient with OpenAI conversations/responses API.
    
    This implementation:
    - Uses conversation IDs instead of thread IDs
    - Uses responses API instead of runs API
    - References agents by name (not asst_xxx ID)
    - Properly supports MCP tools with project_connection_id
    """

    def __init__(
        self,
        project_endpoint: str,
        agent_name: str,
        credential: Optional[Any] = None,
        session_id: Optional[str] = None,
    ):
        """
        Initialize the GeneralAgent.
        
        Args:
            project_endpoint: The Azure AI Foundry project endpoint
            agent_name: The name of the agent to chat with
            credential: Optional Azure credential (defaults to DefaultAzureCredential)
            session_id: Optional session UUID for knowledge base filtering

        Note:
            Instances are cached and shared across students (see get_general_agent),
            so no per-request state (user_id, etc.) may be stored here. Per-request
            values are passed as arguments to the chat/stream methods.
        """
        if not project_endpoint:
            raise ValueError("project_endpoint is required.")
        if not agent_name:
            raise ValueError("agent_name is required.")

        self.project_endpoint = project_endpoint
        self.agent_name = agent_name
        self.credential = credential or get_credential()
        self.session_id = session_id  # Session UUID for knowledge base filtering (agent-scoped)
        
        # Create AIProjectClient and OpenAI client
        self.project_client = AIProjectClient(
            endpoint=self.project_endpoint,
            credential=self.credential,
        )
        self.openai_client = self.project_client.get_openai_client().with_options(
            timeout=httpx.Timeout(
                _FOUNDRY_READ_TIMEOUT_SECONDS,
                connect=_FOUNDRY_CONNECT_TIMEOUT_SECONDS,
            )
        )

        # Inference client for chat.completions (supports vision)
        inference_endpoint = self.project_endpoint.split("/api/projects")[0] if "/api/projects" in self.project_endpoint else self.project_endpoint
        token_provider = get_bearer_token_provider(
            self.credential,
            "https://cognitiveservices.azure.com/.default",
        )
        self.inference_client = openai.AzureOpenAI(
            azure_endpoint=inference_endpoint,
            azure_ad_token_provider=token_provider,
            api_version="2025-04-01-preview",
        )
        
        logger.info(f"GeneralAgent initialized for agent: {scrub(agent_name)}, session_id: {scrub(session_id)}")

    def _prepare_course_material_request(
        self,
        model_input: str | List[Dict[str, Any]],
        user_text: str,
        tool_choice: str,
    ) -> Tuple[str | List[Dict[str, Any]], List[Dict[str, Any]], Optional[Dict[str, Any]]]:
        if (
            not getattr(self, "session_id", None)
            or tool_choice not in ("auto", "required")
            or not _COURSE_MATERIALS_REQUEST_PATTERN.search(user_text)
        ):
            return model_input, [], None

        started = monotonic()
        stage = "agent_definition"
        try:
            def load_definition():
                return self.project_client.agents.get(agent_name=self.agent_name).versions.latest.definition

            endpoint = getattr(self, "project_endpoint", None)
            definition = definition_cache.get((endpoint, self.agent_name), load_definition) if endpoint else load_definition()
            stage = "search_configuration"
            search_tools = [
                tool.as_dict() for tool in (definition.tools or [])
                if tool.type == "azure_ai_search"
            ]
            if len(search_tools) != 1:
                raise ValueError("The course has no unique Search tool")
            indexes = search_tools[0].get("azure_ai_search", {}).get("indexes", [])
            if len(indexes) != 1 or not indexes[0].get("filter"):
                raise ValueError("The course Search tool has no scope filter")

            stage = "passage_retrieval"
            passages = retrieve_course_passages(
                self.agent_name, self.session_id, user_text, indexes[0]
            )
            citations = [source.model_dump() for source in passages]
        except Exception as error:
            logger.warning(
                "Course material retrieval failed stage=%s error_type=%s status=%s elapsed_ms=%d",
                stage, type(error).__name__, getattr(error, "status_code", None),
                round((monotonic() - started) * 1000),
            )
            raise RuntimeError(
                "Course document search could not be completed. Please try again."
            ) from None
        logger.info(
            "Course material retrieval completed passages=%d elapsed_ms=%d",
            len(citations), round((monotonic() - started) * 1000),
        )

        messages = model_input if isinstance(model_input, list) else [
            {"type": "message", "role": "user", "content": model_input}
        ]
        return [
            {
                "type": "message",
                "role": "developer",
                "content": _COURSE_MATERIALS_CONTEXT_PROMPT,
            },
            {
                "type": "message",
                "role": "user",
                "content": json.dumps({
                    "course_material_evidence": {
                        "passages": [
                            {**source, "citation": f"[{position + 1}](#source-{source['citation_id']})"}
                            for position, source in enumerate(citations)
                        ],
                    }
                }),
            },
            *messages,
        ], citations, None

    def start_chat(
        self, 
        user_text: str,
        tool_choice: str = "auto",
        user_profile: Optional[Dict[str, Any]] = None,
    ) -> Tuple[str, str]:
        """
        Start a new conversation.
        
        Args:
            user_text: The user's message
            tool_choice: Tool choice mode ("auto", "required", "none")
            user_profile: Optional user profile for personalization
            
        Returns:
            Tuple of (assistant_reply, conversation_id)
        """
        validate_tool_context(None, self.agent_name, "")
        # Create new conversation
        conversation = self.openai_client.conversations.create()
        conversation_id = conversation.id
        logger.info(f"Created conversation: {conversation_id}")
        
        # Send message using responses API
        response = self.openai_client.responses.create(
            conversation=conversation_id,
            tool_choice=tool_choice,
            input=user_text,
            extra_body={
                "agent_reference": {
                    "name": self.agent_name,
                    "type": "agent_reference"
                }
            },
        )
        
        return response.output_text, conversation_id

    def continue_chat(
        self,
        conversation_id: str,
        user_text: str,
        tool_choice: str = "auto",
        user_profile: Optional[Dict[str, Any]] = None,
    ) -> str:
        """
        Continue an existing conversation.
        
        Args:
            conversation_id: The existing conversation ID
            user_text: The user's message
            tool_choice: Tool choice mode ("auto", "required", "none")
            user_profile: Optional user profile for personalization
            
        Returns:
            The assistant's reply
        """
        validate_tool_context(None, self.agent_name, "")
        response = self.openai_client.responses.create(
            conversation=conversation_id,
            tool_choice=tool_choice,
            input=user_text,
            extra_body={
                "agent_reference": {
                    "name": self.agent_name,
                    "type": "agent_reference"
                }
            },
        )
        
        return response.output_text

    def _get_live_web_context(
        self,
        user_text: str,
    ) -> Tuple[Optional[str], List[Dict[str, str]]]:
        """Run a forced web search and return grounded context plus URL citations."""
        if not user_text.strip():
            return None, []

        try:
            response = self.openai_client.responses.create(
                model=_DEFAULT_WEB_SEARCH_MODEL,
                tools=[{
                    "type": "web_search_preview",
                    "search_context_size": "medium",
                }],
                tool_choice={"type": "web_search_preview"},
                input=_WEB_SEARCH_REQUEST_PROMPT.replace(
                    "{{USER_REQUEST}}", user_text
                ),
            )
        except Exception as error:
            logger.warning("Automatic web search failed: %s", error)
            return None, []

        used_web_search = any(
            getattr(item, "type", "") == "web_search_call"
            for item in (getattr(response, "output", None) or [])
        )
        if not used_web_search:
            logger.warning("Forced web retrieval returned no web_search_call")
            return None, []

        evidence = (getattr(response, "output_text", None) or "").strip()
        citations = _extract_citations_from_response(response)
        if not evidence and not citations:
            logger.warning("Web search completed without evidence or citations")
            return None, []

        evidence = evidence[:_WEB_SEARCH_CONTEXT_MAX_CHARS]
        source_lines = [
            f"- {citation.get('title') or citation.get('url')}: {citation.get('url')}"
            for citation in citations
            if citation.get("url")
        ]
        sources = "\n".join(source_lines) or "No structured source URLs were returned."
        context = _WEB_SEARCH_CONTEXT_PROMPT.replace(
            "{{WEB_EVIDENCE}}", evidence
        ).replace(
            "{{WEB_SOURCES}}", sources
        )
        logger.info("Automatic web search completed with %d citation(s)", len(citations))
        return context, citations

    def _handle_plain_text_fallback(
        self,
        conversation_id: str,
        plain_text: str,
        *,
        user_id: str = "",
        memory_context: MemoryToolContext | None = None,
    ) -> Generator[Tuple[str, str, Optional[str]], None, None]:
        yield from render_plain_text(
            self.agent_name, _runtime_tools(), self._dispatch_tool_call,
            conversation_id, plain_text, user_id=user_id, memory_context=memory_context,
        )

    # ── Centralized tool dispatch & parallel execution ──────────────────

    def _resolve_clarification(self, result: Dict[str, Any], conversation_id: str):
        yield from resolve_clarification(
            result, conversation_id, ask_clarification_tool.wait_for_answers
        )

    def _dispatch_tool_call(
        self,
        func_name: str,
        func_args_str: str,
        call_id: str,
        conversation_id: str,
        user_id: str,
        memory_context: MemoryToolContext | None = None,
    ) -> ToolResult:
        return dispatch_tool_call(
            self.agent_name, _runtime_tools(), LOGGING_TOOLS, func_name, func_args_str,
            call_id, conversation_id, user_id, memory_context,
        )

    def _execute_tools_parallel(
        self,
        collected_calls: List[Dict[str, Any]],
        conversation_id: str,
        user_id: str,
        memory_context: MemoryToolContext | None = None,
    ) -> list[ToolResult]:
        return execute_tools_parallel(
            self._dispatch_tool_call, collected_calls, conversation_id, user_id, memory_context
        )

    def _clear_prior_learner_instruction_context(self, conversation_id: str, *, graph_only: bool = False) -> None:
        try:
            items = self.openai_client.conversations.items
            matches = _is_graph_memory_snapshot if graph_only else _is_learner_instruction_snapshot
            # Materialize all pages before deleting so pagination cursors remain valid.
            snapshots = [
                item for item in items.list(conversation_id)
                if matches(item)
            ]
            for item in snapshots:
                if not isinstance(item.id, str) or not item.id:
                    raise ValueError("Learner context item has no identity")
                items.delete(item.id, conversation_id=conversation_id)
            if snapshots and any(
                matches(item) for item in items.list(conversation_id)
            ):
                raise ValueError("Learner context removal was not confirmed")
        except Exception as error:
            logger.warning("Learner instruction context replacement failed (%s)", type(error).__name__)
            raise RuntimeError("Learner instructions could not be updated. Please retry.") from None

    def start_chat_stream(
        self,
        user_text: str,
        tool_choice: str = "auto",
        user_profile: Optional[Dict[str, Any]] = None,
        web_search_enabled: bool = False,
        image_urls: Optional[list] = None,
        *,
        user_id: str,
        answer_depth: AnswerDepth = "balanced",
        memory_context: MemoryToolContext | None = None,
    ) -> Generator[Tuple[str, str, Optional[str]], None, None]:
        """
        Start a new conversation with streaming.
        
        Args:
            user_text: The user's message
            tool_choice: Tool choice mode ("auto", "required", "none")
            user_profile: Optional user profile for personalization
            web_search_enabled: If True, retrieves live web evidence before synthesis
            answer_depth: Presentation depth for this turn only.
            user_id: Required, keyword-only. Identifies the student whose learning
                state the tools read and write. Callers must validate it before
                reaching here; an empty value would silently corrupt progress data.
        
        Yields:
            Tuples of (event_type, data, conversation_id):
            - ("thread_id", conversation_id, conversation_id) - First yield with conversation ID
            - ("delta", text_chunk, conversation_id) - Text chunks as they arrive
            - ("done", "", conversation_id) - Final signal
            - ("error", error_message, conversation_id) - Error occurred
        """
        if not user_id or not user_id.strip():
            raise ValueError("start_chat_stream requires a non-empty user_id")
        validate_tool_context(memory_context, self.agent_name, user_id)
        agent_reference = context_agent_reference(self.agent_name, memory_context)
        conversation = self.openai_client.conversations.create(
            **({"metadata": conversation_memory_metadata(memory_context)} if memory_context is not None else {})
        )
        conversation_id = conversation.id
        logger.info(f"Created conversation: {conversation_id}")
        yield RuntimeEvent("thread_id", conversation_id, conversation_id)
        yield from self._stream_turn(
            TurnRequest(conversation_id, user_id, tool_choice, agent_reference, False, memory_context),
            user_text, user_profile, web_search_enabled, image_urls, answer_depth,
        )

    def continue_chat_stream(
        self,
        conversation_id: str,
        user_text: str,
        tool_choice: str = "auto",
        user_profile: Optional[Dict[str, Any]] = None,
        web_search_enabled: bool = False,
        image_urls: Optional[list] = None,
        *,
        user_id: str,
        answer_depth: AnswerDepth = "balanced",
        memory_context: MemoryToolContext | None = None,
    ) -> Generator[Tuple[str, str, Optional[str]], None, None]:
        """
        Continue an existing conversation with streaming.
        
        Args:
            conversation_id: The existing conversation ID
            user_text: The user's message
            tool_choice: Tool choice mode ("auto", "required", "none")
            user_profile: Optional user profile for personalization
            web_search_enabled: If True, retrieves live web evidence before synthesis
            answer_depth: Presentation depth for this turn only.
            user_id: Required, keyword-only. Identifies the student whose learning
                state the tools read and write. Callers must validate it before
                reaching here; an empty value would silently corrupt progress data.
        
        Yields:
            Tuples of (event_type, data, conversation_id):
            - ("delta", text_chunk, conversation_id) - Text chunks as they arrive
            - ("done", "", conversation_id) - Final signal
            - ("error", error_message, conversation_id) - Error occurred
        """
        if not user_id or not user_id.strip():
            raise ValueError("continue_chat_stream requires a non-empty user_id")
        validate_tool_context(memory_context, self.agent_name, user_id)
        agent_reference = context_agent_reference(self.agent_name, memory_context)
        if memory_context is not None:
            verify_memory_conversation(self.openai_client, conversation_id, memory_context)
        logger.info(f"Continuing conversation: {scrub(conversation_id)}")
        yield from self._stream_turn(
            TurnRequest(conversation_id, user_id, tool_choice, agent_reference, True, memory_context),
            user_text, user_profile, web_search_enabled, image_urls, answer_depth,
        )

    def _stream_turn(
        self,
        request: TurnRequest,
        user_text: str,
        user_profile: Optional[Dict[str, Any]],
        web_search_enabled: bool,
        image_urls: Optional[list],
        answer_depth: AnswerDepth,
    ) -> Generator[RuntimeEvent, None, None]:
        conversation_id = request.conversation_id
        tool_choice = request.tool_choice
        memory_context = request.memory_context
        yield RuntimeEvent("context_status", "preparing", conversation_id)
        web_context, web_citations = (
            self._get_live_web_context(user_text)
            if _should_retrieve_live_web(user_text, web_search_enabled)
            else (None, [])
        )
        
        full_message = user_text
        
        # Build input with images if present
        if image_urls:
            content_parts = []
            if user_text:
                content_parts.append({"type": "input_text", "text": user_text})
            for img_url in image_urls:
                content_parts.append({"type": "input_image", "image_url": img_url})
            model_input = [{
                "type": "message",
                "role": "user",
                "content": content_parts
            }]
            logger.info(f"Including {len(image_urls)} image(s) in input")
        else:
            model_input = full_message
        
        # Build user context from profile + institute/department research.
        profile_instructions = (
            _profile_research_instructions(user_profile) if user_profile else None
        )
        if _is_greeting_only(user_text):
            profile_instructions = " ".join(
                part for part in (profile_instructions, _GREETING_RESPONSE_RULE) if part
            )
        if profile_instructions:
            logger.info("Injecting user context into run")
        
        context_messages = [{
            "type": "message",
            "role": "user",
            "content": _ANSWER_DEPTH_PROMPT.format(
                answer_depth=answer_depth, style_instructions=_ANSWER_STYLE_PROMPTS[answer_depth],
            ),
        }]
        if tool_choice in ("auto", "required"):
            context_messages.append({
                "type": "message",
                "role": "developer",
                "content": _SIMULATION_REQUEST_CONTEXT_PROMPT,
            })
        if web_context:
            context_messages.append({
                "type": "message",
                "role": "user",
                "content": web_context,
            })
        if profile_instructions:
            context_messages.append({
                "type": "message",
                "role": "user",
                "content": f"{_LEARNER_PROFILE_CONTEXT_PREFIX}{profile_instructions}",
            })
        if memory_context is not None and memory_context.mode == "authoritative":
            context_messages.append({
                "type": "message",
                "role": "user",
                "content": _GRAPH_MEMORY_PROMPT
                + "\n" + json.dumps(memory_tool_context(memory_context), ensure_ascii=False),
            })
        if context_messages:
            if isinstance(model_input, list):
                model_input = context_messages + model_input
            else:
                model_input = context_messages + [{"type": "message", "role": "user", "content": model_input}]
        
        try:
            model_input, course_citations, course_usage = self._prepare_course_material_request(
                model_input, user_text, tool_choice
            )
            if request.continuing:
                if memory_context is not None and memory_context.mode == "authoritative":
                    self._clear_prior_learner_instruction_context(conversation_id, graph_only=True)
                if user_profile and "customInstructions" in user_profile and (
                    user_profile["customInstructions"] is None
                    or isinstance(user_profile["customInstructions"], str)
                ):
                    self._clear_prior_learner_instruction_context(conversation_id)
            yield RuntimeEvent("context_status", "ready", conversation_id)
            dependencies = TurnDependencies(
                create_response=self.openai_client.responses.create,
                write_items=lambda conv_id, **kwargs: self.openai_client.conversations.items.create(
                    conv_id, **kwargs
                ),
                execute_tools=self._execute_tools_parallel,
                resolve_clarification=self._resolve_clarification,
                render_fallback=self._handle_plain_text_fallback,
            )
            yield from TurnExecutor(request, dependencies).run(
                model_input, web_citations, course_citations, course_usage
            )
        except Exception as error:
            logger.error("Streaming error: %s", error)
            yield RuntimeEvent("error", str(error), conversation_id)


    def get_conversation_history(self, conversation_id: str) -> List[Dict[str, Any]]:
        """
        Get all messages in a conversation.
        
        Args:
            conversation_id: The conversation ID
            
        Returns:
            List of message dictionaries with role and content
        """
        items = list(self.openai_client.conversations.items.list(conversation_id))
        messages = []
        for item in items:
            messages.append({
                "role": item.role if hasattr(item, 'role') else "unknown",
                "content": item.content if hasattr(item, 'content') else str(item),
            })
        return messages

    def delete_conversation(self, conversation_id: str) -> bool:
        """
        Delete a conversation.
        
        Args:
            conversation_id: The conversation ID to delete
            
        Returns:
            True if successful
        """
        try:
            self.openai_client.conversations.delete(conversation_id)
            logger.info(f"Deleted conversation: {conversation_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to delete conversation {conversation_id}: {e}")
            return False

    def generate_next_queries(
        self, user_message: str, assistant_response: str,
        *, course_context: Optional[Dict[str, str]] = None,
    ) -> List[str]:
        """Generate course-scoped follow-ups independently of the completed reply."""
        if _is_greeting_only(user_message):
            course = re.sub(r"^(?:course|learning|exam)[-_]", "", self.agent_name, flags=re.IGNORECASE)
            course = course.replace("-", " ").replace("_", " ").strip()[:80]
            return [
                f"What should I learn first in {course}?",
                f"Show me the {course} syllabus.",
                f"Give me a beginner practice task for {course}.",
            ] if course else []
        try:
            response = self.openai_client.with_options(timeout=8, max_retries=0).responses.create(
                model=get_settings(AzureSettings).AZURE_OPENAI_CHAT_MODEL,
                instructions=_COURSE_FOLLOWUPS_PROMPT,
                input=json.dumps({
                    "course": course_context or {"name": self.agent_name},
                    "question": user_message[:2000], "answer": assistant_response[:6000],
                }),
                text={"format": {
                    "type": "json_schema", "name": "course_followups", "strict": True,
                    "schema": CourseSuggestions.model_json_schema(),
                }},
                max_output_tokens=400, store=False,
            )
            if response.status != "completed":
                return []
            return CourseSuggestions.model_validate_json(response.output_text).queries
        except Exception as e:
            logger.warning("Course follow-up generation failed (%s)", type(e).__name__)
            return []

    def generate_title(self, user_message: str, assistant_response: str) -> str:
        """
        Generate a short title for a conversation using the Responses API directly.
        
        Uses a lightweight model call — no conversation or agent needed.
        
        Args:
            user_message: The user's first message
            assistant_response: The assistant's response (first ~500 chars)
            
        Returns:
            A short 3-6 word title for the conversation
        """
        try:
            response_preview = assistant_response[:500] if len(assistant_response) > 500 else assistant_response
            
            prompt = load_prompt_file("agents/conversation_title.md").format(
                user_message=user_message[:200],
                response_preview=response_preview[:300],
            )
            
            # Direct Responses API call — no conversation, no agent, no tools
            response = self.openai_client.responses.create(
                model=get_settings(AzureSettings).AZURE_OPENAI_CHAT_MODEL,
                input=prompt,
            )
            
            title = response.output_text or ""
            
            # Clean up — remove quotes, prefixes, limit length
            title = title.strip().strip('"\'').strip()
            if title.lower().startswith('title:'):
                title = title[6:].strip()
            title = title[:50]
            
            if title:
                logger.info(f"[Title] Generated title: '{title}'")
                return title
            
            raise ValueError("Empty title from Responses API")
            
        except Exception as e:
            logger.warning(f"[Title] Failed to generate title: {e}")
            words = user_message.split()[:5]
            fallback = " ".join(words) + ("..." if len(words) >= 5 else "")
            logger.info(f"[Title] Using fallback title: '{fallback}'")
            return fallback


# Cache for GeneralAgent instances.
#
# Keyed by (endpoint, agent_name, session_id) — one instance is SHARED by every student
# using that agent. It must therefore stay free of per-request state. Pass
# `user_id` to start_chat_stream / continue_chat_stream instead; mutating it on
# the shared instance leaks one student's learning state into another's request.
_agent_cache: Dict[str, GeneralAgent] = {}


def get_general_agent(project_endpoint: str, agent_name: str, session_id: Optional[str] = None, user_id: Optional[str] = None) -> GeneralAgent:
    """
    Get or create a GeneralAgent instance for an endpoint, agent, and material session.

    Args:
        project_endpoint: The Azure AI Foundry project endpoint
        agent_name: The name of the agent
        session_id: Optional session UUID for knowledge base filtering (agent-scoped)
        user_id: Deprecated and ignored — the returned instance is shared across
            students. Pass user_id to the chat/stream call instead.

    Returns:
        Cached or new GeneralAgent instance
    """
    cache_key = f"{project_endpoint}:{agent_name}:{session_id or ''}"
    if cache_key not in _agent_cache:
        _agent_cache[cache_key] = GeneralAgent(
            project_endpoint=project_endpoint,
            agent_name=agent_name,
            session_id=session_id,
        )
    return _agent_cache[cache_key]


if __name__ == "__main__":
    # Test the GeneralAgent
    PROJECT_ENDPOINT = os.environ["AZURE_AI_PROJECT_ENDPOINT"]
    AGENT_NAME = "test-agent"
    
    agent = GeneralAgent(
        project_endpoint=PROJECT_ENDPOINT,
        agent_name=AGENT_NAME,
    )
    
    # Test streaming chat
    print("Testing streaming chat...")
    for event_type, data, conv_id in agent.start_chat_stream("Hello!", user_id="demo-user"):
        if event_type == "delta":
            print(data, end="", flush=True)
        elif event_type == "done":
            print("\n--- Done ---")
