"""
Teacher Analytics Agent Chat — Lightweight streaming chat for the Teacher Dashboard
─────────────────────────────────────────────────────────────────────────
Talks to the *teacher-analytics-agent* hosted in Azure AI Foundry, dispatches
the analytics tools locally (list_agents, list_all_students,
get_student_progress, get_agent_overview), and streams SSE events back
to the frontend.

This is a cut-down version of Backend/base_agents/general_agent.py,
keeping only the pieces relevant to the analytics agent.
"""

import os
import re
import json
import logging
import hashlib
import threading
from typing import Optional, Dict, Any, Generator, Tuple

from azure.ai.projects import AIProjectClient

from common_azure_auth import get_sync_credential

from . import logging_agent_tools as tools
from utils.log_safe import scrub

logger = logging.getLogger(__name__)

# ── Credential ──────────────────────────────────────────────────────

_credential = None

def _get_credential():
    global _credential
    if _credential is None:
        # Central helper: DefaultAzureCredential (no CLI) chained with
        # AzureCliCredential (longer timeout) + retry, matching the rest of the app.
        _credential = get_sync_credential()
    return _credential


# ── Project endpoint (same as Backend) ──────────────────────────────

PROJECT_ENDPOINT = os.environ["AZURE_AI_PROJECT_ENDPOINT"]
# Teacher dashboard uses the dedicated teacher-analytics-agent hosted in Foundry.
AGENT_NAME = os.getenv("TEACHER_ANALYTICS_AGENT_NAME", "teacher-analytics-agent")


# ── Agent wrapper ───────────────────────────────────────────────────

_client: Optional[AIProjectClient] = None
_openai_client = None
_conversation_scopes: Dict[str, str] = {}
_conversation_scopes_lock = threading.Lock()


def _get_openai_client():
    global _client, _openai_client
    if _openai_client is None:
        _client = AIProjectClient(
            endpoint=PROJECT_ENDPOINT,
            credential=_get_credential(),
        )
        _openai_client = _client.get_openai_client()
        logger.info(f"AIProjectClient + OpenAI client initialised for {AGENT_NAME}")
    return _openai_client


# ── Helpers (same logic as GeneralAgent) ────────────────────────────

def _handle_add_message(arguments: Dict[str, Any]) -> Dict[str, Any]:
    """Minimal add_message handler — just packages content."""
    return {"type": "message_block", "content": arguments.get("content", "")}


TOOL_HANDLER_MAP = {
    **tools.TOOL_HANDLERS,
    # add_message is a special tool the agent uses for output formatting
}


# ── Streaming chat ──────────────────────────────────────────────────

