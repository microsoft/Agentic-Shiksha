"""TikZ diagrams via a generator-discriminator agent pipeline. See README.md."""

import json
import logging
import os
import re
import tempfile
import time
import uuid
from typing import Any, Dict, Optional, Tuple

import openai
from azure.ai.projects import AIProjectClient
from azure.ai.projects.models import (
    PromptAgentDefinition,
)

from common_azure_auth import get_sync_credential
from agent_tools.hosted.bing_grounding.builder import build_bing_grounding_tool
from utils.tikz_renderer import (
    TIKZ_PREAMBLE,
    TIKZ_POSTAMBLE,
    render_tikz_to_base64,
    sanitize_tikz_source,
)
from utils.tikz_geometry import check_tikz_geometry, geometry_check_enabled
from utils.prompt_unifier import load_prompt_file
from utils.tool_definitions import load_tool_definition
from agent_tools.custom.base import CustomTool

logger = logging.getLogger(__name__)

# ── Configuration ────────────────────────────────────────────────────

PROJECT_ENDPOINT = os.environ["AZURE_AI_PROJECT_ENDPOINT"]
GENERATOR_MODEL = os.getenv("TIKZ_GENERATOR_MODEL", "gpt-5.4")
DISCRIMINATOR_MODEL = os.getenv("TIKZ_DISCRIMINATOR_MODEL", "gpt-5.4")
POLISHER_MODEL = os.getenv("TIKZ_POLISHER_MODEL", "gpt-5.4")

BING_CONNECTION_ID = os.environ["AZURE_BING_CONNECTION_ID"]

GENERATOR_AGENT_NAME = "tikz-diagram-generator"
DISCRIMINATOR_AGENT_NAME = "tikz-diagram-discriminator"
POLISHER_AGENT_NAME = "tikz-diagram-polisher"

MAX_COMPILE_RETRIES = 3          # L1 — pdflatex error → regenerate
MAX_DISCRIMINATOR_ROUNDS = 1     # L2 — vision critique → regenerate (default when caller omits it)
MAX_FEEDBACK_ROUNDS = 3          # Ceiling the calling agent may request
MIN_REWRITE_CHAR_RATIO = 0.55
MIN_REWRITE_STRUCTURE_RATIO = 0.70
POLISHER_TIMEOUT_SECONDS = 60.0
FINAL_EVALUATION_TIMEOUT_SECONDS = 45.0

# Graduated per-criterion pass thresholds per discriminator round (1-indexed).
# Each criterion is scored 0-10. The round passes only if ALL criteria meet the threshold.
# Round 1 is reachable so a genuinely good first draft can exit early; later rounds
# demand more. All-9s made the gate unreachable, so the loop always burned its budget.
GRADUATED_THRESHOLDS = [8, 9, 9, 9, 9]  # index by (round - 1)

CRITERIA_KEYS = [
    "completeness", "overlap_occlusion", "spatial_layout",
    "alignment", "accuracy", "style_polish",
]

# ── Token tracking ───────────────────────────────────────────────────

_token_usage = {"input_tokens": 0, "output_tokens": 0}


def _track_usage(response):
    """Accumulate token usage from a responses API or chat.completions call."""
    usage = getattr(response, "usage", None)
    if usage:
        # responses API uses input_tokens/output_tokens
        _token_usage["input_tokens"] += getattr(usage, "input_tokens", 0) or 0
        _token_usage["output_tokens"] += getattr(usage, "output_tokens", 0) or 0
        # chat.completions uses prompt_tokens/completion_tokens
        _token_usage["input_tokens"] += getattr(usage, "prompt_tokens", 0) or 0
        _token_usage["output_tokens"] += getattr(usage, "completion_tokens", 0) or 0


def _reset_usage():
    _token_usage["input_tokens"] = 0
    _token_usage["output_tokens"] = 0


# ── System prompts (loaded from prompt_store) ─────────────────────────

GENERATOR_SYSTEM_PROMPT = load_prompt_file("tools/tikz_generator_system.md")

GENERATOR_POLISH_PROMPT = load_prompt_file("tools/tikz_generator_polish.md")

GENERATOR_RETRY_PREFIX = load_prompt_file("tools/tikz_generator_retry_prefix.md")

DISCRIMINATOR_SYSTEM_PROMPT = load_prompt_file("tools/tikz_discriminator_system.md")



# ── Tool definition (Azure AI Agents schema) ────────────────────────

ADD_TIKZ_DIAGRAM_TOOL_DEFINITION: Dict[str, Any] = load_tool_definition("add_tikz_diagram")


# ── Agent infrastructure (singletons) ───────────────────────────────

_project_client = None
_openai_client = None
_inference_client = None
_agents_created = False

# AI Services base URL for chat completions (strip /api/projects/... from PROJECT_ENDPOINT)
_INFERENCE_ENDPOINT = PROJECT_ENDPOINT.split("/api/projects")[0] if "/api/projects" in PROJECT_ENDPOINT else PROJECT_ENDPOINT


def _get_project_client() -> AIProjectClient:
    """Get or create the AIProjectClient singleton."""
    global _project_client
    if _project_client is None:
        _project_client = AIProjectClient(
            endpoint=PROJECT_ENDPOINT,
            credential=get_sync_credential(),
        )
    return _project_client


def _get_openai_client():
    """Get or create the OpenAI client from AIProjectClient (singleton).
    Used for agent-reference calls (responses.create with conversation)."""
    global _openai_client
    if _openai_client is None:
        _openai_client = _get_project_client().get_openai_client()
    return _openai_client


def _get_inference_client():
    """Get or create an AzureOpenAI client for chat completions (singleton).

    Uses the AI Services endpoint directly — supports chat.completions
    with vision, unlike the agent-scoped client from AIProjectClient.
    """
    global _inference_client
    if _inference_client is None:
        from azure.identity import get_bearer_token_provider
        token_provider = get_bearer_token_provider(
            get_sync_credential(),
            "https://cognitiveservices.azure.com/.default",
        )
        _inference_client = openai.AzureOpenAI(
            azure_endpoint=_INFERENCE_ENDPOINT,
            azure_ad_token_provider=token_provider,
            api_version="2025-04-01-preview",
        )
    return _inference_client


