"""
GeneralAgent - Using AIProjectClient with OpenAI conversations/responses API

This module uses the AIProjectClient with the conversations/responses API
which properly supports MCP tool authentication.

Reference: https://learn.microsoft.com/en-us/azure/search/agentic-retrieval-how-to-create-pipeline
"""

import os
import re
import json
import logging
import threading
import concurrent.futures
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
    AddFlashcardTool,
    AddChallengeTool,
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
from utils.log_safe import scrub

logger = logging.getLogger(__name__)

# Tools are stateless (no __init__, no instance state), so one shared instance
# each is safe — including under the parallel ThreadPoolExecutor dispatch below.
add_document_tool = AddDocumentTool()
add_message_tool = AddMessageTool()
add_quiz_tool = AddQuizTool()
add_flashcard_tool = AddFlashcardTool()
add_challenge_tool = AddChallengeTool()
add_tikz_diagram_tool = AddTikzDiagramTool()
generate_image_tool = GenerateImageTool()
ask_clarification_tool = AskClarificationTool()
suggest_next_queries_tool = SuggestNextQueriesTool()
declare_plan_tool = DeclarePlanTool()
get_threshold_concepts_tool = GetThresholdConceptsTool()
update_topic_progress_tool = UpdateTopicProgressTool()

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
_FOUNDRY_CONNECT_TIMEOUT_SECONDS = float(
    os.getenv("FOUNDRY_CONNECT_TIMEOUT_SECONDS", "15")
)
_FOUNDRY_READ_TIMEOUT_SECONDS = float(
    os.getenv("FOUNDRY_READ_TIMEOUT_SECONDS", "180")
)
_WEB_SEARCH_REQUEST_PROMPT = load_prompt_file(
    "research_agents/automatic_web_search_request.md"
)
_WEB_SEARCH_CONTEXT_PROMPT = load_prompt_file(
    "research_agents/automatic_web_search_context.md"
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

# Tools whose *_start event makes the UI draw a placeholder card, so a failure
# has to be reported back or the placeholder hangs forever.
BLOCK_TOOLS = frozenset({
    "add_document",
    "add_message",
    "add_quiz",
    "add_flashcard",
    "add_challenge",
    "add_tikz_diagram",
    "generate_image",
})

# Tool name -> the "<kind>_start" event that makes the UI draw its placeholder.
BLOCK_START_EVENTS: Dict[str, str] = {
    "add_document": "document_start",
    "add_message": "message_block_start",
    "add_quiz": "quiz_start",
    "add_flashcard": "flashcard_start",
    "add_challenge": "challenge_start",
    "add_tikz_diagram": "tikz_image_start",
    "generate_image": "generated_image_start",
}


def _tool_start_events(func_name: Optional[str], conversation_id: Optional[str]):
    """Yield the status + placeholder events announcing that a tool call began.

    Long tools (TikZ) emit nothing for minutes, so without these the
    stream looks dead to the client.
    """
    if not func_name:
        return
    yield ("tool_status", json.dumps({"type": "tool_status", "tool": func_name}), conversation_id)
    start_event = BLOCK_START_EVENTS.get(func_name)
    if start_event:
        yield (start_event, json.dumps({"type": start_event}), conversation_id)


# Tools that produce no user-visible content, so they never keep a turn alive.
NON_CONTENT_TOOLS = frozenset({
    "memory_search_call", "memory_search", "file_search",
    "get_threshold_concepts", "update_topic_progress", "declare_plan",
})

# suggest_next_queries is contractually the last thing in a turn.
TURN_ENDING_TOOLS = frozenset({"suggest_next_queries"})

# Marks a tool output as a failure the model is expected to correct.
TOOL_ERROR_PREFIX = "Error: "


def _rewind_failed_plan_step(
    execution_plan: list,
    plan_index: int,
    tool_round: int,
    last_round_failed: bool,
) -> int:
    """Point the plan back at a forced step that errored, so the model retries it.

    A forced tool that raises leaves nothing on screen, and the plan otherwise
    marches straight on to the next step — so the block it was meant to produce
    vanishes from the reply with only an apology in its place.

    Rewinding is capped by ``tool_round``: once the rounds spent outnumber the
    plan's steps, stop retrying and let the turn finish.
    """
    if (
        last_round_failed
        and 0 < plan_index <= len(execution_plan)
        and tool_round <= len(execution_plan)
    ):
        return plan_index - 1
    return plan_index


def _round_ends_turn(
    tool_types: set,
    execution_plan: list,
    plan_index: int,
    tool_round: int,
    add_message_count: int = 1,
) -> bool:
    """Whether this tool round finished the reply, so no follow-up round is needed.

    Without the TURN_ENDING_TOOLS case the model keeps writing after calling
    suggest_next_queries, calls it again at the next "end", and the reply grows
    by a paragraph per round.
    """
    plan_remaining = bool(execution_plan) and plan_index < len(execution_plan)
    if tool_types & TURN_ENDING_TOOLS:
        # The model sometimes suggests follow-ups before answering at all. Ending
        # there would leave the turn as buttons with no reply, so only treat it as
        # the end once something has actually been delivered.
        other_content = (tool_types - NON_CONTENT_TOOLS) - TURN_ENDING_TOOLS
        content_delivered = add_message_count > 0 or bool(other_content)
        return content_delivered and not plan_remaining
    # A round that only sent a chat message has already delivered the whole reply;
    # running another round would repeat it.
    content_tools = tool_types - NON_CONTENT_TOOLS
    return not execution_plan and tool_round > 0 and content_tools == {"add_message"}


# Canned upstream refusals. These arrive as ordinary assistant text, so without
# this check they render as if the tutor had written them — mid-sentence, since
# a refusal typically lands in a later round than the content already on screen.
_REFUSAL_PATTERNS = (
    "i cannot assist with that",
    "i can't assist with that",
    "i'm sorry, but i cannot",
    "i'm sorry, but i can't",
    "i am sorry, but i cannot",
    "i'm unable to assist",
    "i am unable to assist",
)


def _is_upstream_refusal(text: str) -> bool:
    """Whether plain-text output is a canned refusal rather than real content.

    Deliberately anchored near the start: a tutor legitimately discussing
    refusals mid-answer must not be suppressed.
    """
    if not text:
        return False
    head = text.strip().lower()[:160]
    return any(pattern in head for pattern in _REFUSAL_PATTERNS)


def _log_response_completion(completed_response, phase: str) -> None:
    """Record why a round ended, so filtered turns are diagnosable after the fact.

    Azure reports content-filter action via status/incomplete_details and the
    per-output content_filter_results; none of it was previously logged, which is
    why refusals could only be observed second-hand in the transcript.
    """
    try:
        status = getattr(completed_response, "status", None)
        incomplete = getattr(completed_response, "incomplete_details", None)
        reason = getattr(incomplete, "reason", None) if incomplete else None

        filtered = []
        for item in (getattr(completed_response, "output", None) or []):
            results = getattr(item, "content_filter_results", None)
            if not results:
                continue
            as_dict = results if isinstance(results, dict) else getattr(results, "__dict__", {})
            for category, detail in (as_dict or {}).items():
                detail_dict = detail if isinstance(detail, dict) else getattr(detail, "__dict__", {})
                if (detail_dict or {}).get("filtered"):
                    filtered.append(f"{category}={detail_dict.get('severity', 'unknown')}")

        if filtered or reason:
            logger.error(
                "[content-filter] %s round ended status=%s reason=%s filtered=[%s]",
                phase, status, reason, ", ".join(filtered) or "none",
            )
        else:
            logger.debug("[content-filter] %s round ended status=%s", phase, status)
    except Exception as log_error:
        logger.debug(f"[content-filter] Could not inspect completion: {log_error}")


def _try_parse_raw_function_call(text: str):
    """
    Detect if buffered plain text is actually one or more raw function call JSON
    objects that the model output as text instead of invoking the tool.
    
    Handles single:
      {"name":"add_message","arguments":{"content":"..."}}
    And concatenated:
      {"name":"add_flashcard","arguments":{...}}{"name":"add_message","arguments":{...}}
    
    Returns a list of (func_name, args_dict) tuples, or None if nothing parsed.
    """
    KNOWN_TOOLS = ('add_message', 'add_document', 'add_quiz', 'add_flashcard', 'add_challenge', 'add_tikz_diagram')
    stripped = text.strip()
    if not stripped.startswith('{'):
        return None
    
    results = []
    
    # First try single JSON parse
    try:
        parsed = json.loads(stripped)
        if isinstance(parsed, dict) and 'name' in parsed and 'arguments' in parsed:
            func_name = parsed['name']
            args = parsed['arguments']
            if isinstance(args, str):
                args = json.loads(args)
            if func_name in KNOWN_TOOLS:
                return [(func_name, args)]
    except (json.JSONDecodeError, TypeError, ValueError):
        pass
    
    # Try splitting concatenated JSON objects using json.JSONDecoder
    try:
        decoder = json.JSONDecoder()
        pos = 0
        while pos < len(stripped):
            # Skip whitespace / newlines between objects
            while pos < len(stripped) and stripped[pos] in ' \t\n\r':
                pos += 1
            if pos >= len(stripped):
                break
            obj, end_pos = decoder.raw_decode(stripped, pos)
            pos = end_pos
            if isinstance(obj, dict) and 'name' in obj and 'arguments' in obj:
                func_name = obj['name']
                args = obj['arguments']
                if isinstance(args, str):
                    args = json.loads(args)
                if func_name in KNOWN_TOOLS:
                    results.append((func_name, args))
    except (json.JSONDecodeError, TypeError, ValueError):
        pass
    
    return results if results else None
def _extract_citations_from_response(response) -> List[Dict[str, str]]:
    """
    Extract structured citation annotations from an OpenAI Responses API response object.
    
    Looks for AnnotationURLCitation, AnnotationFileCitation, and
    AnnotationContainerFileCitation in the response output items.
    
    Returns:
        List of citation dicts with 'title', 'url' or 'filename', 'type' keys.
    """
    citations = []
    seen = set()
    try:
        for output_item in (getattr(response, 'output', None) or []):
            # ResponseOutputMessage has .content list
            for content_part in (getattr(output_item, 'content', None) or []):
                for ann in (getattr(content_part, 'annotations', None) or []):
                    ann_type = getattr(ann, 'type', '')
                    if ann_type == 'url_citation':
                        url = getattr(ann, 'url', '')
                        title = getattr(ann, 'title', '') or url
                        key = f"url:{url}"
                        if key not in seen:
                            seen.add(key)
                            citations.append({"type": "url", "title": title, "url": url})
                    elif ann_type == 'file_citation':
                        file_id = getattr(ann, 'file_id', '')
                        filename = getattr(ann, 'filename', '') or file_id
                        key = f"file:{file_id}"
                        if key not in seen:
                            seen.add(key)
                            citations.append({"type": "file", "title": filename, "file_id": file_id, "filename": filename})
                    elif ann_type == 'container_file_citation':
                        file_id = getattr(ann, 'file_id', '')
                        filename = getattr(ann, 'filename', '') or file_id
                        container_id = getattr(ann, 'container_id', '')
                        key = f"container:{file_id}"
                        if key not in seen:
                            seen.add(key)
                            citations.append({"type": "file", "title": filename, "file_id": file_id, "filename": filename, "container_id": container_id})
    except Exception as e:
        logger.warning(f"Failed to extract citations from response: {e}")
    return citations


def _extract_citation_from_annotation_event(event) -> Optional[Dict[str, str]]:
    """
    Extract a single citation from a response.output_text.annotation.added streaming event.
    """
    try:
        ann = getattr(event, 'annotation', None)
        if not ann:
            return None
        ann_type = getattr(ann, 'type', '')
        if ann_type == 'url_citation':
            return {"type": "url", "title": getattr(ann, 'title', '') or getattr(ann, 'url', ''), "url": getattr(ann, 'url', '')}
        elif ann_type == 'file_citation':
            return {"type": "file", "title": getattr(ann, 'filename', '') or getattr(ann, 'file_id', ''), "file_id": getattr(ann, 'file_id', ''), "filename": getattr(ann, 'filename', '')}
        elif ann_type == 'container_file_citation':
            return {"type": "file", "title": getattr(ann, 'filename', '') or getattr(ann, 'file_id', ''), "file_id": getattr(ann, 'file_id', ''), "filename": getattr(ann, 'filename', ''), "container_id": getattr(ann, 'container_id', '')}
    except Exception as e:
        logger.debug(f"Failed to extract citation from annotation event: {e}")
    return None


def get_credential():
    """Get centralized credential (cached) to avoid Windows file locking."""
    try:
        from common_azure_auth import get_sync_credential
        return get_sync_credential()
    except ImportError:
        return DefaultAzureCredential()


def with_suggested_queries(stream, agent: "GeneralAgent", user_text: str):
    """Guarantee every turn ends with follow-up suggestions.

    The model calls ``suggest_next_queries`` only some of the time (it tends to skip
    it when asked for a brief answer), so fill the gap here instead of relying on
    prompt compliance.

    The model also sometimes calls it mid-answer. Since the client renders blocks in
    arrival order, the event is held back and replayed just before ``done`` so the
    buttons always land after the prose.
    """
    pending_suggestions = None
    text_parts: List[str] = []

    for event_type, data, conv_id in stream:
        if event_type == "suggested_queries":
            pending_suggestions = (event_type, data, conv_id)
            continue
        if event_type == "delta":
            text_parts.append(data or "")
        elif event_type == "message_block":
            try:
                text_parts.append(json.loads(data).get("content", "") or "")
            except Exception:
                pass

        if event_type == "done":
            if pending_suggestions is None:
                answer = "".join(text_parts).strip()
                if answer:
                    queries = agent.generate_next_queries(user_text, answer)
                    if queries:
                        logger.info(f"[suggest_next_queries] filled in {len(queries)} fallback suggestions")
                        pending_suggestions = (
                            "suggested_queries",
                            json.dumps({"type": "suggested_queries", "queries": queries}),
                            conv_id,
                        )
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
                "agent": {
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
        response = self.openai_client.responses.create(
            conversation=conversation_id,
            tool_choice=tool_choice,
            input=user_text,
            extra_body={
                "agent": {
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
    ) -> Generator[Tuple[str, str, Optional[str]], None, None]:
        """
        Handle model output that came as plain text instead of tool calls.

        First tries to parse it as raw JSON tool calls (the model sometimes
        serialises function calls as text). If that fails, emits the text
        as a message_block so the user always sees *something* — except for
        upstream refusals, which are reported as an error instead of being
        rendered as if the tutor had written them.

        No retry nudging — the plan-then-execute prompt strategy should
        prevent plain-text output in the first place.
        """
        if _is_upstream_refusal(plain_text):
            logger.error(
                "[refusal] Upstream refusal returned as plain text (%d chars): %r",
                len(plain_text),
                plain_text[:200],
            )
            yield (
                "error",
                json.dumps({
                    "type": "error",
                    "code": "upstream_refusal",
                    "message": (
                        "The assistant could not complete that response. "
                        "Please rephrase your question or try again."
                    ),
                }),
                conversation_id,
            )
            return

        logger.warning(
            f"Model output plain text ({len(plain_text)} chars) without tool calls. "
            "Attempting raw-JSON parse fallback."
        )

        parsed_calls = _try_parse_raw_function_call(plain_text)
        if parsed_calls:
            for func_name, func_args in parsed_calls:
                logger.info(f"Fallback: parsed raw function call from text: {func_name}")
                if func_name == 'add_message':
                    msg_data = add_message_tool.execute(func_args)
                    yield ("message_block_start", json.dumps({"type": "message_block_start"}), conversation_id)
                    yield ("message_block", json.dumps(msg_data), conversation_id)
                elif func_name == 'add_document':
                    doc_data = add_document_tool.execute(func_args)
                    yield ("document_start", json.dumps({"type": "document_start"}), conversation_id)
                    yield ("document", json.dumps(doc_data), conversation_id)
                elif func_name == 'add_quiz':
                    quiz_data = add_quiz_tool.execute(
                        func_args, agent_name=self.agent_name
                    )
                    yield ("quiz_start", json.dumps({"type": "quiz_start"}), conversation_id)
                    yield ("quiz", json.dumps(quiz_data), conversation_id)
                elif func_name == 'add_flashcard':
                    fc_data = add_flashcard_tool.execute(func_args)
                    yield ("flashcard_start", json.dumps({"type": "flashcard_start"}), conversation_id)
                    yield ("flashcard", json.dumps(fc_data), conversation_id)
                elif func_name == 'add_challenge':
                    ch_data = add_challenge_tool.execute(func_args)
                    yield ("challenge_start", json.dumps({"type": "challenge_start"}), conversation_id)
                    yield ("challenge", json.dumps(ch_data), conversation_id)
                elif func_name == 'add_tikz_diagram':
                    tikz_data = add_tikz_diagram_tool.execute(func_args)
                    yield ("tikz_image_start", json.dumps({"type": "tikz_image_start"}), conversation_id)
                    yield ("tikz_image", json.dumps(tikz_data), conversation_id)
                elif func_name == 'generate_image':
                    # No user_id on this fallback path, so the quota check no-ops here.
                    img_data = generate_image_tool.execute(func_args, agent_name=self.agent_name)
                    yield ("generated_image_start", json.dumps({"type": "generated_image_start"}), conversation_id)
                    yield ("generated_image", json.dumps(img_data), conversation_id)
        else:
            # Genuine plain text — emit as a message so user sees it
            yield ("message_block_start", json.dumps({"type": "message_block_start"}), conversation_id)
            msg_data = {"content": plain_text, "type": "text"}
            yield ("message_block", json.dumps(msg_data), conversation_id)
            logger.info(f"Plain text fallback: emitted as message ({len(plain_text)} chars)")

    # ── Centralized tool dispatch & parallel execution ──────────────────

    def _resolve_clarification(self, result: Dict[str, Any]) -> None:
        """Block for the student's answers so the agent can finish this same turn.

        Must be called only after the tool's ``clarify`` event has been yielded,
        otherwise the client never sees the questions and the wait always times out.
        """
        pending = result.get("await_clarification")
        if not pending:
            return
        result["output"] = ask_clarification_tool.wait_for_answers(
            pending["id"], pending["questions"]
        )

    def _dispatch_tool_call(
        self,
        func_name: str,
        func_args_str: str,
        call_id: str,
        conversation_id: str,
        user_id: str,
    ) -> Dict[str, Any]:
        """
        Execute a single tool call and return a structured result.

        Returns a dict with:
          call_id     – echoed back for tool-output submission
          output      – string to send as function_call_output to the model
          yield_events – list of (event_type, data, conv_id) tuples to yield
          tool_type   – the function name (for tool_types_this_round)
          is_add_message – convenience flag
          plan_data   – populated only for declare_plan (caller must handle)
        """
        result: Dict[str, Any] = {
            "call_id": call_id,
            "output": "",
            "yield_events": [],
            "tool_type": func_name,
            "is_add_message": func_name == "add_message",
            "plan_data": None,
        }

        try:
            args = json.loads(func_args_str) if isinstance(func_args_str, str) else func_args_str

            if func_name == "add_document":
                doc_data = add_document_tool.execute(args)
                result["yield_events"].append(("document", json.dumps(doc_data), conversation_id))
                result["output"] = add_document_tool.output(doc_data, args)
                logger.info(f"add_document tool called: {doc_data.get('title')}")

            elif func_name == "add_message":
                msg_data = add_message_tool.execute(args)
                result["yield_events"].append(("message_block", json.dumps(msg_data), conversation_id))
                result["output"] = add_message_tool.output(msg_data, args)
                logger.info("add_message tool called")

            elif func_name == "add_quiz":
                quiz_data = add_quiz_tool.execute(
                    args, agent_name=self.agent_name, user_id=user_id
                )
                result["yield_events"].append(("quiz", json.dumps(quiz_data), conversation_id))
                result["output"] = add_quiz_tool.output(quiz_data, args)
                logger.info(f"add_quiz tool called: {quiz_data.get('title')}")

            elif func_name == "add_flashcard":
                fc_data = add_flashcard_tool.execute(args)
                result["yield_events"].append(("flashcard", json.dumps(fc_data), conversation_id))
                result["output"] = add_flashcard_tool.output(fc_data, args)
                logger.info(f"add_flashcard tool called: {fc_data.get('title')}")

            elif func_name == "add_challenge":
                ch_data = add_challenge_tool.execute(args)
                result["yield_events"].append(("challenge", json.dumps(ch_data), conversation_id))
                result["output"] = add_challenge_tool.output(ch_data, args)
                logger.info(f"add_challenge tool called: {ch_data.get('title')}")

            elif func_name == "ask_clarification":
                clarify_data = ask_clarification_tool.execute(args)
                # The wait happens in the caller, after this event has been flushed to the client.
                clarify_id = clarification_registry.register()
                clarify_data["clarifyId"] = clarify_id
                result["yield_events"].append(("clarify", json.dumps(clarify_data), conversation_id))
                result["await_clarification"] = {
                    "id": clarify_id,
                    "questions": clarify_data["questions"],
                }
                result["output"] = ask_clarification_tool.output(clarify_data, args)
                logger.info(f"ask_clarification tool called: {len(clarify_data['questions'])} question(s)")

            elif func_name == "suggest_next_queries":
                suggestions_data = suggest_next_queries_tool.execute(args)
                result["yield_events"].append(
                    ("suggested_queries", json.dumps(suggestions_data), conversation_id)
                )
                result["output"] = suggest_next_queries_tool.output(suggestions_data, args)
                logger.info(f"suggest_next_queries tool called: {len(suggestions_data.get('queries', []))}")

            elif func_name == "add_tikz_diagram":
                tikz_data = add_tikz_diagram_tool.execute(args)
                if tikz_data.get("error"):
                    raise RuntimeError(
                        tikz_data.get("caption") or "TikZ diagram generation failed"
                    )
                result["yield_events"].append(("tikz_image", json.dumps(tikz_data), conversation_id))
                result["output"] = add_tikz_diagram_tool.output(tikz_data, args)
                logger.info(f"add_tikz_diagram tool called: {tikz_data.get('title')}")

            elif func_name == "generate_image":
                img_data = generate_image_tool.execute(
                    args, agent_name=self.agent_name, user_id=user_id
                )
                result["yield_events"].append(("generated_image", json.dumps(img_data), conversation_id))
                result["output"] = generate_image_tool.output(img_data, args)
                if img_data.get("error"):
                    logger.warning(f"generate_image FAILED: {img_data.get('caption')}")
                else:
                    logger.info(f"generate_image tool called: {img_data.get('title')}")

            elif func_name == "declare_plan":
                plan_result = declare_plan_tool.execute(args)
                plan_tools = args.get("tools", [])
                if plan_result.get("status") == "accepted" and plan_tools:
                    result["plan_data"] = {"tools": plan_tools, "accepted": True}
                    result["output"] = declare_plan_tool.output(plan_result, args)
                    logger.info(f"Plan declared: {' -> '.join(plan_tools)}")
                else:
                    result["plan_data"] = {"tools": [], "accepted": False}
                    result["output"] = plan_result.get("message", "Just respond normally.")
                    logger.info(f"Plan skipped (status={plan_result.get('status')})")

            elif func_name == "get_threshold_concepts":
                plan_data = get_threshold_concepts_tool.execute(
                    args, agent_name=self.agent_name, user_id=user_id
                )
                plan_output = get_threshold_concepts_tool.output(plan_data, args)
                result["output"] = plan_output
                logger.info(f"get_threshold_concepts for '{self.agent_name}' ({len(plan_output)} chars)")

            elif func_name == "update_topic_progress":
                # ── Fire-and-forget: return immediately, run DB write in background ──
                # The model doesn't need the exact result to compose its response.
                result["output"] = (
                    "Progress update accepted and is being saved in the background. "
                    "Continue with your response to the student."
                )
                # Launch background thread for the actual Cosmos DB write
                _agent_name = self.agent_name
                _user_id = user_id

                def _bg_update_progress(a=args, an=_agent_name, uid=_user_id):
                    try:
                        actual_result = update_topic_progress_tool.execute(
                            a, agent_name=an, user_id=uid
                        )
                        actual_output = update_topic_progress_tool.output(actual_result, a)
                        logger.info(f"Background update_topic_progress completed: {actual_output[:120]}")
                    except Exception as bg_err:
                        logger.error(f"Background update_topic_progress failed: {bg_err}")

                threading.Thread(target=_bg_update_progress, daemon=True).start()
                logger.info(f"update_topic_progress fired-and-forgot for '{self.agent_name}'")

            elif func_name in LOGGING_TOOLS:
                logging_tool = LOGGING_TOOLS[func_name]
                logging_result = logging_tool.execute(args)
                result_str = logging_tool.output(logging_result, args)
                result["output"] = result_str
                logger.info(f"Logging tool '{func_name}' called ({len(result_str)} chars)")

            else:
                logger.info(f"Unknown function call: {func_name}")
                result["output"] = f"Tool '{func_name}' executed successfully."

        except Exception as e:
            logger.error(f"Failed to handle {func_name}: {e}")
            if func_name in BLOCK_TOOLS:
                # The frontend already drew a placeholder card on *_start; tell it to drop it.
                result["yield_events"].append((
                    "block_cancel",
                    json.dumps({"type": "block_cancel", "tool": func_name}),
                    conversation_id,
                ))
                result["output"] = (
                    f"{TOOL_ERROR_PREFIX}{e}\n"
                    "Nothing was shown to the student. Do NOT write this content out as plain "
                    "text in your reply. Either call the tool again with corrected arguments, "
                    "or briefly tell the student it could not be created."
                )
            else:
                result["output"] = f"{TOOL_ERROR_PREFIX}{e}"

        return result

    def _execute_tools_parallel(
        self,
        collected_calls: List[Dict[str, Any]],
        conversation_id: str,
        user_id: str,
    ) -> List[Dict[str, Any]]:
        """
        Execute a batch of tool calls in parallel using ThreadPoolExecutor.

        Args:
            collected_calls: list of dicts with keys 'name', 'args', 'call_id'
            conversation_id: the conversation ID
            user_id: the requesting user, threaded explicitly so concurrent
                requests sharing this cached agent never see each other's id

        Returns:
            List of result dicts from _dispatch_tool_call(), preserving original order.
        """
        if not collected_calls:
            return []

        n = len(collected_calls)
        if n == 1:
            # Single call — no thread overhead
            tc = collected_calls[0]
            return [self._dispatch_tool_call(tc["name"], tc["args"], tc["call_id"], conversation_id, user_id)]

        logger.info(f"Executing {n} tool calls in parallel")
        results: List[Optional[Dict[str, Any]]] = [None] * n

        with concurrent.futures.ThreadPoolExecutor(max_workers=min(n, 6)) as executor:
            future_to_idx = {
                executor.submit(
                    self._dispatch_tool_call,
                    tc["name"], tc["args"], tc["call_id"], conversation_id, user_id,
                ): i
                for i, tc in enumerate(collected_calls)
            }
            for future in concurrent.futures.as_completed(future_to_idx):
                idx = future_to_idx[future]
                try:
                    results[idx] = future.result()
                except Exception as e:
                    tc = collected_calls[idx]
                    logger.error(f"Parallel tool execution failed for {tc['name']}: {e}")
                    results[idx] = {
                        "call_id": tc["call_id"],
                        "output": f"Error: {e}",
                        "yield_events": [],
                        "tool_type": tc["name"],
                        "is_add_message": tc["name"] == "add_message",
                        "plan_data": None,
                    }

        return results  # type: ignore[return-value]

    def start_chat_stream(
        self,
        user_text: str,
        tool_choice: str = "auto",
        user_profile: Optional[Dict[str, Any]] = None,
        web_search_enabled: bool = False,
        image_urls: Optional[list] = None,
        *,
        user_id: str,
    ) -> Generator[Tuple[str, str, Optional[str]], None, None]:
        """
        Start a new conversation with streaming.
        
        Args:
            user_text: The user's message
            tool_choice: Tool choice mode ("auto", "required", "none")
            user_profile: Optional user profile for personalization
            web_search_enabled: If True, retrieves live web evidence before synthesis
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
        # Per-request user id. NEVER read self.user_id below this point: this
        # instance is shared by every student on this agent (see the cache in
        # get_general_agent), so only the local is safe under concurrency.
        if not user_id or not user_id.strip():
            raise ValueError("start_chat_stream requires a non-empty user_id")
        _uid = user_id

        # Create new conversation
        conversation = self.openai_client.conversations.create()
        conversation_id = conversation.id
        logger.info(f"Created conversation: {conversation_id}")
        
        # Yield conversation ID first (using "thread_id" for backward compatibility)
        yield ("thread_id", conversation_id, conversation_id)
        
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
        
        context_messages = []
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
                "content": f"[SYSTEM CONTEXT - Student Profile & Environment] {profile_instructions}",
            })
        if context_messages:
            if isinstance(model_input, list):
                model_input = context_messages + model_input
            else:
                model_input = context_messages + [{"type": "message", "role": "user", "content": model_input}]
        
        # Initialize plan tracking (may be set by declare_plan during streaming)
        execution_plan = []
        plan_index = 0
        
        # Stream the response
        try:
            response_stream = self.openai_client.responses.create(
                conversation=conversation_id,
                tool_choice=tool_choice,
                input=model_input,
                stream=True,
                extra_body={
                    "agent": {
                        "name": self.agent_name,
                        "type": "agent_reference"
                    }
                },
            )
            
            # Track function call arguments being streamed
            current_function_call = {"name": None, "arguments": "", "call_id": None}
            pending_tool_calls = []  # Track tool calls that need outputs submitted
            collected_citations = list(web_citations)  # Track citations from annotations
            citation_keys = {
                f"{citation.get('type')}:{citation.get('url') or citation.get('file_id')}"
                for citation in web_citations
            }
            plain_text_buffer = []  # Buffer plain text - only emit if no function calls
            had_function_calls = False  # Track if model used function calls
            tool_types_this_round = set()  # Track which tool types were called in this round
            tool_sequence_this_round = []  # Track ordered tool sequence for this round
            total_add_message_count = 0  # Count add_message calls across all rounds
            deferred_tool_calls = []  # Collect tool calls for parallel execution
            # ── Token usage tracking ──
            _usage_rounds = []  # Per-round usage: [{round, tools, input_tokens, output_tokens}]
            _usage_totals = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
            _current_round_num = 0
            
            for event in response_stream:
                # Debug: Log all event types
                event_type = getattr(event, 'type', 'unknown')
                logger.debug(f"Stream event: {event_type}")
                
                # Handle different event types from the streaming response
                if hasattr(event, 'type'):
                    if event.type == 'response.output_text.delta':
                        # Buffered, not streamed: real answers reach the UI through the
                        # add_message tool-argument stream, so the only thing arriving here
                        # is anomalous plain text that must be classified before display.
                        delta_text = getattr(event, 'delta', '')
                        if delta_text:
                            plain_text_buffer.append(delta_text)
                    elif event.type == 'response.output_text.annotation.added':
                        # Capture citation annotations as they arrive
                        ann = getattr(event, 'annotation', None)
                        logger.info(f"[CITATION DEBUG start_chat_stream] Annotation event: ann_type={getattr(ann, 'type', 'NONE')}, ann={ann}")
                        citation = _extract_citation_from_annotation_event(event)
                        if citation:
                            key = f"{citation.get('type')}:{citation.get('url') or citation.get('file_id')}"
                            if key not in citation_keys:
                                citation_keys.add(key)
                                collected_citations.append(citation)
                                logger.info(f"Citation captured: {citation.get('title', 'unknown')}")
                        else:
                            logger.warning(f"[CITATION DEBUG] _extract_citation_from_annotation_event returned None")
                    elif event.type == 'response.output_item.added':
                        # New output item started - check if it's a function call
                        if hasattr(event, 'item'):
                            item = event.item
                            if hasattr(item, 'type') and item.type == 'function_call':
                                had_function_calls = True
                                current_function_call["name"] = getattr(item, 'name', None)
                                current_function_call["call_id"] = getattr(item, 'call_id', None) or getattr(item, 'id', None)
                                current_function_call["arguments"] = ""
                                current_function_call["doc_started"] = False
                                current_function_call["title_sent"] = False
                                current_function_call["content_buffer"] = ""
                                logger.info(f"Function call started: {current_function_call['name']}")

                                yield from _tool_start_events(current_function_call["name"], conversation_id)
                    elif event.type == 'response.function_call_arguments.delta':
                        # Accumulate function call arguments
                        if hasattr(event, 'delta') and event.delta:
                            current_function_call["arguments"] += event.delta
                            logger.debug(f"Function args delta: {len(current_function_call['arguments'])} chars")
                            
                            func_name = current_function_call.get("name")
                            args_so_far = current_function_call["arguments"]
                            
                            # Stream document content as it arrives
                            if func_name == "add_document":
                                # Try to extract title if not yet sent
                                if not current_function_call.get("title_sent"):
                                    # Look for "title": "..." pattern
                                    title_match = re.search(r'"title"\s*:\s*"([^"]+)"', args_so_far)
                                    if title_match:
                                        title = title_match.group(1)
                                        yield ("document_title", json.dumps({"type": "document_title", "title": title}), conversation_id)
                                        current_function_call["title_sent"] = True
                                        current_function_call["extracted_title"] = title
                                        logger.info(f"Document title streamed: {title}")
                                
                                # Try to extract content being streamed
                                content_start = args_so_far.find('"content"')
                                if content_start != -1:
                                    quote_start = args_so_far.find('"', content_start + len('"content"') + 1)
                                    if quote_start != -1:
                                        content_raw = args_so_far[quote_start + 1:]
                                        # Strip trailing JSON closure: unescaped " followed by optional } and whitespace
                                        content_raw = re.sub(r'(?<!\\)"[\s}]*$', '', content_raw)
                                        try:
                                            new_content = content_raw
                                            if len(new_content) > len(current_function_call.get("content_buffer", "")):
                                                current_function_call["content_buffer"] = new_content
                                                # Strip trailing backslash (may be start of escape sequence like \n)
                                                safe = new_content[:-1] if new_content.endswith('\\') else new_content
                                                unescaped = safe.replace('\\n', '\n').replace('\\t', '\t').replace('\\"', '"')
                                                prev_unescaped_len = current_function_call.get("unescaped_len", 0)
                                                if len(unescaped) > prev_unescaped_len:
                                                    delta = unescaped[prev_unescaped_len:]
                                                    current_function_call["unescaped_len"] = len(unescaped)
                                                    yield ("document_delta", json.dumps({"type": "document_delta", "delta": delta}), conversation_id)
                                        except Exception as e:
                                            logger.debug(f"Content extraction error: {e}")
                            
                            # Stream message content as it arrives
                            elif func_name == "add_message":
                                # Look for "content": "..." and extract what we have so far
                                content_start = args_so_far.find('"content"')
                                if content_start != -1:
                                    quote_start = args_so_far.find('"', content_start + len('"content"') + 1)
                                    if quote_start != -1:
                                        content_raw = args_so_far[quote_start + 1:]
                                        # Strip trailing JSON closure: unescaped " followed by optional } and whitespace
                                        content_raw = re.sub(r'(?<!\\)"[\s}]*$', '', content_raw)
                                        try:
                                            new_content = content_raw
                                            if len(new_content) > len(current_function_call.get("content_buffer", "")):
                                                current_function_call["content_buffer"] = new_content
                                                # Strip trailing backslash (may be start of escape sequence like \n)
                                                safe = new_content[:-1] if new_content.endswith('\\') else new_content
                                                unescaped = safe.replace('\\n', '\n').replace('\\t', '\t').replace('\\"', '"')
                                                prev_unescaped_len = current_function_call.get("unescaped_len", 0)
                                                if len(unescaped) > prev_unescaped_len:
                                                    delta = unescaped[prev_unescaped_len:]
                                                    current_function_call["unescaped_len"] = len(unescaped)
                                                    yield ("message_block_delta", json.dumps({"type": "message_block_delta", "delta": delta}), conversation_id)
                                        except Exception as e:
                                            logger.debug(f"Message content extraction error: {e}")
                    elif event.type == 'response.function_call_arguments.done':
                        # Function call arguments complete - check which function
                        logger.info(f"Function call args done, total length: {len(current_function_call['arguments'])}")
                    elif event.type == 'response.completed':
                        logger.info("Response completed event received")
                        completed_response = getattr(event, 'response', None)
                        if completed_response:
                            _log_response_completion(completed_response, "start_chat")
                            # ── Extract token usage ──
                            _usage = getattr(completed_response, 'usage', None)
                            if _usage:
                                _r_in = getattr(_usage, 'input_tokens', 0) or 0
                                _r_out = getattr(_usage, 'output_tokens', 0) or 0
                                _current_round_num += 1
                                _usage_rounds.append({"round": _current_round_num, "response_id": getattr(completed_response, "id", None), "tools": list(tool_sequence_this_round), "input_tokens": _r_in, "output_tokens": _r_out})
                                _usage_totals["input_tokens"] += _r_in
                                _usage_totals["output_tokens"] += _r_out
                                _usage_totals["total_tokens"] = _usage_totals["input_tokens"] + _usage_totals["output_tokens"]
                                logger.info(f"[TOKEN USAGE] Round {_current_round_num}: in={_r_in} out={_r_out} tools={list(tool_sequence_this_round)}")
                            # Debug: log response structure to understand citation availability
                            logger.info(f"[CITATION DEBUG] response.completed output items: {len(getattr(completed_response, 'output', []))}")
                            for idx, output_item in enumerate(getattr(completed_response, 'output', None) or []):
                                item_type = getattr(output_item, 'type', 'unknown')
                                logger.info(f"[CITATION DEBUG]   output_item[{idx}] type={item_type}")
                                for content_part in (getattr(output_item, 'content', None) or []):
                                    cp_type = getattr(content_part, 'type', 'unknown')
                                    anns = getattr(content_part, 'annotations', None) or []
                                    logger.info(f"[CITATION DEBUG]     content_part type={cp_type}, annotations_count={len(anns)}")
                                    for ann in anns:
                                        logger.info(f"[CITATION DEBUG]       annotation: type={getattr(ann, 'type', '?')}, attrs={[a for a in dir(ann) if not a.startswith('_')]}")
                            response_citations = _extract_citations_from_response(completed_response)
                            for c in response_citations:
                                key = f"{c.get('type')}:{c.get('url') or c.get('file_id')}"
                                if key not in citation_keys:
                                    citation_keys.add(key)
                                    collected_citations.append(c)
                            if response_citations:
                                logger.info(f"Extracted {len(response_citations)} citations from completed response")
                    elif event.type == 'response.output_item.done':
                        # Output item complete - check if it's a function call
                        logger.info(f"Output item done event received")
                        if hasattr(event, 'item'):
                            item = event.item
                            item_type = getattr(item, 'type', 'unknown')
                            logger.info(f"Output item type: {item_type}")
                            # Check if this is a function call
                            if hasattr(item, 'type') and item.type == 'function_call':
                                had_function_calls = True
                                func_name = getattr(item, 'name', None)
                                func_args = getattr(item, 'arguments', current_function_call["arguments"])
                                call_id = getattr(item, 'call_id', None) or getattr(item, 'id', None)
                                logger.info(f"Function call detected: name={func_name}, call_id={call_id}, args_len={len(func_args) if func_args else 0}")
                                tool_types_this_round.add(func_name)
                                tool_sequence_this_round.append(func_name)
                                if func_name == 'add_message':
                                    total_add_message_count += 1
                                
                                # Defer execution — will run in parallel after stream ends
                                deferred_tool_calls.append({
                                    "name": func_name,
                                    "args": func_args,
                                    "call_id": call_id,
                                })
                                
                                # Reset function call tracker
                                current_function_call = {"name": None, "arguments": "", "call_id": None}
                            elif hasattr(item, 'text'):
                                # Plain text output completed - just log, buffered text emitted post-loop
                                text_content = getattr(item, 'text', '') or ''
                                if text_content:
                                    logger.debug(f"Plain text output_item done: {len(text_content)} chars (buffered)")
                elif hasattr(event, 'output_text') and event.output_text:
                    # Catch-all: buffered only, classified before any display.
                    plain_text_buffer.append(event.output_text)
            
            # Nothing was shown live, so buffered text must be classified here:
            # raw JSON tool calls, an upstream refusal, or genuine prose. Prose is only
            # redundant once add_message has delivered the answer; a turn that called
            # other tools (e.g. ask_clarification) still needs its prose shown.
            if plain_text_buffer:
                full_text = ''.join(plain_text_buffer)
                if full_text.strip():
                    if total_add_message_count == 0:
                        yield from self._handle_plain_text_fallback(conversation_id, full_text)
                    else:
                        logger.info(
                            f"[plain_text] Dropped {len(full_text)} chars of stray prose "
                            f"(add_message={total_add_message_count}, tools={had_function_calls})."
                        )
            
            # Safety net: if stream ended with an unfinished function call, add it to deferred list
            if current_function_call.get("call_id"):
                orphan_id = current_function_call["call_id"]
                orphan_name = current_function_call.get("name", "unknown")
                logger.warning(f"Stream ended with unfinished function call: name={orphan_name}, call_id={orphan_id}")
                deferred_tool_calls.append({
                    "name": orphan_name,
                    "args": current_function_call.get("arguments", "{}"),
                    "call_id": orphan_id,
                })
                tool_types_this_round.add(orphan_name)
                if orphan_name == 'add_message':
                    total_add_message_count += 1
                current_function_call = {"name": None, "arguments": "", "call_id": None}
            
            # ── Execute all deferred tool calls in parallel ──────────────────
            if deferred_tool_calls:
                parallel_results = self._execute_tools_parallel(deferred_tool_calls, conversation_id, _uid)
                for r in parallel_results:
                    for evt in r["yield_events"]:
                        yield evt
                    self._resolve_clarification(r)
                    pending_tool_calls.append({"call_id": r["call_id"], "output": r["output"]})
                    if r["plan_data"] and r["plan_data"]["accepted"]:
                        execution_plan = r["plan_data"]["tools"]
                        plan_index = 0
                deferred_tool_calls = []

            # Submit tool outputs until the model stops issuing tool calls
            tool_round = 0
            if not execution_plan:  # Only init if not already set by declare_plan in initial stream
                execution_plan = []
                plan_index = 0

            while pending_tool_calls:
                # Stop once the round has delivered the whole reply: an add_message-only
                # round, or any round that called a turn-ending tool.
                message_only_round = _round_ends_turn(tool_types_this_round, execution_plan, plan_index, tool_round, total_add_message_count)
                if message_only_round:
                    logger.info("Previous round was add_message-only — submitting outputs and stopping (prevents duplicate response)")
                    tool_outputs = [{"type": "function_call_output", "call_id": tc["call_id"], "output": tc["output"]} for tc in pending_tool_calls]
                    try:
                        self.openai_client.responses.create(
                            conversation=conversation_id, input=tool_outputs, stream=False,
                            extra_body={"agent": {"name": self.agent_name, "type": "agent_reference"}},
                        )
                    except Exception as e:
                        logger.error(f"Error submitting final tool outputs: {e}")
                    break
                
                tool_round += 1
                logger.info(f"Submitting {len(pending_tool_calls)} tool outputs (round {tool_round})")
                tool_outputs = [{"type": "function_call_output", "call_id": tc["call_id"], "output": tc["output"]} for tc in pending_tool_calls]
                pending_tool_calls = []  # Reset for this round
                tool_types_this_round = set()  # Reset tool types for new round
                deferred_tool_calls = []  # Reset deferred tool calls for new round
                tool_sequence_this_round = []  # Reset tool sequence for new round
                
                # Determine tool_choice based on execution plan
                next_tool_choice = tool_choice  # Default
                last_round_failed = any(
                    str(o.get("output", "")).startswith(TOOL_ERROR_PREFIX) for o in tool_outputs
                )
                plan_index = _rewind_failed_plan_step(
                    execution_plan, plan_index, tool_round, last_round_failed
                )
                if execution_plan and plan_index < len(execution_plan):
                    next_tool_name = execution_plan[plan_index]
                    next_tool_choice = {"type": "function", "name": next_tool_name}
                    logger.info(f"Plan step {plan_index + 1}/{len(execution_plan)}: forcing tool_choice={next_tool_name}")
                    plan_index += 1
                elif execution_plan and plan_index >= len(execution_plan):
                    # Plan is complete — allow model to generate a final natural text response
                    next_tool_choice = "none"
                    logger.info(f"Plan complete ({len(execution_plan)} steps) — allowing final text response (tool_choice=none)")

                
                try:
                    followup_stream = self.openai_client.responses.create(
                        conversation=conversation_id, input=tool_outputs, stream=True,
                        tool_choice=next_tool_choice,
                        extra_body={"agent": {"name": self.agent_name, "type": "agent_reference"}},
                    )
                    
                    followup_func = {"name": None, "arguments": "", "call_id": None, "content_buffer": "", "title_sent": False}
                    followup_plain_text_buffer = []
                    followup_had_function_calls = False
                    for event in followup_stream:
                        if hasattr(event, 'type'):
                            if event.type == 'response.output_text.delta':
                                # Buffered, not streamed: real answers arrive via the
                                # add_message tool-argument stream, so anything here is
                                # anomalous text that must be classified before display.
                                delta_text = getattr(event, 'delta', '')
                                if delta_text:
                                    followup_plain_text_buffer.append(delta_text)
                            elif event.type == 'response.output_item.added':
                                if hasattr(event, 'item') and hasattr(event.item, 'type') and event.item.type == 'function_call':
                                    followup_had_function_calls = True
                                    followup_func = {"name": getattr(event.item, 'name', None), "call_id": getattr(event.item, 'call_id', None) or getattr(event.item, 'id', None), "arguments": "", "content_buffer": ""}
                                    yield from _tool_start_events(followup_func["name"], conversation_id)
                            elif event.type == 'response.function_call_arguments.delta':
                                if hasattr(event, 'delta') and event.delta:
                                    followup_func["arguments"] += event.delta
                                    func_name = followup_func.get("name")
                                    args_so_far = followup_func["arguments"]

                                    if func_name == "add_document":
                                        if not followup_func.get("title_sent"):
                                            title_match = re.search(r'"title"\s*:\s*"([^"]+)"', args_so_far)
                                            if title_match:
                                                title = title_match.group(1)
                                                yield ("document_title", json.dumps({"type": "document_title", "title": title}), conversation_id)
                                                followup_func["title_sent"] = True
                                                logger.info(f"Followup document title streamed: {title}")

                                        content_start = args_so_far.find('"content"')
                                        if content_start != -1:
                                            quote_start = args_so_far.find('"', content_start + len('"content"') + 1)
                                            if quote_start != -1:
                                                content_raw = args_so_far[quote_start + 1:]
                                                content_raw = re.sub(r'(?<!\\)"[\s}]*$', '', content_raw)
                                                if len(content_raw) > len(followup_func.get("content_buffer", "")):
                                                    followup_func["content_buffer"] = content_raw
                                                    safe = content_raw[:-1] if content_raw.endswith('\\') else content_raw
                                                    unescaped = safe.replace('\\n', '\n').replace('\\t', '\t').replace('\\"', '"')
                                                    prev_unescaped_len = followup_func.get("unescaped_len", 0)
                                                    if len(unescaped) > prev_unescaped_len:
                                                        delta = unescaped[prev_unescaped_len:]
                                                        followup_func["unescaped_len"] = len(unescaped)
                                                        yield ("document_delta", json.dumps({"type": "document_delta", "delta": delta}), conversation_id)

                                    elif func_name == "add_message":
                                        content_start = args_so_far.find('"content"')
                                        if content_start != -1:
                                            quote_start = args_so_far.find('"', content_start + len('"content"') + 1)
                                            if quote_start != -1:
                                                content_raw = args_so_far[quote_start + 1:]
                                                content_raw = re.sub(r'(?<!\\)"[\s}]*$', '', content_raw)
                                                if len(content_raw) > len(followup_func.get("content_buffer", "")):
                                                    followup_func["content_buffer"] = content_raw
                                                    safe = content_raw[:-1] if content_raw.endswith('\\') else content_raw
                                                    unescaped = safe.replace('\\n', '\n').replace('\\t', '\t').replace('\\"', '"')
                                                    prev_unescaped_len = followup_func.get("unescaped_len", 0)
                                                    if len(unescaped) > prev_unescaped_len:
                                                        delta = unescaped[prev_unescaped_len:]
                                                        followup_func["unescaped_len"] = len(unescaped)
                                                        yield ("message_block_delta", json.dumps({"type": "message_block_delta", "delta": delta}), conversation_id)
                            elif event.type == 'response.output_item.done':
                                if hasattr(event, 'item') and hasattr(event.item, 'type') and event.item.type == 'function_call':
                                    func_name = getattr(event.item, 'name', None)
                                    func_args = getattr(event.item, 'arguments', followup_func["arguments"])
                                    call_id = getattr(event.item, 'call_id', None) or getattr(event.item, 'id', None)
                                    tool_types_this_round.add(func_name)
                                    tool_sequence_this_round.append(func_name)
                                    if func_name == 'add_message':
                                        total_add_message_count += 1
                                    # Defer execution — will run in parallel after followup stream ends
                                    deferred_tool_calls.append({
                                        "name": func_name,
                                        "args": func_args,
                                        "call_id": call_id,
                                    })
                                    followup_func = {"name": None, "arguments": "", "call_id": None, "content_buffer": "", "title_sent": False}
                            elif event.type == 'response.completed':
                                # ── Extract token usage from followup round ──
                                completed_response = getattr(event, 'response', None)
                                if completed_response:
                                    _log_response_completion(completed_response, "start_chat.followup")
                                    _usage = getattr(completed_response, 'usage', None)
                                    if _usage:
                                        _r_in = getattr(_usage, 'input_tokens', 0) or 0
                                        _r_out = getattr(_usage, 'output_tokens', 0) or 0
                                        _current_round_num += 1
                                        _usage_rounds.append({"round": _current_round_num, "response_id": getattr(completed_response, "id", None), "tools": list(tool_sequence_this_round), "input_tokens": _r_in, "output_tokens": _r_out})
                                        _usage_totals["input_tokens"] += _r_in
                                        _usage_totals["output_tokens"] += _r_out
                                        _usage_totals["total_tokens"] = _usage_totals["input_tokens"] + _usage_totals["output_tokens"]
                                        logger.info(f"[TOKEN USAGE] Followup round {_current_round_num}: in={_r_in} out={_r_out} tools={list(tool_sequence_this_round)}")
                                    # Also extract citations from followup
                                    response_citations = _extract_citations_from_response(completed_response)
                                    for c in response_citations:
                                        key = f"{c.get('type')}:{c.get('url') or c.get('file_id')}"
                                        if key not in citation_keys:
                                            citation_keys.add(key)
                                            collected_citations.append(c)
                            elif hasattr(event, 'item') and hasattr(event.item, 'text'):
                                # Plain text output completed in followup - just log
                                text_content = getattr(event.item, 'text', '') or ''
                                if text_content:
                                    logger.debug(f"Followup plain text output_item done: {len(text_content)} chars")
                        elif hasattr(event, 'output_text') and event.output_text:
                            followup_plain_text_buffer.append(event.output_text)
                    
                    # Nothing was shown live, so buffered text must be classified here:
                    # raw JSON tool calls, an upstream refusal, or genuine prose. Prose is only
                    # redundant once add_message has delivered the answer; a turn that called
                    # other tools (e.g. ask_clarification) still needs its prose shown.
                    if followup_plain_text_buffer:
                        full_text = ''.join(followup_plain_text_buffer)
                        if full_text.strip() and total_add_message_count == 0:
                            yield from self._handle_plain_text_fallback(conversation_id, full_text)
                            if not followup_had_function_calls:
                                pending_tool_calls = []  # Stop the tool-output loop
                                break
                        elif full_text.strip():
                            logger.info(
                                f"[plain_text] Dropped {len(full_text)} chars of stray followup prose "
                                f"(add_message={total_add_message_count})."
                            )
                    
                    # Safety net: flush any unfinished followup function call
                    if followup_func.get("call_id"):
                        orphan_id = followup_func["call_id"]
                        orphan_name = followup_func.get("name", "unknown")
                        logger.warning(f"Followup stream ended with unfinished function call: name={orphan_name}, call_id={orphan_id}")
                        deferred_tool_calls.append({
                            "name": orphan_name,
                            "args": followup_func.get("arguments", "{}"),
                            "call_id": orphan_id,
                        })
                        tool_types_this_round.add(orphan_name)
                        if orphan_name == 'add_message':
                            total_add_message_count += 1
                        followup_func = {"name": None, "arguments": "", "call_id": None, "content_buffer": "", "title_sent": False}
                    
                    # ── Execute all deferred followup tool calls in parallel ──
                    if deferred_tool_calls:
                        parallel_results = self._execute_tools_parallel(deferred_tool_calls, conversation_id, _uid)
                        for r in parallel_results:
                            for evt in r["yield_events"]:
                                yield evt
                            self._resolve_clarification(r)
                            pending_tool_calls.append({"call_id": r["call_id"], "output": r["output"]})
                            if r["plan_data"] and r["plan_data"]["accepted"]:
                                execution_plan = r["plan_data"]["tools"]
                                plan_index = 0
                        deferred_tool_calls = []
                except Exception as e:
                    logger.error(f"Error submitting tool outputs: {e}")
                    break
            
            # Yield citations if any were collected
            logger.info(f"[CITATION DEBUG start_chat_stream] Total collected_citations={len(collected_citations)}, data={collected_citations}")
            if collected_citations:
                logger.info(f"Yielding {len(collected_citations)} citations")
                yield ("citations", json.dumps(collected_citations), conversation_id)
            else:
                logger.warning(f"[CITATION DEBUG start_chat_stream] No citations collected at end of stream")
            
            # ── Yield accumulated token usage ──
            if _usage_rounds:
                _usage_payload = {
                    "input_tokens": _usage_totals["input_tokens"],
                    "output_tokens": _usage_totals["output_tokens"],
                    "total_tokens": _usage_totals["total_tokens"],
                    "rounds": len(_usage_rounds),
                    "per_round": _usage_rounds,
                }
                logger.info(f"[TOKEN USAGE] Total: {_usage_totals['total_tokens']} tokens across {len(_usage_rounds)} rounds")
                yield ("usage", json.dumps(_usage_payload), conversation_id)
            
            yield ("done", "", conversation_id)
            
        except Exception as e:
            logger.error(f"Streaming error: {e}")
            yield ("error", str(e), conversation_id)

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
    ) -> Generator[Tuple[str, str, Optional[str]], None, None]:
        """
        Continue an existing conversation with streaming.
        
        Args:
            conversation_id: The existing conversation ID
            user_text: The user's message
            tool_choice: Tool choice mode ("auto", "required", "none")
            user_profile: Optional user profile for personalization
            web_search_enabled: If True, retrieves live web evidence before synthesis
            user_id: Required, keyword-only. Identifies the student whose learning
                state the tools read and write. Callers must validate it before
                reaching here; an empty value would silently corrupt progress data.
        
        Yields:
            Tuples of (event_type, data, conversation_id):
            - ("delta", text_chunk, conversation_id) - Text chunks as they arrive
            - ("done", "", conversation_id) - Final signal
            - ("error", error_message, conversation_id) - Error occurred
        """
        # Per-request user id. NEVER read self.user_id below this point: this
        # instance is shared by every student on this agent (see the cache in
        # get_general_agent), so only the local is safe under concurrency.
        if not user_id or not user_id.strip():
            raise ValueError("continue_chat_stream requires a non-empty user_id")
        _uid = user_id

        logger.info(f"Continuing conversation: {scrub(conversation_id)}")

        web_context, web_citations = (
            self._get_live_web_context(user_text)
            if _should_retrieve_live_web(user_text, web_search_enabled)
            else (None, [])
        )
        
        message_text = user_text
        
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
            logger.info(f"Including {len(image_urls)} image(s) in continued conversation")
        else:
            model_input = message_text
        
        # Build user context from profile + institute/department research.
        profile_instructions = (
            _profile_research_instructions(user_profile) if user_profile else None
        )
        if _is_greeting_only(user_text):
            profile_instructions = " ".join(
                part for part in (profile_instructions, _GREETING_RESPONSE_RULE) if part
            )
        if profile_instructions:
            logger.info("Injecting user context into conversation")
        
        context_messages = []
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
                "content": f"[SYSTEM CONTEXT - Student Profile & Environment] {profile_instructions}",
            })
        if context_messages:
            if isinstance(model_input, list):
                model_input = context_messages + model_input
            else:
                model_input = context_messages + [{"type": "message", "role": "user", "content": model_input}]
        
        # Initialize plan tracking (may be set by declare_plan during streaming)
        execution_plan = []
        plan_index = 0
        
        # Stream the response
        try:
            # Retry loop to handle stale/unresolved function calls from previous turns
            response_stream = None
            max_stale_retries = 5
            for _stale_attempt in range(max_stale_retries):
                try:
                    response_stream = self.openai_client.responses.create(
                        conversation=conversation_id,
                        tool_choice=tool_choice,
                        input=model_input,
                        stream=True,
                        extra_body={
                            "agent": {
                                "name": self.agent_name,
                                "type": "agent_reference"
                            }
                        },
                    )
                    break  # Success - no stale calls
                except Exception as stale_err:
                    error_str = str(stale_err)
                    if '400' in error_str and 'No tool output found for function call' in error_str:
                        # Extract the stale call_id and submit a dummy tool output
                        stale_match = re.search(r'function call (call_\w+)', error_str)
                        if stale_match:
                            stale_call_id = stale_match.group(1)
                            logger.warning(f"Stale function call detected: {stale_call_id}, submitting dummy output (attempt {_stale_attempt + 1})")
                            try:
                                self.openai_client.responses.create(
                                    conversation=conversation_id,
                                    input=[{"type": "function_call_output", "call_id": stale_call_id, "output": "Tool execution completed (recovered from stale state)."}],
                                    stream=False,
                                    extra_body={"agent": {"name": self.agent_name, "type": "agent_reference"}},
                                )
                            except Exception as resolve_err:
                                logger.error(f"Failed to resolve stale function call {stale_call_id}: {resolve_err}")
                            continue  # Retry the original request
                    raise  # Re-raise non-stale errors
            
            if response_stream is None:
                raise Exception("Failed to create response stream after resolving stale function calls")
            
            # Track function call arguments being streamed
            current_function_call = {"name": None, "arguments": "", "call_id": None}
            pending_tool_calls = []  # Track tool calls that need outputs submitted
            collected_citations = list(web_citations)  # Track citations from annotations
            citation_keys = {
                f"{citation.get('type')}:{citation.get('url') or citation.get('file_id')}"
                for citation in web_citations
            }
            plain_text_buffer = []  # Buffer plain text - only emit if no function calls
            had_function_calls = False  # Track if model used function calls
            tool_types_this_round = set()  # Track which tool types were called in this round
            tool_sequence_this_round = []  # Track ordered tool sequence for this round
            total_add_message_count = 0  # Count add_message calls across all rounds
            deferred_tool_calls = []  # Collect tool calls for parallel execution
            # ── Token usage tracking ──
            _usage_rounds = []  # Per-round usage: [{round, tools, input_tokens, output_tokens}]
            _usage_totals = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
            _current_round_num = 0
            
            for event in response_stream:
                if hasattr(event, 'type'):
                    if event.type == 'response.output_text.delta':
                        # Buffered, not streamed: real answers reach the UI through the
                        # add_message tool-argument stream, so the only thing arriving here
                        # is anomalous plain text that must be classified before display.
                        delta_text = getattr(event, 'delta', '')
                        if delta_text:
                            plain_text_buffer.append(delta_text)
                    elif event.type == 'response.output_text.annotation.added':
                        # Capture citation annotations as they arrive
                        ann = getattr(event, 'annotation', None)
                        logger.info(f"[CITATION DEBUG continue_chat_stream] Annotation event: ann_type={getattr(ann, 'type', 'NONE')}, ann={ann}")
                        citation = _extract_citation_from_annotation_event(event)
                        if citation:
                            key = f"{citation.get('type')}:{citation.get('url') or citation.get('file_id')}"
                            if key not in citation_keys:
                                citation_keys.add(key)
                                collected_citations.append(citation)
                                logger.info(f"Citation captured: {citation.get('title', 'unknown')}")
                        else:
                            logger.warning(f"[CITATION DEBUG continue_chat_stream] _extract_citation_from_annotation_event returned None")
                    elif event.type == 'response.output_item.added':
                        # New output item started - check if it's a function call
                        if hasattr(event, 'item'):
                            item = event.item
                            if hasattr(item, 'type') and item.type == 'function_call':
                                had_function_calls = True
                                current_function_call["name"] = getattr(item, 'name', None)
                                current_function_call["call_id"] = getattr(item, 'call_id', None) or getattr(item, 'id', None)
                                current_function_call["arguments"] = ""
                                current_function_call["doc_started"] = False
                                current_function_call["title_sent"] = False
                                current_function_call["content_buffer"] = ""
                                logger.info(f"Function call started: {current_function_call['name']}")

                                yield from _tool_start_events(current_function_call["name"], conversation_id)
                    elif event.type == 'response.function_call_arguments.delta':
                        # Accumulate function call arguments
                        if hasattr(event, 'delta') and event.delta:
                            current_function_call["arguments"] += event.delta
                            logger.debug(f"Function args delta: {len(current_function_call['arguments'])} chars")
                            
                            func_name = current_function_call.get("name")
                            args_so_far = current_function_call["arguments"]
                            
                            # Stream document content as it arrives
                            if func_name == "add_document":
                                # Try to extract title if not yet sent
                                if not current_function_call.get("title_sent"):
                                    # Look for "title": "..." pattern
                                    title_match = re.search(r'"title"\s*:\s*"([^"]+)"', args_so_far)
                                    if title_match:
                                        title = title_match.group(1)
                                        yield ("document_title", json.dumps({"type": "document_title", "title": title}), conversation_id)
                                        current_function_call["title_sent"] = True
                                        current_function_call["extracted_title"] = title
                                        logger.info(f"Document title streamed: {title}")
                                
                                # Try to extract content being streamed
                                content_start = args_so_far.find('"content"')
                                if content_start != -1:
                                    quote_start = args_so_far.find('"', content_start + len('"content"') + 1)
                                    if quote_start != -1:
                                        content_raw = args_so_far[quote_start + 1:]
                                        # Strip trailing JSON closure: unescaped " followed by optional } and whitespace
                                        content_raw = re.sub(r'(?<!\\)"[\s}]*$', '', content_raw)
                                        try:
                                            new_content = content_raw
                                            if len(new_content) > len(current_function_call.get("content_buffer", "")):
                                                current_function_call["content_buffer"] = new_content
                                                # Strip trailing backslash (may be start of escape sequence like \n)
                                                safe = new_content[:-1] if new_content.endswith('\\') else new_content
                                                unescaped = safe.replace('\\n', '\n').replace('\\t', '\t').replace('\\"', '"')
                                                prev_unescaped_len = current_function_call.get("unescaped_len", 0)
                                                if len(unescaped) > prev_unescaped_len:
                                                    delta = unescaped[prev_unescaped_len:]
                                                    current_function_call["unescaped_len"] = len(unescaped)
                                                    yield ("document_delta", json.dumps({"type": "document_delta", "delta": delta}), conversation_id)
                                        except Exception as e:
                                            logger.debug(f"Content extraction error: {e}")
                            
                            # Stream message content as it arrives
                            elif func_name == "add_message":
                                # Look for "content": "..." and extract what we have so far
                                content_start = args_so_far.find('"content"')
                                if content_start != -1:
                                    quote_start = args_so_far.find('"', content_start + len('"content"') + 1)
                                    if quote_start != -1:
                                        content_raw = args_so_far[quote_start + 1:]
                                        # Strip trailing JSON closure: unescaped " followed by optional } and whitespace
                                        content_raw = re.sub(r'(?<!\\)"[\s}]*$', '', content_raw)
                                        try:
                                            new_content = content_raw
                                            if len(new_content) > len(current_function_call.get("content_buffer", "")):
                                                current_function_call["content_buffer"] = new_content
                                                # Strip trailing backslash (may be start of escape sequence like \n)
                                                safe = new_content[:-1] if new_content.endswith('\\') else new_content
                                                unescaped = safe.replace('\\n', '\n').replace('\\t', '\t').replace('\\"', '"')
                                                prev_unescaped_len = current_function_call.get("unescaped_len", 0)
                                                if len(unescaped) > prev_unescaped_len:
                                                    delta = unescaped[prev_unescaped_len:]
                                                    current_function_call["unescaped_len"] = len(unescaped)
                                                    yield ("message_block_delta", json.dumps({"type": "message_block_delta", "delta": delta}), conversation_id)
                                        except Exception as e:
                                            logger.debug(f"Message content extraction error: {e}")
                    elif event.type == 'response.function_call_arguments.done':
                        # Function call arguments complete - check which function
                        logger.info(f"Function call args done, total length: {len(current_function_call['arguments'])}")
                    elif event.type == 'response.completed':
                        logger.info("Response completed event received (continue_chat)")
                        completed_response = getattr(event, 'response', None)
                        if completed_response:
                            _log_response_completion(completed_response, "continue_chat")
                            # ── Extract token usage ──
                            _usage = getattr(completed_response, 'usage', None)
                            if _usage:
                                _r_in = getattr(_usage, 'input_tokens', 0) or 0
                                _r_out = getattr(_usage, 'output_tokens', 0) or 0
                                _current_round_num += 1
                                _usage_rounds.append({"round": _current_round_num, "response_id": getattr(completed_response, "id", None), "tools": list(tool_sequence_this_round), "input_tokens": _r_in, "output_tokens": _r_out})
                                _usage_totals["input_tokens"] += _r_in
                                _usage_totals["output_tokens"] += _r_out
                                _usage_totals["total_tokens"] = _usage_totals["input_tokens"] + _usage_totals["output_tokens"]
                                logger.info(f"[TOKEN USAGE] Round {_current_round_num}: in={_r_in} out={_r_out} tools={list(tool_sequence_this_round)}")
                            response_citations = _extract_citations_from_response(completed_response)
                            for c in response_citations:
                                key = f"{c.get('type')}:{c.get('url') or c.get('file_id')}"
                                if key not in citation_keys:
                                    citation_keys.add(key)
                                    collected_citations.append(c)
                            if response_citations:
                                logger.info(f"Extracted {len(response_citations)} citations from completed response")
                    elif event.type == 'response.output_item.done':
                        if hasattr(event, 'item'):
                            item = event.item
                            # Check if this is a function call
                            if hasattr(item, 'type') and item.type == 'function_call':
                                had_function_calls = True
                                func_name = getattr(item, 'name', None)
                                func_args = getattr(item, 'arguments', current_function_call["arguments"])
                                call_id = getattr(item, 'call_id', None) or getattr(item, 'id', None)
                                logger.info(f"Function call detected: name={func_name}, call_id={call_id}")
                                tool_types_this_round.add(func_name)
                                tool_sequence_this_round.append(func_name)
                                if func_name == 'add_message':
                                    total_add_message_count += 1
                                
                                # Defer execution — will run in parallel after stream ends
                                deferred_tool_calls.append({
                                    "name": func_name,
                                    "args": func_args,
                                    "call_id": call_id,
                                })
                                
                                # Reset function call tracker
                                current_function_call = {"name": None, "arguments": "", "call_id": None}
                            elif hasattr(item, 'text'):
                                # Plain text output completed - just log, buffered text emitted post-loop
                                text_content = getattr(item, 'text', '') or ''
                                if text_content:
                                    logger.debug(f"Plain text output_item done: {len(text_content)} chars")
                elif hasattr(event, 'output_text') and event.output_text:
                    # Catch-all: buffered only, classified before any display.
                    plain_text_buffer.append(event.output_text)
            
            # Nothing was shown live, so buffered text must be classified here:
            # raw JSON tool calls, an upstream refusal, or genuine prose. Prose is only
            # redundant once add_message has delivered the answer; a turn that called
            # other tools (e.g. ask_clarification) still needs its prose shown.
            if plain_text_buffer:
                full_text = ''.join(plain_text_buffer)
                if full_text.strip():
                    if total_add_message_count == 0:
                        yield from self._handle_plain_text_fallback(conversation_id, full_text)
                    else:
                        logger.info(
                            f"[plain_text] Dropped {len(full_text)} chars of stray prose "
                            f"(add_message={total_add_message_count}, tools={had_function_calls})."
                        )
            
            # Safety net: if stream ended with an unfinished function call, add it to deferred list
            if current_function_call.get("call_id"):
                orphan_id = current_function_call["call_id"]
                orphan_name = current_function_call.get("name", "unknown")
                logger.warning(f"Stream ended with unfinished function call: name={orphan_name}, call_id={orphan_id}")
                deferred_tool_calls.append({
                    "name": orphan_name,
                    "args": current_function_call.get("arguments", "{}"),
                    "call_id": orphan_id,
                })
                tool_types_this_round.add(orphan_name)
                if orphan_name == 'add_message':
                    total_add_message_count += 1
                current_function_call = {"name": None, "arguments": "", "call_id": None}
            
            # ── Execute all deferred tool calls in parallel ──────────────────
            if deferred_tool_calls:
                parallel_results = self._execute_tools_parallel(deferred_tool_calls, conversation_id, _uid)
                for r in parallel_results:
                    for evt in r["yield_events"]:
                        yield evt
                    self._resolve_clarification(r)
                    pending_tool_calls.append({"call_id": r["call_id"], "output": r["output"]})
                    if r["plan_data"] and r["plan_data"]["accepted"]:
                        execution_plan = r["plan_data"]["tools"]
                        plan_index = 0
                deferred_tool_calls = []

            # Submit tool outputs until the model stops issuing tool calls
            tool_round = 0
            if not execution_plan:  # Only init if not already set by declare_plan in initial stream
                execution_plan = []
                plan_index = 0

            while pending_tool_calls:
                # Stop once the round has delivered the whole reply: an add_message-only
                # round, or any round that called a turn-ending tool.
                message_only_round = _round_ends_turn(tool_types_this_round, execution_plan, plan_index, tool_round, total_add_message_count)
                if message_only_round:
                    logger.info("Previous round was add_message-only — submitting outputs and stopping (prevents duplicate response)")
                    tool_outputs = [{"type": "function_call_output", "call_id": tc["call_id"], "output": tc["output"]} for tc in pending_tool_calls]
                    try:
                        self.openai_client.responses.create(
                            conversation=conversation_id, input=tool_outputs, stream=False,
                            extra_body={"agent": {"name": self.agent_name, "type": "agent_reference"}},
                        )
                    except Exception as e:
                        logger.error(f"Error submitting final tool outputs: {e}")
                    break
                
                tool_round += 1
                logger.info(f"Submitting {len(pending_tool_calls)} tool outputs (round {tool_round})")
                tool_outputs = [{"type": "function_call_output", "call_id": tc["call_id"], "output": tc["output"]} for tc in pending_tool_calls]
                pending_tool_calls = []  # Reset for this round
                tool_types_this_round = set()  # Reset tool types for new round
                deferred_tool_calls = []  # Reset deferred tool calls for new round
                tool_sequence_this_round = []  # Reset tool sequence for new round
                
                # Determine tool_choice based on execution plan
                next_tool_choice = tool_choice  # Default
                last_round_failed = any(
                    str(o.get("output", "")).startswith(TOOL_ERROR_PREFIX) for o in tool_outputs
                )
                plan_index = _rewind_failed_plan_step(
                    execution_plan, plan_index, tool_round, last_round_failed
                )
                if execution_plan and plan_index < len(execution_plan):
                    next_tool_name = execution_plan[plan_index]
                    next_tool_choice = {"type": "function", "name": next_tool_name}
                    logger.info(f"Plan step {plan_index + 1}/{len(execution_plan)}: forcing tool_choice={next_tool_name}")
                    plan_index += 1
                elif execution_plan and plan_index >= len(execution_plan):
                    # Plan is complete — allow model to generate a final natural text response
                    next_tool_choice = "none"
                    logger.info(f"Plan complete ({len(execution_plan)} steps) — allowing final text response (tool_choice=none)")

                
                try:
                    followup_stream = self.openai_client.responses.create(
                        conversation=conversation_id, input=tool_outputs, stream=True,
                        tool_choice=next_tool_choice,
                        extra_body={"agent": {"name": self.agent_name, "type": "agent_reference"}},
                    )
                    
                    followup_func = {"name": None, "arguments": "", "call_id": None, "content_buffer": "", "title_sent": False}
                    followup_plain_text_buffer = []
                    followup_had_function_calls = False
                    for event in followup_stream:
                        if hasattr(event, 'type'):
                            if event.type == 'response.output_text.delta':
                                # Buffered, not streamed: real answers arrive via the
                                # add_message tool-argument stream, so anything here is
                                # anomalous text that must be classified before display.
                                delta_text = getattr(event, 'delta', '')
                                if delta_text:
                                    followup_plain_text_buffer.append(delta_text)
                            elif event.type == 'response.output_item.added':
                                if hasattr(event, 'item') and hasattr(event.item, 'type') and event.item.type == 'function_call':
                                    followup_had_function_calls = True
                                    followup_func = {"name": getattr(event.item, 'name', None), "call_id": getattr(event.item, 'call_id', None) or getattr(event.item, 'id', None), "arguments": "", "content_buffer": ""}
                                    yield from _tool_start_events(followup_func["name"], conversation_id)
                            elif event.type == 'response.function_call_arguments.delta':
                                if hasattr(event, 'delta') and event.delta:
                                    followup_func["arguments"] += event.delta
                                    func_name = followup_func.get("name")
                                    args_so_far = followup_func["arguments"]

                                    if func_name == "add_document":
                                        # Extract title early if not yet sent
                                        if not followup_func.get("title_sent"):
                                            title_match = re.search(r'"title"\s*:\s*"([^"]+)"', args_so_far)
                                            if title_match:
                                                title = title_match.group(1)
                                                yield ("document_title", json.dumps({"type": "document_title", "title": title}), conversation_id)
                                                followup_func["title_sent"] = True
                                                logger.info(f"Followup document title streamed: {title}")

                                        # Extract content deltas
                                        content_start = args_so_far.find('"content"')
                                        if content_start != -1:
                                            quote_start = args_so_far.find('"', content_start + len('"content"') + 1)
                                            if quote_start != -1:
                                                content_raw = args_so_far[quote_start + 1:]
                                                # Strip trailing JSON closure: unescaped " followed by optional } and whitespace
                                                content_raw = re.sub(r'(?<!\\)"[\s}]*$', '', content_raw)
                                                if len(content_raw) > len(followup_func.get("content_buffer", "")):
                                                    followup_func["content_buffer"] = content_raw
                                                    # Strip trailing backslash (may be start of escape sequence like \n)
                                                    safe = content_raw[:-1] if content_raw.endswith('\\') else content_raw
                                                    unescaped = safe.replace('\\n', '\n').replace('\\t', '\t').replace('\\"', '"')
                                                    prev_unescaped_len = followup_func.get("unescaped_len", 0)
                                                    if len(unescaped) > prev_unescaped_len:
                                                        delta = unescaped[prev_unescaped_len:]
                                                        followup_func["unescaped_len"] = len(unescaped)
                                                        yield ("document_delta", json.dumps({"type": "document_delta", "delta": delta}), conversation_id)

                                    elif func_name == "add_message":
                                        content_start = args_so_far.find('"content"')
                                        if content_start != -1:
                                            quote_start = args_so_far.find('"', content_start + len('"content"') + 1)
                                            if quote_start != -1:
                                                content_raw = args_so_far[quote_start + 1:]
                                                # Strip trailing JSON closure: unescaped " followed by optional } and whitespace
                                                content_raw = re.sub(r'(?<!\\)"[\s}]*$', '', content_raw)
                                                if len(content_raw) > len(followup_func.get("content_buffer", "")):
                                                    followup_func["content_buffer"] = content_raw
                                                    # Strip trailing backslash (may be start of escape sequence like \n)
                                                    safe = content_raw[:-1] if content_raw.endswith('\\') else content_raw
                                                    unescaped = safe.replace('\\n', '\n').replace('\\t', '\t').replace('\\"', '"')
                                                    prev_unescaped_len = followup_func.get("unescaped_len", 0)
                                                    if len(unescaped) > prev_unescaped_len:
                                                        delta = unescaped[prev_unescaped_len:]
                                                        followup_func["unescaped_len"] = len(unescaped)
                                                        yield ("message_block_delta", json.dumps({"type": "message_block_delta", "delta": delta}), conversation_id)
                            elif event.type == 'response.output_item.done':
                                if hasattr(event, 'item') and hasattr(event.item, 'type') and event.item.type == 'function_call':
                                    func_name = getattr(event.item, 'name', None)
                                    func_args = getattr(event.item, 'arguments', followup_func["arguments"])
                                    call_id = getattr(event.item, 'call_id', None) or getattr(event.item, 'id', None)
                                    tool_types_this_round.add(func_name)
                                    tool_sequence_this_round.append(func_name)
                                    if func_name == 'add_message':
                                        total_add_message_count += 1
                                    # Defer for parallel execution after stream ends
                                    deferred_tool_calls.append({"name": func_name, "args": func_args, "call_id": call_id})
                                    followup_func = {"name": None, "arguments": "", "call_id": None, "content_buffer": "", "title_sent": False}
                            elif event.type == 'response.completed':
                                # ── Extract token usage from followup round ──
                                completed_response = getattr(event, 'response', None)
                                if completed_response:
                                    _log_response_completion(completed_response, "continue_chat.followup")
                                    _usage = getattr(completed_response, 'usage', None)
                                    if _usage:
                                        _r_in = getattr(_usage, 'input_tokens', 0) or 0
                                        _r_out = getattr(_usage, 'output_tokens', 0) or 0
                                        _current_round_num += 1
                                        _usage_rounds.append({"round": _current_round_num, "response_id": getattr(completed_response, "id", None), "tools": list(tool_sequence_this_round), "input_tokens": _r_in, "output_tokens": _r_out})
                                        _usage_totals["input_tokens"] += _r_in
                                        _usage_totals["output_tokens"] += _r_out
                                        _usage_totals["total_tokens"] = _usage_totals["input_tokens"] + _usage_totals["output_tokens"]
                                        logger.info(f"[TOKEN USAGE] Followup round {_current_round_num}: in={_r_in} out={_r_out} tools={list(tool_sequence_this_round)}")
                                    # Also extract citations from followup
                                    response_citations = _extract_citations_from_response(completed_response)
                                    for c in response_citations:
                                        key = f"{c.get('type')}:{c.get('url') or c.get('file_id')}"
                                        if key not in citation_keys:
                                            citation_keys.add(key)
                                            collected_citations.append(c)
                            elif hasattr(event, 'item') and hasattr(event.item, 'text'):
                                # Plain text output completed in followup - just log
                                text_content = getattr(event.item, 'text', '') or ''
                                if text_content:
                                    logger.debug(f"Followup plain text output_item done: {len(text_content)} chars")
                        elif hasattr(event, 'output_text') and event.output_text:
                            followup_plain_text_buffer.append(event.output_text)
                    
                    # Nothing was shown live, so buffered text must be classified here:
                    # raw JSON tool calls, an upstream refusal, or genuine prose. Prose is only
                    # redundant once add_message has delivered the answer; a turn that called
                    # other tools (e.g. ask_clarification) still needs its prose shown.
                    if followup_plain_text_buffer:
                        full_text = ''.join(followup_plain_text_buffer)
                        if full_text.strip() and total_add_message_count == 0:
                            yield from self._handle_plain_text_fallback(conversation_id, full_text)
                            if not followup_had_function_calls:
                                pending_tool_calls = []  # Stop the tool-output loop
                                break
                        elif full_text.strip():
                            logger.info(
                                f"[plain_text] Dropped {len(full_text)} chars of stray followup prose "
                                f"(add_message={total_add_message_count})."
                            )
                    
                    # Safety net: flush any unfinished followup function call
                    if followup_func.get("call_id"):
                        orphan_id = followup_func["call_id"]
                        orphan_name = followup_func.get("name", "unknown")
                        logger.warning(f"Followup stream ended with unfinished function call: name={orphan_name}, call_id={orphan_id}")
                        deferred_tool_calls.append({"name": orphan_name, "args": followup_func.get("arguments", "{}"), "call_id": orphan_id})
                        tool_types_this_round.add(orphan_name)
                        followup_func = {"name": None, "arguments": "", "call_id": None, "content_buffer": "", "title_sent": False}

                    # Execute all deferred tool calls in parallel
                    if deferred_tool_calls:
                        parallel_results = self._execute_tools_parallel(deferred_tool_calls, conversation_id, _uid)
                        for r in parallel_results:
                            for evt in r["yield_events"]:
                                yield evt
                            self._resolve_clarification(r)
                            pending_tool_calls.append({"call_id": r["call_id"], "output": r["output"]})
                            if r["plan_data"] and r["plan_data"]["accepted"]:
                                execution_plan = r["plan_data"]["tools"]
                                plan_index = 0
                        deferred_tool_calls = []
                except Exception as e:
                    logger.error(f"Error submitting tool outputs: {e}")
                    break
            
            # Yield citations if any were collected
            logger.info(f"[CITATION DEBUG continue_chat_stream] Total collected_citations={len(collected_citations)}, data={collected_citations}")
            if collected_citations:
                logger.info(f"Yielding {len(collected_citations)} citations")
                yield ("citations", json.dumps(collected_citations), conversation_id)
            else:
                logger.warning(f"[CITATION DEBUG continue_chat_stream] No citations collected at end of stream")
            
            # ── Yield accumulated token usage ──
            if _usage_rounds:
                _usage_payload = {
                    "input_tokens": _usage_totals["input_tokens"],
                    "output_tokens": _usage_totals["output_tokens"],
                    "total_tokens": _usage_totals["total_tokens"],
                    "rounds": len(_usage_rounds),
                    "per_round": _usage_rounds,
                }
                logger.info(f"[TOKEN USAGE] Total: {_usage_totals['total_tokens']} tokens across {len(_usage_rounds)} rounds")
                yield ("usage", json.dumps(_usage_payload), conversation_id)
            
            yield ("done", "", conversation_id)
            
        except Exception as e:
            logger.error(f"Streaming error: {e}")
            yield ("error", str(e), conversation_id)

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

    def generate_next_queries(self, user_message: str, assistant_response: str) -> List[str]:
        """Fallback follow-ups for turns where the model skipped suggest_next_queries.

        Uses a lightweight model call — no conversation, agent, or tools — so it
        cannot disturb the turn's history.
        """
        try:
            prompt = (
                "A student asked a tutor a question and got an answer. Propose exactly 3 short "
                "follow-up messages the STUDENT would plausibly send next.\n\n"
                "Rules: write them in the student's own voice (e.g. 'Show me a worked example'), "
                "each under 80 characters, concrete and specific to the exchange, all three "
                "meaningfully different, and none repeating the student's original question.\n\n"
                "Reply with ONLY a JSON array of 3 strings, nothing else.\n\n"
                f"STUDENT ASKED:\n{user_message[:400]}\n\nTUTOR ANSWERED:\n{assistant_response[:1200]}"
            )
            response = self.openai_client.responses.create(
                model="gpt-4.1-mini",
                input=prompt,
            )
            text = (getattr(response, "output_text", "") or "").strip()
            match = re.search(r"\[.*\]", text, re.DOTALL)
            if not match:
                return []
            parsed = json.loads(match.group(0))
            queries = [str(q).strip() for q in parsed if isinstance(q, str) and str(q).strip()]
            return queries[:3] if len(queries) >= 3 else []
        except Exception as e:
            logger.warning(f"[suggest_next_queries] fallback generation failed: {e}")
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
                model="gpt-4.1-mini",
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
# Keyed by (endpoint, agent_name) only — one instance is SHARED by every student
# using that agent. It must therefore stay free of per-request state. Pass
# `user_id` to start_chat_stream / continue_chat_stream instead; mutating it on
# the shared instance leaks one student's learning state into another's request.
_agent_cache: Dict[str, GeneralAgent] = {}


def get_general_agent(project_endpoint: str, agent_name: str, session_id: Optional[str] = None, user_id: Optional[str] = None) -> GeneralAgent:
    """
    Get or create a GeneralAgent instance (cached per endpoint + agent name).

    Args:
        project_endpoint: The Azure AI Foundry project endpoint
        agent_name: The name of the agent
        session_id: Optional session UUID for knowledge base filtering (agent-scoped)
        user_id: Deprecated and ignored — the returned instance is shared across
            students. Pass user_id to the chat/stream call instead.

    Returns:
        Cached or new GeneralAgent instance
    """
    cache_key = f"{project_endpoint}:{agent_name}"
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