def chat_stream(
    text: str,
    conversation_id: Optional[str] = None,
    tool_scope: Optional[Dict[str, Any]] = None,
) -> Generator[Tuple[str, str, Optional[str]], None, None]:
    """
    Send a message to the teacher-analytics-agent and yield SSE-style events.

    Yields:
        (event_type, data_string, conversation_id)
        event_type is one of:
          thread_id, message_block_start, message_block_delta,
          message_block, delta, done, error
    """
    oai = _get_openai_client()
    scope_payload = {
        "agent_ids": sorted((tool_scope or {}).get("allowed_agent_ids") or []),
        "student_ids": sorted((tool_scope or {}).get("target_student_ids") or []),
        "selected_mode": bool((tool_scope or {}).get("selected_mode")),
    }
    scope_fingerprint = hashlib.sha256(
        json.dumps(scope_payload, sort_keys=True).encode("utf-8")
    ).hexdigest()

    # Create or reuse conversation
    if conversation_id:
        with _conversation_scopes_lock:
            known_scope = _conversation_scopes.get(conversation_id)
        if known_scope == scope_fingerprint:
            conv_id = conversation_id
            logger.info(f"Continuing conversation: {scrub(conv_id)}")
        else:
            conversation = oai.conversations.create()
            conv_id = conversation.id
            with _conversation_scopes_lock:
                _conversation_scopes[conv_id] = scope_fingerprint
            logger.info("Started a new conversation because the insight scope changed")
            yield ("thread_id", conv_id, conv_id)
    else:
        conversation = oai.conversations.create()
        conv_id = conversation.id
        with _conversation_scopes_lock:
            _conversation_scopes[conv_id] = scope_fingerprint
        logger.info(f"Created conversation: {conv_id}")
        yield ("thread_id", conv_id, conv_id)

    # Stream the response
    try:
        response_stream = oai.responses.create(
            conversation=conv_id,
            tool_choice="auto",
            input=text,
            stream=True,
            extra_body={
                "agent_reference": {
                    "name": AGENT_NAME,
                    "type": "agent_reference",
                }
            },
        )

        current_fc = {"name": None, "arguments": "", "call_id": None,
                       "content_buffer": "", "title_sent": False, "unescaped_len": 0}
        pending_tool_calls = []
        plain_text_buffer = []
        had_function_calls = False
        tool_types_this_round = set()

        for event in response_stream:
            etype = getattr(event, "type", "unknown")

            if etype == "response.output_text.delta":
                delta = getattr(event, "delta", "")
                if delta:
                    plain_text_buffer.append(delta)

            elif etype == "response.output_item.added":
                item = getattr(event, "item", None)
                if item and getattr(item, "type", None) == "function_call":
                    had_function_calls = True
                    current_fc = {
                        "name": getattr(item, "name", None),
                        "call_id": getattr(item, "call_id", None) or getattr(item, "id", None),
                        "arguments": "",
                        "content_buffer": "",
                        "title_sent": False,
                        "unescaped_len": 0,
                    }
                    logger.info(f"Function call started: {current_fc['name']}")
                    if current_fc["name"] == "add_message":
                        yield ("message_block_start", json.dumps({"type": "message_block_start"}), conv_id)

            elif etype == "response.function_call_arguments.delta":
                delta = getattr(event, "delta", "")
                if delta:
                    current_fc["arguments"] += delta
                    # Stream add_message content incrementally
                    if current_fc.get("name") == "add_message":
                        args_so_far = current_fc["arguments"]
                        content_start = args_so_far.find('"content"')
                        if content_start != -1:
                            quote_start = args_so_far.find('"', content_start + len('"content"') + 1)
                            if quote_start != -1:
                                content_raw = args_so_far[quote_start + 1:]
                                content_raw = re.sub(r'(?<!\\)"[\s}]*$', '', content_raw)
                                if len(content_raw) > len(current_fc.get("content_buffer", "")):
                                    current_fc["content_buffer"] = content_raw
                                    safe = content_raw[:-1] if content_raw.endswith('\\') else content_raw
                                    unescaped = safe.replace('\\n', '\n').replace('\\t', '\t').replace('\\"', '"')
                                    prev = current_fc.get("unescaped_len", 0)
                                    if len(unescaped) > prev:
                                        d = unescaped[prev:]
                                        current_fc["unescaped_len"] = len(unescaped)
                                        yield ("message_block_delta", json.dumps({"type": "message_block_delta", "delta": d}), conv_id)

            elif etype == "response.completed":
                logger.info("Response completed")
                routed = getattr(getattr(event, "response", None), "model", None)
                if routed:
                    logger.info(f"Model used: {routed}")

            elif etype == "response.output_item.done":
                item = getattr(event, "item", None)
                if item and getattr(item, "type", None) == "function_call":
                    func_name = getattr(item, "name", None)
                    func_args = getattr(item, "arguments", current_fc["arguments"])
                    call_id = getattr(item, "call_id", None) or getattr(item, "id", None)
                    logger.info(f"Function call done: {func_name}")
                    tool_types_this_round.add(func_name)

                    if func_name == "add_message":
                        try:
                            args = json.loads(func_args) if isinstance(func_args, str) else func_args
                            msg_data = _handle_add_message(args)
                            yield ("message_block", json.dumps(msg_data), conv_id)
                            pending_tool_calls.append({
                                "call_id": call_id,
                                "output": "Message delivered to user. Do NOT call add_message again unless the user asks a new question.",
                            })
                        except Exception as e:
                            logger.error(f"add_message error: {e}")
                            pending_tool_calls.append({"call_id": call_id, "output": f"Error: {e}"})

                    elif func_name in tools.TOOL_HANDLERS:
                        try:
                            args = json.loads(func_args) if isinstance(func_args, str) else func_args
                            result_str = tools.execute_scoped_tool(
                                func_name, args, tool_scope or {}
                            )
                            logger.info(f"Logging tool '{func_name}' returned {len(result_str)} chars")
                            pending_tool_calls.append({"call_id": call_id, "output": result_str})
                        except Exception as e:
                            logger.error(f"Logging tool '{func_name}' error: {e}")
                            pending_tool_calls.append({"call_id": call_id, "output": f"Error: {e}"})
                    else:
                        logger.warning(f"Unknown function: {func_name}")
                        pending_tool_calls.append({"call_id": call_id, "output": f"Tool '{func_name}' executed."})

                    current_fc = {"name": None, "arguments": "", "call_id": None,
                                  "content_buffer": "", "title_sent": False, "unescaped_len": 0}

        # Plain text fallback (model answered without using tools)
        if plain_text_buffer and not had_function_calls:
            full_text = "".join(plain_text_buffer)
            if full_text.strip():
                logger.warning(f"Plain-text fallback ({len(full_text)} chars)")
                yield ("message_block_start", json.dumps({"type": "message_block_start"}), conv_id)
                yield ("message_block", json.dumps({"type": "message_block", "content": full_text}), conv_id)

        # Submit tool outputs and keep going until model stops issuing tool calls
        tool_round = 0
        while pending_tool_calls:
            content_tools = tool_types_this_round - {"add_message"}
            message_only = tool_round > 0 and not content_tools and "add_message" in tool_types_this_round
            if message_only:
                logger.info("add_message-only round — submitting & stopping")
                tool_outputs = [{"type": "function_call_output", "call_id": tc["call_id"], "output": tc["output"]} for tc in pending_tool_calls]
                try:
                    oai.responses.create(
                        conversation=conv_id, input=tool_outputs, stream=False,
                        extra_body={"agent_reference": {"name": AGENT_NAME, "type": "agent_reference"}},
                    )
                except Exception as e:
                    logger.error(f"Final tool output submit error: {e}")
                break

            tool_round += 1
            logger.info(f"Submitting {len(pending_tool_calls)} tool outputs (round {tool_round})")
            tool_outputs = [{"type": "function_call_output", "call_id": tc["call_id"], "output": tc["output"]} for tc in pending_tool_calls]
            pending_tool_calls = []
            tool_types_this_round = set()

            try:
                followup = oai.responses.create(
                    conversation=conv_id, input=tool_outputs, stream=True,
                    tool_choice="auto",
                    extra_body={"agent_reference": {"name": AGENT_NAME, "type": "agent_reference"}},
                )

                fu_fc = {"name": None, "arguments": "", "call_id": None,
                         "content_buffer": "", "unescaped_len": 0}
                fu_plain = []
                fu_had_fc = False

                for event in followup:
                    etype = getattr(event, "type", "unknown")

                    if etype == "response.output_text.delta":
                        d = getattr(event, "delta", "")
                        if d:
                            fu_plain.append(d)

                    elif etype == "response.output_item.added":
                        item = getattr(event, "item", None)
                        if item and getattr(item, "type", None) == "function_call":
                            fu_had_fc = True
                            fu_fc = {
                                "name": getattr(item, "name", None),
                                "call_id": getattr(item, "call_id", None) or getattr(item, "id", None),
                                "arguments": "", "content_buffer": "", "unescaped_len": 0,
                            }
                            if fu_fc["name"] == "add_message":
                                yield ("message_block_start", json.dumps({"type": "message_block_start"}), conv_id)

                    elif etype == "response.function_call_arguments.delta":
                        d = getattr(event, "delta", "")
                        if d:
                            fu_fc["arguments"] += d
                            if fu_fc.get("name") == "add_message":
                                args_so_far = fu_fc["arguments"]
                                cs = args_so_far.find('"content"')
                                if cs != -1:
                                    qs = args_so_far.find('"', cs + len('"content"') + 1)
                                    if qs != -1:
                                        cr = args_so_far[qs + 1:]
                                        cr = re.sub(r'(?<!\\)"[\s}]*$', '', cr)
                                        if len(cr) > len(fu_fc.get("content_buffer", "")):
                                            fu_fc["content_buffer"] = cr
                                            safe = cr[:-1] if cr.endswith('\\') else cr
                                            un = safe.replace('\\n', '\n').replace('\\t', '\t').replace('\\"', '"')
                                            prev = fu_fc.get("unescaped_len", 0)
                                            if len(un) > prev:
                                                yield ("message_block_delta", json.dumps({"type": "message_block_delta", "delta": un[prev:]}), conv_id)
                                                fu_fc["unescaped_len"] = len(un)

                    elif etype == "response.output_item.done":
                        item = getattr(event, "item", None)
                        if item and getattr(item, "type", None) == "function_call":
                            fn = getattr(item, "name", None)
                            fa = getattr(item, "arguments", fu_fc["arguments"])
                            cid = getattr(item, "call_id", None) or getattr(item, "id", None)
                            tool_types_this_round.add(fn)

                            if fn == "add_message":
                                try:
                                    a = json.loads(fa) if isinstance(fa, str) else fa
                                    md = _handle_add_message(a)
                                    yield ("message_block", json.dumps(md), conv_id)
                                    pending_tool_calls.append({"call_id": cid, "output": "Message delivered."})
                                except Exception as e:
                                    pending_tool_calls.append({"call_id": cid, "output": f"Error: {e}"})
                            elif fn in tools.TOOL_HANDLERS:
                                try:
                                    a = json.loads(fa) if isinstance(fa, str) else fa
                                    rs = tools.execute_scoped_tool(
                                        fn, a, tool_scope or {}
                                    )
                                    logger.info(f"Followup logging tool '{fn}' ({len(rs)} chars)")
                                    pending_tool_calls.append({"call_id": cid, "output": rs})
                                except Exception as e:
                                    pending_tool_calls.append({"call_id": cid, "output": f"Error: {e}"})
                            else:
                                pending_tool_calls.append({"call_id": cid, "output": f"Tool '{fn}' executed."})

                            fu_fc = {"name": None, "arguments": "", "call_id": None,
                                     "content_buffer": "", "unescaped_len": 0}

                # Plain text fallback in followup
                if fu_plain and not fu_had_fc:
                    full = "".join(fu_plain)
                    if full.strip():
                        yield ("message_block_start", json.dumps({"type": "message_block_start"}), conv_id)
                        yield ("message_block", json.dumps({"type": "message_block", "content": full}), conv_id)

            except Exception as e:
                logger.error(f"Followup round {tool_round} error: {e}", exc_info=True)
                # The consumer streams this to the browser, so keep the detail in the log.
                yield ("error", "Internal error", conv_id)
                break

        yield ("done", "", conv_id)

    except Exception as e:
        logger.error(f"Chat stream error: {e}", exc_info=True)
        yield ("error", "Internal error", conv_id)