def _ensure_agents_created():
    """Create generator and discriminator agents if not already done."""
    global _agents_created
    if _agents_created:
        return

    pc = _get_project_client()

    # ── Generator agent: GPT-5.2 + BingGrounding web search ──────
    generator_tools = []
    bing_tool = build_bing_grounding_tool(BING_CONNECTION_ID)
    if bing_tool is not None:
        generator_tools.append(bing_tool)

    logger.info(f"[TikZ Agent] Creating generator agent '{GENERATOR_AGENT_NAME}' (model={GENERATOR_MODEL})...")
    try:
        pc.agents.create_version(
            agent_name=GENERATOR_AGENT_NAME,
            definition=PromptAgentDefinition(
                model=GENERATOR_MODEL,
                instructions=GENERATOR_SYSTEM_PROMPT,
                tools=generator_tools if generator_tools else None,
            ),
        )
        logger.info(
            f"[TikZ Agent] Created/updated generator agent '{GENERATOR_AGENT_NAME}' "
            f"(model={GENERATOR_MODEL}, tools={'BingGrounding' if generator_tools else 'none'})"
        )
    except Exception as e:
        logger.error(f"[TikZ Agent] FAILED to create generator agent: {e}")
        raise

    # ── Discriminator agent: GPT-5.2, NO tools ──────────────────
    logger.info(f"[TikZ Agent] Creating discriminator agent '{DISCRIMINATOR_AGENT_NAME}' (model={DISCRIMINATOR_MODEL})...")
    try:
        pc.agents.create_version(
            agent_name=DISCRIMINATOR_AGENT_NAME,
            definition=PromptAgentDefinition(
                model=DISCRIMINATOR_MODEL,
                instructions=DISCRIMINATOR_SYSTEM_PROMPT,
                tools=None,
            ),
        )
        logger.info(
            f"[TikZ Agent] Created/updated discriminator agent '{DISCRIMINATOR_AGENT_NAME}' "
            f"(model={DISCRIMINATOR_MODEL}, tools=none)"
        )
    except Exception as e:
        logger.error(f"[TikZ Agent] FAILED to create discriminator agent: {e}")
        raise

    # ── Polisher agent: gpt-5.4-pro, NO tools ───────────────────
    logger.info(f"[TikZ Agent] Creating polisher agent '{POLISHER_AGENT_NAME}' (model={POLISHER_MODEL})...")
    try:
        pc.agents.create_version(
            agent_name=POLISHER_AGENT_NAME,
            definition=PromptAgentDefinition(
                model=POLISHER_MODEL,
                instructions=GENERATOR_POLISH_PROMPT,
                tools=None,
            ),
        )
        logger.info(
            f"[TikZ Agent] Created/updated polisher agent '{POLISHER_AGENT_NAME}' "
            f"(model={POLISHER_MODEL}, tools=none)"
        )
    except Exception as e:
        logger.error(f"[TikZ Agent] FAILED to create polisher agent: {e}")
        raise

    _agents_created = True


# ── Helpers ──────────────────────────────────────────────────────────

def _number_lines(code: str) -> str:
    """Add line numbers to code for the edit-mode prompt."""
    lines = code.split("\n")
    width = len(str(len(lines)))
    return "\n".join(f"{i + 1:>{width}} | {line}" for i, line in enumerate(lines))


def _retry_rewrite_problem(original: str, candidate: str) -> Optional[str]:
    """Return why a retry rewrite is unsafe, or None when it is plausible."""
    import re

    if any(marker in candidate for marker in ("<<<SEARCH>>>", "<<<REPLACE>>>", "<<<END>>>")):
        return "unapplied edit-protocol markers remain"

    begins = candidate.count(r"\begin{tikzpicture}")
    ends = candidate.count(r"\end{tikzpicture}")
    if begins == 0 or begins != ends:
        return f"unbalanced tikzpicture environments ({begins} begin, {ends} end)"

    char_ratio = len(candidate) / max(len(original), 1)
    primitive_pattern = r"\\(?:node|draw|path|fill|filldraw|coordinate|matrix)\b"
    original_primitives = len(re.findall(primitive_pattern, original))
    candidate_primitives = len(re.findall(primitive_pattern, candidate))
    structure_ratio = candidate_primitives / max(original_primitives, 1)

    if (
        len(original) >= 1000
        and char_ratio < MIN_REWRITE_CHAR_RATIO
        and structure_ratio < MIN_REWRITE_STRUCTURE_RATIO
    ):
        return (
            f"destructive shrink (characters {char_ratio:.0%}, "
            f"drawing primitives {structure_ratio:.0%} of previous code)"
        )
    return None


def _apply_edits(original: str, raw_response: str) -> Optional[str]:
    """
    Parse <<<SEARCH>>>...<<<REPLACE>>>...<<<END>>> blocks from the model's
    response and apply them sequentially to *original*.

    Returns the edited code, or None if parsing/application failed.
    """
    import re

    blocks = re.findall(
        r"<<<SEARCH>>>\s*\n(.*?)<<<REPLACE>>>\s*\n(.*?)<<<END>>>",
        raw_response,
        re.DOTALL,
    )

    if not blocks:
        return None  # no edit blocks found — caller should try full-rewrite parse

    result = original
    for search_text, replace_text in blocks:
        # Strip trailing whitespace from the block but preserve internal structure
        search_text = search_text.rstrip("\n")
        replace_text = replace_text.rstrip("\n")

        # Strip line numbers the model might have copied from the numbered listing
        search_clean = re.sub(r"^\s*\d+\s*\|\s?", "", search_text, flags=re.MULTILINE)
        replace_clean = re.sub(r"^\s*\d+\s*\|\s?", "", replace_text, flags=re.MULTILINE)

        # Try exact match first, then cleaned match
        if search_text in result:
            result = result.replace(search_text, replace_clean, 1)
        elif search_clean in result:
            result = result.replace(search_clean, replace_clean, 1)
        else:
            logger.warning(
                f"[TikZ Edit] SEARCH block not found in code "
                f"({len(search_clean)} chars), rejecting edit response"
            )
            return None

    logger.info(f"[TikZ Edit] Applied {len(blocks)} edit block(s) successfully")
    return result

def _extract_tikz_code(raw_text: str) -> str:
    """
    Extract the TikZ body from the model's response.
    Handles responses wrapped in ```tikz ... ``` fences or plain text.
    """
    text = raw_text.strip()

    # Strip markdown code fences (```tikz ... ``` or ```latex ... ``` or ``` ... ```)
    for fence in ("```tikz", "```latex", "```tex", "```"):
        if text.startswith(fence):
            text = text[len(fence):]
            break
    if text.endswith("```"):
        text = text[:-3]

    # Strip invisible Unicode now so stored code, edit blocks, and critiques all agree.
    return sanitize_tikz_source(text.strip())


