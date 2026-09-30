"""Guarded prose streaming and recovery of raw tool JSON."""

import json
import logging
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Generator, Optional, Tuple

from learner_memory.integration import MemoryToolContext
from harness.dispatch import Tool, ToolResult
from harness.events import RuntimeEvent, json_event, tool_start_events as _tool_start_events
from harness.turn_policy import RETIRED_FLASHCARD_MESSAGE, TOOL_ERROR_PREFIX

logger = logging.getLogger("base_agents.general_agent")


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



def _try_parse_raw_function_call(text: str):
    """
    Detect if buffered plain text is actually one or more raw function call JSON
    objects that the model output as text instead of invoking the tool.
    
    Handles single:
      {"name":"add_message","arguments":{"content":"..."}}
    And concatenated:
      {"name":"add_quiz","arguments":{...}}{"name":"add_message","arguments":{...}}
    
    Returns a list of (func_name, args_dict) tuples, or None if nothing parsed.
    """
    # Recognize the retired name only to reject legacy raw tool JSON, not display it as prose.
    KNOWN_TOOLS = ('add_message', 'add_document', 'add_quiz', 'add_flashcard', 'add_challenge', 'add_tikz_diagram', 'add_circuit', 'add_slides')
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


class ValidatedProse(list[str]):
    def __init__(self, enabled: bool = True, *, user_id: str = "", memory_context=None):
        super().__init__()
        self.enabled = enabled
        self.streamed = False
        self.user_id = user_id
        self.memory_context = memory_context

    def push(self, text: str, conversation_id: str):
        self.append(text)
        if not self.enabled:
            return
        if not self.streamed:
            prefix = "".join(self)
            if len(prefix) < 160:
                return
            if (
                prefix.lstrip().startswith(("{", "[", "```"))
                or _is_upstream_refusal(prefix)
                or _try_parse_raw_function_call(prefix)
            ):
                self.enabled = False
                return
            self.streamed = True
            yield json_event("message_block_start", {"type": "message_block_start"}, conversation_id)
            text = prefix
        yield json_event("message_block_delta", {"type": "message_block_delta", "delta": text}, conversation_id)

    def supersede(self, conversation_id: str):
        self.enabled = False
        if self.streamed:
            self.streamed = False
            yield json_event("block_cancel", {"type": "block_cancel", "tool": "plain_text"}, conversation_id)

    def finish(self, render_fallback, conversation_id: str, full_text: str):
        if self.streamed:
            yield ("message_block", json.dumps({"type": "text", "content": full_text}), conversation_id)
        else:
            kwargs = (
                {"user_id": self.user_id, "memory_context": self.memory_context}
                if self.memory_context is not None else {}
            )
            yield from render_fallback(conversation_id, full_text, **kwargs)


@dataclass
class FunctionArguments:
    name: str | None = None
    call_id: str | None = None
    arguments: str = ""
    content_buffer: str = ""
    title_sent: bool = False
    unescaped_len: int = 0

    def push(
        self, delta: str, conversation_id: str, *, initial: bool
    ) -> Generator[RuntimeEvent, None, None]:
        self.arguments += delta
        if self.name not in {"add_document", "add_message"}:
            return
        if self.name == "add_document" and not self.title_sent:
            title_match = re.search(r'"title"\s*:\s*"([^"]+)"', self.arguments)
            if title_match:
                self.title_sent = True
                yield json_event(
                    "document_title",
                    {"type": "document_title", "title": title_match.group(1)},
                    conversation_id,
                )
        content_start = self.arguments.find('"content"')
        if content_start == -1:
            return
        quote_start = self.arguments.find('"', content_start + len('"content"') + 1)
        if quote_start == -1:
            return
        content_raw = re.sub(r'(?<!\\)"[\s}]*$', '', self.arguments[quote_start + 1:])
        try:
            if len(content_raw) > len(self.content_buffer):
                self.content_buffer = content_raw
                safe = content_raw[:-1] if content_raw.endswith("\\") else content_raw
                unescaped = safe.replace("\\n", "\n").replace("\\t", "\t").replace('\\"', '"')
                if len(unescaped) > self.unescaped_len:
                    chunk = unescaped[self.unescaped_len:]
                    self.unescaped_len = len(unescaped)
                    kind = "document_delta" if self.name == "add_document" else "message_block_delta"
                    yield json_event(kind, {"type": kind, "delta": chunk}, conversation_id)
        except Exception as error:
            if not initial:
                raise
            logger.debug("Content extraction error: %s", error)