def _call_generator(
    description: str,
    title: str,
    previous_code: str = "",
    feedback: str = "",
    image_b64: str = "",
) -> str:
    """
    Call the generator agent to produce TikZ code.

    On retry, includes the previous code, feedback, AND the rendered image
    so the agent can see exactly what the current output looks like.
    The agent has BingGrounding and can web-search for TikZ reference material.

    Returns: TikZ code body (everything between \\begin{document} and \\end{document}).
    """
    client = _get_inference_client()

    is_retry = bool(previous_code and feedback)

    if is_retry:
        user_text = GENERATOR_RETRY_PREFIX.format(
            feedback=feedback,
            previous_code_numbered=_number_lines(previous_code),
        ) + f"\n\nOriginal description:\n{description}\n\nTitle: {title}"

        # On retry with image, send as vision request
        if image_b64:
            user_msg_content = [
                {"type": "text", "text": user_text},
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{image_b64}", "detail": "high"},
                },
            ]
        else:
            user_msg_content = user_text
    else:
        user_msg_content = f"Generate a TikZ diagram for:\n\n{description}\n\nTitle: {title}"

    messages = [
        {"role": "system", "content": GENERATOR_SYSTEM_PROMPT},
        {"role": "user", "content": user_msg_content},
    ]

    logger.info(f"[TikZ Generator] Calling chat.completions.create (is_retry={is_retry})")
    try:
        response = client.chat.completions.create(
            model=GENERATOR_MODEL,
            messages=messages,
            max_completion_tokens=8192,
            temperature=0.4,
        )
    except Exception as gen_err:
        logger.error(f"[TikZ Generator] chat.completions.create FAILED: {gen_err}")
        raise
    _track_usage(response)

    raw = response.choices[0].message.content or ""

    # On retries, try edit-mode parsing first, then fall back to full-code extraction
    if is_retry:
        edited = _apply_edits(previous_code, raw)
        if edited is not None:
            problem = _retry_rewrite_problem(previous_code, edited)
            if problem:
                logger.warning(
                    f"[TikZ Generator] Rejected applied edits: {problem}; "
                    "preserving previous code"
                )
                return previous_code
            logger.info(f"[TikZ Generator] Applied edits → {len(edited)} chars")
            return edited

        if any(marker in raw for marker in ("<<<SEARCH>>>", "<<<REPLACE>>>", "<<<END>>>")):
            logger.warning(
                "[TikZ Generator] Edit response could not be applied; preserving previous code"
            )
            return previous_code
        logger.info("[TikZ Generator] No edit blocks found, trying full-code extraction")

    tikz_code = _extract_tikz_code(raw)

    if not tikz_code:
        raise RuntimeError("Generator agent returned empty TikZ code")

    if is_retry:
        problem = _retry_rewrite_problem(previous_code, tikz_code)
        if problem:
            logger.warning(
                f"[TikZ Generator] Rejected full rewrite: {problem}; preserving previous code"
            )
            return previous_code

    logger.info(f"[TikZ Generator] Produced {len(tikz_code)} chars of TikZ code")
    return tikz_code


# ── Discriminator ────────────────────────────────────────────────────

def _salvage_json(raw: str) -> Optional[Dict[str, Any]]:
    """Recover the largest complete JSON object from a truncated response.

    The discriminator's verdict is long, so a token cap can cut it mid-value.
    Closing the open containers recovers the scores rather than losing the round.
    """
    start = raw.find("{")
    if start == -1:
        return None

    depth = 0
    in_string = False
    escaped = False
    last_complete = -1
    for index in range(start, len(raw)):
        ch = raw[index]
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch in "{[":
            depth += 1
        elif ch in "}]":
            depth -= 1
            if depth == 0:
                last_complete = index

    if last_complete != -1:
        try:
            return json.loads(raw[start:last_complete + 1])
        except json.JSONDecodeError:
            pass

    # Truncated mid-value (e.g. `"completeness": f`). Walk back to successively
    # earlier key/value boundaries, closing open containers at each attempt.
    body = raw[start:]
    boundaries: List[Tuple[int, int]] = []
    depth = 0
    in_string = False
    escaped = False
    for index, ch in enumerate(body):
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch in "{[":
            depth += 1
        elif ch in "}]":
            depth -= 1
        elif ch == "," and depth >= 1:
            boundaries.append((index, depth))

    for cut, cut_depth in reversed(boundaries[-40:]):
        candidate = body[:cut] + ("}" if cut_depth == 1 else "}" * cut_depth)
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue
    return None


def _call_discriminator(
    image_b64: str,
    tikz_code: str,
    description: str,
    title: str,
    d_round: int = 1,
    timeout_seconds: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Call the discriminator agent with the rendered PNG + TikZ source code
    + description to evaluate quality.

    The agent sees both the visual output AND the code that produced it,
    allowing it to catch structural issues (wrong colours, missing elements)
    that may not be obvious from the image alone.

    d_round tells the discriminator which iteration this is (affects strictness).

    Returns: dict with keys: score, pass, issues, suggestions
    """
    client = _get_inference_client()

    threshold = GRADUATED_THRESHOLDS[min(d_round - 1, len(GRADUATED_THRESHOLDS) - 1)]

    user_text = (
        f"Evaluate this diagram.\n\n"
        f"Title: {title}\n"
        f"Description: {description}\n\n"
        f"Discriminator round: {d_round}/{MAX_DISCRIMINATOR_ROUNDS}\n"
        f"Per-criterion pass threshold: {threshold}/10\n\n"
        f"TikZ source code (with line numbers):\n```tikz\n{_number_lines(tikz_code)}\n```\n\n"
        f"Rate each criterion 0-10: completeness, overlap & occlusion, "
        f"spatial layout, alignment, accuracy, style & polish. "
        f"A criterion passes if its score >= {threshold}. "
        f"Use BOTH the rendered image AND the source code. "
        f"Respond with ONLY a JSON object."
    )

    messages = [
        {"role": "system", "content": DISCRIMINATOR_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": user_text},
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{image_b64}", "detail": "high"},
                },
            ],
        },
    ]

    request_client = (
        client.with_options(timeout=timeout_seconds, max_retries=0)
        if timeout_seconds is not None
        else client
    )
    response = request_client.chat.completions.create(
        model=DISCRIMINATOR_MODEL,
        messages=messages,
        max_completion_tokens=6144,
        temperature=0.2,
    )
    _track_usage(response)

    raw = (response.choices[0].message.content or "").strip()

    # Strip markdown fences if the model wraps the JSON
    if raw.startswith("```"):
        lines = raw.split("\n")
        # Remove first and last lines (fences)
        lines = [l for l in lines if not l.strip().startswith("```")]
        raw = "\n".join(lines)

    verdict = None
    try:
        verdict = json.loads(raw)
    except json.JSONDecodeError:
        salvaged = _salvage_json(raw)
        if salvaged is not None:
            logger.warning(
                "[TikZ Discriminator] Response was truncated; salvaged the complete prefix"
            )
            verdict = salvaged

    if verdict is None:
        logger.warning(f"[TikZ Discriminator] Could not parse JSON: {raw[:200]}")
        # Fail closed. Treating an unreadable verdict as a pass lets a broken
        # response end the loop and ship an unevaluated diagram.
        verdict = {
            "scores": {},
            "criteria_pass": {k: False for k in CRITERIA_KEYS},
            "average": 0,
            "all_pass": False,
            "issues": [],
            "parse_failed": True,
        }

    # Normalise: compute average and all_pass if not present
    scores = verdict.get("scores", {})
    if "average" not in verdict and scores:
        vals = [scores.get(k, 0) for k in CRITERIA_KEYS]
        verdict["average"] = round(sum(vals) / len(vals), 1) if vals else 0
    # Backward compat: old "score" or "total" key
    if "average" not in verdict:
        verdict["average"] = verdict.pop("total", verdict.pop("score", 7))
    if scores or "criteria_pass" in verdict:
        # The score is authoritative: the prompt defines "pass" as score >= threshold,
        # so a self-reported boolean that contradicts its own number is an arithmetic
        # slip. Fall back to the reported flag only where no score came through.
        reported = verdict.get("criteria_pass") or {}
        verdict["criteria_pass"] = {
            k: (scores[k] >= threshold) if k in scores else bool(reported.get(k, False))
            for k in CRITERIA_KEYS
        }
        # Recompute rather than trust a self-reported all_pass that the
        # per-criterion results contradict.
        verdict["all_pass"] = all(
            verdict["criteria_pass"].get(k, False) for k in CRITERIA_KEYS
        )
    if "all_pass" not in verdict:
        cp = verdict.get("criteria_pass", {})
        # Unknown criteria count as failures — the loop should keep refining
        # rather than ship a diagram nobody confirmed was good.
        verdict["all_pass"] = all(cp.get(k, False) for k in CRITERIA_KEYS)
    if "scores" not in verdict:
        verdict["scores"] = {}
    if "flagged_nodes" not in verdict:
        verdict["flagged_nodes"] = []
    if "flagged_edges" not in verdict:
        verdict["flagged_edges"] = []
    if "flagged_lines" not in verdict:
        verdict["flagged_lines"] = []

    # Derive flat lists from structured issues (new format) for annotation
    issues_list = verdict.get("issues", [])
    if issues_list and isinstance(issues_list[0], dict):
        # New structured format — extract aggregated flat lists
        all_nodes = []
        all_edges = []
        all_lines = []
        for iss in issues_list:
            all_nodes.extend(iss.get("nodes", []))
            all_edges.extend(iss.get("edges", []))
            all_lines.extend(iss.get("lines", []))
        verdict["flagged_nodes"] = list(dict.fromkeys(all_nodes))  # dedupe, keep order
        verdict["flagged_edges"] = all_edges
        verdict["flagged_lines"] = sorted(set(all_lines))
    # Backward compat: old format had separate "suggestions" list
    if "suggestions" not in verdict:
        verdict["suggestions"] = [
            iss.get("suggestion", "") for iss in issues_list
            if isinstance(iss, dict) and iss.get("suggestion")
        ]

    logger.info(
        f"[TikZ Discriminator] Average: {verdict.get('average')}/10, "
        f"Scores: {verdict.get('scores')}, "
        f"All pass: {verdict.get('all_pass')}, Issues: {len(verdict.get('issues', []))}, "
        f"Flagged nodes: {verdict.get('flagged_nodes', [])}, "
        f"Flagged edges: {verdict.get('flagged_edges', [])}, "
        f"Flagged lines: {verdict.get('flagged_lines', [])}"
    )
    return verdict


# ── Compile helper with error extraction ─────────────────────────────

_RECURSION_FEEDBACK = (
    "CRITICAL — Your code contains an INFINITE RECURSION that crashes the "
    "LaTeX compiler (TeX capacity exceeded / input stack size=10000). "
    "Common causes:\n"
    "1. A \\newcommand whose body calls itself (e.g. \\newcommand{\\foo}{...\\foo...})\n"
    "2. A \\tikzset style whose expansion triggers itself\n"
    "3. A \\foreach loop with an expanding macro that never terminates\n\n"
    "FIX: Remove ALL self-referencing macros. Use plain \\foreach with finite "
    "explicit lists/ranges (e.g. {1,...,5}). Do NOT define any command whose body "
    "references the command itself. Rewrite the problematic section from scratch."
)

_DIMENSION_FEEDBACK = (
    "CRITICAL — TeX could not read a number where a length was expected. This is "
    "almost always a \\foreach loop variable glued to a unit, e.g. "
    "`[xshift=\\pos cm]`. When a list item carries braces, a stray space, a "
    "trailing comma, a `%` comment, or a missing `/` part, \\pos expands to "
    "something that is not a bare number and the whole picture dies.\n\n"
    "FIX — rewrite EVERY such loop:\n"
    "1. Never concatenate a loop variable with a unit. Write "
    "`([shift={(\\pos,0)}]node.center)` or `[xshift={\\pos*1cm}]` instead of "
    "`[xshift=\\pos cm]`.\n"
    "2. Put the whole \\foreach list on ONE line, with no trailing comma, no `%` "
    "comments, and no `...` ellipsis in a slash-separated list.\n"
    "3. Every item must have exactly as many `/` parts as declared variables.\n"
    "4. If the loop only draws 3-6 decorations, delete it and write the "
    "\\fill/\\draw calls out explicitly with literal lengths — that is always safe."
)

# pdflatex / pgf messages that mean "a length or number could not be parsed".
_DIMENSION_ERROR_MARKERS = (
    "missing number",
    "illegal unit of measure",
    "dimension too large",
    "unknown function `cm'",
    "unknown operator",
)

_ARROW_FEEDBACK = (
    "CRITICAL — an arrow specification was rejected by pgf. The ONLY arrow "
    "syntax guaranteed to work in this preamble is the explicit arrows.meta "
    "form:\n"
    "  one-way        -{Stealth[length=3mm]}\n"
    "  bidirectional  {Stealth[length=3mm]}-{Stealth[length=3mm]}\n"
    "  shorthand      <->  combined with  >=Stealth\n\n"
    "These all FAIL — do not write them:\n"
    "  Stealth-Stealth[length=3mm]   (bracket must sit on each tip, not the pair)\n"
    "  arrows=Stealth                (incomplete arrow spec)\n"
    "  {Stealth, thick}              (a tip name is not a style key)\n"
    "  {arrows/.cd, Stealth}         (not a key path)\n\n"
    "FIX: rewrite the offending style so the tip appears only inside `-{...}` "
    "or after `>=`, and put any `[length=...]` immediately after the tip name "
    "inside its own braces."
)

# pgf messages raised while parsing an arrow specification.
_ARROW_ERROR_MARKERS = (
    "unknown arrow tip kind",
    "pgf@arrows@",
    "do not know the key '/tikz/arrows",
)

# `Stealth-Stealth[length=3mm]` leaves pgfkeys hunting for a key named `length[`.
# Matching the trailing bracket keeps ordinary undefined-style errors out.
_ARROW_OPTION_KEY_RE = re.compile(r"do not know the key '[^']*\[")


def _compile_feedback(error: Optional[str], prefix: str = "") -> str:
    """Build generator feedback for a failed compile, adding targeted recovery
    guidance for the failure modes it cannot diagnose from the raw log."""
    base = f"{prefix}LaTeX compilation error: {error}"
    lowered = (error or "").lower()

    if any(
        marker in lowered
        for marker in ("capacity exceeded", "input stack size", "recursion pre-check")
    ):
        return f"{base}\n\n{_RECURSION_FEEDBACK}"
    if any(marker in lowered for marker in _ARROW_ERROR_MARKERS) or _ARROW_OPTION_KEY_RE.search(lowered):
        return f"{base}\n\n{_ARROW_FEEDBACK}"
    if any(marker in lowered for marker in _DIMENSION_ERROR_MARKERS):
        return f"{base}\n\n{_DIMENSION_FEEDBACK}"
    return base


def _check_recursion(tikz_code: str) -> Optional[str]:
    """
    Quick static check for obvious self-referencing patterns that cause
    'TeX capacity exceeded'.  Returns an error message if found, else None.
    """
    import re

    # Find all \newcommand{\foo} or \renewcommand{\foo} or \def\foo
    # then check if \foo appears in its own body
    for m in re.finditer(
        r"\\(?:re)?newcommand\{(\\[a-zA-Z]+)\}(?:\[\d+\])*\{(.+?)\}(?=\s*\\|\s*$|\s*%)",
        tikz_code,
        re.DOTALL,
    ):
        cmd_name = m.group(1)
        cmd_body = m.group(2)
        if cmd_name in cmd_body:
            return (
                f"Detected self-referencing macro: {cmd_name} calls itself "
                f"in its own definition. This causes infinite recursion."
            )

    # Check \def\foo...{...\foo...}
    for m in re.finditer(
        r"\\def(\\[a-zA-Z]+)[^{]*\{(.+?)\}",
        tikz_code,
        re.DOTALL,
    ):
        cmd_name = m.group(1)
        cmd_body = m.group(2)
        if cmd_name in cmd_body:
            return (
                f"Detected self-referencing \\def: {cmd_name} calls itself. "
                f"This causes infinite recursion."
            )

    return None


def _save_failed_source(tikz_code: str, error: str) -> Optional[str]:
    """Write the rejected TikZ source next to its error so the failure can be
    reproduced later. The 5-line window in the log is rarely enough to diagnose."""
    try:
        failure_dir = os.path.join(tempfile.gettempdir(), "ekalaiva_tikz_failures")
        os.makedirs(failure_dir, exist_ok=True)

        # Keep the newest 20; these are debugging aids, not artifacts to retain.
        existing = sorted(
            (os.path.join(failure_dir, n) for n in os.listdir(failure_dir)),
            key=os.path.getmtime,
        )
        for stale in existing[:-19]:
            try:
                os.remove(stale)
            except OSError:
                pass

        path = os.path.join(
            failure_dir, f"{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}.tex"
        )
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(f"% COMPILE ERROR:\n% {error.replace(chr(10), chr(10) + '% ')}\n\n")
            fh.write(tikz_code)
        return path
    except Exception as save_error:  # noqa: BLE001 - diagnostics must never break the run
        logger.debug(f"[TikZ Compile] Could not save failed source: {save_error}")
        return None


def _compile_tikz(tikz_code: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Compile TikZ code to base64 PNG.
    Runs a quick recursion check before invoking pdflatex.

    Returns:
        (base64_png, None) on success
        (None, error_message) on failure
    """
    # Pre-check for obvious infinite recursion
    recursion_err = _check_recursion(tikz_code)
    if recursion_err:
        logger.warning(f"[TikZ Compile] Recursion pre-check failed: {recursion_err}")
        return None, f"Recursion pre-check: {recursion_err}"

    try:
        b64 = render_tikz_to_base64(tikz_code)
        return b64, None
    except RuntimeError as e:
        error = str(e)
        saved = _save_failed_source(tikz_code, error)
        if saved:
            logger.warning(f"[TikZ Compile] Failed source saved to {saved}")
        return None, error


# ── Annotated image builder ───────────────────────────────────────────


# Colour per criterion for annotated image bounding boxes
_CRITERION_COLORS = {
    "completeness":      "red",
    "overlap_occlusion": "orange",
    "spatial_layout":    "blue",
    "alignment":         "purple",
    "accuracy":          "brown",
    "style_polish":      "teal",
}


def _build_annotated_image(
    tikz_code: str,
    issues: list[dict],
) -> Optional[str]:
    """
    Compile a copy of the TikZ code with numbered, color-coded bounding
    boxes around flagged nodes and overlay arrows for flagged edges.
    Each issue gets a circled number label and a color based on its criterion.
    Returns base64 PNG or None if compile fails.
    """
    if not issues:
        return None

    # Find the end of the tikzpicture to inject annotation layer just before it
    marker = r"\end{tikzpicture}"
    idx = tikz_code.rfind(marker)
    if idx == -1:
        return None

    # Build overlay draw commands
    overlay_lines = [
        "% ── Discriminator annotations (auto-injected) ──",
    ]
    for i, iss in enumerate(issues, 1):
        criterion = iss.get("criterion", "overlap_occlusion")
        color = _CRITERION_COLORS.get(criterion, "red")
        nodes = iss.get("nodes", [])
        edges = iss.get("edges", [])

        # Draw colored dashed rectangle around each flagged node
        for node_name in nodes:
            safe = node_name.replace("\\", "")
            overlay_lines.append(
                rf"  \node[draw={color}, dashed, ultra thick, rounded corners=3pt, "
                rf"inner sep=8pt, fit=({safe})] {{}};"
            )

        # Draw numbered label near the first flagged node (or first edge source)
        label_anchor = None
        if nodes:
            label_anchor = nodes[0].replace("\\", "")
        elif edges and len(edges[0]) >= 2:
            label_anchor = edges[0][0].replace("\\", "")
        if label_anchor:
            overlay_lines.append(
                rf"  \node[circle, fill={color}, text=white, font=\bfseries\footnotesize, "
                rf"inner sep=2pt, above left=2pt and 2pt of {label_anchor}] {{{i}}};"
            )

        # Draw colored dashed overlay arrows for flagged edges
        for edge in edges:
            if len(edge) >= 2:
                src = edge[0].replace("\\", "")
                dst = edge[1].replace("\\", "")
                overlay_lines.append(
                    rf"  \draw[{color}, ultra thick, dashed, -{{Stealth[length=4mm]}}] "
                    rf"({src}) -- ({dst});"
                )

    annotated_code = (
        tikz_code[:idx]
        + "\n".join(overlay_lines)
        + "\n"
        + tikz_code[idx:]
    )

    try:
        b64 = render_tikz_to_base64(annotated_code)
        logger.info(
            f"[TikZ Annotate] Built annotated image with {len(issues)} numbered issue(s)"
        )
        return b64
    except RuntimeError as e:
        logger.warning(f"[TikZ Annotate] Compile failed, skipping annotations: {e}")
        return None


# ── Polisher ─────────────────────────────────────────────────────────

def _call_polisher(
    tikz_code: str,
    image_b64: str,
    title: str,
) -> str:
    """
    Call the polisher agent (Pass 2) to improve spacing, alignment, and
    visual balance of an already-correct diagram without changing structure.

    Returns: Improved TikZ code body.
    """
    client = _get_inference_client()

    user_text = (
        f"Polish this TikZ diagram for better visual quality.\n"
        f"Title: {title}\n\n"
        f"Current TikZ code:\n```tikz\n{tikz_code}\n```\n\n"
        f"The rendered image is attached. Improve spacing, alignment, "
        f"and label placement. Output ONLY the improved TikZ code body."
    )

    messages = [
        {"role": "system", "content": GENERATOR_POLISH_PROMPT},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": user_text},
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{image_b64}", "detail": "high"},
                },
            ],
        },
    ]

    response = client.with_options(
        timeout=POLISHER_TIMEOUT_SECONDS,
        max_retries=0,
    ).chat.completions.create(
        model=POLISHER_MODEL,
        messages=messages,
        max_completion_tokens=8192,
        temperature=0.2,
    )
    _track_usage(response)

    raw = response.choices[0].message.content or ""
    polished = _extract_tikz_code(raw)
    if not polished:
        logger.warning("[TikZ Polisher] Empty output, keeping original code")
        return tikz_code
    logger.info(f"[TikZ Polisher] Produced {len(polished)} chars of polished TikZ code")
    return polished