def render_plain_text(
    agent_name: str,
    tools: Mapping[str, Tool],
    dispatch: Callable[..., ToolResult],
    conversation_id: str,
    plain_text: str,
    *,
    user_id: str = "",
    memory_context: MemoryToolContext | None = None,
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
        for call_index, (func_name, func_args) in enumerate(parsed_calls):
            logger.info(f"Fallback: parsed raw function call from text: {func_name}")
            if func_name == 'add_message':
                msg_data = tools["add_message"].execute(func_args)
                yield ("message_block_start", json.dumps({"type": "message_block_start"}), conversation_id)
                yield ("message_block", json.dumps(msg_data), conversation_id)
            elif func_name == 'add_document':
                doc_data = tools["add_document"].execute(func_args)
                yield ("document_start", json.dumps({"type": "document_start"}), conversation_id)
                yield ("document", json.dumps(doc_data), conversation_id)
            elif func_name == 'add_quiz':
                context = (
                    {
                        "user_id": user_id,
                        "memory_context": memory_context,
                        "call_id": f"fallback-quiz-{call_index}",
                    }
                    if memory_context is not None else {}
                )
                quiz_data = tools["add_quiz"].execute(
                    func_args, agent_name=agent_name, **context
                )
                yield ("quiz_start", json.dumps({"type": "quiz_start"}), conversation_id)
                yield ("quiz", json.dumps(quiz_data), conversation_id)
            elif func_name == 'add_flashcard':
                logger.warning("Blocked a retired flashcard tool in raw-output recovery")
                yield ("error", RETIRED_FLASHCARD_MESSAGE, conversation_id)
            elif func_name == 'add_challenge':
                ch_data = tools["add_challenge"].execute(func_args)
                yield ("challenge_start", json.dumps({"type": "challenge_start"}), conversation_id)
                yield ("challenge", json.dumps(ch_data), conversation_id)
            elif func_name == 'add_circuit':
                yield from _tool_start_events(func_name, conversation_id)
                result = dispatch(func_name, func_args, "circuit-fallback", conversation_id, "")
                yield from result["yield_events"]
                if result["output"].startswith(TOOL_ERROR_PREFIX):
                    yield ("error", "The circuit could not be simulated. Check its connections and values.", conversation_id)
            elif func_name == 'add_slides':
                yield from _tool_start_events(func_name, conversation_id)
                result = dispatch(func_name, func_args, "slides-fallback", conversation_id, "")
                yield from result["yield_events"]
                if result["output"].startswith(TOOL_ERROR_PREFIX):
                    yield ("error", "The presentation could not be created. Try fewer words per slide.", conversation_id)
            elif func_name == 'add_tikz_diagram':
                tikz_data = tools["add_tikz_diagram"].execute(func_args)
                yield ("tikz_image_start", json.dumps({"type": "tikz_image_start"}), conversation_id)
                yield ("tikz_image", json.dumps(tikz_data), conversation_id)
            elif func_name == 'generate_image':
                # No user_id on this fallback path, so the quota check no-ops here.
                img_data = tools["generate_image"].execute(func_args, agent_name=agent_name)
                yield ("generated_image_start", json.dumps({"type": "generated_image_start"}), conversation_id)
                yield ("generated_image", json.dumps(img_data), conversation_id)
    else:
        # Genuine plain text — emit as a message so user sees it
        yield ("message_block_start", json.dumps({"type": "message_block_start"}), conversation_id)
        msg_data = {"content": plain_text, "type": "text"}
        yield ("message_block", json.dumps(msg_data), conversation_id)
        logger.info(f"Plain text fallback: emitted as message ({len(plain_text)} chars)")