# ── Orchestrator ─────────────────────────────────────────────────────

def generate_tikz_diagram(
    description: str,
    title: str,
    max_compile_retries: Optional[int] = None,
    max_discriminator_rounds: Optional[int] = None,
    force_all_rounds: bool = False,
) -> Tuple[str, Dict[str, Any]]:
    """
    Two-pass Generator \u2192 Compile \u2192 Discriminator pipeline with graduated thresholds.

    Pass 1 (Structure): Generator creates the diagram, discriminator evaluates with
    graduated strictness (round 1\u21926, round 2\u21927, rounds 3+\u21928).
    Pass 2 (Polish): Polisher agent refines spacing/alignment, must compile cleanly.

    Args:
        max_compile_retries: Override MAX_COMPILE_RETRIES (default from module constant).
        max_discriminator_rounds: Override MAX_DISCRIMINATOR_ROUNDS (default from module constant).
        force_all_rounds: When True, always run all discriminator rounds (no early exit).

    Returns:
        (base64_png, metadata_dict)
    """
    _max_compile = max_compile_retries if max_compile_retries is not None else MAX_COMPILE_RETRIES
    _max_disc = max_discriminator_rounds if max_discriminator_rounds is not None else MAX_DISCRIMINATOR_ROUNDS
    _reset_usage()
    t0 = time.time()
    tikz_code = ""
    image_b64 = ""
    feedback = ""
    compile_attempts = 0
    discriminator_rounds = 0
    round_snapshots: list[Dict[str, Any]] = []  # collected for callers that want per-round images
    # Best *scored* candidate, so a regression in a later round can never ship.
    best_score = -1.0
    best_code = ""
    best_image = ""

    def _remember(score: float, code: str, image: str, label: str) -> None:
        nonlocal best_score, best_code, best_image
        if image and score > best_score:
            best_score, best_code, best_image = score, code, image
            logger.info(f"[TikZ Pipeline] New best: {label} (score={score})")

    # ── Pass 1: Generate + Compile (with L1 retries) ─────────────
    for attempt in range(1, _max_compile + 1):
        compile_attempts = attempt
        logger.info(f"[TikZ Pipeline] Generate attempt {attempt}/{_max_compile}")

        tikz_code = _call_generator(
            description=description,
            title=title,
            previous_code=tikz_code if feedback else "",
            feedback=feedback,
            image_b64=image_b64,
        )

        b64, error = _compile_tikz(tikz_code)

        if b64 is not None:
            image_b64 = b64
            feedback = ""
            break
        else:
            feedback = _compile_feedback(error)
            logger.warning(f"[TikZ Pipeline] Compile failed (attempt {attempt}): {error}")

    if not image_b64:
        raise RuntimeError(
            f"TikZ compilation failed after {_max_compile} attempts. "
            f"Last error: {feedback}"
        )

    # Snapshot: initial generation
    round_snapshots.append({"label": "Initial generation", "image_b64": image_b64, "score": None})

    # ── Pass 1 continued: Discriminator feedback loop (L2) ───────
    final_score = 10  # assume perfect if discriminator is skipped

    for d_round in range(1, _max_disc + 1):
        discriminator_rounds = d_round
        threshold = GRADUATED_THRESHOLDS[min(d_round - 1, len(GRADUATED_THRESHOLDS) - 1)]
        logger.info(
            f"[TikZ Pipeline] Discriminator round {d_round}/{_max_disc} "
            f"(threshold={threshold})"
        )

        verdict = _call_discriminator(image_b64, tikz_code, description, title, d_round)
        final_score = verdict.get("average", 10)
        # A verdict we could not read carries no score, so it must not win best-so-far.
        if not verdict.get("parse_failed"):
            _remember(final_score, tikz_code, image_b64, f"discriminator round {d_round}")

        # Shadow mode: measure geometry alongside the VLM verdict, but do not gate on it.
        if geometry_check_enabled():
            geom_report = check_tikz_geometry(tikz_code)
            if geom_report:
                round_snapshots[-1]["geometry"] = geom_report
                logger.info(
                    f"[TikZ Geometry] round {d_round}: {geom_report.get('verdict')} "
                    f"score={geom_report.get('geometry_score')} "
                    f"failed={geom_report.get('failed_gates')}"
                )

        # Update snapshot with per-criterion scores, pass info, and feedback
        round_snapshots[-1]["score"] = final_score
        round_snapshots[-1]["scores"] = verdict.get("scores", {})
        round_snapshots[-1]["criteria_pass"] = verdict.get("criteria_pass", {})
        round_snapshots[-1]["issues"] = verdict.get("issues", [])
        round_snapshots[-1]["suggestions"] = verdict.get("suggestions", [])

        # Build annotated image highlighting issues with numbered, color-coded boxes
        issues = verdict.get("issues", [])
        structured_issues = issues if issues and isinstance(issues[0], dict) else []
        flagged = verdict.get("flagged_nodes", [])
        flagged_edges = verdict.get("flagged_edges", [])
        flagged_lines = verdict.get("flagged_lines", [])
        round_snapshots[-1]["flagged_nodes"] = flagged
        round_snapshots[-1]["flagged_edges"] = flagged_edges
        round_snapshots[-1]["flagged_lines"] = flagged_lines
        annotated_b64 = _build_annotated_image(tikz_code, structured_issues)
        if annotated_b64:
            round_snapshots[-1]["annotated_b64"] = annotated_b64

        # All criteria must individually pass their threshold
        passed = verdict.get("all_pass", final_score >= threshold)
        if passed:
            logger.info(
                f"[TikZ Pipeline] PASSED discriminator "
                f"(score={final_score}, threshold={threshold})"
            )
            if not force_all_rounds or d_round == _max_disc:
                break
            # force_all_rounds: still regenerate to show progression
            logger.info("[TikZ Pipeline] force_all_rounds=True, continuing...")

        # Build feedback for the generator — structured per-issue with box references
        issues = verdict.get("issues", [])
        suggestions = verdict.get("suggestions", [])
        critique_parts = []

        # Lead with the scorecard: without it the generator cannot tell which
        # criteria failed, by how much, or what it needs to reach.
        scores = verdict.get("scores") or {}
        if scores:
            scorecard = [
                f"Scores this round (each must reach {threshold}/10 to pass):"
            ]
            for key in CRITERIA_KEYS:
                if key not in scores:
                    continue
                value = scores[key]
                status = "PASS" if value >= threshold else f"FAIL — needs +{threshold - value}"
                scorecard.append(f"  {key:<18} {value}/10   {status}")
            scorecard.append(f"  {'average':<18} {verdict.get('average', '?')}/10")
            failing = [k for k in CRITERIA_KEYS if k in scores and scores[k] < threshold]
            if failing:
                scorecard.append(
                    "Prioritise the failing criteria: " + ", ".join(failing)
                )
            critique_parts.append("\n".join(scorecard))

        if issues and isinstance(issues[0], dict):
            # New structured format: each issue has a box number matching the annotated image
            critique_parts.append(
                "The annotated image shows numbered colored boxes around problematic components. "
                "Each issue below corresponds to a box number in the image."
            )
            for issue_idx, iss in enumerate(issues, 1):
                criterion = iss.get("criterion", "unknown")
                parts = [f"[Box #{issue_idx} — {criterion}] {iss.get('description', 'Unknown')}"]
                nodes = iss.get("nodes", [])
                edges = iss.get("edges", [])
                lines = iss.get("lines", [])
                if nodes:
                    parts.append(f"  Components: {', '.join(nodes)}")
                if edges:
                    edge_strs = [f"{e[0]}→{e[1]}" for e in edges if len(e) >= 2]
                    parts.append(f"  Edges: {', '.join(edge_strs)}")
                if lines:
                    parts.append(f"  Code lines: {', '.join(str(n) for n in lines)}")
                suggestion = iss.get("suggestion", "")
                if suggestion:
                    parts.append(f"  Fix: {suggestion}")
                critique_parts.append("\n".join(parts))
        else:
            # Legacy flat format
            if issues:
                critique_parts.append("Issues found:\n" + "\n".join(f"- {i}" for i in issues))
            if suggestions:
                critique_parts.append("Suggestions:\n" + "\n".join(f"- {s}" for s in suggestions))
            if flagged:
                critique_parts.append(
                    "Flagged components (TikZ node names): " + ", ".join(flagged)
                )
            if flagged_edges:
                edge_strs = [f"{e[0]}→{e[1]}" for e in flagged_edges if len(e) >= 2]
                if edge_strs:
                    critique_parts.append(
                        "Flagged edges (arrows needing re-routing): " + ", ".join(edge_strs)
                    )
            if flagged_lines:
                critique_parts.append(
                    "Flagged lines in your code: " + ", ".join(str(n) for n in flagged_lines)
                )

        if passed and force_all_rounds:
            # Passed but forcing rounds — keep the scorecard so the polish pass
            # knows which criterion is weakest.
            polish = (
                "The diagram passes but can be improved further. Suggestions:\n"
                + "\n".join(f"- {s}" for s in suggestions)
                if suggestions
                else "The diagram passes. Improve spacing, alignment, and label clarity."
            )
            feedback = "\n\n".join([*critique_parts[:1], polish]) if critique_parts else polish
        else:
            feedback = "\n\n".join(critique_parts)

        logger.info(
            f"[TikZ Pipeline] {'PASSED but forcing round' if passed else 'FAILED'} discriminator "
            f"(score={final_score}, threshold={threshold}), regenerating..."
        )

        # Regenerate with feedback (includes inner compile loop)
        for compile_try in range(1, _max_compile + 1):
            compile_attempts += 1

            # Send annotated image (with red outlines) if available, else original
            gen_image = annotated_b64 if annotated_b64 else image_b64
            tikz_code = _call_generator(
                description=description,
                title=title,
                previous_code=tikz_code,
                feedback=feedback,
                image_b64=gen_image,
            )

            b64, error = _compile_tikz(tikz_code)

            if b64 is not None:
                image_b64 = b64
                feedback = ""  # clear compile feedback for next discriminator check
                # Snapshot: after regeneration from discriminator feedback
                round_snapshots.append({
                    "label": f"After feedback round {d_round}",
                    "image_b64": image_b64,
                    "score": None,
                })
                break
            else:
                feedback = _compile_feedback(
                    error, prefix="\n\n".join(critique_parts) + "\n\nAlso, "
                )
                logger.warning(
                    f"[TikZ Pipeline] Compile failed in D-round {d_round}, "
                    f"attempt {compile_try}: {error}"
                )

        if not image_b64:
            raise RuntimeError("TikZ compilation failed during discriminator feedback loop")

    # ── Pass 2: Polish ───────────────────────────────────────────
    logger.info("[TikZ Pipeline] Pass 2: Polishing diagram...")
    polish_available = True
    try:
        polished_code = _call_polisher(tikz_code, image_b64, title)
        b64_polished, error_polished = _compile_tikz(polished_code)
        if b64_polished is not None:
            tikz_code = polished_code
            image_b64 = b64_polished
            round_snapshots.append({"label": "After polish", "image_b64": image_b64, "score": None})
            logger.info("[TikZ Pipeline] Polish pass compiled successfully")
        else:
            logger.warning(
                f"[TikZ Pipeline] Polish pass compile failed ({error_polished}), "
                f"keeping pre-polish version"
            )
    except Exception as polish_error:
        polish_available = False
        logger.warning(
            f"[TikZ Pipeline] Polish pass unavailable ({polish_error}); "
            "keeping pre-polish version"
        )

    if not polish_available and best_image:
        tikz_code, image_b64 = best_code, best_image
        final_score = best_score
        round_snapshots.append({
            "label": "Polish unavailable; using best-scoring round",
            "image_b64": image_b64,
            "score": best_score,
        })

    # ── Final evaluation ─────────────────────────────────────────
    # The last regeneration and the polish pass were never scored, so without this
    # the shipped image is the one artifact nobody evaluated. Score it, then ship
    # whichever candidate actually scored best.
    if _max_disc > 0 and image_b64 and polish_available:
        try:
            final_verdict = _call_discriminator(
                image_b64,
                tikz_code,
                description,
                title,
                discriminator_rounds or 1,
                timeout_seconds=FINAL_EVALUATION_TIMEOUT_SECONDS,
            )
            final_candidate_score = final_verdict.get("average", 0)
            round_snapshots[-1]["score"] = final_candidate_score
            round_snapshots[-1]["scores"] = final_verdict.get("scores", {})
            if not final_verdict.get("parse_failed"):
                _remember(final_candidate_score, tikz_code, image_b64, "final candidate")
        except Exception as final_evaluation_error:
            logger.warning(
                f"[TikZ Pipeline] Final evaluation unavailable ({final_evaluation_error}); "
                "shipping the best previously scored candidate"
            )

        if best_image and best_image != image_b64:
            logger.warning(
                f"[TikZ Pipeline] Reverting to best scored candidate ({best_score})"
            )
            tikz_code, image_b64 = best_code, best_image
            round_snapshots.append({
                "label": "Reverted to best-scoring round",
                "image_b64": image_b64,
                "score": best_score,
            })
        final_score = best_score

    elapsed = time.time() - t0
    metadata = {
        "generator_model": GENERATOR_MODEL,
        "discriminator_model": DISCRIMINATOR_MODEL,
        "generator_agent": GENERATOR_AGENT_NAME,
        "discriminator_agent": DISCRIMINATOR_AGENT_NAME,
        "polisher_agent": POLISHER_AGENT_NAME,
        "compile_attempts": compile_attempts,
        "discriminator_rounds": discriminator_rounds,
        "final_score": final_score,
        "total_time_sec": round(elapsed, 1),
        "input_tokens": _token_usage["input_tokens"],
        "output_tokens": _token_usage["output_tokens"],
        "total_tokens": _token_usage["input_tokens"] + _token_usage["output_tokens"],
        "round_snapshots": round_snapshots,
    }

    logger.info(
        f"[TikZ Pipeline] Complete in {elapsed:.1f}s — "
        f"compiles={compile_attempts}, d-rounds={discriminator_rounds}, score={final_score}, "
        f"tokens={_token_usage['input_tokens']}in/{_token_usage['output_tokens']}out"
    )

    return image_b64, metadata


# ── Tool handler ───────────────────────────────────────────────

def _build_tikz_result(arguments: Dict[str, Any]) -> Dict[str, Any]:
    """Run the TikZ generator-discriminator pipeline and return the payload."""
    description = arguments.get("description", "")
    title = arguments.get("title", "Diagram")
    caption = arguments.get("caption", "")

    if not description:
        return {
            "type": "tikz_image",
            "title": title,
            "imageData": "",
            "caption": "No diagram description provided.",
            "visualizationType": "tikz_agent",
            "error": True,
        }

    # The calling agent sizes the critique loop to the diagram's complexity.
    try:
        feedback_rounds = int(arguments.get("feedback_rounds") or MAX_DISCRIMINATOR_ROUNDS)
    except (TypeError, ValueError):
        feedback_rounds = MAX_DISCRIMINATOR_ROUNDS
    feedback_rounds = max(1, min(feedback_rounds, MAX_FEEDBACK_ROUNDS))

    logger.info(
        f"[add_tikz_diagram] title={title}, desc_len={len(description)}, "
        f"feedback_rounds={feedback_rounds}"
    )

    try:
        image_b64, metadata = generate_tikz_diagram(
            description, title, max_discriminator_rounds=feedback_rounds
        )
    except Exception as e:
        logger.error(f"[add_tikz_diagram] Pipeline failed: {e}", exc_info=True)
        return {
            "type": "tikz_image",
            "title": title,
            "imageData": "",
            "caption": f"Diagram generation failed: {e}",
            "visualizationType": "tikz_agent",
            "error": True,
        }

    return {
        "type": "tikz_image",
        "title": title,
        "imageData": image_b64,
        "caption": caption or "",
        "visualizationType": "tikz_agent",
    }


class AddTikzDiagramTool(CustomTool):
    """Generate an educational TikZ diagram via a generator-discriminator pipeline."""

    name = "add_tikz_diagram"

    def execute(self, arguments: Dict[str, Any], **context: Any) -> Dict[str, Any]:
        return _build_tikz_result(arguments)

    def output(self, result: Dict[str, Any], arguments: Dict[str, Any]) -> str:
        if result.get("error"):
            description = arguments.get("description", "")
            return (
                f"TikZ diagram generation FAILED for: '{description[:80]}...'. "
                "Describe the diagram verbally instead."
            )
        title = result.get("title", "Diagram")
        return (
            f"TikZ diagram '{title}' generated and validated by the diagram agent. "
            "It has been displayed to the user. Continue with your explanation."
        )

