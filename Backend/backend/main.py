# main.py
import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment configuration. APP_ENV selects the per-environment file
# (.env.development by default, or .env.production / .env.test). Precedence,
# highest first: OS / App Service settings > .env.<APP_ENV> > .env (shared base).
_BACKEND_DIR = Path(__file__).resolve().parent.parent
_APP_ENV = (os.getenv("APP_ENV") or "development").strip().lower()
load_dotenv(_BACKEND_DIR / f".env.{_APP_ENV}")  # environment-specific overrides win
load_dotenv(_BACKEND_DIR / ".env")              # shared base / fallback

from fastapi import (
    FastAPI,
    UploadFile,
    File,
    Form,
    HTTPException,
    Depends,
    Body,
    Query,
    BackgroundTasks,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.encoders import jsonable_encoder
from fastapi.responses import RedirectResponse, JSONResponse, FileResponse, StreamingResponse, HTMLResponse, Response
from fastapi.openapi.docs import get_swagger_ui_html
from starlette.requests import Request
from contextlib import asynccontextmanager

from urllib.parse import quote
from io import BytesIO

from typing import List, Optional, Dict, Any, Literal, Tuple
from pathlib import Path
from datetime import datetime, timezone
from uuid import uuid4
import shutil
import os
import re
import time
import asyncio
import logging
import json
import threading
import functools
import queue
from docx import Document

from pydantic import BaseModel

# ---------- Azure SDK ----------
from azure.ai.projects import AIProjectClient
from azure.core.exceptions import HttpResponseError

# ---------- Your modules ----------
from utils.prompt_unifier import unify_agent_prompts
from custom_agents.learning_agent_manager import LearningAgentManager

# ---------- Agent modules (AIProjectClient with MCP support) ----------
from azure_services.agents.agent_creation import AgentCreator, ConversationManager
from azure_services.tools.memory.memory_store_manager import (
    MemoryStoreManager,
    get_memory_store_manager,
    create_memory_store_for_agent,
    delete_memory_store_for_agent,
)
from base_agents.general_agent import GeneralAgent, get_general_agent, with_suggested_queries

# central auth (AUTO: Default -> CLI fallback)
from common_azure_auth import (
    get_async_credential,
    get_sync_credential,
    get_token_with_retry,
    close_async_credential,
)

# ---- Entra ID (Azure AD) server-side authentication ----
from auth import EntraAuth, create_session_token, verify_session_token

# ---- Google OAuth 2.0 authentication ----
from google_auth import GoogleAuth

# ===================== Config =====================


def _require_env(name: str) -> str:
    """Return a required environment variable, failing fast instead of falling back.

    Infrastructure identifiers (subscription, resource group, endpoints, admin
    identity) must never carry hardcoded defaults: a wrong default silently
    points a deployment at someone else's Azure resources.
    """
    value = os.getenv(name)
    if not value:
        raise RuntimeError(
            f"Missing required environment variable: {name}. "
            "Set it in Backend/.env for local runs, or in the App Service "
            "configuration for deployed environments."
        )
    return value


# Using gpt-5.2-chat for all operations (inference + agent creation)
DEFAULT_MODEL_DEPLOYMENT = os.getenv("AZURE_AI_MODEL_DEPLOYMENT_NAME", "gpt-5.2-chat")
AGENT_MODEL_DEPLOYMENT = os.getenv("AZURE_AI_AGENT_MODEL_DEPLOYMENT", "gpt-5.2-chat")
ALLOWED_DEPLOYMENTS = set(
    (os.getenv("AZURE_ALLOWED_DEPLOYMENTS") or "gpt-5.2-chat,gpt-4.1,gpt-4.1-mini")
    .replace(" ", "")
    .split(",")
)

PROJECT_ENDPOINT = _require_env("AZURE_AI_PROJECT_ENDPOINT")
# ARM Resource ID for MCP project connections
PROJECT_RESOURCE_ID = _require_env("PROJECT_RESOURCE_ID")
# Azure AI Search endpoint for MCP
AZURE_AI_SEARCH_ENDPOINT = _require_env("AZURE_AI_SEARCH_ENDPOINT")

# Meta-agent IDs (new Foundry agents)
# CACA (Teaching Assistant Creation Agent): Generates both learning AND exam instructions
# Temp Teaching Assistant: Preview agent in edit mode
# CCA (Course Conversational Agent): Builder agent in edit mode
COURSE_AGENT_CREATION_AGENT_ID = "course-agent-creation-agent"  # CACA
TEMP_COURSE_AGENT_ID = "temp-course-agent"
COURSE_CONVERSATIONAL_AGENT_ID = "course-conversational-agent"  # CCA

# Local runtime data. Anchored to the backend package, not the working directory,
# so these resolve identically however the app is launched. Azure Blob Storage
# remains the source of truth; these are a local cache/backup.
USER_DATA_BASE = _BACKEND_DIR / "user_data"
SESSION_DOCS_BASE = USER_DATA_BASE / "session_docs"
AGENT_SETUPS_BASE = USER_DATA_BASE / "agent_setups"
SESSION_DOCS_BASE.mkdir(parents=True, exist_ok=True)
AGENT_SETUPS_BASE.mkdir(parents=True, exist_ok=True)

N_SAMPLES = 3

BACKEND_VERSION = "2025-12-09-01"

# ---- Auth config ----
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
AUTH_CLIENT_ID = os.getenv("AZURE_AUTH_CLIENT_ID") or _require_env("VITE_AZURE_CLIENT_ID")
# App registration is single-tenant (Microsoft corp policy blocks multi-tenant).
# To allow personal accounts, create a new app registration in a non-Microsoft tenant.
AUTH_TENANT_ID = os.getenv("AZURE_AUTH_TENANT_ID", os.getenv("VITE_AZURE_TENANT_ID", "common"))
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")
AUTH_REDIRECT_URI = os.getenv("AUTH_REDIRECT_URI", f"{BACKEND_URL}/auth/callback")

entra_auth = EntraAuth(
    client_id=AUTH_CLIENT_ID,
    tenant_id=AUTH_TENANT_ID,
    redirect_uri=AUTH_REDIRECT_URI,
)

# ---- Google OAuth config ----
GOOGLE_CLIENT_ID = _require_env("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
if not GOOGLE_CLIENT_SECRET:
    raise RuntimeError("GOOGLE_CLIENT_SECRET is required")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", f"{BACKEND_URL}/auth/google/callback")

google_auth: GoogleAuth | None = None
if GOOGLE_CLIENT_ID:
    google_auth = GoogleAuth(
        client_id=GOOGLE_CLIENT_ID,
        redirect_uri=GOOGLE_REDIRECT_URI,
        client_secret=GOOGLE_CLIENT_SECRET,
    )

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ekalaiva.api")

# Reduce Azure SDK verbosity - hide HTTP request/response details
logging.getLogger("azure.cosmos._cosmos_http_logging_policy").setLevel(logging.WARNING)
logging.getLogger("azure.identity").setLevel(logging.WARNING)
logging.getLogger("azure.core.pipeline.policies.http_logging_policy").setLevel(logging.WARNING)
logging.getLogger("azure.core").setLevel(logging.WARNING)

SAFE_NAME_RE = re.compile(r"[^a-zA-Z0-9_\-]+")

# NOTE: Document generation, quiz, flashcard, and knowledge retrieval instructions
# are now part of the core prompt files (tool_handling.md and knowledge_grounding.md).
# No extra constants needed — prompt_unifier handles everything.

from fastapi.middleware.cors import CORSMiddleware

# ===================== Helpers =====================

from docx import Document

def _extract_docx_text(docx_path: Path) -> str:
    doc = Document(str(docx_path))

    parts = []
    # paragraphs
    for p in doc.paragraphs:
        t = (p.text or "").strip()
        if t:
            parts.append(t)

    # tables (common for notes)
    for table in doc.tables:
        for row in table.rows:
            cells = [ (c.text or "").strip() for c in row.cells ]
            line = " | ".join([c for c in cells if c])
            if line.strip():
                parts.append(line)

    return "\n\n".join(parts).strip()

def _estimate_tokens(text: str) -> int:
    # cheap approximation; good enough for “memory” display
    return max(1, (len(text) + 3) // 4)


KB_SCOPES = {"learning", "exam", "course"}

def _require_scope(scope: str) -> str:
    scope = (scope or "").strip().lower()
    if scope not in KB_SCOPES:
        raise HTTPException(status_code=400, detail=f"Invalid kb_scope '{scope}'. Use one of: {sorted(KB_SCOPES)}")
    return scope

def _require_session(session: str) -> str:
    session = (session or "").strip()
    if not session:
        raise HTTPException(status_code=400, detail="session is required")
    # prevent path traversal / weird paths
    session = Path(session).name
    if not session:
        raise HTTPException(status_code=400, detail="invalid session")
    return session

def _kb_base(session: str, kb_scope: str) -> Path:
    kb_scope = _require_scope(kb_scope)
    session = _require_session(session)
    return SESSION_DOCS_BASE / kb_scope / session


def _agent_setup_dir(agent_id: str) -> Path:
    """Agent setup folder for ``agent_id``, rejecting ids that escape AGENT_SETUPS_BASE."""
    # Path(...).name drops any directory component, so "../../etc" collapses to "etc".
    name = Path((agent_id or "").strip()).name
    if not name or name in (".", ".."):
        raise HTTPException(status_code=400, detail="invalid agent id")
    return AGENT_SETUPS_BASE / name



# NOTE: Removed tc_packet_to_json (only used by deprecated CACA endpoints)


def sanitize_agent_name(name: str) -> str:
    """
    Sanitize agent name to comply with Azure requirements:
    - Must start and end with alphanumeric characters
    - Can contain hyphens in the middle
    - Must not exceed 63 characters
    """
    # Replace any non-alphanumeric chars with hyphens
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "-", (name or "").strip())
    # Remove leading/trailing hyphens
    cleaned = cleaned.strip("-")
    # Collapse multiple hyphens
    cleaned = re.sub(r"-+", "-", cleaned)
    # Truncate to 63 chars and ensure it doesn't end with hyphen after truncation
    cleaned = cleaned[:63].rstrip("-")
    return cleaned or "learning-agent"


def extract_teacher_markdown_from_cca_response(text: str) -> str:
    """
    Given a full Course Conversational Agent (CCA) response (Markdown + trailing ```json block),
    return only the teacher-facing Markdown.

    If no ```json block is present, we just return the whole text.
    """
    if not text:
        return ""
    start_tag = "```json"
    idx = text.rfind(start_tag)
    if idx == -1:
        # No JSON block found; assume entire message is Markdown
        return text.strip()
    # Everything before the JSON block is the Markdown spec
    return text[:idx].rstrip()


def docx_to_text(path: Path) -> str:
    doc = Document(str(path))
    parts: list[str] = []

    # paragraphs
    for p in doc.paragraphs:
        t = (p.text or "").strip()
        if t:
            parts.append(t)

    # tables (tab-separated)
    for table in doc.tables:
        for row in table.rows:
            cells = [(" ".join((c.text or "").split())).strip() for c in row.cells]
            line = "\t".join([c for c in cells if c])
            if line.strip():
                parts.append(line)

    return "\n\n".join(parts).strip()


# ===================== Meta-Agent Helpers (Teaching Assistant Creation) =====================

def redact_pii_for_model(text: str) -> str:
    """
    Redact phone numbers and age references before sending text to Azure OpenAI.

    Azure's content-management PII filter blocks prompts that contain detectable
    personal data, which causes a `content_filter` 400 error. Course descriptions
    trip two sub-categories in practice: PhoneNumber, and Age — the latter fires on
    ordinary phrasing like "ages 6-10" or "7-year-olds", which is common and
    entirely legitimate in course material. Replacing them with a neutral
    placeholder keeps the prompt useful while passing the filter.
    """
    if not text:
        return text

    # International / national phone numbers: optional +country code, then 7-15
    # digits separated by spaces, dashes, dots, or parentheses.
    phone_pattern = re.compile(
        r"(?<!\w)(?:\+?\d{1,3}[\s.\-]?)?(?:\(\d{1,4}\)[\s.\-]?)?(?:\d[\s.\-]?){7,14}\d(?!\w)"
    )

    def _replace(match: "re.Match[str]") -> str:
        candidate = match.group(0)
        digit_count = sum(ch.isdigit() for ch in candidate)
        # Only redact if it really looks like a phone number (7-15 digits).
        if 7 <= digit_count <= 15:
            return "[redacted]"
        return candidate

    text = phone_pattern.sub(_replace, text)

    # Explicit age expressions only — anchored on "age(d)" or "year(s) old" so
    # that "Grade 5", "Level 1", "3 Months" and course codes are left intact.
    age_patterns = (
        re.compile(r"\b(?:ages?|aged)\s+\d{1,2}\s*(?:[-–—]|to)\s*\d{1,2}\b", re.I),
        re.compile(r"\b(?:ages?|aged)\s+\d{1,2}\s*\+?", re.I),
        re.compile(r"\b\d{1,2}\s*(?:[-–—]|\s)\s*year[-\s]?olds?\b", re.I),
        re.compile(r"\b\d{1,2}\s+years?\s+of\s+age\b", re.I),
    )
    for pattern in age_patterns:
        text = pattern.sub("[redacted]", text)

    return text


async def call_meta_agent_for_prompt(
    *,
    course_name: str,
    course_level: str = "",
    course_duration: str = "",
    course_description: str = "",
    prerequisites: str = "",
) -> Tuple[str, str, List[str]]:
    """
    Call course-agent-creation-agent (CACA) meta-agent to generate a Teaching Assistant
    Specification (§1-§5) plus a library description.
    
    Returns a tuple of (description, instructions, conversation_starters) where:
    - description: A 300-char summary for the agent library
    - instructions: The CACA course-specific specification (§1-§5)
    - conversation_starters: Always [] — starters are now generated dynamically
      by the teaching assistant itself via /api/agents/{id}/conversation-starters
    
    Uses AIProjectClient with conversations/responses API and agent reference.
    """
    from azure.identity import DefaultAzureCredential
    import asyncio
    
    # Build the course brief for CACA (matching caca_prompt.md Input spec)
    request_parts = [
        f"Create a teaching assistant specification for the following course:",
        f"",
        f"**Subject + Target Level:** {course_name}",
    ]
    if course_level:
        request_parts.append(f"**Level:** {course_level}")
    if course_duration:
        request_parts.append(f"**Duration:** {course_duration}")
    if course_description:
        request_parts.append(f"**Course Description:** {course_description}")
    if prerequisites:
        request_parts.append(f"**Prerequisites:** {prerequisites}")
    
    request_parts.extend([
        "",
        "Generate a JSON response with this structure:",
        "",
        '```json',
        '{',
        '  "description": "A 300-char-or-less summary for the agent library",',
        '  "instructions": "The Teaching Assistant Specification with sections §1-§5 as defined in your system prompt"',
        '}',
        '```',
        "",
        "Requirements:",
        "- description: A compelling summary (max 300 chars) for the library card",
        "- instructions: Your full §1-§5 Teaching Assistant Specification output — identity, example threshold concepts & concept inventories, content & notation profile, contextual framing, teacher preferences. Do NOT include pedagogical theory, tool instructions, tone rules, safety rules, or retrieval rules (those are handled by core modules).",
        "",
        "Return ONLY the JSON, no other text.",
    ])
    
    request_message = "\n".join(request_parts)
    
    # Redact phone-number-like PII so Azure's content-management filter does not
    # reject the prompt with a `content_filter` 400 error.
    request_message = redact_pii_for_model(request_message)
    
    # Use AIProjectClient with conversations/responses API and agent reference
    def _run_meta_agent():
        from azure.ai.projects import AIProjectClient
        client = AIProjectClient(
            endpoint=PROJECT_ENDPOINT,
            credential=get_sync_credential()
        )
        try:
            # Get OpenAI client for conversations/responses
            openai_client = client.get_openai_client()
            
            # Create conversation
            conversation = openai_client.conversations.create()
            
            # Send request using agent reference
            response = openai_client.responses.create(
                conversation=conversation.id,
                input=request_message,
                extra_body={"agent": {"name": COURSE_AGENT_CREATION_AGENT_ID, "type": "agent_reference"}}
            )
            
            if not response.output_text:
                raise RuntimeError("No response from meta-agent")
            
            return response.output_text
        finally:
            client.close()
    
    # Run sync code in thread pool
    loop = asyncio.get_event_loop()
    raw_response = await loop.run_in_executor(None, _run_meta_agent)
    
    logger.info(f"Meta-agent generated response of length {len(raw_response)}")
    
    # Parse JSON response
    description = ""
    instructions = raw_response  # Fallback: use entire response as instructions
    conversation_starters: List = []  # Always empty — starters generated dynamically by teaching assistants
    
    # Try to extract JSON from response
    try:
        # Find JSON block in response (may be wrapped in ```json ... ```)
        json_text = raw_response
        if "```json" in raw_response:
            json_start = raw_response.find("```json") + len("```json")
            json_end = raw_response.find("```", json_start)
            if json_end > json_start:
                json_text = raw_response[json_start:json_end].strip()
        elif "```" in raw_response:
            json_start = raw_response.find("```") + len("```")
            json_end = raw_response.find("```", json_start)
            if json_end > json_start:
                json_text = raw_response[json_start:json_end].strip()
        
        parsed = json.loads(json_text)
        description = parsed.get("description", "")[:300]
        instructions = parsed.get("instructions", raw_response)
        logger.info(f"Successfully parsed meta-agent JSON response")
    except json.JSONDecodeError as e:
        logger.warning(f"Failed to parse JSON from meta-agent, using raw response: {e}")
        # Use the raw response as instructions
        description = f"AI-powered course assistant for {course_name}."[:300]
    
    # If no description found, generate a default
    if not description:
        description = f"AI-powered course assistant for {course_name}. "
        if course_level:
            description += f"Designed for {course_level} level students. "
        description = description[:300]
    
    return (description, instructions, conversation_starters)


# NOTE: Removed deprecated helper functions:
# - sync_cca_markdown_for_thread
# - extract_agent_meta_from_caca
# - ensure_thread_idle
# - ACTIVE_STATUSES
# These were only used by deprecated CACA endpoints.


def strip_final_json_block(text: str) -> str:
    """
    Remove the last fenced ```json ... ``` block from a string, if present.
    Leaves only the teacher-facing Markdown from the CCA reply.
    """
    start_tag = "```json"
    end_tag = "```"
    last_start = text.rfind(start_tag)
    last_end = text.rfind(end_tag)
    if last_start == -1 or last_end == -1 or last_end <= last_start:
        return text
    return text[:last_start].rstrip()


# ===================== Course / Agent chat models =====================

ChatRole = Literal["user", "assistant", "system"]


class CourseChatMessage(BaseModel):
    id: str
    chat_id: str
    role: ChatRole
    content: str
    created_at: datetime


class CourseChatSession(BaseModel):
    id: str
    session_uuid: Optional[str] = None
    course_name: Optional[str] = None
    course_slug: Optional[str] = None
    agent_kind: Literal["learning", "exam", "other"] = "learning"
    agent_id: str
    agent_name: Optional[str] = None
    title: str
    azure_thread_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    messages: List[CourseChatMessage] = []


class CourseChatSendRequest(BaseModel):
    text: str


class CourseChatSendResponse(BaseModel):
    session: CourseChatSession


# ===================== Agent Setup Details =====================

class AgentSetupDetails(BaseModel):
    agentId: str
    agentKind: Literal["learning", "exam", "course"]
    courseName: str
    courseLevel: str
    courseDuration: str
    additionalContext: str
    courseCode: Optional[str] = None
    prerequisites: Optional[List[str]] = None
    textbooks: Optional[List[Dict[str, Any]]] = None
    vectorStoreId: Optional[str] = None
    knowledgeUrls: List[Any] = []  # [{url, description}] or legacy [str]
    agentDescription: Optional[str] = None  # 300-char description for agent library
    conversationStarters: List[Any] = []  # Up to 15 starters: [{title, prompt}] or legacy [str]
    agentImageUrl: Optional[str] = None  # Blob Storage URL for agent image
    sessionUuid: Optional[str] = None  # Session UUID for KB file storage location


def _save_setup_json(agent_id: str, setup_data: dict):
    """Save agent setup to blob storage (primary) and local file (backup)."""
    from azure_services.persistence.cosmos_db import save_agent_setup
    # Blob storage (primary)
    save_agent_setup(agent_id, setup_data)
    # Local backup
    try:
        d = _agent_setup_dir(agent_id)
        d.mkdir(parents=True, exist_ok=True)
        with open(d / "setup.json", "w", encoding="utf-8") as f:
            json.dump(setup_data, f, indent=2, ensure_ascii=False)
    except Exception:
        pass


def _load_setup_json(agent_id: str) -> dict | None:
    """Load agent setup from blob storage (primary), local file, or reconstruct from Cosmos."""
    from azure_services.persistence.cosmos_db import load_agent_setup, save_agent_setup, get_agent_metadata

    def _backfill_starters(data: dict) -> dict:
        """If the setup blob/file is missing conversation starters, pull them from
        Cosmos metadata (source of truth) so the edit UI doesn't show them as empty."""
        if not data:
            return data
        if not data.get("conversationStarters"):
            try:
                meta = get_agent_metadata(agent_id)
                starters = (meta or {}).get("conversationStarters") or []
                if starters:
                    data["conversationStarters"] = starters
            except Exception as e:
                logger.warning(f"Could not backfill conversation starters for '{agent_id}': {e}")
        return data

    # 1. Blob storage (primary)
    data = load_agent_setup(agent_id)
    if data:
        return _backfill_starters(data)

    # 2. Local file fallback (auto-migrate to blob)
    f = _agent_setup_dir(agent_id) / "setup.json"
    if f.exists():
        with open(f, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        save_agent_setup(agent_id, data)
        return _backfill_starters(data)

    # 3. Reconstruct from agents_v1 Cosmos metadata
    meta = get_agent_metadata(agent_id)
    if meta:
        data = {
            "agentId": agent_id,
            "agentKind": meta.get("agentKind", "course"),
            "courseName": meta.get("courseName", ""),
            "courseLevel": meta.get("courseLevel", ""),
            "courseDuration": meta.get("courseDuration", ""),
            "courseCode": meta.get("courseCode", ""),
            "prerequisites": meta.get("prerequisites", []),
            "additionalContext": meta.get("additionalContext", ""),
            "vectorStoreId": meta.get("vectorStoreId") or meta.get("indexName", ""),
            "indexName": meta.get("indexName", ""),
            "knowledgeUrls": [],
            "agentDescription": meta.get("description", ""),
            "conversationStarters": meta.get("conversationStarters", []),
            "agentImageUrl": meta.get("agentImageUrl", ""),
            "knowledgeAttached": bool(meta.get("indexName")),
            "sessionUuid": meta.get("sessionUuid", ""),
            "textbooks": meta.get("textbooks", []),
        }
        # Persist reconstructed setup to blob for future reads
        save_agent_setup(agent_id, data)
        logger.info(f"Reconstructed setup.json for '{agent_id}' from Cosmos metadata")
        return data

    return None


COURSE_CHAT_SESSIONS: Dict[str, CourseChatSession] = {}
COURSE_CHAT_MESSAGES: Dict[str, List[CourseChatMessage]] = {}


def slugify_course_name(name: Optional[str]) -> Optional[str]:
    if not name:
        return None
    cleaned = SAFE_NAME_RE.sub("_", name.strip().lower())
    return cleaned or None


# ===================== FastAPI app (with lifespan) =====================

# Every chat/streaming endpoint is a sync `def`, so Starlette holds one AnyIO
# worker thread for the *entire* duration of each streamed response. AnyIO's
# default ceiling is 40 threads, which a few long agent turns plus background
# research can exhaust — at which point *all* further requests queue and the
# server appears frozen. These are I/O-bound (waiting on Azure), so a higher
# ceiling is safe. Override with EKALAIVA_MAX_SYNC_THREADS.
MAX_SYNC_THREADS = int(os.getenv("EKALAIVA_MAX_SYNC_THREADS", "160"))

# Upper bound on threads any single background research run may occupy, so a
# 12-module course cannot spawn 12 concurrent agent calls and starve chat.
RESEARCH_MAX_PARALLEL = int(os.getenv("EKALAIVA_RESEARCH_MAX_PARALLEL", "4"))

# Background research previously used a per-round `with ThreadPoolExecutor(...)`
# block. That cannot be cancelled, and concurrent.futures joins its worker
# threads (which are NOT daemon threads) via an atexit hook — so process exit
# stalls until every in-flight batch finishes. Under `uvicorn --reload` that
# blackouts the server for the whole research run. Instead we keep one
# explicitly-managed executor and tear it down from the lifespan.
_research_executor = None
_research_executor_lock = threading.Lock()

from concurrent.futures import CancelledError, as_completed

# Set during shutdown; research workers poll this and abort promptly.
RESEARCH_SHUTDOWN = threading.Event()


class ResearchShutdown(BaseException):
    """Raised inside a research worker when the server is shutting down.

    Deliberately derives from BaseException so the pipeline's broad
    ``except Exception`` retry handlers cannot swallow it and restart the work.
    """


def get_research_executor():
    """Return the shared research executor, creating it on first use."""
    global _research_executor
    with _research_executor_lock:
        if _research_executor is None:
            from concurrent.futures import ThreadPoolExecutor

            _research_executor = ThreadPoolExecutor(
                max_workers=RESEARCH_MAX_PARALLEL,
                thread_name_prefix="research",
            )
            logger.info(
                f"Research executor created (max_workers={RESEARCH_MAX_PARALLEL})"
            )
        return _research_executor


def raise_if_research_cancelled() -> None:
    """Abort the current research batch if the server is shutting down."""
    if RESEARCH_SHUTDOWN.is_set():
        raise ResearchShutdown("server shutting down")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # startup: widen the sync-endpoint thread pool (see MAX_SYNC_THREADS above)
    try:
        import anyio.to_thread

        limiter = anyio.to_thread.current_default_thread_limiter()
        previous = limiter.total_tokens
        limiter.total_tokens = MAX_SYNC_THREADS
        logger.info(
            f"Sync endpoint thread capacity: {previous} -> {limiter.total_tokens}"
        )
    except Exception as e:
        logger.warning(f"Could not raise sync thread capacity: {e}")
    try:
        from teacher_dashboard.token_stats import sync_foundry_usage_to_cosmos

        threading.Thread(
            target=sync_foundry_usage_to_cosmos,
            name="token-usage-reconciliation",
            daemon=True,
        ).start()
    except Exception as e:
        logger.warning(f"Could not start token usage reconciliation: {e}")
    yield
    # shutdown: signal research workers first so in-flight batches unwind, then
    # drop anything still queued. Without this the atexit join stalls exit.
    RESEARCH_SHUTDOWN.set()
    if _research_executor is not None:
        try:
            _research_executor.shutdown(wait=False, cancel_futures=True)
            logger.info("Research executor shut down (queued batches cancelled)")
        except Exception as e:
            logger.warning(f"Research executor shutdown failed: {e}")
    # shutdown: close async credential cleanly
    try:
        await close_async_credential()
    except Exception:
        pass


app = FastAPI(title="Ekalaiva Backend", version="0.1.0", lifespan=lifespan, docs_url=None)

# Custom Swagger UI CSS for WCAG accessibility compliance (contrast fixes)
SWAGGER_UI_A11Y_CSS = """
/* Version stamp contrast fix - background from #7d8492 to #5a6270 */
small:first-child > pre.version {
    background-color: #5a6270 !important;
}

/* OAS version stamp contrast fix - background from #89bf04 to #5d8200 */
.version-stamp > pre.version {
    background-color: #5d8200 !important;
}

/* URL link contrast fix - color from #4990e2 to #3973b6 */
.info .url {
    color: #3973b6 !important;
}

/* GET method badge contrast fix - background from #61affe to #4177ae */
.opblock-get .opblock-summary-method {
    background-color: #4177ae !important;
}

/* POST method badge contrast fix - background from #49cc90 to #2d845c */
.opblock-post .opblock-summary-method {
    background-color: #2d845c !important;
}

/* DELETE method badge contrast fix - background from #f93e3e to #d43434 */
.opblock-delete .opblock-summary-method {
    background-color: #d43434 !important;
}

/* PUT method badge contrast fix */
.opblock-put .opblock-summary-method {
    background-color: #c07020 !important;
}

/* PATCH method badge contrast fix */
.opblock-patch .opblock-summary-method {
    background-color: #3a8a6b !important;
}

/* Expand all button contrast fix - color from #afaeae to #6b6b6b */
.json-schema-2020-12-expand-deep-button {
    color: #6b6b6b !important;
}
"""


@app.get("/docs", include_in_schema=False)
async def custom_swagger_ui_html():
    """Custom Swagger UI with accessibility fixes for color contrast."""
    return get_swagger_ui_html(
        openapi_url=app.openapi_url,
        title=app.title + " - API Docs",
        swagger_css_url="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css",
        swagger_ui_parameters={"syntaxHighlight.theme": "monokai"},
    )


# Inject custom CSS via middleware for /docs
@app.middleware("http")
async def inject_a11y_css(request: Request, call_next):
    response = await call_next(request)
    if request.url.path == "/docs" and response.status_code == 200:
        # Read the original response body
        body = b""
        async for chunk in response.body_iterator:
            body += chunk
        # Inject custom CSS before </head>
        body_str = body.decode("utf-8")
        css_injection = f"<style>{SWAGGER_UI_A11Y_CSS}</style></head>"
        body_str = body_str.replace("</head>", css_injection)
        # Create new response without Content-Length (let it be calculated automatically)
        new_headers = {k: v for k, v in response.headers.items() if k.lower() != "content-length"}
        return HTMLResponse(content=body_str, status_code=200, headers=new_headers)
    return response


# Deployed origin comes from FRONTEND_URL; CORS_ALLOWED_ORIGINS adds extras (comma-separated).
origins = list(dict.fromkeys(
    [o for o in [FRONTEND_URL] if o]
    + [o.strip() for o in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",") if o.strip()]
    + ["http://localhost:5173", "http://localhost:5174", "http://localhost:3000"]
))

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,  # or ["*"] if you don't need credentials
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    max_age=3600,
)


# ---- Merged Teacher Dashboard API (/api/teacher-dashboard/*) ----
# Teacher-scoped learning-progress analytics, served by this same backend and
# authenticated with the shared HttpOnly session cookie (see
# teacher_dashboard.teacher_auth.get_current_teacher).
from teacher_dashboard.routes import router as teacher_dashboard_router

app.include_router(teacher_dashboard_router)


# ---- Error handlers ----
@app.exception_handler(HttpResponseError)
async def azure_err_handler(request: Request, exc: HttpResponseError):
    logger.exception("Azure error on %s %s", request.method, request.url.path)
    detail = getattr(exc, "message", None) or str(exc)
    return JSONResponse(status_code=400, content={"detail": f"Azure Agents error: {detail}"})


@app.exception_handler(Exception)
async def unhandled_err_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": f"{type(exc).__name__}: {exc}"})


@app.get("/", include_in_schema=False)
def root():
    """Redirect to frontend - allows cookie compliance scanner to find the HTML page."""
    return RedirectResponse(
        url=FRONTEND_URL,
        status_code=302,
    )


# ===================== Auth Endpoints =====================

# Cookie name used for HttpOnly session token
SESSION_COOKIE_NAME = "session"
# 7 days (must match JWT_EXPIRY_SECONDS in auth.py)
SESSION_COOKIE_MAX_AGE = 86400 * 7


def _set_session_cookie(response, token: str):
    """Set HttpOnly Secure session cookie on a response."""
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=True,
        samesite="none",      # cross-origin (frontend ≠ backend origin)
        max_age=SESSION_COOKIE_MAX_AGE,
        path="/",
    )


def _get_session_token(request: Request) -> str | None:
    """
    Extract session token from HttpOnly cookie (preferred) or
    Authorization: Bearer header (backward-compat fallback).
    """
    # 1. Try cookie first
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if token:
        return token

    # 2. Fallback to Authorization header (transition period)
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:]

    return None


# Prefix used by the frontend for locally-generated ids when nobody is signed in
# (see generateTempUserId in Frontend/src/lib/userStore.ts).
TEMP_USER_ID_PREFIX = "temp_"


def _resolve_user_id(request: Request, claimed_user_id: Any) -> str:
    """
    Resolve the authoritative user id for a chat request.

    A valid session cookie always wins. Its JWT is signed with JWT_SECRET, so a
    signed-in caller cannot act as somebody else by editing the request body —
    which matters because this id keys the per-student learning state in Cosmos.

    Anonymous clients keep working, but may only claim a frontend-generated
    ``temp_`` id. That stops an unauthenticated caller from naming a real Entra
    or Google id and reading/overwriting that student's progress.

    Raises:
        HTTPException 400: no id supplied and no session to derive one from.
        HTTPException 401: a real (non-temp) id claimed without a valid session.
    """
    claimed = str(claimed_user_id or "").strip()

    token = _get_session_token(request)
    if token:
        payload = verify_session_token(token)
        if payload and payload.get("sub"):
            session_user_id = str(payload["sub"]).strip()
            if claimed and claimed != session_user_id:
                logger.warning(
                    "[Auth] user_id mismatch: body claimed '%s' but session is '%s' — using session",
                    claimed, session_user_id,
                )
            return session_user_id

    if not claimed:
        raise HTTPException(status_code=400, detail="user_id is required")

    if not claimed.startswith(TEMP_USER_ID_PREFIX):
        raise HTTPException(
            status_code=401,
            detail="Sign in required: a non-temporary user_id needs a valid session",
        )

    return claimed


def _resolve_caller(request: Request) -> dict:
    """
    Identify the caller of an administrative route from their session cookie.

    Returns a dict with ``email``, ``role`` and ``is_super``.

    Raises:
        HTTPException 401: no session cookie, or the token is invalid/expired.
    """
    token = _get_session_token(request) if request is not None else None
    payload = verify_session_token(token) if token else None
    if not payload:
        raise HTTPException(status_code=401, detail="Sign in required")

    email = (payload.get("email") or "").lower()
    is_super = bool(email) and email == SUPER_ADMIN_EMAIL.lower()
    if is_super:
        role = "admin"
    else:
        profile = get_user_by_email(email) if email else None
        role = ((profile or {}).get("role") or "student").lower()

    return {"email": email, "role": role, "is_super": is_super}


def _require_directory_admin(request: Request) -> dict:
    """
    Identify the caller and confirm they may administer the user directory.

    Raises:
        HTTPException 401: not signed in.
        HTTPException 403: signed in, but not an admin.
    """
    caller = _resolve_caller(request)
    if not caller["is_super"] and caller["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return caller


@app.get("/auth/login", tags=["auth"])
def auth_login():
    """Redirect user to Microsoft Entra ID login page."""
    login_url = entra_auth.get_login_url()
    return RedirectResponse(login_url)


@app.get("/auth/callback", tags=["auth"])
async def auth_callback(request: Request):
    """
    Handle the callback from Microsoft Entra ID after user authentication.
    Completes the PKCE auth code flow, creates a JWT session token,
    and redirects the user back to the frontend.
    """
    import urllib.parse
    try:
        auth_response = dict(request.query_params)
        logger.info("Auth callback received. Query params keys: %s", list(auth_response.keys()))

        # Check if Microsoft returned an error directly
        if "error" in auth_response:
            error_desc = auth_response.get("error_description", auth_response["error"])
            logger.error("Microsoft returned auth error: %s - %s", auth_response["error"], error_desc)
            error_msg = urllib.parse.quote(error_desc)
            return RedirectResponse(f"{FRONTEND_URL}/auth?error={error_msg}")

        result = entra_auth.complete_login(auth_response)
        logger.info("Auth complete_login succeeded. Result keys: %s", list(result.keys()))

        # Extract user info from id_token_claims
        claims = result.get("id_token_claims", {})
        user_id = claims.get("oid", claims.get("sub", ""))
        name = claims.get("name", "")
        email = claims.get("preferred_username", claims.get("email", ""))
        logger.info("Auth claims: user_id=%s, name=%s, email=%s", user_id, name, email)

        if not user_id:
            logger.error("Auth callback: missing user ID in claims: %s", claims)
            return RedirectResponse(f"{FRONTEND_URL}/auth?error=missing_user_id")

        # Check if this email is already registered with a different provider
        _PROVIDER_DISPLAY = {"azure-ad": "Microsoft", "microsoft": "Microsoft", "google": "Google"}

        # C1 (invited_users_v1) check first, then C2 (users_v1) for active users
        invite_doc = get_invite_by_email(email)
        existing_user = get_user_by_email(email)

        if existing_user:
            # User already in C2 (active) — check provider conflict
            existing_provider = existing_user.get("authProvider", "")
            if existing_provider and existing_provider not in ("temp", "", "microsoft", "azure-ad"):
                logger.warning("Auth conflict: email %s already registered with provider '%s', blocking Microsoft login", email, existing_provider)
                friendly = _PROVIDER_DISPLAY.get(existing_provider, existing_provider)
                error_msg = urllib.parse.quote(f"This email is already registered with {friendly}. Please use that login method instead.")
                return RedirectResponse(f"{FRONTEND_URL}/auth?error={error_msg}")
            # Already active — allow login
            logger.info("Existing active user %s logged in via Microsoft", email)
        elif invite_doc:
            # User in C1 (invited) — promote to C2
            promote_invited_user(email, user_id, auth_provider="microsoft", display_name=name)
            logger.info("Promoted invited user %s to active on Microsoft login", email)
        else:
            # Email not in directory at all — deny access
            logger.warning("Auth denied: email %s is not in the user directory", email)
            error_msg = urllib.parse.quote("Access denied. Your account is not registered in the platform. Please contact an administrator.")
            return RedirectResponse(f"{FRONTEND_URL}/auth?error={error_msg}")

        # Create JWT session token
        token = create_session_token(user_id, name, email, provider="microsoft")
        logger.info("Auth callback: JWT created for user %s (%s), redirecting to frontend", email, user_id)

        # Set HttpOnly cookie and redirect (no token in URL)
        response = RedirectResponse(f"{FRONTEND_URL}/auth/callback", status_code=302)
        _set_session_cookie(response, token)
        return response

    except ValueError as e:
        logger.error("Auth callback ValueError: %s", e, exc_info=True)
        error_msg = urllib.parse.quote(str(e))
        return RedirectResponse(f"{FRONTEND_URL}/auth?error={error_msg}")
    except Exception as e:
        logger.exception("Unexpected auth callback error: %s", e)
        error_msg = urllib.parse.quote(str(e))
        return RedirectResponse(f"{FRONTEND_URL}/auth?error={error_msg}")


# ===================== Google Auth Endpoints =====================

@app.get("/auth/google/login", tags=["auth"])
def auth_google_login():
    """Redirect user to Google OAuth login page."""
    if not google_auth:
        logger.error("Google auth not configured (GOOGLE_CLIENT_ID not set)")
        return RedirectResponse(f"{FRONTEND_URL}/auth?error=google_auth_not_configured")
    login_url = google_auth.get_login_url()
    return RedirectResponse(login_url)


@app.get("/auth/google/callback", tags=["auth"])
async def auth_google_callback(request: Request):
    """
    Handle the callback from Google OAuth after user authentication.
    Completes the OAuth flow, creates a JWT session token,
    and redirects the user back to the frontend.
    """
    import urllib.parse
    if not google_auth:
        return RedirectResponse(f"{FRONTEND_URL}/auth?error=google_auth_not_configured")
    try:
        auth_response = dict(request.query_params)
        logger.info("Google auth callback received. Query params keys: %s", list(auth_response.keys()))

        result = google_auth.complete_login(auth_response)
        logger.info("Google auth complete_login succeeded: %s (%s)", result["display_name"], result["email"])

        user_id = result["user_id"] or result["email"]
        name = result["display_name"]
        email = result["email"]

        if not user_id:
            logger.error("Google auth callback: missing user ID")
            return RedirectResponse(f"{FRONTEND_URL}/auth?error=missing_user_id")

        # Check if this email is already registered with a different provider
        _PROVIDER_DISPLAY = {"azure-ad": "Microsoft", "microsoft": "Microsoft", "google": "Google"}

        # C1 (invited_users_v1) check first, then C2 (users_v1) for active users
        invite_doc = get_invite_by_email(email)
        existing_user = get_user_by_email(email)

        if existing_user:
            # User already in C2 (active) — check provider conflict
            existing_provider = existing_user.get("authProvider", "")
            if existing_provider and existing_provider not in ("temp", "", "google"):
                logger.warning("Auth conflict: email %s already registered with provider '%s', blocking Google login", email, existing_provider)
                friendly = _PROVIDER_DISPLAY.get(existing_provider, existing_provider)
                error_msg = urllib.parse.quote(f"This email is already registered with {friendly}. Please use that login method instead.")
                return RedirectResponse(f"{FRONTEND_URL}/auth?error={error_msg}")
            # Already active — allow login
            logger.info("Existing active user %s logged in via Google", email)
        elif invite_doc:
            # User in C1 (invited) — promote to C2
            promote_invited_user(email, user_id, auth_provider="google", display_name=name)
            logger.info("Promoted invited user %s to active on Google login", email)
        else:
            # Email not in directory at all — deny access
            logger.warning("Auth denied: email %s is not in the user directory", email)
            error_msg = urllib.parse.quote("Access denied. Your account is not registered in the platform. Please contact an administrator.")
            return RedirectResponse(f"{FRONTEND_URL}/auth?error={error_msg}")

        # Create JWT session token
        token = create_session_token(user_id, name, email, provider="google")
        logger.info("Google auth callback: JWT created for user %s (%s), redirecting to frontend", email, user_id)

        # Set HttpOnly cookie and redirect (no token in URL)
        response = RedirectResponse(f"{FRONTEND_URL}/auth/callback", status_code=302)
        _set_session_cookie(response, token)
        return response

    except ValueError as e:
        logger.error("Google auth callback ValueError: %s", e, exc_info=True)
        error_msg = urllib.parse.quote(str(e))
        return RedirectResponse(f"{FRONTEND_URL}/auth?error={error_msg}")
    except Exception as e:
        logger.exception("Unexpected Google auth callback error: %s", e)
        error_msg = urllib.parse.quote(str(e))
        return RedirectResponse(f"{FRONTEND_URL}/auth?error={error_msg}")


@app.get("/auth/google/status", tags=["auth"])
def auth_google_status():
    """Check if Google auth is configured and available."""
    return {"enabled": google_auth is not None}


@app.get("/auth/me", tags=["auth"])
def auth_me(request: Request):
    """
    Return the authenticated user's profile from the JWT session token.
    Reads from HttpOnly 'session' cookie (preferred) or Authorization header (fallback).
    """
    token = _get_session_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    payload = verify_session_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired session")

    return {
        "id": payload["sub"],
        "displayName": payload["name"],
        "email": payload["email"],
        "username": payload["email"],
        "provider": payload.get("provider", "microsoft"),
    }


@app.post("/auth/logout", tags=["auth"])
def auth_logout():
    """
    Logout endpoint. Clears the HttpOnly session cookie.
    """
    response = JSONResponse(content={"status": "ok"})
    response.delete_cookie(
        key="session",
        path="/",
        samesite="none",
        secure=True,
    )
    return response


# ===================== User Directory Endpoints =====================

# ── Super-admin: this email can never be removed and has all privileges ──
SUPER_ADMIN_EMAIL = _require_env("SUPER_ADMIN_EMAIL")


class InviteUserRequest(BaseModel):
    """Request body for inviting a user."""
    email: str
    name: str = ""
    role: str = "student"
    institute: str = ""
    department: str = ""


class UpdateUserRequest(BaseModel):
    """Request body for editing a user."""
    name: Optional[str] = None
    role: Optional[str] = None
    institute: Optional[str] = None
    department: Optional[str] = None


@app.get("/api/directory", tags=["directory"])
def api_list_directory(role: Optional[str] = None, status: Optional[str] = None, request: Request = None):
    """List all users in the directory (invited + active)."""
    import random

    # This response carries every user's real name and email address, so it is
    # only ever served to a caller we can identify. Anonymous callers are
    # rejected outright; non-super-admins get the pseudonymised view below.
    caller = _resolve_caller(request)
    caller_email = caller["email"]
    is_super = caller["is_super"]

    users = list_directory_users(role=role, status=status)

    # ── Privacy filtering ──
    # Super-admin sees everything. Others see pseudonymised data.
    if is_super:
        result = []
        for u in users:
            result.append({
                "id": u.get("id", ""),
                "userId": u.get("userId", ""),
                "name": u.get("displayName") or u.get("fullName", ""),
                "email": u.get("email", ""),
                "role": u.get("role", "student"),
                "status": u.get("status", "active"),
                "institute": u.get("institute", u.get("college", "")),
                "department": u.get("department", ""),
                "authProvider": u.get("authProvider", ""),
                "affiliations": u.get("affiliations", []),
                "activeAffiliation": u.get("activeAffiliation", 0),
            })
        return result

    # ── Role-based pseudonymisation ──
    # Admins: always show real name + email.
    # Teachers: "Teacher 1", "Teacher 2", …
    # Students: "Student 1", "Student 2", …
    # Caller's own entry always shows real info.
    admins, teachers, students = [], [], []
    for u in users:
        u_role = u.get("role", "student")
        if u_role == "admin":
            admins.append(u)
        elif u_role == "teacher":
            teachers.append(u)
        else:
            students.append(u)

    # Shuffle teachers and students for privacy (admins stay as-is)
    rng = random.Random(caller_email)
    rng.shuffle(teachers)
    rng.shuffle(students)

    def _build_entry(u, pseudonym=None):
        u_email = (u.get("email") or "").lower()
        is_self = u_email == caller_email
        real_name = u.get("displayName") or u.get("fullName", "")
        return {
            "id": u.get("id", ""),
            "userId": u.get("userId", ""),
            "name": real_name if (is_self or pseudonym is None) else pseudonym,
            "email": u.get("email", "") if (is_self or pseudonym is None) else "\u2014",
            "role": u.get("role", "student"),
            "status": u.get("status", "active"),
            "institute": u.get("institute", u.get("college", "")),
            "department": u.get("department", ""),
            "authProvider": u.get("authProvider", "") if is_self else "",
            "affiliations": u.get("affiliations", []) if is_self else [],
            "activeAffiliation": u.get("activeAffiliation", 0) if is_self else 0,
        }

    result = []
    for u in admins:
        result.append(_build_entry(u))  # no pseudonym → real name + email
    for idx, u in enumerate(teachers, start=1):
        result.append(_build_entry(u, f"Teacher {idx}"))
    for idx, u in enumerate(students, start=1):
        result.append(_build_entry(u, f"Student {idx}"))
    return result


@app.post("/api/directory", tags=["directory"])
def api_invite_user(body: InviteUserRequest, request: Request):
    """Invite (allowlist) a new user. They won't be able to login until added here."""
    # Allowlisting an account grants access to the platform — admins only.
    _require_directory_admin(request)

    doc, is_new_user, affiliation_added = invite_user(
        email=body.email,
        name=body.name,
        role=body.role,
        institute=body.institute,
        department=body.department,
    )

    from starlette.responses import JSONResponse
    result = {
        "id": doc.get("id", ""),
        "userId": doc.get("userId", ""),
        "name": doc.get("displayName") or doc.get("fullName", ""),
        "email": doc.get("email", ""),
        "role": doc.get("role", "student"),
        "status": doc.get("status", "invited"),
        "institute": doc.get("institute", ""),
        "department": doc.get("department", ""),
        "affiliations": doc.get("affiliations", []),
        "affiliationAdded": affiliation_added,
        "alreadyExists": not is_new_user and not affiliation_added,
    }
    status_code = 201 if is_new_user else 200
    return JSONResponse(content=result, status_code=status_code)


@app.patch("/api/directory/{user_id}", tags=["directory"])
def api_update_directory_user(user_id: str, body: UpdateUserRequest, request: Request):
    """Edit an existing user in the directory (name, role, institute, department)."""
    # This route can change a user's role, so it is admin-only.
    caller = _require_directory_admin(request)

    # Granting or revoking admin is reserved for the super-admin, mirroring the
    # rule in api_remove_directory_user that only the super-admin may remove an
    # admin. Without this an admin could mint admins they are not allowed to
    # delete.
    if body.role and body.role.lower() == "admin" and not caller["is_super"]:
        raise HTTPException(
            status_code=403,
            detail="Only the super-admin can grant the admin role",
        )

    # Fetch the target user (try C2 first, then C1 for invited users)
    from azure_services.persistence.cosmos_db import get_user_profile
    target = get_user_profile(user_id)
    target_in_c1 = False
    if not target:
        # Try C1: invited_users_v1 (cross-partition query by id)
        from azure_services.persistence.cosmos_db import _invited_users_container, get_cosmos_client as _init_cosmos
        _init_cosmos()
        try:
            hits = list(_invited_users_container.query_items(
                query="SELECT * FROM c WHERE c.id = @id",
                parameters=[{"name": "@id", "value": user_id}],
                enable_cross_partition_query=True,
            ))
            target = hits[0] if hits else None
            if target:
                target_in_c1 = True
        except Exception:
            target = None
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    # Apply updates
    if target_in_c1:
        # Update C1 (invited_users_v1) doc directly
        from datetime import datetime as _dt
        if body.name:
            target["name"] = body.name
        if body.role:
            target["role"] = body.role
        if body.institute:
            target["institute"] = body.institute
        if body.department:
            target["department"] = body.department
        target["updatedAt"] = _dt.utcnow().isoformat() + "Z"
        _invited_users_container.upsert_item(body=target)
        updated = target
        updated.setdefault("fullName", target.get("name", ""))
        updated.setdefault("displayName", target.get("name", ""))
    else:
        # Update C2 (users_v1) via upsert
        updated = upsert_user_profile(
            user_id=user_id,
            full_name=body.name or "",
            display_name=body.name or "",
            role=body.role or "",
            institute=body.institute or "",
            department=body.department or "",
        )
    return {
        "id": updated.get("id", ""),
        "userId": updated.get("userId", ""),
        "name": updated.get("displayName") or updated.get("fullName", ""),
        "email": updated.get("email", ""),
        "role": updated.get("role", "student"),
        "status": updated.get("status", "active"),
        "institute": updated.get("institute", ""),
        "department": updated.get("department", ""),
    }


@app.delete("/api/directory/{user_id}", tags=["directory"])
def api_remove_directory_user(user_id: str, request: Request):
    """Remove a user from the directory."""
    caller = _require_directory_admin(request)
    caller_role = caller["role"]
    is_super = caller["is_super"]

    # Fetch target from C2 (users_v1) or C1 (invited_users_v1)
    from azure_services.persistence.cosmos_db import get_user_profile
    target = get_user_profile(user_id)
    if not target:
        # Try C1: invited_users_v1 (cross-partition query by id)
        from azure_services.persistence.cosmos_db import _invited_users_container, get_cosmos_client as _init_cosmos
        _init_cosmos()
        try:
            hits = list(_invited_users_container.query_items(
                query="SELECT * FROM c WHERE c.id = @id",
                parameters=[{"name": "@id", "value": user_id}],
                enable_cross_partition_query=True,
            ))
            target = hits[0] if hits else None
        except Exception:
            target = None
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    target_email = (target.get("email") or "").lower()

    # Super-admin cannot be removed by anyone
    if target_email == SUPER_ADMIN_EMAIL.lower():
        raise HTTPException(status_code=403, detail="The super-admin account cannot be removed")

    # Only super-admin can remove other admins
    target_role = (target.get("role") or "student")
    if target_role == "admin" and not is_super:
        raise HTTPException(status_code=403, detail="Only the super-admin can remove other admins")

    # Admins can remove teachers and students; non-admins cannot remove anyone
    if caller_role != "admin" and not is_super:
        raise HTTPException(status_code=403, detail="Only admins can remove users")

    deleted = remove_directory_user(user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="User not found")
    return {"status": "ok", "deleted": user_id}


class SwitchAffiliationRequest(BaseModel):
    index: int


@app.post("/api/directory/{user_id}/switch-affiliation", tags=["directory"])
def api_switch_affiliation(user_id: str, body: SwitchAffiliationRequest, request: Request):
    """Switch the user's active affiliation. Users can switch their own; super-admin can switch anyone."""
    token = _get_session_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = verify_session_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired session")

    caller_email = (payload.get("email") or "").lower()
    is_super = caller_email == SUPER_ADMIN_EMAIL.lower()

    # Users can only switch their own affiliation (unless super-admin)
    caller_user = get_user_by_email(caller_email)
    caller_id = (caller_user or {}).get("id", "")
    if caller_id != user_id and not is_super:
        raise HTTPException(status_code=403, detail="You can only switch your own affiliation")

    from azure_services.persistence.cosmos_db import switch_active_affiliation
    updated = switch_active_affiliation(user_id, body.index)
    if not updated:
        raise HTTPException(status_code=400, detail="Invalid affiliation index or user not found")

    return {
        "id": updated.get("id", ""),
        "userId": updated.get("userId", ""),
        "institute": updated.get("institute", ""),
        "department": updated.get("department", ""),
        "role": updated.get("role", ""),
        "affiliations": updated.get("affiliations", []),
        "activeAffiliation": updated.get("activeAffiliation", 0),
    }


# ── Institution / Department rename & delete ────────────────────────────

class RenameInstituteRequest(BaseModel):
    old_name: str
    new_name: str

class DeleteInstituteRequest(BaseModel):
    name: str

class RenameDepartmentRequest(BaseModel):
    institute: str
    old_name: str
    new_name: str

class DeleteDepartmentRequest(BaseModel):
    institute: str
    department: str


def _require_super_admin(request: Request):
    """Helper: verify caller is the super-admin. Raises 403 otherwise."""
    token = _get_session_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = verify_session_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    caller_email = (payload.get("email") or "").lower()
    if caller_email != SUPER_ADMIN_EMAIL.lower():
        raise HTTPException(status_code=403, detail="Only the super-admin can perform this action")


@app.post("/api/directory/institutes/rename", tags=["directory"])
def api_rename_institute(body: RenameInstituteRequest, request: Request):
    """Rename an institution across all user records."""
    _require_super_admin(request)
    if not body.old_name.strip() or not body.new_name.strip():
        raise HTTPException(status_code=400, detail="old_name and new_name are required")
    from azure_services.persistence.cosmos_db import rename_institute
    count = rename_institute(body.old_name.strip(), body.new_name.strip())
    return {"status": "ok", "updated": count}


@app.post("/api/directory/institutes/delete", tags=["directory"])
def api_delete_institute(body: DeleteInstituteRequest, request: Request):
    """Delete an institution — clears institute & department on affected users."""
    _require_super_admin(request)
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="name is required")
    from azure_services.persistence.cosmos_db import delete_institute
    count = delete_institute(body.name.strip())
    return {"status": "ok", "cleared": count}


@app.post("/api/directory/departments/rename", tags=["directory"])
def api_rename_department(body: RenameDepartmentRequest, request: Request):
    """Rename a department within an institution across all user records."""
    _require_super_admin(request)
    if not body.institute.strip() or not body.old_name.strip() or not body.new_name.strip():
        raise HTTPException(status_code=400, detail="institute, old_name and new_name are required")
    from azure_services.persistence.cosmos_db import rename_department
    count = rename_department(body.institute.strip(), body.old_name.strip(), body.new_name.strip())
    return {"status": "ok", "updated": count}


@app.post("/api/directory/departments/delete", tags=["directory"])
def api_delete_department(body: DeleteDepartmentRequest, request: Request):
    """Delete a department — clears the department field on affected users."""
    _require_super_admin(request)
    if not body.institute.strip() or not body.department.strip():
        raise HTTPException(status_code=400, detail="institute and department are required")
    from azure_services.persistence.cosmos_db import delete_department
    count = delete_department(body.institute.strip(), body.department.strip())
    return {"status": "ok", "cleared": count}


@app.get("/api/directory/onboarding-progress", tags=["directory"])
def api_onboarding_progress(institute: str, department: str, request: Request):
    """Return onboarding progress (invited vs active counts) for a department."""
    _require_super_admin(request)
    progress = get_department_onboarding_progress(institute.strip(), department.strip())
    return progress


@app.get("/api/health", include_in_schema=False)
def health():
    """Health check endpoint for Azure - returns 200 OK"""
    return {"status": "healthy", "service": "ekalaiva-backend"}


@app.get("/api/healthz")
def healthz():
    return JSONResponse(
        {
            "status": "ok",
            "version": BACKEND_VERSION,
            "allowed_models": sorted(ALLOWED_DEPLOYMENTS),
        }
    )


@app.get("/api/config")
def get_config():
    """
    Return frontend configuration from backend.
    Frontend should fetch this instead of hardcoding values.
    """
    return JSONResponse(
        {
            "default_model": DEFAULT_MODEL_DEPLOYMENT,
            "agent_model": AGENT_MODEL_DEPLOYMENT,
            "allowed_models": sorted(ALLOWED_DEPLOYMENTS),
            "version": BACKEND_VERSION,
        },
        headers={"Cache-Control": "public, max-age=300"},
    )


# ===================== Speech Token =====================

AZURE_SPEECH_REGION = os.getenv("AZURE_SPEECH_REGION", "eastus")
AZURE_SPEECH_RESOURCE_NAME = os.getenv("AZURE_SPEECH_RESOURCE_NAME", "shiksha-speech-swapnik")


@app.get("/api/speech/token")
def get_speech_token():
    """
    Issue a short STS token for the browser Speech SDK.
    Flow: managed identity -> AAD token -> exchange for short STS token.
    The STS token is ~800 chars and fits in WebSocket URL query params.
    """
    import urllib.request

    # Step 1: Get an AAD token via managed identity
    try:
        aad_token = get_token_with_retry("https://cognitiveservices.azure.com/.default")
    except Exception as exc:
        logging.error("Speech AAD token fetch failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"Failed to obtain AAD token: {exc}")

    # Step 2: Exchange AAD token for a short STS token
    # Try custom subdomain first, fall back to regional endpoint
    token_urls = [
        f"https://{AZURE_SPEECH_RESOURCE_NAME}.cognitiveservices.azure.com/sts/v1.0/issueToken",
        f"https://{AZURE_SPEECH_REGION}.api.cognitive.microsoft.com/sts/v1.0/issueToken",
    ]
    
    last_error = None
    for token_url in token_urls:
        req = urllib.request.Request(token_url, data=b"", method="POST")
        req.add_header("Authorization", f"Bearer {aad_token}")
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
        req.add_header("Content-Length", "0")
        req.add_header("Ocp-Apim-Subscription-Region", AZURE_SPEECH_REGION)

        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                sts_token = resp.read().decode("utf-8")
            return JSONResponse({"token": sts_token, "region": AZURE_SPEECH_REGION})
        except Exception as exc:
            logging.warning("Speech STS token exchange failed for %s: %s", token_url, exc)
            last_error = exc

    logging.error("All Speech STS token exchange attempts failed: %s", last_error)
    raise HTTPException(
        status_code=502,
        detail=f"Failed to exchange AAD token for STS token: {last_error}"
    )


# ===================== Factories =====================


def learning_agent_manager() -> LearningAgentManager:
    """Factory function for LearningAgentManager."""
    return LearningAgentManager(
        project_endpoint=PROJECT_ENDPOINT,
        config_path=os.getenv("AZURE_AGENTS_CONFIG_PATH", "configs/azure_agents.json"),
        credential_factory=get_async_credential,
    )


class AgentObjectWrapper:
    """
    Wrapper that provides attribute-style access to AgentObject from azure.ai.projects.
    
    The new AgentObject is dict-like, so we wrap it to support both:
    - agent.tools (attribute access, for backward compatibility)
    - agent.get("tools") (dict access)
    """
    
    def __init__(self, agent_obj):
        object.__setattr__(self, '_agent', agent_obj)
    
    def __getattr__(self, name):
        agent = object.__getattribute__(self, '_agent')
        # First check if it's a direct attribute/method
        if hasattr(agent, name) and not name.startswith('_'):
            attr = getattr(agent, name)
            if callable(attr):
                return attr
        # Otherwise treat as dict key
        return agent.get(name)
    
    def get(self, key, default=None):
        return object.__getattribute__(self, '_agent').get(key, default)
    
    def __getitem__(self, key):
        return object.__getattribute__(self, '_agent')[key]
    
    def __repr__(self):
        return f"AgentObjectWrapper({object.__getattribute__(self, '_agent')})"


class AgentsClientAdapter:
    """
    Adapter that provides backward-compatible API for AIProjectClient.agents.
    
    Maps old-style methods (get_agent, update_agent, list_agents) to new API
    (get, update, list). The new API uses agent_name/agent_id interchangeably
    for most operations.
    """
    
    def __init__(self, agents_operations):
        self._agents = agents_operations
    
    def _wrap_agent(self, agent_obj):
        """Wrap AgentObject to provide attribute-style access."""
        return AgentObjectWrapper(agent_obj)
    
    def list_agents(self):
        """List all agents. Returns an iterable of wrapped agent objects."""
        return [self._wrap_agent(a) for a in self._agents.list()]
    
    def get_agent(self, agent_id: str):
        """Get an agent by its ID (asst_xxx) or name."""
        return self._wrap_agent(self._agents.get(agent_name=agent_id))
    
    def update_agent(self, agent_id: str = None, **kwargs):
        """Update an agent. Accepts agent_id as first positional arg or keyword.
        
        IMPORTANT: If 'tools' is not explicitly provided, the existing tools are
        preserved by fetching the current agent definition first.  This prevents
        accidental tool deletion when only updating instructions or model.
        """
        if agent_id is None:
            raise ValueError("agent_id is required for update_agent")
        
        # If caller didn't explicitly pass 'tools', preserve existing tools
        if 'tools' not in kwargs:
            try:
                existing = self._agents.get(agent_name=agent_id)
                existing_tools = None
                # Get tools from latest version's definition (AgentVersionDetails object)
                if hasattr(existing, 'versions') and existing.versions:
                    latest = existing.versions.get('latest')
                    if latest and hasattr(latest, 'definition') and latest.definition:
                        existing_tools = getattr(latest.definition, 'tools', None)
                # Fallback: try direct definition attribute
                if not existing_tools and hasattr(existing, 'definition') and existing.definition:
                    existing_tools = getattr(existing.definition, 'tools', None)
                if existing_tools:
                    kwargs['tools'] = existing_tools
                    logger.info(f"[AgentsClientAdapter] Preserved {len(existing_tools)} existing tools for '{agent_id}'")
            except Exception as e:
                logger.warning(f"[AgentsClientAdapter] Could not fetch existing tools for '{agent_id}': {e}")
        
        # Build the definition dict — the new SDK expects a 'definition' inside the body
        definition_fields = {}
        for key in ['tools', 'tool_resources', 'instructions', 'model', 'name']:
            if key in kwargs:
                definition_fields[key] = kwargs[key]
        
        # The definition must include 'kind' — default to 'prompt' for standard agents
        if definition_fields and 'kind' not in definition_fields:
            definition_fields['kind'] = 'prompt'
        
        # Build body with definition wrapper
        body = {}
        if definition_fields:
            body['definition'] = definition_fields
        
        # description and metadata go at top level of body
        if 'description' in kwargs:
            body['description'] = kwargs['description']
        if 'metadata' in kwargs:
            body['metadata'] = kwargs['metadata']
        
        result = self._agents.update(agent_name=agent_id, body=body if body else None)
        return self._wrap_agent(result)
    
    def delete_agent(self, agent_id: str):
        """Delete an agent by its ID."""
        return self._agents.delete(agent_name=agent_id)
    
    def create_agent(self, **kwargs):
        """Create a new agent."""
        result = self._agents.create(**kwargs)
        return self._wrap_agent(result)
    
    def __getattr__(self, name):
        """Delegate any other attributes to the underlying agents operations."""
        return getattr(self._agents, name)


def agents_client():
    """Get agents client adapter from AIProjectClient for agent operations."""
    pc = project_client()
    return AgentsClientAdapter(pc.agents)


def project_client():
    """AIProjectClient for all agent operations (supports MCP, conversations, responses)."""
    return AIProjectClient(endpoint=PROJECT_ENDPOINT, credential=get_sync_credential())


def create_azure_ai_search_tool(index_name: str, connection_id: str, query_type: str = "vector_semantic_hybrid"):
    """
    Create an Azure AI Search tool using azure.ai.projects.models.
    
    Args:
        index_name: The name of the search index
        connection_id: The Azure AI project connection ID for the search service
        query_type: One of "simple", "semantic", "vector", "vector_simple_hybrid", "vector_semantic_hybrid"
    
    Returns:
        AzureAISearchAgentTool instance to add to agent tools
    """
    from agent_tools.hosted.azure_ai_search.builder import build_azure_ai_search_tool

    return build_azure_ai_search_tool(index_name, connection_id, query_type=query_type)


def agents_client_with_retry(max_retries: int = 3, retry_delay: float = 0.5):
    """
    Get agents client with retry logic for operations.
    
    Returns a wrapper that retries on Windows file locking errors.
    """
    import time
    
    client = agents_client()
    
    class RetryWrapper:
        def __init__(self, client):
            self._client = client
        
        def _retry_operation(self, operation, *args, **kwargs):
            """Retry an operation with exponential backoff."""
            last_error = None
            for attempt in range(max_retries):
                try:
                    return operation(*args, **kwargs)
                except Exception as e:
                    last_error = e
                    error_msg = str(e)
                    if "cannot access the file" in error_msg or "being used by another process" in error_msg:
                        if attempt < max_retries - 1:
                            time.sleep(retry_delay * (2 ** attempt))
                            continue
                    raise
            raise last_error
        
        def get_agent(self, agent_name):
            return self._retry_operation(self._client.get_agent, agent_name)
        
        def update_agent(self, **kwargs):
            return self._retry_operation(self._client.update_agent, **kwargs)
        
        def __getattr__(self, name):
            return getattr(self._client, name)
    
    return RetryWrapper(client)


# ===================== CCA (Course Conversational Agent) – main builder chat =====================


@app.post("/api/cca/start")
async def cca_start(payload: Dict[str, Any]):
    """
    Start a Course Conversational Agent (CCA) conversation for builder/edit mode.
    Uses AIProjectClient with conversations/responses API and agent reference.
    """
    teacher_opening = payload.get("teacher_opening")
    if not teacher_opening:
        raise HTTPException(status_code=400, detail="teacher_opening is required")

    cca_agent_id = payload.get("ccaAgentId", COURSE_CONVERSATIONAL_AGENT_ID)
    session = payload.get("session")
    vector_store_id = payload.get("vector_store_id")

    # Use AIProjectClient with conversations/responses API
    client = project_client()
    try:
        openai_client = client.get_openai_client()
        
        # Create conversation
        conversation = openai_client.conversations.create()
        
        # Send request using agent reference
        response = openai_client.responses.create(
            conversation=conversation.id,
            input=teacher_opening,
            extra_body={"agent": {"name": cca_agent_id, "type": "agent_reference"}}
        )
        
        full_reply = response.output_text or "(No assistant message yet.)"
        markdown_part = strip_final_json_block(full_reply)

        return {
            "thread_id": conversation.id,  # Return conversation ID as thread_id for API compatibility
            "last_reply": markdown_part,
            "vector_store_id": vector_store_id,
        }
    finally:
        client.close()


@app.post("/api/cca/step")
async def cca_step(payload: Dict[str, Any]):
    """
    Continue a CCA conversation with a teacher reply.
    Uses AIProjectClient with conversations/responses API and agent reference.
    """
    thread_id = payload.get("thread_id")  # Actually a conversation ID
    teacher_reply = payload.get("teacher_reply")
    if not thread_id or teacher_reply is None:
        raise HTTPException(status_code=400, detail="thread_id and teacher_reply are required")

    cca_agent_id = payload.get("ccaAgentId", COURSE_CONVERSATIONAL_AGENT_ID)
    session = payload.get("session")
    vector_store_id = payload.get("vector_store_id")

    # Use AIProjectClient with conversations/responses API
    client = project_client()
    try:
        openai_client = client.get_openai_client()
        
        # Continue conversation using agent reference
        response = openai_client.responses.create(
            conversation=thread_id,  # Use existing conversation
            input=teacher_reply,
            extra_body={"agent": {"name": cca_agent_id, "type": "agent_reference"}}
        )
        
        full_reply = response.output_text or "(No assistant message yet.)"
        markdown_part = strip_final_json_block(full_reply)

        return {
            "last_reply": markdown_part,
            "vector_store_id": vector_store_id,
        }
    finally:
        client.close()


# ===================== CACA (Teaching Assistant Creation Agent) =====================


@app.post("/api/caca/start")
async def caca_start(payload: Dict[str, Any]):
    """
    Start a Teaching Assistant Creation Agent (CACA) conversation.
    Uses AIProjectClient with conversations/responses API and agent reference.
    """
    teacher_opening = payload.get("teacher_opening")
    if not teacher_opening:
        raise HTTPException(status_code=400, detail="teacher_opening is required")

    caca_agent_id = payload.get("cacaAgentId", COURSE_AGENT_CREATION_AGENT_ID)

    # Use AIProjectClient with conversations/responses API
    client = project_client()
    try:
        openai_client = client.get_openai_client()
        
        # Create conversation
        conversation = openai_client.conversations.create()
        
        # Send request using agent reference
        response = openai_client.responses.create(
            conversation=conversation.id,
            input=teacher_opening,
            extra_body={"agent": {"name": caca_agent_id, "type": "agent_reference"}}
        )
        
        full_reply = response.output_text or "(No assistant message yet.)"
        
        return {
            "thread_id": conversation.id,  # Return conversation ID as thread_id for API compatibility
            "last_reply": full_reply,
        }
    finally:
        client.close()


@app.post("/api/caca/step")
async def caca_step(payload: Dict[str, Any]):
    """
    Continue an existing Teaching Assistant Creation Agent (CACA) conversation.
    Uses AIProjectClient with conversations/responses API and agent reference.
    """
    thread_id = payload.get("thread_id")  # Actually a conversation ID
    teacher_reply = payload.get("teacher_reply")

    if not thread_id or teacher_reply is None:
        raise HTTPException(
            status_code=400,
            detail="thread_id and teacher_reply are required",
        )

    caca_agent_id = payload.get("cacaAgentId", COURSE_AGENT_CREATION_AGENT_ID)

    # Use AIProjectClient with conversations/responses API
    client = project_client()
    try:
        openai_client = client.get_openai_client()
        
        # Continue conversation using agent reference
        response = openai_client.responses.create(
            conversation=thread_id,  # Use existing conversation
            input=teacher_reply,
            extra_body={"agent": {"name": caca_agent_id, "type": "agent_reference"}}
        )
        
        full_reply = response.output_text or "(No assistant message yet.)"
        
        return {"last_reply": full_reply}
    finally:
        client.close()


# ===================== Agent name check =====================


@app.get("/api/agents/check-name")
def check_agent_name(
    name: str,
):
    """
    Return {"exists": true/false} depending on whether an Azure agent
    already exists with this name (case-insensitive).
    """
    creator = AgentCreator(project_endpoint=PROJECT_ENDPOINT, model_deployment=AGENT_MODEL_DEPLOYMENT)
    agents = creator.list_agents()
    lower = (name or "").strip().lower()
    exists = any(
        (getattr(a, "name", "") or "").strip().lower() == lower for a in agents
    )
    return {"exists": exists}


# ===================== Knowledge file management =====================


@app.get("/api/knowledge/list")
def knowledge_list_files(
    session: str,
    kb_scope: str = Query(...),  # ✅ REQUIRE
    vector_store_id: Optional[str] = None,
):
    """
    List knowledge files for a session.
    
    First checks local file system, then falls back to Azure Blob Storage
    where files are uploaded via /api/knowledge/build.
    """
    logger.info(f"[Knowledge List] session={session}, kb_scope={kb_scope}, vector_store_id={vector_store_id}")
    items: List[Dict[str, Any]] = []
    
    # 1. Try local file system first (legacy approach)
    base = _kb_base(session, kb_scope)
    raw_dir = base / "raw"
    derived_dir = base / "derived"
    
    logger.info(f"[Knowledge List] Checking local path: {base}")

    if raw_dir.exists():
        for raw in raw_dir.iterdir():
            if not raw.is_file():
                continue

            ext = raw.suffix.lower()
            stem = raw.stem

            derived_path = None
            if ext == ".pdf":
                cand = derived_dir / f"{stem}.md"
                derived_path = cand if cand.exists() else None
            elif ext == ".docx":
                cand = derived_dir / f"{stem}.txt"
                derived_path = cand if cand.exists() else None
            elif ext == ".md":
                cand = derived_dir / raw.name
                derived_path = cand if cand.exists() else None

            mem = None
            if derived_path and derived_path.exists():
                txt = derived_path.read_text(encoding="utf-8", errors="ignore")
                mem = {
                    "derived_filename": derived_path.name,
                    "chars": len(txt),
                    "approx_tokens": _estimate_tokens(txt),
                    "size": derived_path.stat().st_size,
                }

            items.append({
                "filename": raw.name,
                "kind": ext.lstrip("."),
                "size": raw.stat().st_size,
                "download_url": f"/api/knowledge/download/{session}/{quote(raw.name)}?kb_scope={kb_scope}",
                "memory": mem,
            })
        
        logger.info(f"[Knowledge List] Found {len(items)} files in local filesystem")

    # 2. If no local files found, check Azure Blob Storage
    if not items:
        logger.info("[Knowledge List] No local files, checking Azure Blob Storage...")
        try:
            INDEXER_CONTAINER = os.environ.get("AZURE_AI_SEARCH_BLOB_CONTAINER", "course-material-v1")
            blob_service = get_blob_service_client()
            container_client = blob_service.get_container_client(INDEXER_CONTAINER)
            
            # List blobs with prefix: sessions/{session}/{kb_scope}/
            prefix = f"sessions/{session}/{kb_scope}/"
            
            for blob in container_client.list_blobs(name_starts_with=prefix):
                # Extract filename from blob path
                blob_name = blob.name
                filename = blob_name.split("/")[-1] if "/" in blob_name else blob_name
                
                if not filename:
                    continue
                
                ext = Path(filename).suffix.lower()
                
                items.append({
                    "filename": filename,
                    "kind": ext.lstrip(".") if ext else "unknown",
                    "size": blob.size,
                    "download_url": f"/api/knowledge/blob/{session}/{quote(filename)}?kb_scope={kb_scope}",
                    "source": "blob_storage",
                    "blob_path": blob_name,
                })
            
            if items:
                logger.info(f"[Knowledge List] Found {len(items)} files in blob storage for session={session}, kb_scope={kb_scope}")
            else:
                logger.info(f"[Knowledge List] No files found in blob storage at prefix: {prefix}")
        except Exception as e:
            logger.warning(f"[Knowledge List] Failed to list files from blob storage: {e}")
    
    logger.info(f"[Knowledge List] Returning {len(items)} files total")
    return {"files": items, "vector_store_id": vector_store_id}


@app.get("/api/knowledge/blob/{session}/{filename}")
def knowledge_download_blob_file(session: str, filename: str, kb_scope: str = Query(...)):
    """
    Download a file from Azure Blob Storage (for files uploaded via /api/knowledge/build).
    """
    from azure.core.exceptions import ResourceNotFoundError
    
    try:
        INDEXER_CONTAINER = os.environ.get("AZURE_AI_SEARCH_BLOB_CONTAINER", "course-material-v1")
        blob_service = get_blob_service_client()
        container_client = blob_service.get_container_client(INDEXER_CONTAINER)
        
        safe_name = Path(filename).name
        blob_path = f"sessions/{session}/{kb_scope}/{safe_name}"
        blob_client = container_client.get_blob_client(blob_path)
        
        # Download blob content
        download_stream = blob_client.download_blob()
        content = download_stream.readall()
        
        # Determine media type
        ext = Path(safe_name).suffix.lower()
        if ext == ".pdf":
            media_type = "application/pdf"
        elif ext in (".md", ".txt"):
            media_type = "text/plain"
        elif ext in (".png", ".jpg", ".jpeg"):
            media_type = f"image/{ext.lstrip('.')}"
        else:
            media_type = "application/octet-stream"
        
        return Response(
            content=content,
            media_type=media_type,
            headers={
                "Content-Disposition": f'attachment; filename="{safe_name}"',
            }
        )
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="File not found in blob storage")
    except Exception as e:
        logger.error(f"Failed to download blob file: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to download file: {str(e)}")


@app.get("/api/knowledge/download/{session}/{filename}")
def knowledge_download_file(session: str, filename: str, kb_scope: str = Query(...)):
    base = _kb_base(session, kb_scope)
    safe_name = Path(filename).name

    raw_dir = base / "raw"
    derived_dir = base / "derived"

    candidates: List[Path] = []
    if raw_dir.exists():
        candidates.append(raw_dir / safe_name)
    if derived_dir.exists():
        candidates.append(derived_dir / safe_name)

    path = next((p for p in candidates if p.exists()), None)
    if not path:
        raise HTTPException(status_code=404, detail="File not found")

    # better media-types
    suf = path.suffix.lower()
    if suf == ".pdf":
        media_type = "application/pdf"
    elif suf in (".md", ".txt"):
        media_type = "text/plain"
    else:
        media_type = "application/octet-stream"

    return FileResponse(path, filename=path.name, media_type=media_type)


@app.delete("/api/knowledge/files/{session}/{filename}")
def knowledge_delete_file(session: str, filename: str, kb_scope: str = Query(...)):
    base = _kb_base(session, kb_scope)
    safe_name = Path(filename).name

    raw_path = (base / "raw" / safe_name)
    derived_dir = base / "derived"

    if raw_path.exists():
        raw_path.unlink()

    stem = Path(safe_name).stem
    if derived_dir.exists():
        # Compare stems instead of globbing: a filename of "*" would otherwise
        # expand into a wildcard and delete every derived file in the scope.
        for p in derived_dir.iterdir():
            if not p.is_file() or p.stem != stem:
                continue
            try:
                p.unlink()
            except Exception:
                logger.exception("Failed to delete derived file %s", p)

    return {"ok": True}


# NOTE: Removed deprecated /api/knowledge/cca-sync endpoint
# Agent creation now uses the fast path: /api/agents/create-async


# NOTE: Removed deprecated CACA endpoints (/api/caca/draft, /api/caca/approve-create,
# /api/caca/exam-draft, /api/caca/exam-approve-create) and related helper functions.
# Agent creation now uses the fast path: /api/agents/create-async


# ===================== Agent ops (update + simple chat) =====================


@app.get("/api/agents/{agent_id}/tools")
def get_agent_tools(agent_id: str):
    """
    Inspect an agent's current tools and tool resources.
    Useful for debugging tool configuration issues.
    
    Tries the legacy AgentsClient first.  If the agent has no tools there
    (common for named agents), falls back to AgentCreator which reads
    the versioned definition where tools are actually stored.
    """
    ac = agents_client()
    try:
        agent = ac.get_agent(agent_id)
        
        tools_info = []
        for t in (agent.tools or []):
            tool_info = {
                "type": type(t).__name__,
            }
            if hasattr(t, 'type'):
                tool_info["tool_type"] = str(t.type)
            tools_info.append(tool_info)
        
        # Get tool resources info
        resources_info = {}
        tr = agent.tool_resources
        if tr:
            if hasattr(tr, 'file_search') and tr.file_search:
                vs_ids = getattr(tr.file_search, 'vector_store_ids', None)
                resources_info["file_search"] = {"vector_store_ids": vs_ids}
            if hasattr(tr, 'azure_ai_search') and tr.azure_ai_search:
                resources_info["azure_ai_search"] = str(tr.azure_ai_search)
            if hasattr(tr, 'code_interpreter') and tr.code_interpreter:
                resources_info["code_interpreter"] = str(tr.code_interpreter)
        
        # Fallback: if legacy tools list is empty, try the versioned definition
        if not tools_info:
            try:
                creator = AgentCreator(
                    project_endpoint=PROJECT_ENDPOINT,
                    model_deployment=AGENT_MODEL_DEPLOYMENT,
                )
                for named_agent in creator.list_agents():
                    if named_agent.name == agent_id:
                        if hasattr(named_agent, 'versions') and named_agent.versions and 'latest' in named_agent.versions:
                            definition = named_agent.versions['latest'].get('definition', {})
                            raw_tools = definition.get('tools', [])
                            for rt in raw_tools:
                                if isinstance(rt, dict):
                                    tools_info.append({
                                        "type": rt.get('type', 'unknown'),
                                        "tool_type": rt.get('type', 'unknown'),
                                        "name": rt.get('name') or (rt.get('function', {}) or {}).get('name'),
                                    })
                                else:
                                    tools_info.append({
                                        "type": type(rt).__name__,
                                        "tool_type": getattr(rt, 'type', 'unknown'),
                                        "name": getattr(rt, 'name', None) or getattr(getattr(rt, 'function', None), 'name', None),
                                    })
                        break
            except Exception as fallback_err:
                logger.warning(f"Fallback tool extraction failed for '{agent_id}': {fallback_err}")
        
        return {
            "agent_id": agent_id,
            "name": agent.name,
            "tools": tools_info,
            "tool_resources": resources_info,
            "tools_count": len(tools_info),
        }
    except HttpResponseError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/agents/{agent_id}/tools/clear")
def clear_agent_tools(agent_id: str, keep_bing: bool = Query(True)):
    """
    Clear all tools from an agent, optionally keeping Bing grounding.
    Use this to fix agents with broken tool configurations.
    """
    ac = agents_client()
    try:
        agent = ac.get_agent(agent_id)
        
        final_tools = []
        if keep_bing:
            # Keep Bing grounding tool if present
            for t in (agent.tools or []):
                if 'BingGrounding' in type(t).__name__:
                    final_tools.append(t)
        
        updated = ac.update_agent(
            agent_id=agent_id,
            tools=final_tools if final_tools else [],
            tool_resources=None,  # Clear tool resources
        )
        
        return {
            "ok": True,
            "agent_id": agent_id,
            "tools_cleared": True,
            "remaining_tools": len(final_tools),
        }
    except HttpResponseError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/agents/{agent_id}/update")
def update_agent(agent_id: str, payload: Dict[str, Any]):
    kwargs: Dict[str, Any] = {}
    if payload.get("model"):
        kwargs["model"] = payload["model"]
    if payload.get("instructions"):
        kwargs["instructions"] = payload["instructions"]
    if not kwargs:
        return {"ok": True}
    try:
        ac = agents_client()
        ac.update_agent(agent_id=agent_id, **kwargs)
        return {"ok": True}
    except HttpResponseError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/agents/{agent_id}/regenerate-prompt")
async def regenerate_agent_prompt(agent_id: str, payload: Dict[str, Any]):
    """
    Regenerate agent instructions using the CACA meta-agent and prompt unifier.
    
    Flow:
      1. Call CACA for learning prompt (using current course details)
      2. Call CACA for exam prompt (using current course details)
      3. Unify both prompts with prompt store modules
      4. Update the agent with the new instructions + model
    
    Payload:
        courseName: str (required)
        courseLevel: str (optional)
        courseDuration: str (optional)
        additionalContext: str (optional)
        courseUrls: list[str] (optional) - teacher-curated URLs
        model: str (optional) - model deployment name to update
    """
    course_name = payload.get("courseName", "")
    course_level = payload.get("courseLevel", "")
    course_duration = payload.get("courseDuration", "")
    course_description = payload.get("courseDescription", "") or payload.get("additionalContext", "")
    prerequisites = payload.get("prerequisites", "")
    course_urls = payload.get("courseUrls", [])
    model = payload.get("model")
    
    if not course_name:
        raise HTTPException(status_code=400, detail="courseName is required")
    
    logger.info(f"[Regenerate] Regenerating prompt for agent '{agent_id}' — course: {course_name}")
    
    try:
        # Step 1: Call CACA meta-agent for teaching assistant specification
        logger.info(f"[Regenerate] Step 1: Generating course specification via CACA...")
        course_desc, course_prompt, course_starters = await call_meta_agent_for_prompt(
            course_name=course_name,
            course_level=course_level,
            course_duration=course_duration,
            course_description=course_description,
            prerequisites=prerequisites,
        )
        logger.info(f"[Regenerate] Course specification: {len(course_prompt)} chars")
        
        # Step 2: Build enhanced context with teacher-curated URLs if provided
        enhanced_context = course_description or ""
        if course_urls:
            urls_section = "\n\n## Teacher-Curated Web Resources (STRICT)\n"
            urls_section += "The teacher has provided the following URLs as the ONLY approved external web sources:\n"
            for url in course_urls:
                urls_section += f"- {url}\n"
            urls_section += "\n**IMPORTANT URL RESTRICTIONS:**\n"
            urls_section += "1. When using web search, ONLY use content from these exact URLs or their direct sub-pages.\n"
            urls_section += "2. Do NOT use or cite information from any other websites.\n"
            urls_section += "3. If asked about topics not covered by these URLs or the uploaded course materials, say: "
            urls_section += "\"This topic is not covered in the approved course resources. Please ask your teacher for additional materials.\"\n"
            urls_section += "4. Always cite the specific URL when using information from these sources.\n"
            enhanced_context = (enhanced_context + urls_section) if enhanced_context else urls_section
            logger.info(f"[Regenerate] Added {len(course_urls)} teacher-curated URLs to context")
        
        # Step 3: Unify CACA spec with prompt store modules
        unified_instructions = unify_agent_prompts(
            course_name=course_name,
            course_level=course_level or None,
            course_duration=course_duration or None,
            learning_prompt=course_prompt,
            exam_prompt=None,
            additional_context=enhanced_context or None,
            include_agent_behavior=True,
            include_pedagogical_framework=True,
            include_tool_handling=True,
            include_knowledge_grounding=True,
            include_safety_guardrails=True,
        )
        
        final_instructions = unified_instructions
        logger.info(f"[Regenerate] Unified instructions: {len(final_instructions)} chars")
        
        # Step 4: Update the agent with new instructions (and model if provided)
        ac = agents_client()

        # Foundry's update-agent endpoint requires `model` on every call.
        # If the caller didn't supply one, fall back to the agent's current model.
        effective_model = model
        if not effective_model:
            try:
                existing_agent = ac.get_agent(agent_id=agent_id)
                effective_model = (
                    getattr(existing_agent, "model", None)
                    or (existing_agent.get("model") if isinstance(existing_agent, dict) else None)
                )
                logger.info(f"[Regenerate] Using existing agent model: {effective_model}")
            except Exception as fetch_err:
                logger.warning(f"[Regenerate] Could not fetch existing agent to read model: {fetch_err}")

        if not effective_model:
            effective_model = AGENT_MODEL_DEPLOYMENT
            logger.info(f"[Regenerate] Falling back to default model: {effective_model}")

        update_kwargs: Dict[str, Any] = {
            "instructions": final_instructions,
            "model": effective_model,
        }
        ac.update_agent(agent_id=agent_id, **update_kwargs)
        
        logger.info(f"[Regenerate] ✓ Agent '{agent_id}' updated in Azure AI")
        
        # Step 5: Update Cosmos DB metadata (description, course details)
        # NOTE: conversation_starters from CACA are always empty (starters are
        # generated dynamically), so we pass None to preserve any existing starters
        # instead of wiping them out on every regeneration.
        try:
            update_agent_metadata(
                agent_id=agent_id,
                description=course_desc,
                conversation_starters=(course_starters or None),
                additional_context=course_description,
            )
            logger.info(f"[Regenerate] ✓ Updated Cosmos DB metadata for '{agent_id}'")
        except Exception as meta_err:
            logger.warning(f"[Regenerate] Failed to update Cosmos DB metadata: {meta_err}")
            # Non-fatal — agent instructions are already updated
        
        # Step 7: Update setup.json with regenerated description and conversation starters
        try:
            setup_data = _load_setup_json(agent_id)
            if setup_data:
                setup_data["agentDescription"] = course_desc
                # Preserve existing conversation starters when CACA returns none.
                if course_starters:
                    setup_data["conversationStarters"] = course_starters
                setup_data["courseName"] = course_name
                setup_data["courseLevel"] = course_level
                setup_data["courseDuration"] = course_duration
                setup_data["additionalContext"] = course_description
                _save_setup_json(agent_id, setup_data)
                logger.info(f"[Regenerate] ✓ Updated setup.json for '{agent_id}'")
        except Exception as setup_err:
            logger.warning(f"[Regenerate] Failed to update setup.json: {setup_err}")
            # Non-fatal
        
        logger.info(f"[Regenerate] ✓ Full regeneration complete for '{agent_id}'")
        
        return {
            "ok": True,
            "agent_id": agent_id,
            "description": course_desc,
            "conversation_starters": course_starters,
            "instructions_length": len(final_instructions),
            "learning_prompt_length": len(course_prompt),
            "exam_prompt_length": 0,
        }
        
    except Exception as e:
        logger.error(f"[Regenerate] Failed to regenerate prompt for agent '{agent_id}': {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to regenerate agent prompt: {str(e)}"
        )


@app.post("/api/agents/{agent_id}/chat/start")
def agent_chat_start(agent_id: str, payload: Dict[str, Any]):
    """
    Start a new chat conversation with an agent (non-streaming).
    
    Uses named agents with AIProjectClient and MCP support.
    """
    ga = get_general_agent(project_endpoint=PROJECT_ENDPOINT, agent_name=agent_id)
    tool_choice = payload.get("tool_choice", "auto")
    user_profile = payload.get("user_profile", {})
    reply, conversation_id = ga.start_chat(payload["text"], tool_choice=tool_choice, user_profile=user_profile)
    return {"reply": reply, "thread_id": conversation_id, "conversation_id": conversation_id}


@app.post("/api/agents/{agent_id}/chat/continue")
def agent_chat_continue(agent_id: str, payload: Dict[str, Any]):
    """
    Continue an existing chat conversation (non-streaming).
    
    Uses named agents with conversation_id for session continuity.
    """
    ga = get_general_agent(project_endpoint=PROJECT_ENDPOINT, agent_name=agent_id)
    conversation_id = payload.get("thread_id") or payload.get("conversation_id")
    tool_choice = payload.get("tool_choice", "auto")
    user_profile = payload.get("user_profile", {})
    reply = ga.continue_chat(conversation_id, payload["text"], tool_choice=tool_choice, user_profile=user_profile)
    return {"reply": reply, "conversation_id": conversation_id}


# ===================== Streaming Chat Endpoint =====================


def build_user_thread_metadata(user_profile: Dict[str, Any]) -> Dict[str, str]:
    """
    Build thread metadata dict from user profile for agent personalization.
    Thread metadata is attached to the Azure AI Agent thread and accessible during runs.
    
    Constraints: max 16 key/value pairs, keys max 64 chars, values max 512 chars.
    """
    metadata: Dict[str, str] = {}
    
    # User ID (useful for tracking/analytics)
    user_id = user_profile.get("userId", "")
    if user_id:
        metadata["user_id"] = str(user_id)[:512]
    
    # Note: user name is intentionally NOT included in metadata.
    # The frontend PII guard replaces the real name with {{user_name}} in
    # messages, so the backend must not leak it via thread metadata either.
    
    # Work function / role
    work_function = user_profile.get("workFunction", "")
    if work_function:
        metadata["user_role"] = str(work_function)[:512]
    
    # User preferences (most important - custom learning preferences)
    # Truncate to 512 chars to fit Azure limits
    preferences = user_profile.get("preferences", "")
    if preferences and preferences.strip():
        metadata["user_preferences"] = preferences.strip()[:512]
    
    # Email (optional, may be useful for context)
    email = user_profile.get("email", "")
    if email:
        metadata["user_email"] = str(email)[:512]
    
    # Learning profile (proficiency, goals, skills)
    learning_profile = user_profile.get("learningProfile", "")
    if learning_profile and learning_profile.strip():
        metadata["learning_profile"] = learning_profile.strip()[:512]
    
    # Department
    department = user_profile.get("department", "")
    if department and department.strip():
        metadata["user_department"] = department.strip()[:512]
    
    # College / University
    college = user_profile.get("college", "")
    if college and college.strip():
        metadata["user_college"] = college.strip()[:512]
    
    # Custom instructions
    custom_instructions = user_profile.get("customInstructions", "")
    if custom_instructions and custom_instructions.strip():
        metadata["custom_instructions"] = custom_instructions.strip()[:512]
    
    return metadata


@app.post("/api/agents/{agent_id}/chat/stream")
def agent_chat_stream(agent_id: str, request: Request, payload: Dict[str, Any] = Body(...)):
    """
    Streaming chat endpoint using Server-Sent Events.
    
    Uses AIProjectClient with MCP (Knowledge Base) support.
    
    Args:
        agent_id: The agent name (e.g., "my-course-agent")
    
    Request body:
        text: The user's message (required)
        thread_id/conversation_id: Optional existing conversation ID for continuation
        user_id: Optional user ID to lookup profile for personalization
        tool_choice: Tool control - "auto", "required", or "none" (default: "auto")
        research_mode: If True, sets tool_choice="required" for deep research
        image_urls: Optional list of image URLs to include in the message (for vision)
    """
    text = payload.get("text", "")
    # Support both old and new naming
    conversation_id = payload.get("thread_id") or payload.get("conversation_id")
    user_id = payload.get("user_id")
    inject_profile = payload.get("inject_profile", True)  # Default True for backward compat
    tool_choice = payload.get("tool_choice", "auto")
    research_mode = payload.get("research_mode", False)
    web_search_enabled = False
    image_urls = payload.get("image_urls", [])
    
    # image_urls are already base64 data URLs from the frontend - pass directly to agent
    if image_urls:
        logger.info(f"Received {len(image_urls)} base64 image(s) from frontend")
    
    # Research mode forces tool use
    if research_mode:
        tool_choice = "required"
    
    logger.info(f"[Chat Stream] agent={agent_id}, text_len={len(text)}, conv_id={conversation_id}, tool_choice={tool_choice}, web_search={web_search_enabled}, inject_profile={inject_profile}")
    
    if not text and not image_urls:
        raise HTTPException(status_code=400, detail="text or image_urls is required")
    
    # Authoritative id: a valid session overrides whatever the body claimed.
    # Tools key per-student learning state off this, so it must not be forgeable.
    user_id = _resolve_user_id(request, user_id)
    
    # Only fetch and inject user profile when the frontend signals it's needed
    # (new chat or profile has changed since last injection in this thread)
    # Prefer inline user_profile from frontend cache to avoid Cosmos round-trip
    user_profile = None
    inline_profile = payload.get("user_profile")
    if user_id and inject_profile:
        if inline_profile and isinstance(inline_profile, dict):
            # Use frontend-cached profile directly — no Cosmos DB fetch needed
            user_profile = inline_profile
            logger.info(f"[Chat Stream] Using inline profile from frontend (user={user_id})")
        else:
            try:
                user_profile = get_user_profile(user_id)
                logger.info(f"[Chat Stream] Profile fetched from Cosmos DB (user={user_id})")
            except Exception as e:
                logger.warning(f"Could not fetch user profile for {user_id}: {e}")
    elif user_id and not inject_profile:
        logger.info(f"[Chat Stream] Skipping profile injection (already injected for this thread)")
    
    # Load session_uuid from agent setup.json for knowledge tools
    session_uuid = None
    try:
        setup_data = _load_setup_json(agent_id)
        if setup_data:
            session_uuid = setup_data.get("sessionUuid")
            if session_uuid:
                logger.info(f"Loaded sessionUuid for agent {agent_id}: {session_uuid}")
    except Exception as e:
        logger.warning(f"Could not load sessionUuid from setup.json for {agent_id}: {e}")
    
    def generate_stream():
        assistant_texts: List[str] = []
        try:
            # Use named agent with agent_id as agent_name
            ga = get_general_agent(
                project_endpoint=PROJECT_ENDPOINT,
                agent_name=agent_id,
                session_id=session_uuid,
            )
            
            if conversation_id:
                stream_gen = ga.continue_chat_stream(
                    conversation_id=conversation_id,
                    user_text=text,
                    tool_choice=tool_choice,
                    user_profile=user_profile or {},
                    web_search_enabled=web_search_enabled,
                    image_urls=image_urls,
                    user_id=user_id,
                )
            else:
                stream_gen = ga.start_chat_stream(
                    user_text=text,
                    tool_choice=tool_choice,
                    user_profile=user_profile or {},
                    web_search_enabled=web_search_enabled,
                    image_urls=image_urls,
                    user_id=user_id,
                )
            
            event_counter = 0
            for event_type, data, conv_id in _with_progress_guardrail(
                with_suggested_queries(stream_gen, ga, text), agent_id, user_id
            ):
                if event_type == "thread_id":
                    # Return both thread_id and conversation_id for backward compatibility
                    yield f"data: {json.dumps({'type': 'thread_id', 'thread_id': data, 'conversation_id': data})}\n\n"
                elif event_type == "delta":
                    yield f"data: {json.dumps({'type': 'delta', 'content': data, 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
                elif event_type == "document_start":
                    # Document streaming started - signal frontend to prepare
                    logger.info(f"[Stream] Document streaming started")
                    yield f"data: {json.dumps({'type': 'document_start', 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
                elif event_type == "document_title":
                    # Document title received
                    try:
                        title_data = json.loads(data)
                        logger.info(f"[Stream] Document title: {title_data.get('title')}")
                        yield f"data: {json.dumps({'type': 'document_title', 'title': title_data.get('title'), 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
                    except json.JSONDecodeError:
                        logger.error(f"Failed to parse document title: {data}")
                elif event_type == "document_delta":
                    # Document content chunk
                    try:
                        delta_data = json.loads(data)
                        yield f"data: {json.dumps({'type': 'document_delta', 'delta': delta_data.get('delta', ''), 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
                    except json.JSONDecodeError:
                        logger.error(f"Failed to parse document delta: {data}")
                elif event_type == "document":
                    # Agent called add_document tool - forward complete document data to frontend
                    logger.info(f"[Stream] Forwarding complete document event: {data[:100]}...")
                    try:
                        doc_data = json.loads(data)
                        logger.info(f"[Stream] Document parsed: title={doc_data.get('title')}")
                        yield f"data: {json.dumps({'type': 'document', 'title': doc_data.get('title'), 'content': doc_data.get('content'), 'doc_type': doc_data.get('doc_type', 'markdown'), 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
                    except json.JSONDecodeError:
                        logger.error(f"Failed to parse document data: {data}")
                elif event_type == "message_block_start":
                    # Message block streaming started
                    logger.info(f"[Stream] Message block streaming started")
                    yield f"data: {json.dumps({'type': 'message_block_start', 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
                elif event_type == "message_block_delta":
                    # Message block content chunk
                    try:
                        delta_data = json.loads(data)
                        yield f"data: {json.dumps({'type': 'message_block_delta', 'delta': delta_data.get('delta', ''), 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
                    except json.JSONDecodeError:
                        logger.error(f"Failed to parse message block delta: {data}")
                elif event_type == "message_block":
                    # Agent called add_message tool - forward complete message block
                    logger.info(f"[Stream] Forwarding message_block event")
                    try:
                        msg_data = json.loads(data)
                        assistant_texts.append(msg_data.get('content', '') or '')
                        yield f"data: {json.dumps({'type': 'message_block', 'content': msg_data.get('content', ''), 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
                    except json.JSONDecodeError:
                        logger.error(f"Failed to parse message block data: {data}")
                elif event_type == "quiz_start":
                    # Quiz streaming started
                    logger.info(f"[Stream] Quiz streaming started")
                    yield f"data: {json.dumps({'type': 'quiz_start', 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
                elif event_type == "quiz":
                    # Agent called add_quiz tool - forward quiz data to frontend
                    logger.info(f"[Stream] Forwarding quiz event")
                    try:
                        quiz_data = json.loads(data)
                        yield f"data: {json.dumps({'type': 'quiz', 'title': quiz_data.get('title'), 'questions': quiz_data.get('questions', []), 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
                    except json.JSONDecodeError:
                        logger.error(f"Failed to parse quiz data: {data}")
                elif event_type == "flashcard_start":
                    # Flashcard streaming started
                    logger.info(f"[Stream] Flashcard streaming started")
                    yield f"data: {json.dumps({'type': 'flashcard_start', 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
                elif event_type == "tool_status":
                    # Names the tool so the UI can label what the agent is doing.
                    try:
                        payload = json.loads(data)
                    except json.JSONDecodeError:
                        payload = {}
                    yield f"data: {json.dumps({'type': 'tool_status', 'tool': payload.get('tool'), 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
                elif event_type == "block_cancel":
                    # A block tool failed after its placeholder was drawn
                    logger.warning(f"[Stream] Forwarding block_cancel: {data}")
                    try:
                        cancel = json.loads(data)
                    except json.JSONDecodeError:
                        cancel = {}
                    yield f"data: {json.dumps({'type': 'block_cancel', 'tool': cancel.get('tool'), 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
                elif event_type == "flashcard":
                    # Agent called add_flashcard tool - forward flashcard data to frontend
                    logger.info(f"[Stream] Forwarding flashcard event")
                    try:
                        fc_data = json.loads(data)
                        yield f"data: {json.dumps({'type': 'flashcard', 'title': fc_data.get('title'), 'cards': fc_data.get('cards', []), 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
                    except json.JSONDecodeError:
                        logger.error(f"Failed to parse flashcard data: {data}")
                elif event_type == "challenge_start":
                    # Challenge streaming started
                    logger.info(f"[Stream] Challenge streaming started")
                    yield f"data: {json.dumps({'type': 'challenge_start', 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
                elif event_type == "challenge":
                    # Agent called add_challenge tool - forward challenge data to frontend
                    logger.info(f"[Stream] Forwarding challenge event")
                    try:
                        ch_data = json.loads(data)
                        yield f"data: {json.dumps({'type': 'challenge', 'title': ch_data.get('title'), 'description': ch_data.get('description', ''), 'difficulty': ch_data.get('difficulty', 'medium'), 'hints': ch_data.get('hints', []), 'solution': ch_data.get('solution', ''), 'challenge_type': ch_data.get('challenge_type', 'problem'), 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
                    except json.JSONDecodeError:
                        logger.error(f"Failed to parse challenge data: {data}")
                elif event_type == "clarify":
                    # Agent called ask_clarification - forward question + options to frontend
                    logger.info(f"[Stream] Forwarding clarify event")
                    try:
                        clarify_data = json.loads(data)
                        yield f"data: {json.dumps({'type': 'clarify', 'clarifyId': clarify_data.get('clarifyId', ''), 'questions': clarify_data.get('questions', []), 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
                    except json.JSONDecodeError:
                        logger.error(f"Failed to parse clarify data: {data}")
                elif event_type == "suggested_queries":
                    # Agent called suggest_next_queries - forward follow-up suggestions
                    logger.info(f"[Stream] Forwarding suggested_queries event")
                    try:
                        suggestions_data = json.loads(data)
                        yield f"data: {json.dumps({'type': 'suggested_queries', 'queries': suggestions_data.get('queries', []), 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
                    except json.JSONDecodeError:
                        logger.error(f"Failed to parse suggested_queries data: {data}")
                elif event_type in ("tikz_image_start", "sympy_image_start"):
                    # TikZ diagram generation starting. sympy_image is a legacy alias.
                    logger.info("[Stream] TikZ image generation started")
                    yield f"data: {json.dumps({'type': 'tikz_image_start', 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
                elif event_type == "generated_image_start":
                    logger.info("[Stream] Generated image starting")
                    yield f"data: {json.dumps({'type': 'generated_image_start', 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
                elif event_type == "generated_image":
                    # Agent called generate_image tool - forward image data to frontend.
                    logger.info("[Stream] Forwarding generated_image event")
                    try:
                        img_data = json.loads(data)
                        yield f"data: {json.dumps({'type': 'generated_image', 'title': img_data.get('title', ''), 'imageData': img_data.get('imageData', ''), 'imageUrl': img_data.get('imageUrl', ''), 'caption': img_data.get('caption', ''), 'size': img_data.get('size', ''), 'quality': img_data.get('quality', ''), 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
                    except json.JSONDecodeError:
                        logger.error(f"Failed to parse generated image data: {data}")
                elif event_type in ("tikz_image", "sympy_image"):
                    # Agent called add_tikz_diagram tool - forward image data to frontend.
                    logger.info("[Stream] Forwarding tikz_image event")
                    try:
                        tikz_data = json.loads(data)
                        yield f"data: {json.dumps({'type': 'tikz_image', 'title': tikz_data.get('title', ''), 'imageData': tikz_data.get('imageData', ''), 'caption': tikz_data.get('caption', ''), 'visualizationType': tikz_data.get('visualizationType', ''), 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
                    except json.JSONDecodeError:
                        logger.error(f"Failed to parse TikZ image data: {data}")
                elif event_type == "usage":
                    # Token usage data from the agent
                    try:
                        usage_data = json.loads(data)
                        _persist_stream_token_usage(
                            agent_id=agent_id,
                            user_id=user_id,
                            conversation_id=conv_id,
                            usage_event_id=payload.get("usage_event_id"),
                            usage_data=usage_data,
                        )
                        logger.info(f"[Stream] Forwarding token usage: {usage_data.get('total_tokens')} tokens, {usage_data.get('rounds')} rounds")
                        yield f"data: {json.dumps({'type': 'usage', **usage_data, 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
                    except json.JSONDecodeError:
                        logger.error(f"Failed to parse usage data: {data}")
                elif event_type == "done":
                    _record_inferred_progress(
                        user_id=user_id,
                        agent_id=agent_id,
                        texts=[text, *assistant_texts],
                    )
                    yield f"data: {json.dumps({'type': 'done', 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
                elif event_type == "citations":
                    # Forward citation annotations from the agent's search results
                    try:
                        citations_list = json.loads(data)
                        logger.info(f"[Stream] Forwarding {len(citations_list)} citations")
                        yield f"data: {json.dumps({'type': 'citations', 'citations': citations_list, 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
                    except json.JSONDecodeError:
                        logger.error(f"Failed to parse citations data: {data}")
                elif event_type == "error":
                    yield f"data: {json.dumps({'type': 'error', 'error': data, 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
        except Exception as e:
            logger.error(f"Stream error: {e}")
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
    
    return StreamingResponse(
        _with_sse_keepalive(generate_stream()),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


def _record_inferred_progress(
    *,
    user_id: Optional[str],
    agent_id: str,
    texts: List[str],
) -> None:
    """Best-effort progress tracking; it must never break a chat stream."""
    if not user_id or not agent_id:
        return
    try:
        from azure_services.persistence.progress_inference import record_taught_topics

        record_taught_topics(user_id, agent_id, texts)
    except Exception as e:
        logger.error(f"Failed to record inferred progress for {agent_id}: {e}")


def _persist_stream_token_usage(
    *,
    agent_id: str,
    user_id: Optional[str],
    conversation_id: Optional[str],
    usage_event_id: Optional[str],
    usage_data: Dict[str, Any],
) -> None:
    """Best-effort persistence; analytics must never break a chat stream."""
    try:
        from teacher_dashboard.token_stats import persist_stream_usage

        result = persist_stream_usage(
            agent_id=agent_id,
            student_user_id=user_id,
            conversation_id=conversation_id,
            usage_event_id=usage_event_id,
            usage=usage_data,
        )
        logger.info(
            "Token usage persisted: agent=%s stored=%s existing=%s",
            agent_id,
            result["stored"],
            result["existing"],
        )
    except Exception as e:
        logger.error(f"Failed to persist token usage for {agent_id}: {e}")


def _guardrail_prior_progress(user_id: str, agent_id: str) -> Optional[Dict[str, Any]]:
    """Build the guardrail's grounding facts from the student's learning state."""
    try:
        from azure_services.persistence.cosmos_db import get_learning_state

        state = get_learning_state(user_id, agent_id)
    except Exception as e:
        logger.warning(f"Guardrail could not read learning state for '{user_id}': {e}")
        return None

    topics = (state or {}).get("topics") or {}
    concepts = (state or {}).get("threshold_concepts") or {}

    def names(items: Dict[str, Any], status: str) -> List[str]:
        return [n for n, v in items.items() if (v or {}).get("status") == status]

    learned_topics = names(topics, "learned")
    in_progress_topics = names(topics, "in_progress")
    learned_concepts = names(concepts, "learned")
    return {
        "topics_learned": len(learned_topics),
        "topics_in_progress": len(in_progress_topics),
        "concepts_learned": len(learned_concepts),
        "learned_topics": learned_topics,
        "in_progress_topics": in_progress_topics,
        "learned_concepts": learned_concepts,
    }


def _run_progress_guardrail(agent_id: str, user_id: str, reply: str) -> None:
    """Flag tutor claims of progress the student has not actually made."""
    try:
        from azure_services.content_guardrail import check_progress_claims

        prior = _guardrail_prior_progress(user_id, agent_id)
        if prior is None:
            return
        verdict = check_progress_claims(reply, prior, course=agent_id)
        if verdict.get("violation"):
            logger.error(
                "[Guardrail] Unearned progress claim | agent=%s user=%s ungrounded=%.0f%% claim=%r",
                agent_id, user_id, verdict.get("ungrounded_percentage", 0) * 100,
                (verdict.get("claims") or [""])[0][:200],
            )
    except Exception as e:
        logger.warning(f"Progress guardrail skipped: {type(e).__name__}: {e}")


def _with_progress_guardrail(stream, agent_id: str, user_id: str):
    """Pass the stream through untouched, checking the finished reply off-thread."""
    chunks: List[str] = []
    for event_type, data, conv_id in stream:
        if event_type == "delta" and isinstance(data, str):
            chunks.append(data)
        elif event_type == "done":
            reply = "".join(chunks)
            if reply.strip() and user_id:
                threading.Thread(
                    target=_run_progress_guardrail,
                    args=(agent_id, user_id, reply),
                    daemon=True,
                ).start()
        yield event_type, data, conv_id


# A diagram or document tool can block the stream for minutes with nothing to
# emit; without traffic the browser hits its idle timeout and aborts the run.
_SSE_KEEPALIVE_SECONDS = 15.0


def _with_sse_keepalive(frames, interval: float = _SSE_KEEPALIVE_SECONDS):
    """Yield SSE comment frames while the producer is blocked on a long tool.

    Comments keep the connection (and the client's idle timer) alive without
    reaching any event handler.
    """
    pending: "queue.Queue[Any]" = queue.Queue(maxsize=1)
    done = object()
    stop = threading.Event()
    failure: List[BaseException] = []

    def produce():
        try:
            for frame in frames:
                while not stop.is_set():
                    try:
                        pending.put(frame, timeout=1.0)
                        break
                    except queue.Full:
                        continue
                if stop.is_set():
                    break
        except BaseException as exc:  # noqa: BLE001 - re-raised on the consumer side
            failure.append(exc)
        finally:
            try:
                pending.put(done, timeout=1.0)
            except queue.Full:
                pass

    worker = threading.Thread(target=produce, daemon=True)
    worker.start()

    try:
        while True:
            try:
                item = pending.get(timeout=interval)
            except queue.Empty:
                yield ": keepalive\n\n"
                continue
            if item is done:
                break
            yield item
    finally:
        # The consumer may be gone (client disconnect); release the producer.
        stop.set()

    if failure:
        raise failure[0]


def _open_agent_stream(agent_id: str, payload: Dict[str, Any], request: Request):
    """Build the agent stream generator for a chat request.

    Shared entry point for protocol-specific chat endpoints. Returns the
    ``(stream, conversation_id, user_id)`` tuple for protocol adapters.
    """
    text = payload.get("text", "")
    conversation_id = payload.get("thread_id") or payload.get("conversation_id")
    user_id = payload.get("user_id")
    inject_profile = payload.get("inject_profile", True)
    tool_choice = payload.get("tool_choice", "auto")
    web_search_enabled = False
    image_urls = payload.get("image_urls", [])

    if payload.get("research_mode", False):
        tool_choice = "required"

    if not text and not image_urls:
        raise HTTPException(status_code=400, detail="text or image_urls is required")

    # Authoritative id: a valid session overrides whatever the body claimed.
    # Tools key per-student learning state off this, so it must not be forgeable.
    user_id = _resolve_user_id(request, user_id)

    user_profile = None
    inline_profile = payload.get("user_profile")
    if user_id and inject_profile:
        if inline_profile and isinstance(inline_profile, dict):
            user_profile = inline_profile
        else:
            try:
                user_profile = get_user_profile(user_id)
            except Exception as e:
                logger.warning(f"Could not fetch user profile for {user_id}: {e}")

    session_uuid = None
    try:
        setup_data = _load_setup_json(agent_id)
        if setup_data:
            session_uuid = setup_data.get("sessionUuid")
    except Exception as e:
        logger.warning(f"Could not load sessionUuid for {agent_id}: {e}")

    ga = get_general_agent(
        project_endpoint=PROJECT_ENDPOINT,
        agent_name=agent_id,
        session_id=session_uuid,
    )

    kwargs = dict(
        user_text=text,
        tool_choice=tool_choice,
        user_profile=user_profile or {},
        web_search_enabled=web_search_enabled,
        image_urls=image_urls,
        user_id=user_id,
    )

    if conversation_id:
        stream = ga.continue_chat_stream(conversation_id=conversation_id, **kwargs)
    else:
        stream = ga.start_chat_stream(**kwargs)
    return with_suggested_queries(stream, ga, text), conversation_id, user_id


@app.get("/api/a2ui/catalog.json")
def a2ui_catalog():
    """Serve the A2UI component catalog describing EKALAIVA's trusted widgets."""
    from agent_tools.a2ui import build_catalog_definition

    return build_catalog_definition()


@app.post("/api/clarify/{clarify_id}")
def submit_clarification(clarify_id: str, payload: Dict[str, Any] = Body(...)):
    """Deliver clarification answers to the agent turn that is blocked waiting on them."""
    from utils import clarification_registry

    raw_answers = payload.get("answers")
    if not isinstance(raw_answers, list):
        raise HTTPException(status_code=400, detail="'answers' must be a list")

    answers = [
        {"answer": str((item or {}).get("answer") or "").strip()}
        for item in raw_answers
        if isinstance(item, dict)
    ]

    delivered = clarification_registry.submit(clarify_id, answers)
    if not delivered:
        # The turn already timed out or finished; the agent proceeded with defaults.
        raise HTTPException(status_code=409, detail="No agent is waiting on this clarification")
    return {"status": "ok", "answers": len(answers)}


@app.post("/api/agents/{agent_id}/chat/agui")
def agent_chat_agui(agent_id: str, request: Request, payload: Dict[str, Any] = Body(...)):
    """
    Streaming chat endpoint speaking the AG-UI protocol.

    Emits standard AG-UI events (RUN_STARTED, TEXT_MESSAGE_*, STEP_*,
    RUN_FINISHED / RUN_ERROR) over SSE. Widget output is carried as AG-UI
    CUSTOM events named "a2ui", each holding one A2UI protocol message that
    references EKALAIVA's custom component catalog.

    Accepts the same request body as /api/agents/{agent_id}/chat/stream.
    """
    from backend.agui import AGUITranslator, encode_sse

    logger.info(f"[AG-UI] agent={agent_id}, conv={payload.get('thread_id')}")

    stream_gen, conversation_id, user_id = _open_agent_stream(agent_id, payload, request)

    def generate_stream():
        translator = AGUITranslator(thread_id=conversation_id)
        def persisted_stream():
            for event_type, data, conv_id in _with_progress_guardrail(stream_gen, agent_id, user_id):
                if event_type == "usage":
                    try:
                        usage_data = json.loads(data) if isinstance(data, str) else data
                        if isinstance(usage_data, dict):
                            _persist_stream_token_usage(
                                agent_id=agent_id,
                                user_id=user_id,
                                conversation_id=conv_id,
                                usage_event_id=payload.get("usage_event_id"),
                                usage_data=usage_data,
                            )
                    except json.JSONDecodeError:
                        logger.error("Failed to parse AG-UI usage data")
                yield event_type, data, conv_id

        for event in translator.run(persisted_stream()):
            yield encode_sse(event)

    return StreamingResponse(
        _with_sse_keepalive(generate_stream()),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@app.post("/api/chat/generate-title")
async def generate_chat_title(payload: Dict[str, Any] = Body(...)):
    """
    Generate a title for a conversation based on the first message exchange.
    
    This endpoint sends an "invisible question" to the agent asking for a title.
    The agent responds via add_message tool, and we extract the title.
    
    Call this AFTER the first response completes to get a title for the thread.
    
    Request body:
        user_message: The user's first message
        assistant_response: The assistant's response (can be truncated)
        agent_name: The agent name to use for title generation
    
    Returns:
        { "title": "Generated Title" }
    """
    user_message = payload.get("user_message", "")
    assistant_response = payload.get("assistant_response", "")
    received_agent_name = payload.get("agent_name")
    
    logger.info(f"[TITLE] === generate_chat_title called ===")
    logger.info(f"[TITLE] Payload keys: {list(payload.keys())}")
    logger.info(f"[TITLE] user_message length: {len(user_message)}, assistant_response length: {len(assistant_response)}")
    logger.info(f"[TITLE] agent_name from payload: '{received_agent_name}'")
    
    if not user_message:
        logger.warning("[TITLE] ❌ No user_message provided — returning 400")
        raise HTTPException(status_code=400, detail="user_message is required")
    
    # Use the agent to generate title (invisible question approach)
    # If no agent_name provided, use a fallback title
    if not received_agent_name:
        logger.warning("[TITLE] ⚠️ No agent_name provided — using fallback title")
        words = user_message.split()[:5]
        fallback_title = " ".join(words) + ("..." if len(words) >= 5 else "")
        return {"title": fallback_title}
    
    try:
        logger.info(f"[TITLE] Using agent '{received_agent_name}' to generate title...")
        
        # Use GeneralAgent.generate_title which sends an invisible question to the agent
        def _generate_title():
            ga = get_general_agent(
                project_endpoint=PROJECT_ENDPOINT,
                agent_name=received_agent_name,
            )
            return ga.generate_title(user_message, assistant_response)
        
        import asyncio
        loop = asyncio.get_event_loop()
        title = await loop.run_in_executor(None, _generate_title)
        
        logger.info(f"[TITLE] ✅ SUCCESS — returning title: '{title}'")
        return {"title": title}
        
    except Exception as e:
        logger.error(f"[TITLE] ❌ FAILED — exception: {type(e).__name__}: {e}")
        # Fallback: use first few words of user message
        words = user_message.split()[:5]
        fallback_title = " ".join(words) + ("..." if len(words) >= 5 else "")
        logger.info(f"[TITLE] Using fallback title: '{fallback_title}'")
        return {"title": fallback_title}


# ===================== Course / Agent chat sessions (multi-chat per agent) =====================


@app.post(
    "/api/course-chats/sessions",
    response_model=CourseChatSession,
)
def create_course_chat_session(payload: Dict[str, Any] = Body(...)):
    """
    Create a new chat session for a given Azure agent.
    """
    agent_id = payload.get("agent_id")
    if not agent_id:
        raise HTTPException(status_code=400, detail="agent_id is required")

    agent_kind = payload.get("agent_kind", "learning")
    if agent_kind not in ("learning", "exam", "other"):
        raise HTTPException(status_code=400, detail="invalid agent_kind")

    now = datetime.utcnow()
    chat_id = str(uuid4())

    course_name = payload.get("course_name") or None
    session_uuid = payload.get("session_uuid") or None
    title = payload.get("title") or "New chat"
    agent_name = payload.get("agent_name") or None

    session = CourseChatSession(
        id=chat_id,
        session_uuid=session_uuid,
        course_name=course_name,
        course_slug=slugify_course_name(course_name),
        agent_kind=agent_kind,  # type: ignore[arg-type]
        agent_id=agent_id,
        agent_name=agent_name,
        title=title,
        azure_thread_id=None,
        created_at=now,
        updated_at=now,
        messages=[],
    )
    COURSE_CHAT_SESSIONS[chat_id] = session
    COURSE_CHAT_MESSAGES[chat_id] = []
    return session


@app.get(
    "/api/course-chats/sessions",
    response_model=List[CourseChatSession],
)
def list_course_chat_sessions(
    agent_id: str = Query(...),
    agent_kind: Optional[Literal["learning", "exam", "other"]] = Query(None),
    course_name: Optional[str] = Query(None),
):
    """
    List chat sessions for an agent, optionally filtered by kind or course_name.
    """
    slug = slugify_course_name(course_name) if course_name else None

    sessions: List[CourseChatSession] = []
    for s in COURSE_CHAT_SESSIONS.values():
        if s.agent_id != agent_id:
            continue
        if agent_kind and s.agent_kind != agent_kind:
            continue
        if slug and s.course_slug != slug:
            continue
        s.messages = COURSE_CHAT_MESSAGES.get(s.id, [])
        sessions.append(s)

    sessions.sort(key=lambda s: s.updated_at, reverse=True)
    return sessions


@app.get(
    "/api/course-chats/sessions/{chat_id}",
    response_model=CourseChatSession,
)
def get_course_chat_session(chat_id: str):
    """
    Get a single course chat session with all messages.
    """
    session = COURSE_CHAT_SESSIONS.get(chat_id)
    if not session:
        raise HTTPException(status_code=404, detail="Chat session not found")

    session.messages = COURSE_CHAT_MESSAGES.get(chat_id, [])
    return session


@app.post(
    "/api/course-chats/sessions/{chat_id}/messages",
    response_model=CourseChatSendResponse,
)
def send_course_chat_message(
    chat_id: str,
    payload: CourseChatSendRequest = Body(...),
):
    """
    Append a user message, call the Azure agent, store the assistant reply,
    and return the updated session (including all messages).
    """
    session = COURSE_CHAT_SESSIONS.get(chat_id)
    if not session:
        raise HTTPException(status_code=404, detail="Chat session not found")

    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    # Use named agent - agent_id is treated as agent_name
    ga = get_general_agent(project_endpoint=PROJECT_ENDPOINT, agent_name=session.agent_id)

    now = datetime.utcnow()

    user_msg = CourseChatMessage(
        id=str(uuid4()),
        chat_id=chat_id,
        role="user",
        content=text,
        created_at=now,
    )
    COURSE_CHAT_MESSAGES.setdefault(chat_id, []).append(user_msg)

    if not session.azure_thread_id:
        reply, conversation_id = ga.start_chat(text)
        session.azure_thread_id = conversation_id
    else:
        reply = ga.continue_chat(session.azure_thread_id, text)

    asst_msg = CourseChatMessage(
        id=str(uuid4()),
        chat_id=chat_id,
        role="assistant",
        content=reply,
        created_at=datetime.utcnow(),
    )
    COURSE_CHAT_MESSAGES[chat_id].append(asst_msg)

    session.updated_at = datetime.utcnow()
    session.messages = COURSE_CHAT_MESSAGES[chat_id]

    return CourseChatSendResponse(session=session)


import os
import re
from pathlib import Path

SAFE_NAME_RE = re.compile(r"[^a-zA-Z0-9_\-]+")

def _safe_filename(name: str) -> str:
    name = (name or "").strip()
    if not name:
        return ""

    name = os.path.basename(name)                     # drop any path
    name = re.sub(r"[\x00-\x1f\x7f]", "", name)       # remove control chars
    name = re.sub(r"[^A-Za-z0-9.\-_\s]", "_", name)   # conservative set
    name = re.sub(r"[\s_]+", "_", name).strip("._")   # normalize

    if not name:
        return ""

    p = Path(name)
    stem = (p.stem or "file")[:80]
    suffix = (p.suffix or "")[:10]
    return f"{stem}{suffix}"

def _ext(filename: str) -> str:
    return Path(filename).suffix.lower()

# ===================== Knowledge build / attach =====================

@app.post("/api/knowledge/build")
async def knowledge_build(
    files: List[UploadFile] = File(None),
    session: str = Form(...),
    kb_scope: str = Form(...),  # ✅ REQUIRE: "learning" or "exam"
    ccaAgentId: str = Form(COURSE_CONVERSATIONAL_AGENT_ID),
    cacaAgentId: str = Form(COURSE_AGENT_CREATION_AGENT_ID),
    index_name: Optional[str] = Form(None),  # Existing index name (if any)
):
    """
    Build knowledge base by uploading files to blob storage.
    
    The files are uploaded to a blob container that is connected to a 
    pre-configured Azure AI Search indexer. The indexer will automatically:
    1. Process files with Document Intelligence OCR
    2. Create vector embeddings
    3. Add content to the shared search index
    
    This approach uses the same index/indexer infrastructure that was 
    pre-configured (like 'law-of-torts-multimodal-index'), avoiding the need
    for admin credentials to create new search resources.
    
    The index_name parameter specifies which pre-configured index to use.
    Default is 'ekalaiva-knowledge-index'.
    """
    # Note: When using per-session MCP pipelines, the actual index used is created dynamically
    # (e.g., ccd73d41-44b6-4424-aed5-91f83c23-unified-index). The files are uploaded to
    # sessions/{session_uuid}/{kb_scope}/ and the per-session indexer picks them up.
    # The SHARED_INDEX_NAME is only used as metadata/logging if no index_name is provided.
    SHARED_INDEX_NAME = os.environ.get("AZURE_AI_SEARCH_INDEX_NAME", "ekalaiva-knowledge-index")
    target_index = index_name or SHARED_INDEX_NAME
    
    if (not files or len(files) == 0) and index_name:
        return {"index_name": target_index, "name": f"temp_knowledge_{kb_scope}_{session[:8]}"}
    if not files or len(files) == 0:
        raise HTTPException(status_code=400, detail="No files uploaded.")

    temp_name = f"temp_knowledge_{kb_scope}_{session[:8]}"
    
    logger.info(f"Processing {len(files)} files for Azure AI Search indexing")
    # Note: Files are uploaded to sessions/{session}/ - the per-session indexer will pick them up
    logger.info(f"Session blob path: sessions/{session}/{kb_scope}/")
    
    # Blob container that the Azure AI Search indexer is configured to watch
    # This should match the data source configuration in Azure AI Search
    INDEXER_CONTAINER = os.environ.get("AZURE_AI_SEARCH_BLOB_CONTAINER", "course-material-v1")
    
    # Use sync blob client (more reliable on Windows than async)
    from azure.storage.blob import BlobServiceClient
    
    sync_credential = get_sync_credential()
    blob_client = BlobServiceClient(
        account_url=f"https://{BLOB_STORAGE_ACCOUNT}.blob.core.windows.net",
        credential=sync_credential
    )
    
    try:
        # Get container (should already exist as it's configured for the indexer)
        container = blob_client.get_container_client(INDEXER_CONTAINER)
        try:
            if not container.exists():
                container.create_container()
                logger.info(f"Created container: {INDEXER_CONTAINER}")
        except Exception as e:
            logger.warning(f"Could not check/create container: {e}")
        
        # Prepare files for upload
        upload_tasks = []
        
        for f in files:
            fname = _safe_filename(f.filename)
            if not fname:
                continue
            
            ext = _ext(fname)
            
            # Validate file type
            allowed_extensions = {".pdf", ".md", ".txt", ".docx", ".png", ".jpg", ".jpeg", ".tiff", ".bmp"}
            if ext not in allowed_extensions:
                raise HTTPException(
                    status_code=400, 
                    detail=f"Unsupported file type: {ext}. Allowed: {', '.join(sorted(allowed_extensions))}"
                )
            
            if ext == ".doc":
                raise HTTPException(
                    status_code=400, 
                    detail="'.doc' is not supported. Please upload .docx or .pdf."
                )
            
            # Get file size and validate (max 100MB for knowledge files)
            MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB
            f.file.seek(0, 2)  # Seek to end
            file_size = f.file.tell()
            f.file.seek(0)  # Reset to beginning
            
            if file_size > MAX_FILE_SIZE:
                raise HTTPException(
                    status_code=400,
                    detail=f"File '{fname}' is too large ({file_size / 1024 / 1024:.1f}MB). Maximum size is 100MB."
                )
            
            # Read file content (for files under 100MB this is fine)
            content = await f.read()
            
            # Upload to folder structure: sessions/{session}/{kb_scope}/{filename}
            # The indexer will pick up files from this container
            blob_name = f"sessions/{session}/{kb_scope}/{fname}"
            blob = container.get_blob_client(blob_name)
            upload_tasks.append((blob, content, fname, file_size))
        
        if not upload_tasks:
            raise HTTPException(status_code=400, detail="No valid files to process.")
        
        # Upload files to blob storage
        logger.info(f"Uploading {len(upload_tasks)} files to blob storage...")
        blob_uris = []
        for blob, content, fname, file_size in upload_tasks:
            logger.info(f"  Uploading: {fname} ({file_size / 1024 / 1024:.1f}MB)...")
            blob.upload_blob(
                content, 
                overwrite=True,
                max_concurrency=4,  # Parallel uploads for large files
                metadata={
                    "session": session,
                    "kb_scope": kb_scope,
                    "original_filename": fname,
                    "index_name": target_index,
                }
            )
            blob_uris.append(blob.url)
            logger.info(f"  Uploaded: {fname}")
        
        logger.info(f"✓ Uploaded {len(blob_uris)} files to blob storage")
        logger.info(f"  Container: {INDEXER_CONTAINER}")
        logger.info(f"  Path: sessions/{session}/{kb_scope}/")
        logger.info("  Note: Per-session indexer will pick up files from this path")
        
        # --- Extract images from PDFs/PPTs and index them ---
        IMAGE_EXTRACTABLE_EXTS = {".pdf", ".pptx", ".docx"}
        image_extraction_results = []
        for _blob, content, fname, _file_size in upload_tasks:
            ext = Path(fname).suffix.lower()
            if ext in IMAGE_EXTRACTABLE_EXTS:
                try:
                    from azure_services.tools.search.course_index_manager import extract_and_index_images
                    
                    mime_map = {
                        ".pdf": "application/pdf",
                        ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    }
                    result = extract_and_index_images(
                        file_bytes=content,
                        filename=fname,
                        session_uuid=session,
                        kb_scope=kb_scope,
                        content_type=mime_map.get(ext, "application/pdf"),
                    )
                    image_extraction_results.append({"file": fname, **result})
                    logger.info(f"  Image extraction for {fname}: {result.get('extracted_count', 0)} figures")
                except Exception as img_err:
                    logger.warning(f"  Image extraction failed for {fname}: {img_err}")
                    image_extraction_results.append({"file": fname, "error": str(img_err)})
        
        total_images = sum(r.get("indexed_count", 0) for r in image_extraction_results)
        
        return {
            "index_name": target_index,
            "name": temp_name,
            "files_uploaded": len(blob_uris),
            "blob_uris": blob_uris,
            "container": INDEXER_CONTAINER,
            "folder_path": f"sessions/{session}/{kb_scope}/",
            "images_extracted": total_images,
            "image_details": image_extraction_results,
            "message": "Files uploaded. The per-session indexer will process them automatically.",
        }
        
    finally:
        # Sync client doesn't need explicit cleanup
        pass


@app.post("/api/knowledge/attach")
def knowledge_attach(payload: Dict[str, Any]):
    """
    Attach Azure AI Search index to an agent using AzureAISearchAgentTool.
    
    This replaces the old vector store attachment with Azure AI Search integration.
    The agent will use the search index for RAG (Retrieval Augmented Generation).
    
    NOTE: FileSearchTool / vector_store_id support has been removed.
    All retrieval now uses Azure AI Search exclusively.
    """
    index_name = payload.get("index_name")
    agent_id = payload["agent_id"]
    name = payload.get("name", "Knowledge")
    
    # Require index_name - vector_store_id is no longer supported
    if not index_name:
        raise HTTPException(
            status_code=400,
            detail="'index_name' is required. FileSearchTool / vector_store_id is no longer supported."
        )
    
    # Azure AI Search connection ID
    SEARCH_CONNECTION_ID = os.environ["AZURE_AI_SEARCH_CONNECTION_ID"]
    
    # Query type for search
    query_type_str = payload.get("query_type", "vector_semantic_hybrid").lower()
    
    logger.info(f"Attaching Azure AI Search index '{index_name}' to agent '{agent_id}'")
    logger.info(f"  Connection ID: {SEARCH_CONNECTION_ID}")
    logger.info(f"  Query type: {query_type_str}")
    
    # Create Azure AI Search tool using new azure.ai.projects API
    ai_search_tool = create_azure_ai_search_tool(
        index_name=index_name,
        connection_id=SEARCH_CONNECTION_ID,
        query_type=query_type_str,
    )
    
    # Get the agent and update its tools - use retry wrapper to handle file locking
    ac = agents_client_with_retry()
    
    try:
        # Get current agent to preserve existing tools
        agent = ac.get_agent(agent_id)
        existing_tools = list(agent.tools) if agent.tools else []
        
        # Filter out any existing Azure AI Search tools to avoid duplicates
        preserved_tools = [
            t for t in existing_tools 
            if not (isinstance(t, dict) and t.get('type') == 'azure_ai_search')
            and 'AzureAISearch' not in str(type(t))
        ]
        
        # Combine preserved tools with new Azure AI Search tool
        all_tools = preserved_tools + [ai_search_tool]
        
        logger.info(f"Preserved {len(preserved_tools)} existing tools, adding Azure AI Search")
        logger.info(f"Total tools after update: {len(all_tools)}")
        
        # Update the agent with new tools
        updated_agent = ac.update_agent(
            agent_id=agent_id,
            tools=all_tools,
        )
        
        logger.info(f"✓ Attached Azure AI Search index '{index_name}' to agent '{agent_id}'")
        
        return {
            "ok": True,
            "mode": "azure_ai_search",
            "index_name": index_name,
            "agent_id": agent_id,
            "query_type": query_type_str,
            "tools_count": len(updated_agent.tools) if updated_agent.tools else 0,
        }
        
    except Exception as e:
        logger.error(f"Failed to attach Azure AI Search: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to attach Azure AI Search index: {str(e)}"
        )


# ===================== Per-Course Index Management =====================

@app.post("/api/knowledge/create-index")
async def create_course_index(
    session_uuid: str = Form(...),
    kb_scope: str = Form("course"),  # "course" or "exam"
):
    """
    Create a dedicated Azure AI Search index for a course.
    
    This creates:
    1. A data source pointing to sessions/{session_uuid}/{kb_scope}/
    2. An index with multimodal embedding support
    3. A skillset with Document Intelligence OCR and text embedding
    4. An indexer to process files
    
    The index is named: {session_uuid[:32]}-{kb_scope}-index
    
    Call this AFTER uploading files to blob storage via /api/knowledge/build.
    """
    from azure_services.tools.search.course_index_manager import (
        create_course_index_pipeline,
        get_index_name,
    )
    
    logger.info(f"Creating index for session {session_uuid}, scope {kb_scope}")
    
    try:
        success, result = create_course_index_pipeline(session_uuid, kb_scope)
        
        if success:
            index_name = get_index_name(session_uuid, kb_scope)
            logger.info(f"✓ Index pipeline created: {index_name}")
            return {
                "ok": True,
                "index_name": index_name,
                "session_uuid": session_uuid,
                "kb_scope": kb_scope,
                "message": "Index pipeline created. Files are being indexed.",
            }
        else:
            logger.error(f"✗ Index creation failed: {result}")
            raise HTTPException(status_code=500, detail=result)
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Index creation error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/knowledge/delete-index")
async def delete_course_index(
    session_uuid: str = Query(...),
    kb_scope: str = Query("course"),
):
    """
    Delete the Azure AI Search index for a course.
    
    This deletes:
    1. The indexer
    2. The skillset
    3. The index
    4. The data source
    
    Call this when deleting a course/agent.
    """
    from azure_services.tools.search.course_index_manager import delete_course_index_pipeline
    
    logger.info(f"Deleting index for session {session_uuid}, scope {kb_scope}")
    
    try:
        success, result = delete_course_index_pipeline(session_uuid, kb_scope)
        
        if success:
            logger.info(f"✓ Index pipeline deleted for {session_uuid}/{kb_scope}")
            return {
                "ok": True,
                "session_uuid": session_uuid,
                "kb_scope": kb_scope,
                "message": result,
            }
        else:
            logger.warning(f"Index deletion had issues: {result}")
            return {
                "ok": False,
                "session_uuid": session_uuid,
                "kb_scope": kb_scope,
                "message": result,
            }
            
    except Exception as e:
        logger.error(f"Index deletion error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/knowledge/update-index")
async def update_course_index(
    session_uuid: str = Form(...),
    kb_scope: str = Form("course"),
):
    """
    Re-run the common indexer after files have changed in edit mode.
    
    This resets and re-runs the shared indexer to process:
    - New files that have been added
    - Remove entries for deleted files
    
    Call this after:
    - Adding new files in edit mode
    - Deleting files in edit mode
    """
    from azure_services.tools.search.course_index_manager import (
        ensure_common_index_pipeline,
        run_common_indexer,
        get_common_index_name,
    )
    
    logger.info(f"Updating common index for session {session_uuid}, scope {kb_scope}")
    
    try:
        # Ensure pipeline exists (idempotent)
        pipeline_ok, pipeline_result = ensure_common_index_pipeline()
        if not pipeline_ok:
            raise HTTPException(status_code=500, detail=f"Pipeline setup failed: {pipeline_result}")
        
        # Run indexer to pick up file additions/deletions (incremental, uses change tracking)
        ok, result = run_common_indexer()
        
        index_name = get_common_index_name()
        
        if ok:
            logger.info(f"✓ Common indexer started for {index_name}")
            return {
                "ok": True,
                "index_name": index_name,
                "action": "updated",
                "message": "Common indexer started. Changes will be reflected shortly.",
            }
        else:
            logger.warning(f"Indexer re-run issue (may already be running): {result}")
            return {
                "ok": True,
                "index_name": index_name,
                "action": "updated",
                "message": f"Indexer may already be running: {result}",
            }
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Index update error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/knowledge/index-status")
async def get_index_status(
    session_uuid: str = Query(...),
    kb_scope: str = Query("course"),
):
    """
    Get the status of the common indexer.
    
    Returns information about:
    - Indexer run status (running, success, transientFailure, etc.)
    - Number of documents indexed
    - Any errors
    """
    from azure_services.tools.search.course_index_manager import (
        get_common_indexer_status,
        get_common_index_name,
    )
    
    logger.info(f"Getting common indexer status (requested for session {session_uuid})")
    
    try:
        status = get_common_indexer_status()
        
        return {
            "exists": True,
            "index_name": get_common_index_name(),
            "session_uuid": session_uuid,
            "kb_scope": kb_scope,
            "status": status,
        }
        
    except Exception as e:
        logger.error(f"Index status error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/knowledge/images")
async def list_extracted_images(
    session_uuid: str = Query(None, description="Optional session UUID to filter images"),
):
    """
    List images extracted from documents during upload.
    
    Images are stored with structured paths: {session_uuid}/{doc_slug}/page{N}_fig{M}.json
    If session_uuid is provided, only lists images for that session.
    """
    from azure_services.tools.search.course_index_manager import get_common_image_container
    
    try:
        image_container = get_common_image_container()
        blob_service = get_blob_service_client()
        container_client = blob_service.get_container_client(image_container)
        
        if not container_client.exists():
            return {"ok": True, "container": image_container, "count": 0, "images": []}
        
        # Filter by session prefix if provided
        prefix = f"{session_uuid}/" if session_uuid else None
        
        images = []
        for blob in container_client.list_blobs(name_starts_with=prefix):
            images.append({
                "name": blob.name,
                "size": blob.size,
                "content_type": blob.content_settings.content_type if blob.content_settings else None,
                "last_modified": blob.last_modified.isoformat() if blob.last_modified else None,
                "url": f"/api/knowledge/images/{blob.name}",
            })
        
        return {
            "ok": True,
            "container": image_container,
            "count": len(images),
            "images": images,
        }
        
    except Exception as e:
        logger.error(f"Failed to list extracted images: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/knowledge/images/{image_path:path}")
async def get_extracted_image(image_path: str):
    """
    Serve an extracted image from the knowledge store blob container.
    
    Images are stored by the indexer's knowledgeStore projection
    with hash-based filenames.
    """
    from azure.core.exceptions import ResourceNotFoundError
    from azure_services.tools.search.course_index_manager import get_common_image_container
    
    try:
        image_container = get_common_image_container()
        blob_service = get_blob_service_client()
        container_client = blob_service.get_container_client(image_container)
        
        # Sanitize: reject path traversal
        if ".." in image_path:
            raise HTTPException(status_code=400, detail="Invalid image path")
        
        blob_client = container_client.get_blob_client(image_path)
        download_stream = blob_client.download_blob()
        content = download_stream.readall()
        
        # Determine media type from blob properties or extension
        props = blob_client.get_blob_properties()
        media_type = "image/png"  # default
        if props.content_settings and props.content_settings.content_type:
            media_type = props.content_settings.content_type
        else:
            ext = Path(image_path).suffix.lower()
            media_types = {
                ".png": "image/png",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".gif": "image/gif",
                ".bmp": "image/bmp",
                ".tiff": "image/tiff",
                ".webp": "image/webp",
            }
            media_type = media_types.get(ext, "application/octet-stream")
        
        return Response(
            content=content,
            media_type=media_type,
            headers={
                "Cache-Control": "public, max-age=3600",
            },
        )
        
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Image not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to serve extracted image: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/knowledge/create-unified-index")
async def create_unified_index_endpoint(
    session_uuid: str = Form(...),
):
    """
    Create a UNIFIED search index that covers ALL files (course + exam).
    
    This creates a single index pointing to sessions/{session_uuid}/,
    which includes both course/ and exam/ subfolders.
    
    Use this INSTEAD of creating separate course/exam indexes when you want
    a single Knowledge Base to search all materials.
    
    Call this AFTER uploading files to blob storage via /api/knowledge/build.
    """
    from azure_services.tools.search.course_index_manager import (
        create_unified_index_pipeline,
        get_unified_index_name,
    )
    
    logger.info(f"Creating UNIFIED index for session {session_uuid}")
    
    try:
        success, result = create_unified_index_pipeline(session_uuid)
        
        if success:
            index_name = get_unified_index_name(session_uuid)
            logger.info(f"✓ UNIFIED Index pipeline created: {index_name}")
            return {
                "ok": True,
                "index_name": index_name,
                "session_uuid": session_uuid,
                "unified": True,
                "message": "Unified index created. All files (course + exam) are being indexed.",
            }
        else:
            logger.error(f"✗ Unified index creation failed: {result}")
            raise HTTPException(status_code=500, detail=result)
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unified index creation error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/knowledge/delete-unified-index")
async def delete_unified_index_endpoint(
    session_uuid: str = Query(...),
):
    """
    Delete the UNIFIED search index pipeline for a session.
    Deletes: indexer, skillset, index, datasource
    """
    from azure_services.tools.search.course_index_manager import delete_unified_index_pipeline
    
    logger.info(f"Deleting UNIFIED index for session {session_uuid}")
    
    try:
        success, result = delete_unified_index_pipeline(session_uuid)
        
        if success:
            logger.info(f"✓ Unified index pipeline deleted for {session_uuid}")
            return {
                "ok": True,
                "session_uuid": session_uuid,
                "message": result,
            }
        else:
            return {
                "ok": False,
                "session_uuid": session_uuid,
                "message": result,
            }
            
    except Exception as e:
        logger.error(f"Unified index deletion error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ===================== Agentic Retrieval: Knowledge Base Endpoints =====================
# UNIFIED APPROACH: One Knowledge Base per session that combines:
# - ONE Index Knowledge Source (all course + exam files)
# - ONE Web Knowledge Source (all teacher-curated URLs)
# This replaces the per-scope (course/exam) approach with a single unified KB.


@app.post("/api/knowledge/create-unified-kb")
async def create_unified_knowledge_base(
    session_uuid: str = Form(...),
    teacher_urls: Optional[str] = Form(None),  # JSON array of URLs
):
    """
    Create a UNIFIED Knowledge Base for a session combining:
    1. ONE Index Knowledge Source (from the unified index)
    2. ONE Web Knowledge Source (all teacher-curated websites)
    
    This provides a single retrieval endpoint that searches ALL materials.
    
    Prerequisites: The unified index must exist (call /api/knowledge/create-unified-index first).
    
    Args:
        session_uuid: The course session UUID
        teacher_urls: JSON array of ALL teacher-curated URLs, e.g.:
                      '["https://wikipedia.org/wiki/Topic", "https://khanacademy.org/"]'
    """
    from azure_services.tools.search.course_index_manager import (
        create_unified_knowledge_pipeline,
        get_unified_knowledge_base_name,
        get_unified_index_name,
    )
    
    logger.info(f"Creating UNIFIED Knowledge Base for session {session_uuid}")
    
    # Parse teacher URLs if provided
    urls_list = None
    if teacher_urls:
        try:
            import json
            urls_list = json.loads(teacher_urls)
            logger.info(f"Parsed {len(urls_list)} teacher URLs")
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=400, detail=f"Invalid teacher_urls JSON: {e}")
    
    # Use the unified index
    unified_index = get_unified_index_name(session_uuid)
    logger.info(f"Using unified index: {unified_index}")
    
    try:
        success, result = create_unified_knowledge_pipeline(
            session_uuid, 
            teacher_urls=urls_list,
            index_names=[unified_index]  # Use the single unified index
        )
        
        if success:
            kb_name = get_unified_knowledge_base_name(session_uuid)
            logger.info(f"✓ UNIFIED Knowledge Base created: {kb_name}")
            return {
                "ok": True,
                "knowledge_base_name": kb_name,
                "session_uuid": session_uuid,
                "unified_index": unified_index,
                "teacher_urls_count": len(urls_list) if urls_list else 0,
                "message": "Unified Knowledge Base created. Agent can now search all materials + web in one query.",
            }
        else:
            logger.error(f"✗ Knowledge Base creation failed: {result}")
            raise HTTPException(status_code=500, detail=result)
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Knowledge Base creation error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/knowledge/delete-unified-kb")
async def delete_unified_knowledge_base(
    session_uuid: str = Query(...),
):
    """
    Delete the unified Knowledge Base and all Knowledge Sources for a session.
    
    Call this when deleting a course/agent. Should be called BEFORE
    deleting the search indexes.
    """
    from azure_services.tools.search.course_index_manager import delete_unified_knowledge_pipeline
    
    logger.info(f"Deleting UNIFIED Knowledge Base for session {session_uuid}")
    
    try:
        success, result = delete_unified_knowledge_pipeline(session_uuid)
        
        if success:
            logger.info(f"✓ Unified Knowledge Pipeline deleted for {session_uuid}")
            return {
                "ok": True,
                "session_uuid": session_uuid,
                "message": result,
            }
        else:
            logger.warning(f"Knowledge Pipeline deletion had issues: {result}")
            return {
                "ok": False,
                "session_uuid": session_uuid,
                "message": result,
            }
            
    except Exception as e:
        logger.error(f"Knowledge Pipeline deletion error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/knowledge/retrieve-unified")
async def retrieve_from_unified_kb(
    session_uuid: str = Form(...),
    query: str = Form(...),
    top_k: int = Form(10),
):
    """
    Retrieve content from the session's UNIFIED Knowledge Base.
    
    This performs agentic retrieval, searching:
    - ALL course files (textbooks, notes, etc.)
    - ALL exam files (past papers, practice questions)
    - ALL teacher-curated web domains
    
    Results are ranked together by semantic relevance.
    
    Args:
        session_uuid: The course session UUID
        query: The search query or question
        top_k: Number of results to return (default: 10)
    """
    from azure_services.tools.search.course_index_manager import (
        retrieve_from_unified_knowledge_base,
        get_unified_knowledge_base_name,
    )
    
    logger.info(f"Retrieving from UNIFIED Knowledge Base for session {session_uuid}: {query[:50]}...")
    
    try:
        result = retrieve_from_unified_knowledge_base(session_uuid, query, top_k)
        
        if result.get("success"):
            return {
                "ok": True,
                "knowledge_base": get_unified_knowledge_base_name(session_uuid),
                "query": query,
                "total_results": len(result.get("chunks", [])),
                "chunks": result.get("chunks", []),
                "answer": result.get("answer"),
            }
        else:
            logger.warning(f"Retrieval failed: {result.get('error')}")
            return {
                "ok": False,
                "error": result.get("error"),
                "chunks": [],
            }
            
    except Exception as e:
        logger.error(f"Retrieval error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# MCP PIPELINE ENDPOINTS - Full agentic retrieval with MCPTool
# =============================================================================

@app.post("/api/knowledge/create-mcp-pipeline")
def create_mcp_pipeline_endpoint(
    session_uuid: str = Form(...),
    teacher_urls: str = Form(None),  # JSON array of URLs as string, e.g. '["https://example.com"]'
):
    """
    Ensure the common index pipeline exists and run the indexer.
    
    With the common index approach, this:
    1. Ensures the shared datasource, index, skillset, indexer exist (idempotent)
    2. Triggers the indexer to process any new files
    
    The agent creation flow will use AzureAISearchTool with a session_id filter
    instead of MCPTool + per-session Knowledge Sources/Bases.
    
    Call this AFTER uploading files to blob storage.
    
    Args:
        session_uuid: The session UUID
        teacher_urls: Optional JSON array of teacher-curated URLs (now handled via BingCustomSearchTool)
    
    Returns:
        - index_name: The common index name
        - session_filter: The OData filter for this session
    """
    from azure_services.tools.search.course_index_manager import (
        ensure_common_index_pipeline,
        run_common_indexer,
        get_common_index_name,
        get_session_filter,
    )
    
    logger.info(f"=== Ensuring common index pipeline for session {session_uuid} ===")
    
    try:
        # Idempotent: creates shared resources if they don't exist
        logger.info("Step 1: Calling ensure_common_index_pipeline()...")
        ensure_common_index_pipeline()
        logger.info("Step 1: ensure_common_index_pipeline() completed")
        
        # Trigger indexer to process new files
        logger.info("Step 2: Calling run_common_indexer()...")
        run_common_indexer()
        logger.info("Step 2: run_common_indexer() completed")
        
        index_name = get_common_index_name()
        session_filter = get_session_filter(session_uuid)
        
        logger.info(f"✓ Common index pipeline ready!")
        logger.info(f"  Index: {index_name}")
        logger.info(f"  Filter: {session_filter}")
        
        return {
            "ok": True,
            "session_uuid": session_uuid,
            "index_name": index_name,
            "session_filter": session_filter,
            "message": "Common index pipeline ready. Agent will use AzureAISearchTool with session filter.",
        }
            
    except Exception as e:
        logger.error(f"Common index pipeline error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/knowledge/delete-mcp-pipeline")
async def delete_mcp_pipeline_endpoint(
    session_uuid: str = Query(...),
):
    """
    Delete session documents from the common index and optionally clean up
    legacy MCP pipeline resources.
    
    With the common index approach, this removes all documents with the
    matching session_id from the shared index. No per-session resources
    (KS, KB, MCP connection) need to be deleted.
    
    Call this when deleting a course/agent.
    """
    from azure_services.tools.search.course_index_manager import delete_session_documents
    
    logger.info(f"=== Deleting session documents for {session_uuid} from common index ===")
    
    try:
        del_ok, del_result = delete_session_documents(session_uuid)
        
        logger.info(f"Session doc deletion: {del_result} (success={del_ok})")
        deleted_count = del_result if del_ok else 0
        
        return {
            "ok": del_ok,
            "session_uuid": session_uuid,
            "result": del_result,
            "message": del_result if del_ok else f"Deletion failed: {del_result}",
        }
            
    except Exception as e:
        logger.error(f"Session document deletion error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/knowledge/indexer-status")
async def get_indexer_status():
    """
    Get the status of the common indexer.
    Useful for debugging indexing issues.
    """
    from azure_services.tools.search.course_index_manager import (
        get_common_indexer_status,
        run_common_indexer,
        get_common_index_name,
    )
    
    try:
        status = get_common_indexer_status()
        last_result = status.get("lastResult", {})
        
        return {
            "indexer_name": status.get("name"),
            "status": status.get("status"),
            "last_run_status": last_result.get("status"),
            "items_processed": last_result.get("itemsProcessed", 0),
            "items_failed": last_result.get("itemsFailed", 0),
            "error_message": last_result.get("errorMessage"),
            "warnings": len(last_result.get("warnings", [])),
            "index_name": get_common_index_name(),
        }
    except Exception as e:
        logger.error(f"Error getting indexer status: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/knowledge/run-indexer")
async def run_indexer():
    """
    Trigger the common indexer to run and process new documents.
    """
    from azure_services.tools.search.course_index_manager import run_common_indexer
    
    try:
        success, result = run_common_indexer()
        return {
            "ok": success,
            "result": result,
            "message": "Indexer started" if success else f"Failed: {result}",
        }
    except Exception as e:
        logger.error(f"Error running indexer: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ===================== Event Grid Webhook (Auto-Indexing) =====================

# Debounce: avoid running the indexer on every single blob event in a batch upload
_indexer_last_triggered: float = 0.0
_INDEXER_DEBOUNCE_SECONDS = 30  # Minimum seconds between indexer runs

async def _debounced_run_indexer():
    """Run the indexer with debounce to avoid hammering during batch uploads."""
    global _indexer_last_triggered
    now = time.time()
    if now - _indexer_last_triggered < _INDEXER_DEBOUNCE_SECONDS:
        logger.info(f"[EventGrid] Indexer debounced (last run {now - _indexer_last_triggered:.0f}s ago)")
        return
    _indexer_last_triggered = now
    
    from azure_services.tools.search.course_index_manager import run_common_indexer
    try:
        success, result = run_common_indexer()
        if success:
            logger.info(f"[EventGrid] Indexer triggered successfully: {result}")
        else:
            logger.warning(f"[EventGrid] Indexer trigger failed: {result}")
    except Exception as e:
        logger.error(f"[EventGrid] Error running indexer: {e}")


@app.post("/api/knowledge/eventgrid-webhook")
async def eventgrid_webhook(request: Request, background_tasks: BackgroundTasks):
    """
    Azure Event Grid webhook endpoint for automatic knowledge base re-indexing.
    
    Handles:
    1. Subscription validation handshake (Event Grid sends a validation event
       when you first create a subscription — we must echo back the validation code)
    2. Blob events (BlobCreated, BlobDeleted) — triggers the indexer in the background
    
    Setup: Create an Event Grid subscription on the blob storage account pointing
    to this endpoint. The subscription should filter for:
    - Microsoft.Storage.BlobCreated
    - Microsoft.Storage.BlobDeleted
    
    Subject filter (optional): /blobServices/default/containers/course-material-v1
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    
    # Event Grid sends an array of events
    events = body if isinstance(body, list) else [body]
    
    for event in events:
        event_type = event.get("eventType", "")
        
        # 1. Subscription validation handshake
        if event_type == "Microsoft.EventGrid.SubscriptionValidationEvent":
            validation_code = event.get("data", {}).get("validationCode", "")
            logger.info(f"[EventGrid] Subscription validation received, code: {validation_code}")
            return {"validationResponse": validation_code}
        
        # 2. CloudEvents schema validation (alternative schema)
        if event.get("type") == "Microsoft.EventGrid.SubscriptionValidationEvent":
            validation_code = event.get("data", {}).get("validationCode", "")
            logger.info(f"[EventGrid] CloudEvents validation received, code: {validation_code}")
            return {"validationResponse": validation_code}
        
        # 3. Blob storage events → trigger indexer
        if event_type in (
            "Microsoft.Storage.BlobCreated",
            "Microsoft.Storage.BlobDeleted",
        ):
            subject = event.get("subject", "")
            blob_url = event.get("data", {}).get("url", "")
            logger.info(f"[EventGrid] Blob event: {event_type} | subject={subject}")
            
            # Only process events for course material container
            if "course-material" in subject or "course-material" in blob_url:
                background_tasks.add_task(_debounced_run_indexer)
                logger.info("[EventGrid] Indexer run queued in background")
            else:
                logger.debug(f"[EventGrid] Ignoring event for non-course blob: {subject}")
        else:
            logger.debug(f"[EventGrid] Ignoring event type: {event_type}")
    
    return {"status": "ok", "message": "Event processed"}


@app.get("/api/knowledge/eventgrid-webhook")
async def eventgrid_webhook_health():
    """Health check for Event Grid webhook endpoint."""
    return {"status": "ok", "endpoint": "/api/knowledge/eventgrid-webhook", "debounce_seconds": _INDEXER_DEBOUNCE_SECONDS}


# ===================== Groundedness Evaluation =====================
# NOTE: Groundedness evaluation endpoints have been migrated to the
# Dashboard server (port 8050). See Dashboard/main.py for the new
# endpoints under /api/dashboard/evaluation/*.
# ===================================================================


@app.post("/api/knowledge/recreate-pipeline")
async def recreate_pipeline():
    """
    Delete and recreate the common index pipeline.
    Use this to fix credential/configuration issues.
    """
    from azure_services.tools.search.course_index_manager import (
        _make_request,
        COMMON_DATASOURCE_NAME,
        COMMON_INDEXER_NAME,
        ensure_common_index_pipeline,
        run_common_indexer,
        get_common_index_name,
        API_VERSION,
    )
    import os
    
    search_endpoint = os.environ["AZURE_AI_SEARCH_ENDPOINT"]
    
    try:
        # Delete datasource (indexer depends on it, so delete indexer first)
        logger.info("Deleting indexer and datasource...")
        
        # Delete indexer
        url = f"{search_endpoint}/indexers/{COMMON_INDEXER_NAME}?api-version={API_VERSION}"
        _make_request("DELETE", url)
        
        # Delete datasource
        url = f"{search_endpoint}/datasources/{COMMON_DATASOURCE_NAME}?api-version={API_VERSION}"
        _make_request("DELETE", url)
        
        # Recreate everything
        logger.info("Recreating pipeline...")
        ensure_common_index_pipeline()
        
        # Run indexer
        run_common_indexer()
        
        return {
            "ok": True,
            "message": "Pipeline recreated and indexer started",
            "index_name": get_common_index_name(),
        }
    except Exception as e:
        logger.error(f"Error recreating pipeline: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# LEGACY: Per-scope endpoints (kept for backward compatibility)
@app.post("/api/knowledge/create-knowledge-base")
async def create_knowledge_base(
    session_uuid: str = Form(...),
    kb_scope: str = Form("course"),
    teacher_urls: Optional[str] = Form(None),  # JSON array of URLs
):
    """
    Create a unified Knowledge Base for a course combining:
    1. Index Knowledge Source (course files from search index)
    2. Web Knowledge Source (teacher-curated websites)
    
    This enables agentic retrieval where a single query searches both
    course materials AND approved web domains.
    
    Prerequisites: The search index must already exist (call /api/knowledge/create-index first).
    
    Args:
        session_uuid: The course session UUID
        kb_scope: "course" or "exam"
        teacher_urls: JSON array of teacher-curated URLs, e.g.:
                      '["https://wikipedia.org/wiki/Topic", "https://khanacademy.org/"]'
    """
    from azure_services.tools.search.course_index_manager import (
        create_full_knowledge_pipeline,
        get_knowledge_base_name,
        check_index_exists,
    )
    
    logger.info(f"Creating Knowledge Base for session {session_uuid}, scope {kb_scope}")
    
    # Parse teacher URLs if provided
    urls_list = None
    if teacher_urls:
        try:
            import json
            urls_list = json.loads(teacher_urls)
            logger.info(f"Parsed {len(urls_list)} teacher URLs")
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=400, detail=f"Invalid teacher_urls JSON: {e}")
    
    try:
        # Verify index exists
        if not check_index_exists(session_uuid, kb_scope):
            raise HTTPException(
                status_code=400,
                detail="Index does not exist. Create the index first with /api/knowledge/create-index"
            )
        
        success, result = create_full_knowledge_pipeline(
            session_uuid, 
            kb_scope, 
            teacher_urls=urls_list
        )
        
        if success:
            kb_name = get_knowledge_base_name(session_uuid, kb_scope)
            logger.info(f"✓ Knowledge Base created: {kb_name}")
            return {
                "ok": True,
                "knowledge_base_name": kb_name,
                "session_uuid": session_uuid,
                "kb_scope": kb_scope,
                "message": "Knowledge Base created. Agent can now use unified retrieval.",
            }
        else:
            logger.error(f"✗ Knowledge Base creation failed: {result}")
            raise HTTPException(status_code=500, detail=result)
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Knowledge Base creation error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/knowledge/delete-knowledge-base")
async def delete_knowledge_base(
    session_uuid: str = Query(...),
    kb_scope: str = Query("course"),
):
    """
    Delete the Knowledge Base and Knowledge Sources for a course.
    
    Call this when deleting a course/agent. Should be called BEFORE
    deleting the search index.
    """
    from azure_services.tools.search.course_index_manager import delete_knowledge_pipeline
    
    logger.info(f"Deleting Knowledge Base for session {session_uuid}, scope {kb_scope}")
    
    try:
        success, result = delete_knowledge_pipeline(session_uuid, kb_scope)
        
        if success:
            logger.info(f"✓ Knowledge Pipeline deleted for {session_uuid}/{kb_scope}")
            return {
                "ok": True,
                "session_uuid": session_uuid,
                "kb_scope": kb_scope,
                "message": result,
            }
        else:
            logger.warning(f"Knowledge Pipeline deletion had issues: {result}")
            return {
                "ok": False,
                "session_uuid": session_uuid,
                "kb_scope": kb_scope,
                "message": result,
            }
            
    except Exception as e:
        logger.error(f"Knowledge Pipeline deletion error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/knowledge/retrieve")
async def retrieve_from_kb(
    session_uuid: str = Form(...),
    kb_scope: str = Form("course"),
    query: str = Form(...),
    top_k: int = Form(10),
):
    """
    Retrieve content from a course's unified Knowledge Base.
    
    This performs agentic retrieval, searching both:
    1. Course files (textbooks, notes, etc.)
    2. Teacher-curated web domains
    
    Results are ranked together by semantic relevance.
    
    Args:
        session_uuid: The course session UUID
        kb_scope: "course" or "exam"
        query: The search query or question
        top_k: Number of results to return (default: 10)
    """
    from azure_services.tools.search.course_index_manager import (
        retrieve_from_knowledge_base,
        get_knowledge_base_name,
    )
    
    logger.info(f"Retrieving from Knowledge Base for session {session_uuid}: {query[:50]}...")
    
    try:
        result = retrieve_from_knowledge_base(session_uuid, kb_scope, query, top_k)
        
        if result.get("success"):
            return {
                "ok": True,
                "knowledge_base": get_knowledge_base_name(session_uuid, kb_scope),
                "query": query,
                "total_results": len(result.get("chunks", [])),
                "chunks": result.get("chunks", []),
                "answer": result.get("answer"),
            }
        else:
            logger.warning(f"Retrieval failed: {result.get('error')}")
            return {
                "ok": False,
                "error": result.get("error"),
                "chunks": [],
            }
            
    except Exception as e:
        logger.error(f"Retrieval error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ===================== Custom Skill for Azure AI Search =====================

@app.post("/api/skills/detect-sections")
async def detect_sections_skill(request: Request):
    """
    Custom Web API Skill for Azure AI Search to detect logical sections.
    
    This endpoint is called by Azure AI Search during indexing. It analyzes
    the content of each chunk and detects which logical section it belongs to
    (e.g., "Question Paper 5", "Chapter 3").
    
    Azure AI Search Custom Skill Contract:
    - Receives: {"values": [{"recordId": "1", "data": {"content": "...", "pageNumber": 1}}]}
    - Returns: {"values": [{"recordId": "1", "data": {"logical_section": "..."}}]}
    """
    import re
    
    # Common section header patterns for educational content
    SECTION_PATTERNS = [
        # Question papers
        (r"(?i)^(?:question|exam|test)\s*paper\s*(?:no\.?\s*)?(\d+)", "Question Paper {}"),
        (r"(?i)^(?:paper|exam)\s*[-#:]?\s*(\d+)", "Paper {}"),
        (r"(?i)^(?:set|version)\s*[-:]?\s*([A-Za-z\d]+)", "Set {}"),
        # Chapters
        (r"(?i)^chapter\s*(\d+)", "Chapter {}"),
        (r"(?i)^unit\s*(\d+)", "Unit {}"),
        (r"(?i)^module\s*(\d+)", "Module {}"),
        (r"(?i)^lesson\s*(\d+)", "Lesson {}"),
        (r"(?i)^part\s*(\d+|[IV]+)", "Part {}"),
        # Sections
        (r"(?i)^section\s*([A-Za-z\d]+)", "Section {}"),
    ]
    
    try:
        body = await request.json()
        values = body.get("values", [])
        
        results = []
        
        for value in values:
            record_id = value.get("recordId", "")
            data = value.get("data", {})
            content = data.get("content", "")
            page_number = data.get("pageNumber", 1)
            
            # Try to detect section from content
            logical_section = None
            
            # Check first few lines for section headers
            lines = content.strip().split('\n')[:10]
            
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                    
                for pattern, format_str in SECTION_PATTERNS:
                    match = re.match(pattern, line)
                    if match:
                        # Found a section header
                        section_num = match.group(1)
                        logical_section = format_str.format(section_num)
                        break
                
                if logical_section:
                    break
            
            # If no section detected, use page-based fallback
            # This ensures every chunk has some section identifier
            if not logical_section:
                # Could optionally use page ranges: "Pages 1-5", etc.
                # For now, leave as None - the field will be empty
                pass
            
            results.append({
                "recordId": record_id,
                "data": {
                    "logical_section": logical_section
                },
                "errors": None,
                "warnings": None
            })
        
        logger.info(f"Processed {len(results)} records for section detection")
        
        return {"values": results}
        
    except Exception as e:
        logger.error(f"Section detection skill error: {e}", exc_info=True)
        # Return error for each record
        return {
            "values": [{
                "recordId": "0",
                "data": {"logical_section": None},
                "errors": [{"message": str(e)}],
                "warnings": None
            }]
        }


@app.post("/api/skills/detect-sections-di")
async def detect_sections_with_di_skill(request: Request):
    """
    Advanced Custom Web API Skill using Document Intelligence for section detection.
    
    This version uses Document Intelligence to detect headings with their roles
    (title, sectionHeading) for more accurate section detection.
    
    Note: This is more expensive (DI API calls) but more accurate for complex documents.
    Use the simple `/api/skills/detect-sections` for basic pattern matching.
    """
    try:
        body = await request.json()
        values = body.get("values", [])
        
        # Import section detector
        from utils.section_detector import get_logical_section
        
        results = []
        
        for value in values:
            record_id = value.get("recordId", "")
            data = value.get("data", {})
            content = data.get("content", "")
            
            # Use the pattern-based detector
            logical_section = get_logical_section(content)
            
            results.append({
                "recordId": record_id,
                "data": {
                    "logical_section": logical_section
                },
                "errors": None,
                "warnings": None
            })
        
        return {"values": results}
        
    except Exception as e:
        logger.error(f"DI Section detection skill error: {e}", exc_info=True)
        return {
            "values": [{
                "recordId": "0",
                "data": {"logical_section": None},
                "errors": [{"message": str(e)}],
                "warnings": None
            }]
        }


# ===================== Azure agents list/delete =====================

# Meta-agents that should NOT be shown in the library
HIDDEN_META_AGENTS = {
    COURSE_AGENT_CREATION_AGENT_ID,  # "course-agent-creation-agent" (CACA)
    COURSE_CONVERSATIONAL_AGENT_ID,  # "course-conversational-agent" (CCA)
    TEMP_COURSE_AGENT_ID,            # "temp-course-agent"
}
_agent_list_cache_lock = threading.Lock()
_agent_list_inflight: Dict[str, threading.Event] = {}


def _finish_agent_list_request(cache_key: str, rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    with _agent_list_cache_lock:
        if not hasattr(azure_agents_list, '_cache'):
            azure_agents_list._cache = {}
            azure_agents_list._cache_time = {}
        azure_agents_list._cache[cache_key] = rows
        azure_agents_list._cache_time[cache_key] = time.time()
        event = _agent_list_inflight.pop(cache_key, None)
        if event is not None:
            event.set()
    return rows


def _invalidate_agent_list_caches(
    teacher_id: Optional[str] = None,
    invalidate_teacher_scope: bool = True,
) -> None:
    with _agent_list_cache_lock:
        if hasattr(azure_agents_list, '_cache'):
            azure_agents_list._cache.clear()
            azure_agents_list._cache_time.clear()
    if invalidate_teacher_scope:
        try:
            from teacher_dashboard.teacher_scope import invalidate_teacher_agents_cache
            invalidate_teacher_agents_cache(teacher_id)
        except Exception as e:
            logger.debug(f"Teacher agent cache invalidation skipped: {e}")


@app.get("/api/azure/agents/list")
def azure_agents_list(
    force_refresh: bool = Query(False),
    created_by_id: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
):
    """
    List agents from Cosmos DB (primary) with fallback to Azure AI Foundry API.
    
    Uses named agents from AIProjectClient.
    Filters out meta-agents (CCA, CACA, temp-course-agent) which are internal only.
    
    Role-based scoping (when user_id is provided):
      - admin: sees all agents
      - teacher: sees agents they created or are assigned to teach
      - student: sees only agents they are enrolled in
    
    Args:
        force_refresh: If True, bypass cache and fetch fresh data
        created_by_id: Filter agents by creator userId (optional, legacy)
        user_id: Current user's ID for role-based scoping (optional)
    
    Returns:
        List of agent metadata including description, conversation starters, etc.
    """
    # Resolve user role when user_id is provided
    user_role = "student"  # default: restrictive if no user_id
    if user_id:
        try:
            profile = get_user_profile(user_id)
            user_role = (profile or {}).get("role", "student")
        except Exception:
            user_role = "student"  # safe fallback

    # Use cached version if available and fresh (within 30 seconds)
    cache_key = f"agents_{user_id or created_by_id or 'all'}_{user_role}"
    with _agent_list_cache_lock:
        cache = getattr(azure_agents_list, '_cache', {})
        cache_time = getattr(azure_agents_list, '_cache_time', {})

        if not force_refresh and cache.get(cache_key) is not None and (time.time() - cache_time.get(cache_key, 0)) < 30:
            return cache[cache_key]

        pending = _agent_list_inflight.get(cache_key)
        if pending is None:
            pending = threading.Event()
            _agent_list_inflight[cache_key] = pending
            owns_fill = True
        else:
            owns_fill = False

    if not owns_fill:
        pending.wait(timeout=60)
        with _agent_list_cache_lock:
            return getattr(azure_agents_list, '_cache', {}).get(cache_key, [])
    
    # First, try to get agents from Cosmos DB (has rich metadata)
    try:
        if user_id:
            cosmos_agents = list_agents_for_user(user_id=user_id, user_role=user_role)
        elif created_by_id:
            cosmos_agents = list_agents_metadata(created_by_id=created_by_id)
        else:
            # No user_id and no created_by_id — return empty list
            # (prevents unauthenticated/anonymous access from seeing all agents)
            cosmos_agents = []
        if cosmos_agents is not None:
            # Filter out meta-agents (CCA, CACA, temp-course-agent)
            cosmos_agents = [a for a in cosmos_agents if a.get("id", "") not in HIDDEN_META_AGENTS]
            
            # Collect all unique creator userIds for batch lookup
            creator_ids = list(set(a.get("createdById", "") for a in cosmos_agents if a.get("createdById")))

            # Assigned teachers (admin-managed) are resolved in the same batch.
            assigned_teacher_ids = {
                tid
                for a in cosmos_agents
                for tid in (a.get("teacherIds") or [])
                if tid
            }

            # Batch fetch user profiles to get display names
            lookup_ids = list(set(creator_ids) | assigned_teacher_ids)
            users_map = get_users_batch(lookup_ids) if lookup_ids else {}

            # Assigned teachers may still be invite-only records (C1), which
            # get_users_batch does not cover.
            missing_ids = [uid for uid in lookup_ids if uid not in users_map]
            invites_map = get_invited_users_batch(missing_ids) if missing_ids else {}

            def _display_name(uid: str) -> str:
                profile = users_map.get(uid) or invites_map.get(uid) or {}
                return (
                    profile.get("displayName", "")
                    or profile.get("fullName", "")
                    or profile.get("name", "")
                    or ""
                )

            rows = []
            for a in cosmos_agents:
                creator_id = a.get("createdById", "") or ""
                user_profile = users_map.get(creator_id, {})
                creator_display_name = user_profile.get("displayName", "") or user_profile.get("fullName", "") or ""
                # Agents carry no institution of their own, so attribute the creator's.
                creator_institute = user_profile.get("institute", "") or user_profile.get("college", "") or ""

                teacher_ids = [tid for tid in (a.get("teacherIds") or []) if tid]
                teacher_names = [name for name in (_display_name(tid) for tid in teacher_ids) if name]

                rows.append({
                    "id": a.get("id", ""),
                    "name": a.get("name", "") or "(unnamed agent)",
                    "model": a.get("model", "") or "",
                    "status": a.get("status", "active"),
                    "description": a.get("description", "") or "",
                    "created_by_id": creator_id,
                    "created_by": creator_display_name or a.get("createdByName", ""),
                    "institution": creator_institute,
                    "teacher_ids": teacher_ids,
                    "teachers": teacher_names,
                    "course_name": a.get("courseName", "") or "",
                    "course_code": a.get("courseCode", "") or "",
                    "course_level": a.get("courseLevel", "") or "",
                    "agent_kind": a.get("agentKind", "learning"),
                    "conversation_starters": a.get("conversationStarters", []),
                    "created_at": a.get("createdAt", ""),
                    "agentImageUrl": a.get("agentImageUrl", "") or "",
                    "api_version": a.get("apiVersion", "current"),
                    "department_id": a.get("departmentId", "") or "",
                })
            
            logger.info(f"Listed {len(rows)} agents from Cosmos DB (user={user_id}, role={user_role})")
            return _finish_agent_list_request(cache_key, rows)
    except Exception as e:
        logger.warning(f"Could not fetch agents from Cosmos DB, falling back to Azure: {e}")
    
    # Fallback: Use AIProjectClient to list agents (no scoping — admin-only fallback)
    try:
        creator = AgentCreator(project_endpoint=PROJECT_ENDPOINT, model_deployment=AGENT_MODEL_DEPLOYMENT)
        azure_agents = creator.list_agents()
        
        # Filter out meta-agents (CCA, CACA, temp-course-agent)
        azure_agents = [a for a in azure_agents if a.name not in HIDDEN_META_AGENTS]
        
        rows = []
        for agent in azure_agents:
            rows.append({
                "id": agent.name,  # Uses names as IDs
                "name": agent.name or "(unnamed agent)",
                "model": getattr(agent, "model", "") or AGENT_MODEL_DEPLOYMENT,
                "status": "active",
                "description": getattr(agent, "description", "") or "",
                "created_by_id": "",
                "created_by": "",
                "course_name": "",
                "course_level": "",
                "agent_kind": "learning",
                "conversation_starters": [],
                "created_at": "",
                "agentImageUrl": "",
                "api_version": "current",
            })
        
        return _finish_agent_list_request(cache_key, rows)
    except Exception as e:
        logger.error(f"Agent list failed: {e}")
        return _finish_agent_list_request(cache_key, [])


# ── Agent member management ────────────────────────────────────────
class AgentMemberPayload(BaseModel):
    user_id: str
    member_type: str  # "teacher" or "student"


@app.get("/api/agents/{agent_id}/members")
def get_members(agent_id: str):
    """Return teacherIds and studentIds for an agent."""
    try:
        members = get_agent_members(agent_id)
        return members
    except Exception as e:
        logger.error(f"Failed to get members for agent {agent_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to get agent members")


@app.post("/api/agents/{agent_id}/members")
def add_member(agent_id: str, payload: AgentMemberPayload, requester_id: str = Query(...)):
    """
    Add a student or teacher to an agent.
    Only the creator, existing teachers on the agent, or admins can manage members.
    """
    # Permission check
    try:
        requester_profile = get_user_profile(requester_id)
        requester_role = (requester_profile or {}).get("role", "student")
    except Exception:
        raise HTTPException(status_code=403, detail="Could not verify requester permissions")

    if requester_role not in ("admin",):
        agent_meta = get_agent_metadata(agent_id)
        if not agent_meta:
            raise HTTPException(status_code=404, detail="Agent not found")
        is_creator = agent_meta.get("createdById") == requester_id
        is_teacher = requester_id in (agent_meta.get("teacherIds") or [])
        if not (is_creator or is_teacher):
            raise HTTPException(status_code=403, detail="Only creator, assigned teachers, or admins can manage members")

    if payload.member_type not in ("teacher", "student"):
        raise HTTPException(status_code=400, detail="member_type must be 'teacher' or 'student'")

    try:
        add_agent_member(agent_id, payload.user_id, payload.member_type)
        _invalidate_agent_list_caches(
            payload.user_id if payload.member_type == "teacher" else None,
            invalidate_teacher_scope=payload.member_type == "teacher",
        )
        return {"status": "ok", "agent_id": agent_id, "added": payload.user_id, "as": payload.member_type}
    except Exception as e:
        logger.error(f"Failed to add member to agent {agent_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to add member")


@app.delete("/api/agents/{agent_id}/members/{target_user_id}")
def remove_member(agent_id: str, target_user_id: str, requester_id: str = Query(...)):
    """
    Remove a student or teacher from an agent.
    Only the creator, existing teachers on the agent, or admins can manage members.
    """
    # Permission check
    try:
        requester_profile = get_user_profile(requester_id)
        requester_role = (requester_profile or {}).get("role", "student")
    except Exception:
        raise HTTPException(status_code=403, detail="Could not verify requester permissions")

    if requester_role not in ("admin",):
        agent_meta = get_agent_metadata(agent_id)
        if not agent_meta:
            raise HTTPException(status_code=404, detail="Agent not found")
        is_creator = agent_meta.get("createdById") == requester_id
        is_teacher = requester_id in (agent_meta.get("teacherIds") or [])
        if not (is_creator or is_teacher):
            raise HTTPException(status_code=403, detail="Only creator, assigned teachers, or admins can manage members")

    try:
        remove_agent_member(agent_id, target_user_id, "teacher")
        remove_agent_member(agent_id, target_user_id, "student")
        _invalidate_agent_list_caches(target_user_id)
        return {"status": "ok", "agent_id": agent_id, "removed": target_user_id}
    except Exception as e:
        logger.error(f"Failed to remove member from agent {agent_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to remove member")


@app.post("/api/agents/create-direct")
async def create_agent_direct(payload: Dict[str, Any]):
    """
    Create an agent using AIProjectClient with MCP knowledge base and web search.
    
    Uses named agents with AIProjectClient.
    
    Flow:
    1. Send course details to meta-agent to generate sophisticated prompts
    2. Create the agent with MCP+Bing tools
    3. Optionally set up MCP knowledge base if session_uuid provided
    4. Save agent metadata to Cosmos DB
    """
    agent_kind = payload.get("kind")  # "learning", "exam", or "course"
    name = payload.get("name")
    user_description = payload.get("description") or ""
    course_name = payload.get("courseName") or ""
    course_level = payload.get("courseLevel") or ""
    course_duration = payload.get("courseDuration") or ""
    course_description = payload.get("courseDescription", "") or payload.get("additionalContext", "") or ""
    prerequisites = payload.get("prerequisites") or ""
    created_by_id = payload.get("createdById") or ""
    created_by_name = payload.get("createdByName") or ""
    session_uuid = payload.get("sessionUuid") or ""  # For MCP knowledge base
    include_web_search = payload.get("includeWebSearch", False)
    teacher_urls = payload.get("teacherUrls") or []  # URLs for web knowledge source

    model = payload.get("model") or AGENT_MODEL_DEPLOYMENT

    if model not in ALLOWED_DEPLOYMENTS:
        raise HTTPException(
            status_code=400,
            detail=f"Model '{model}' not allowed. Allowed: {sorted(ALLOWED_DEPLOYMENTS)}",
        )

    if not name:
        raise HTTPException(status_code=400, detail="Agent name is required")

    if not agent_kind or agent_kind not in ["learning", "exam", "course"]:
        raise HTTPException(status_code=400, detail="Valid agent kind (learning/exam/course) is required")

    logger.info(f"Creating {agent_kind} agent using course-agent-creation-agent meta-agent...")
    
    # Initialize description and starters
    generated_description = user_description or f"AI assistant for {course_name}"
    conversation_starters = []
    learning_prompt_from_meta = ""
    
    # Call CACA meta-agent to generate course specification
    generated_description, course_prompt_from_meta, conversation_starters = await call_meta_agent_for_prompt(
        course_name=course_name,
        course_level=course_level,
        course_duration=course_duration,
        course_description=course_description,
        prerequisites=prerequisites,
    )
    logger.info(f"Meta-agent generated prompt: {len(course_prompt_from_meta)} chars")

    # Unify with prompt store components
    unified_instructions = unify_agent_prompts(
        course_name=course_name,
        course_level=course_level or None,
        course_duration=course_duration or None,
        learning_prompt=course_prompt_from_meta,
        exam_prompt=None,
        additional_context=course_description or None,
        include_agent_behavior=True,
        include_pedagogical_framework=True,
        include_tool_handling=True,
        include_knowledge_grounding=True,
        include_safety_guardrails=True,
    )
    
    instructions = unified_instructions
    logger.info(f"Unified instructions: {len(instructions)} chars")

    final_name = sanitize_agent_name(name)
    
    # Prepare common index search if session_uuid provided
    search_index_name = None
    search_index_filter = None
    search_connection_id = None
    
    SEARCH_CONNECTION_ID = os.environ["AZURE_AI_SEARCH_CONNECTION_ID"]
    
    if session_uuid:
        try:
            from azure_services.tools.search.course_index_manager import (
                ensure_common_index_pipeline,
                run_common_indexer,
                get_common_index_name,
                get_session_filter,
            )
            
            pipeline_ok, pipeline_result = ensure_common_index_pipeline()
            if not pipeline_ok:
                raise Exception(f"Pipeline failed: {pipeline_result}")
            
            indexer_ok, indexer_result = run_common_indexer()
            if not indexer_ok:
                logger.warning(f"Indexer run failed (may already be running): {indexer_result}")
            
            search_index_name = get_common_index_name()
            search_index_filter = get_session_filter(session_uuid)
            search_connection_id = SEARCH_CONNECTION_ID
            logger.info(f"Common index ready: {search_index_name}, filter: {search_index_filter}")
        except Exception as e:
            logger.warning(f"Common index setup failed, continuing without: {e}")

    try:
        # Create a dedicated memory store for this agent
        memory_store_name = None
        try:
            mem_result = create_memory_store_for_agent(final_name)
            memory_store_name = mem_result.get("name")
            logger.info(f"Memory store ready: {memory_store_name}")
        except Exception as e:
            logger.warning(f"Memory store creation failed, continuing without: {e}")

        # Create agent using AIProjectClient
        creator = AgentCreator(
            project_endpoint=PROJECT_ENDPOINT,
            model_deployment=model,
        )
        
        agent_name, agent_version = creator.create_agent(
            name=final_name,
            instructions=instructions,
            include_web_search=include_web_search,
            include_custom_search=False,
            search_index_name=search_index_name,
            search_index_filter=search_index_filter,
            search_connection_id=search_connection_id,
            memory_store_name=memory_store_name,
            save_to_config=True,
        )
        
        # The agent_id IS the name (named agents)
        agent_id = agent_name
        
    except Exception as e:
        error_msg = str(e)
        if "already exists" in error_msg.lower():
            raise HTTPException(status_code=409, detail=f"Agent '{final_name}' already exists")
        logger.error(f"Agent creation failed: {e}")
        raise HTTPException(status_code=400, detail=f"Agent creation failed: {error_msg}")

    logger.info(f"Created {agent_kind} agent: {agent_name} v{agent_version}")

    # Save agent metadata to Cosmos DB
    try:
        create_agent_metadata(
            agent_id=agent_id,
            name=final_name,
            created_by=created_by_id,
            created_by_name=created_by_name,
            description=generated_description,
            model=model,
            course_name=course_name,
            course_level=course_level,
            course_duration=course_duration,
            agent_kind=agent_kind,
            conversation_starters=conversation_starters,
            additional_context=additional_context,
            metadata={"memoryStoreName": memory_store_name} if memory_store_name else None,
            session_uuid=session_uuid or None,
            department_id=payload.get("departmentId", ""),
        )
        logger.info(f"Saved agent metadata to Cosmos DB for {agent_id}")
    except Exception as e:
        logger.error(f"Failed to save agent metadata: {e}")

    return {
        "agent_id": agent_id,
        "agent_name": agent_name,
        "agent_version": agent_version,
        "name": final_name,
        "description": generated_description,
        "conversation_starters": conversation_starters,
        "instructions_preview": instructions[:500] + "..." if len(instructions) > 500 else instructions,
        "meta_agent_used": "CACA",
        "created_by_id": created_by_id,
        "has_search": search_index_name is not None,
        "has_web_search": include_web_search,
        "has_memory": memory_store_name is not None,
        "memory_store_name": memory_store_name,
        "api_version": "current",
    }


# ===================== Async Agent Creation (Parallel Processing) =====================

class AsyncAgentCreateRequest(BaseModel):
    """Request model for async agent creation with parallel processing"""
    # Agent details
    kind: Literal["learning", "exam", "course"]
    name: str
    description: Optional[str] = None
    courseName: str
    courseLevel: Optional[str] = None
    courseDuration: Optional[str] = None
    additionalContext: Optional[str] = None
    model: Optional[str] = None
    createdById: Optional[str] = None
    # Knowledge files (session UUID for uploaded files)
    sessionUuid: Optional[str] = None
    kbScope: Optional[str] = "course"
    indexName: Optional[str] = None
    # Agent image (base64 or will be uploaded separately)
    agentImageUrl: Optional[str] = None
    # Bing Custom Search configuration
    # Instance name for teacher-curated domain search (created in Azure Portal)
    customSearchInstanceName: Optional[str] = None
    # Course code (e.g. CS101)
    courseCode: Optional[str] = None
    # Prerequisites (list of prerequisite course names)
    prerequisites: Optional[List[str]] = None
    # Teacher-curated URLs for focused web search
    # These are passed to the agent's instructions to prioritize searches from these domains
    courseUrls: Optional[List[str]] = None
    # Textbook metadata for course curriculum research
    textbooks: Optional[List[Dict[str, Any]]] = None
    # Department this agent belongs to
    departmentId: Optional[str] = None


async def _check_knowledge_files_exist(
    session_uuid: str,
    kb_scope: str,
) -> bool:
    """
    Quick check if knowledge files exist for this session in blob storage.
    Does NOT wait for indexer - just checks if files are there.
    
    Returns True if files exist, False otherwise.
    """
    if not session_uuid:
        return False
    
    INDEXER_CONTAINER = os.environ.get("AZURE_AI_SEARCH_BLOB_CONTAINER", "course-material-v1")
    
    try:
        from azure.storage.blob.aio import BlobServiceClient as AsyncBlobServiceClient
        
        async_credential = get_async_credential()
        blob_client = AsyncBlobServiceClient(
            account_url=f"https://{BLOB_STORAGE_ACCOUNT}.blob.core.windows.net",
            credential=async_credential
        )
        
        try:
            container = blob_client.get_container_client(INDEXER_CONTAINER)
            
            # Check if files exist for this session
            folder_path = f"sessions/{session_uuid}/{kb_scope}/"
            async for blob in container.list_blobs(name_starts_with=folder_path):
                # Found at least one file
                logger.info(f"[Knowledge Check] Found files for session {session_uuid}")
                return True
            
            logger.info(f"[Knowledge Check] No files found for session {session_uuid}")
            return False
                
        finally:
            await blob_client.close()
            await async_credential.close()
            
    except Exception as e:
        logger.error(f"[Knowledge Check] Error checking files: {e}")
        return False


def _background_attach_knowledge_and_save(
    agent_id: str,
    agent_name: str,
    session_uuid: str,
    kb_scope: str,
    index_name: Optional[str],
    created_by_id: str,
    description: str,
    model: str,
    course_name: str,
    course_level: str,
    course_duration: str,
    agent_kind: str,
    conversation_starters: List[str],
    additional_context: str,
    agent_image_url: Optional[str],
    department_id: str = "",
):
    """
    BACKGROUND TASK: Create per-course Azure AI Search index and attach to agent.
    
    This runs AFTER the agent is already created and user has started chatting.
    
    Steps:
    1. Create dedicated index for this course (datasource, index, skillset, indexer)
    2. Wait for indexer to process files
    3. Attach Azure AI Search tool to the agent
    4. Save metadata to Cosmos DB
    5. Save setup.json with index name
    """
    import time
    from azure_services.tools.search.course_index_manager import (
        create_course_index_pipeline,
        get_index_name,
        get_indexer_status,
    )
    
    SEARCH_CONNECTION_ID = os.environ["AZURE_AI_SEARCH_CONNECTION_ID"]
    
    target_index = None
    knowledge_attached = False
    
    # Only create index if we have a session (meaning files were uploaded)
    if session_uuid:
        try:
            # Step 1: Create per-course index pipeline
            logger.info(f"[Background] Creating per-course index for session {session_uuid}...")
            success, result = create_course_index_pipeline(session_uuid, kb_scope)
            
            if success:
                target_index = get_index_name(session_uuid, kb_scope)
                logger.info(f"[Background] ✓ Created index pipeline: {target_index}")
                
                # Step 2: Wait for indexer to process files
                logger.info(f"[Background] Waiting for indexer to process files...")
                max_wait_seconds = 120  # Wait up to 2 minutes
                check_interval = 10
                waited = 0
                
                while waited < max_wait_seconds:
                    time.sleep(check_interval)
                    waited += check_interval
                    
                    status = get_indexer_status(session_uuid, kb_scope)
                    if "lastResult" in status:
                        last_status = status.get("lastResult", {}).get("status")
                        if last_status in ["success", "transientFailure"]:
                            logger.info(f"[Background] Indexer finished with status: {last_status}")
                            break
                        elif last_status == "inProgress":
                            logger.info(f"[Background] Indexer still running... (waited {waited}s)")
                    else:
                        logger.info(f"[Background] Indexer starting... (waited {waited}s)")
                
                # Step 3: Attach Azure AI Search tool to agent
                ai_search_tool = create_azure_ai_search_tool(
                    index_name=target_index,
                    connection_id=SEARCH_CONNECTION_ID,
                    query_type="vector_semantic_hybrid",
                )
                
                # Get agents client (sync version for background task)
                ac = agents_client()
                
                # Get current agent to preserve existing tools
                agent = ac.get_agent(agent_id)
                existing_tools = list(agent.tools) if agent.tools else []
                
                # Filter out any existing Azure AI Search tools to avoid duplicates
                preserved_tools = [
                    t for t in existing_tools 
                    if not (isinstance(t, dict) and t.get('type') == 'azure_ai_search')
                    and 'AzureAISearch' not in str(type(t))
                ]
                
                # Combine preserved tools with new Azure AI Search tool
                all_tools = preserved_tools + [ai_search_tool]
                
                # Update the agent with new tools
                updated_agent = ac.update_agent(
                    agent_id=agent_id,
                    tools=all_tools,
                )
                
                knowledge_attached = True
                logger.info(f"[Background] ✓ Attached Azure AI Search index '{target_index}' to agent '{agent_id}'")
                
            else:
                logger.error(f"[Background] Failed to create index pipeline: {result}")
            
        except Exception as e:
            logger.error(f"[Background] Failed to create/attach Azure AI Search: {e}", exc_info=True)
            # Continue - save metadata even if knowledge attachment fails
    
    # Save metadata to Cosmos DB
    try:
        create_agent_metadata(
            agent_id=agent_id,
            name=agent_name,
            created_by=created_by_id,
            description=description,
            model=model,
            course_name=course_name,
            course_level=course_level,
            course_duration=course_duration,
            agent_kind=agent_kind,
            conversation_starters=conversation_starters,
            additional_context=additional_context,
            session_uuid=session_uuid or None,
            department_id=department_id,
        )
        logger.info(f"[Background] ✓ Saved agent metadata to Cosmos DB for {agent_id}")
    except Exception as e:
        logger.error(f"[Background] Failed to save metadata to Cosmos DB: {e}")
    
    # Save setup.json
    try:
        setup_data = {
            "agentId": agent_id,
            "agentKind": agent_kind,
            "courseName": course_name,
            "courseLevel": course_level,
            "courseDuration": course_duration,
            "additionalContext": additional_context,
            "vectorStoreId": target_index if knowledge_attached else None,
            "indexName": target_index,
            "knowledgeUrls": [],
            "agentDescription": description,
            "conversationStarters": conversation_starters,
            "agentImageUrl": agent_image_url,
            "knowledgeAttached": knowledge_attached,
            "sessionUuid": session_uuid,
        }
        _save_setup_json(agent_id, setup_data)
        logger.info(f"[Background] ✓ Saved setup details for {agent_id}")
        
    except Exception as e:
        logger.error(f"[Background] Failed to save setup.json: {e}")


def _background_save_metadata(
    agent_id: str,
    agent_name: str,
    session_uuid: str,
    kb_scope: str,
    index_name: Optional[str],
    created_by_id: str,
    description: str,
    model: str,
    course_name: str,
    course_level: str,
    course_duration: str,
    agent_kind: str,
    conversation_starters: List[str],
    additional_context: str,
    agent_image_url: Optional[str],
    knowledge_attached: bool,
    textbooks: Optional[List[Dict[str, Any]]] = None,
    manage_code: Optional[str] = None,
    department_id: str = "",
    course_code: str = "",
    prerequisites: Optional[List[str]] = None,
    course_urls: Optional[List[str]] = None,
):
    """
    BACKGROUND TASK: Save agent metadata to Cosmos DB and setup.json.
    
    This is a lightweight task that just persists metadata.
    Index attachment now happens in the foreground during agent creation.
    """
    # Save metadata to Cosmos DB
    try:
        create_agent_metadata(
            agent_id=agent_id,
            name=agent_name,
            created_by=created_by_id,
            description=description,
            model=model,
            course_name=course_name,
            course_level=course_level,
            course_duration=course_duration,
            agent_kind=agent_kind,
            conversation_starters=conversation_starters,
            additional_context=additional_context,
            session_uuid=session_uuid or None,
            manage_code=manage_code,
            department_id=department_id,
            course_code=course_code,
        )
        logger.info(f"[Background] ✓ Saved agent metadata to Cosmos DB for {agent_id}")
    except Exception as e:
        logger.error(f"[Background] Failed to save metadata to Cosmos DB: {e}")
    
    # Save setup.json
    try:
        setup_data = {
            "agentId": agent_id,
            "agentKind": agent_kind,
            "courseName": course_name,
            "courseLevel": course_level,
            "courseDuration": course_duration,
            "additionalContext": additional_context,
            "vectorStoreId": index_name if knowledge_attached else None,
            "indexName": index_name,
            "knowledgeUrls": course_urls or [],  # stored as [{url, description}] or [str]
            "courseCode": course_code or "",
            "prerequisites": prerequisites or [],
            "agentDescription": description,
            "conversationStarters": conversation_starters,
            "agentImageUrl": agent_image_url,
            "knowledgeAttached": knowledge_attached,
            "sessionUuid": session_uuid,
        }
        
        # Include textbooks if provided (avoids race condition with inline save)
        if textbooks:
            setup_data["textbooks"] = [{
                "name": tb.get("name", ""),
                "edition": tb.get("edition", ""),
                "authors": tb.get("authors", []),
                "type": tb.get("type", "primary"),
                "description": tb.get("description", ""),
            } for tb in textbooks]
        
        _save_setup_json(agent_id, setup_data)
        logger.info(f"[Background] ✓ Saved setup.json for {agent_id}")
        
    except Exception as e:
        logger.error(f"[Background] Failed to save setup.json: {e}")


# ---- Research Agent Configuration ----
# Three-step pipeline: reframed syllabus (CACA agent) → textbook research (o3 + web search) → threshold concepts (o3-pro)
TEXTBOOK_RESEARCH_AGENT_NAME = os.getenv(
    "TEXTBOOK_RESEARCH_AGENT_NAME", "textbook-research-agent"
)
THRESHOLD_CONCEPT_RESEARCH_AGENT_NAME = os.getenv(
    "THRESHOLD_CONCEPT_RESEARCH_AGENT_NAME", "threshold-concept-research-agent"
)


def _background_textbook_research(
    agent_id: str,
    agent_name: str,
    course_name: str,
    course_level: str,
    textbooks: List[Dict[str, Any]],
    additional_context: str = "",
):
    """
    BACKGROUND TASK: Three-step research pipeline.

    Step 0 — Direct model call (gpt-4.1):
        Generates a reframed syllabus from teacher's context (course description,
        attached file content, textbook names) with prerequisite mapping between modules.

    Step 1 — textbook-research-agent (o3 + web search):
        Researches textbooks via web search and enriches the reframed syllabus
        with textbook chapter references and additional subtopics.

    Step 2 — threshold-concept-research-agent (o3-pro):
        Receives the reframed syllabus and generates module-wise threshold concepts,
        misconceptions, and concept inventory questions using deep reasoning.
        Threshold concepts reference reframed syllabus modules (not textbook chapters).

    The outputs are merged into a single course_curriculum and saved to Cosmos DB.
    This runs asynchronously — does NOT block agent creation.
    """
    import time

    logger.info(
        f"[Textbook Research] Starting 2-agent pipeline for '{agent_id}' "
        f"with {len(textbooks)} textbooks"
    )
    start_time = time.time()

    # Build textbook descriptions
    textbook_descriptions = []
    for tb in textbooks:
        desc = f"- **{tb.get('name', 'Unknown')}** ({tb.get('edition', 'N/A')})"
        authors = tb.get('authors', [])
        if authors:
            desc += f" by {', '.join(authors)}"
        desc += f" [Type: {tb.get('type', 'primary')}]"
        tb_notes = tb.get('description', '').strip()
        if tb_notes:
            desc += f" — {tb_notes}"
        textbook_descriptions.append(desc)

    # Additional context from teacher
    context_section = ""
    if additional_context:
        context_section = f"\n\n**Additional Context from Teacher:**\n{additional_context}"

    def _extract_json(raw: str) -> dict:
        """Extract JSON from a response that may contain markdown fences."""
        text = raw
        if "```json" in raw:
            start = raw.find("```json") + len("```json")
            end = raw.find("```", start)
            if end > start:
                text = raw[start:end].strip()
        elif "```" in raw:
            start = raw.find("```") + len("```")
            end = raw.find("```", start)
            if end > start:
                text = raw[start:end].strip()
        # Strip trailing commas before ] or } (common LLM output issue)
        text = re.sub(r",\s*([\]\}])", r"\1", text)
        return json.loads(text)

    reframed_raw = ""
    syllabus_raw = ""
    tc_raw = ""
    setup_dir = _agent_setup_dir(agent_id)
    setup_dir.mkdir(parents=True, exist_ok=True)

    try:
        from azure.ai.projects import AIProjectClient
        import httpx

        # Retry client creation — Azure CLI credential can fail transiently
        # on Windows due to temp file locking when multiple processes run
        openai_client = None
        client = None
        for _auth_attempt in range(3):
            try:
                credential = get_sync_credential()
                client = AIProjectClient(
                    endpoint=PROJECT_ENDPOINT,
                    credential=credential,
                )
                # Use a high timeout for the OpenAI client — o3-pro deep reasoning
                # can take 10-20+ minutes, and the default httpx timeout
                # causes 408 server-side timeouts when the API gateway cuts off.
                openai_client = client.get_openai_client()
                openai_client = openai_client.with_options(
                    timeout=httpx.Timeout(1800.0, connect=60.0)  # 30 min read, 60s connect
                )
                # Force an early token fetch to catch credential errors now
                openai_client.conversations.create()
                break
            except Exception as auth_err:
                if _auth_attempt < 2:
                    wait = 5 * (_auth_attempt + 1)
                    logger.warning(
                        f"[Textbook Research] Auth attempt {_auth_attempt + 1} failed: {auth_err} — retrying in {wait}s"
                    )
                    time.sleep(wait)
                else:
                    raise

        # ==================================================================
        # Step 0: Generate Reframed Syllabus (CACA agent via conversations API)
        #   → Creates a pedagogical syllabus from teacher's context
        # ==================================================================
        logger.info(f"[Textbook Research] Step 0: Generating reframed syllabus via {COURSE_AGENT_CREATION_AGENT_ID}")

        caca_agent_ref = {
            "agent": {
                "name": COURSE_AGENT_CREATION_AGENT_ID,
                "type": "agent_reference",
            }
        }

        # Choose prompt style based on whether we have actual syllabus content
        # A short description (< 200 chars) is treated as a hint, not a full syllabus
        _ctx = (additional_context or "").strip()
        has_syllabus_content = bool(_ctx and len(_ctx) >= 200)

        if has_syllabus_content:
            reframed_intro = (
                f"Reformat the following input syllabus / course description for a "
                f"{course_level or 'university-level'} course on **{course_name}** "
                f"into a structured modular syllabus JSON.\n\n"
                f"**CRITICAL RULES:**\n"
                f"1. PRESERVE the EXACT terminology, topic names, and technical terms "
                f"from the input. Do NOT paraphrase, rename, or invent new terms.\n"
                f"2. If the input already contains textbook/chapter references, "
                f"include them in a `textbook_references` array for each module.\n"
                f"3. Only REORGANIZE the content into modules — do not add topics "
                f"that are not present in the input unless they are clearly implied "
                f"as foundational prerequisites.\n"
                f"4. The input may be in ANY format (table, bullet list, numbered list, "
                f"prose, PDF-extracted text, markdown). Parse whatever format you receive.\n\n"
            )
        else:
            reframed_intro = (
                f"Generate a comprehensive modular syllabus for a "
                f"{course_level or 'university-level'} course on **{course_name}**.\n\n"
                f"**CRITICAL: You MUST generate the syllabus directly. Do NOT ask for "
                f"more information, do NOT request a syllabus to reformat, do NOT say "
                f"you are missing input. Use your knowledge of {course_name} to create "
                f"the syllabus from scratch.**\n\n"
                f"**INSTRUCTIONS:**\n"
                f"1. Create a well-structured syllabus covering the essential topics "
                f"that would be taught in a standard {course_level or 'university-level'} "
                f"course on {course_name}.\n"
                f"2. Use standard academic terminology for the field.\n"
                f"3. Order modules in a logical teaching sequence (foundations first).\n"
                f"4. Include 8-20 modules depending on course scope.\n\n"
            )

        reframed_prompt = (
            reframed_intro
            + f"**Textbooks prescribed for this course:**\n"
            + "\n".join(textbook_descriptions)
            + context_section
            + "\n\n"
            f"Return ONLY a JSON object with this exact structure:\n"
            f'{{\n'
            f'  "course_name": "...",\n'
            f'  "course_level": "...",\n'
            f'  "total_chapters": <number>,\n'
            f'  "syllabus": [\n'
            f'    {{\n'
            f'      "title": "Module 1: <Topic Name>",\n'
            f'      "topics": ["topic1", "topic2", ...],\n'
            f'      "learning_objectives": ["objective1", "objective2", ...],\n'
            f'      "prerequisites": ["Module X: <Topic>", ...],\n'
            f'      "textbook_references": ["Book Title - Ch X", ...]  // include ONLY if the input mentions them, otherwise omit this field\n'
            f'    }}\n'
            f'  ]\n'
            f'}}\n\n'
            f"Requirements:\n"
            f"- Order modules in a logical teaching sequence (foundations first)\n"
            f"- prerequisites must reference exact module titles from this syllabus\n"
            f"- Use the EXACT topic names from the input syllabus, not paraphrased versions\n"
            f"- 8-20 modules depending on course scope\n\n"
            f"Return ONLY the JSON."
        )

        conv0 = openai_client.conversations.create()
        reframed_response = openai_client.responses.create(
            conversation=conv0.id,
            input=reframed_prompt,
            extra_body=caca_agent_ref,
        )
        reframed_raw = reframed_response.output_text or ""
        step0_time = time.time() - start_time
        logger.info(
            f"[Textbook Research] Step 0 done ({len(reframed_raw)} chars) in {step0_time:.1f}s"
        )

        # Validate JSON — retry once if CACA returned a non-JSON response
        # (e.g., asked for more info instead of generating)
        try:
            _test_parse = _extract_json(reframed_raw)
            if not isinstance(_test_parse, dict) or "syllabus" not in _test_parse:
                raise ValueError("Missing 'syllabus' key")
        except (json.JSONDecodeError, ValueError) as _parse_err:
            logger.warning(
                f"[Textbook Research] Step 0: CACA returned non-JSON response, "
                f"retrying with stronger prompt ({_parse_err})"
            )
            # Retry with an explicit "do not ask questions" instruction
            retry_prompt = (
                f"You MUST respond with ONLY a JSON object. No questions, no explanation.\n\n"
                f"Generate a comprehensive modular syllabus JSON for a "
                f"{course_level or 'university-level'} course on **{course_name}**.\n"
                f"Textbooks: {', '.join(tb.get('name', '') for tb in textbooks)}\n"
                + (f"Context: {additional_context}\n" if additional_context else "")
                + f"\nReturn ONLY valid JSON with keys: course_name, course_level, "
                f"total_chapters, syllabus (array of modules with title, topics, "
                f"learning_objectives, prerequisites).\n"
                f"Include 8-20 modules. Return ONLY the JSON, nothing else."
            )
            conv0_retry = openai_client.conversations.create()
            retry_response = openai_client.responses.create(
                conversation=conv0_retry.id,
                input=retry_prompt,
                extra_body=caca_agent_ref,
            )
            reframed_raw = retry_response.output_text or ""
            logger.info(
                f"[Textbook Research] Step 0 retry done ({len(reframed_raw)} chars)"
            )

        # Save raw for debugging
        with open(setup_dir / "reframed_syllabus_raw.txt", "w", encoding="utf-8") as f:
            f.write(reframed_raw)

        reframed_data = _extract_json(reframed_raw)

        # ── Deduplicate modules with same title ──
        # The CACA agent sometimes splits a module into multiple entries with the
        # same title but different topics. Merge them into a single module.
        # Strip "Module N:" or "N." or "N:" prefixes before comparing titles.
        import re as _dedup_re
        _module_num_re = _dedup_re.compile(r'^(?:module\s+)?\d+[\.\:\)\-]\s*', _dedup_re.IGNORECASE)
        def _normalize_module_title(title: str) -> str:
            """Strip numbering prefixes like 'Module 3:', '3.', '3:' for dedup comparison."""
            t = title.strip()
            t = _module_num_re.sub('', t)
            return t.strip().lower()

        raw_syllabus = reframed_data.get("syllabus", [])
        if raw_syllabus:
            merged_map: dict = {}  # normalized title → merged module dict
            merge_order: list = []  # preserve first-seen order
            for mod in raw_syllabus:
                title = (mod.get("title") or "").strip()
                key = _normalize_module_title(title)
                if not key:
                    key = title.lower()  # fallback if title is just a number
                if key in merged_map:
                    # Merge topics, objectives, prerequisites, textbook_references
                    existing = merged_map[key]
                    for field in ("topics", "learning_objectives", "prerequisites", "textbook_references"):
                        existing_list = existing.get(field, [])
                        new_items = mod.get(field, [])
                        # Add only items not already present (dedup by string value)
                        existing_set = set(str(x) for x in existing_list)
                        for item in new_items:
                            if str(item) not in existing_set:
                                existing_list.append(item)
                                existing_set.add(str(item))
                        existing[field] = existing_list
                else:
                    merged_map[key] = dict(mod)
                    merge_order.append(key)
            deduped_syllabus = [merged_map[k] for k in merge_order]
            if len(deduped_syllabus) < len(raw_syllabus):
                logger.info(
                    f"[Textbook Research] Step 0: Merged duplicate modules: "
                    f"{len(raw_syllabus)} → {len(deduped_syllabus)}"
                )
            reframed_data["syllabus"] = deduped_syllabus

        # Assign stable module_id and renumber titles after dedup
        for i, mod in enumerate(reframed_data.get("syllabus", [])):
            mod["module_id"] = f"mod_{i + 1}"
            # Renumber the title: strip old prefix and add clean "Module N:" prefix
            raw_title = (mod.get("title") or "").strip()
            clean_name = _module_num_re.sub('', raw_title).strip()
            if clean_name:
                mod["title"] = f"Module {i + 1}: {clean_name}"
        n_modules = len(reframed_data.get("syllabus", []))
        logger.info(f"[Textbook Research] Step 0: Parsed reframed syllabus with {n_modules} modules")

        reframed_json_str = json.dumps(reframed_data, indent=2, ensure_ascii=False)

        # Save partial curriculum (reframed syllabus) so it's available immediately
        from azure_services.persistence.cosmos_db import save_course_curriculum
        partial_curriculum = {
            "course_name": reframed_data.get("course_name", course_name),
            "course_level": reframed_data.get("course_level", course_level),
            "total_chapters": reframed_data.get("total_chapters", n_modules),
            "syllabus": reframed_data.get("syllabus", []),
            "all_threshold_concepts": [],
            "_status": "reframed_syllabus_ready",
        }
        if save_course_curriculum(agent_id, partial_curriculum):
            logger.info(f"[Textbook Research] ✓ Saved partial curriculum (reframed syllabus) for {agent_id}")
        else:
            logger.warning(f"[Textbook Research] ⚠ Could not save partial curriculum")

        # ==================================================================
        # Step 1: textbook-research-agent  (o3 + web search)
        #   → Researches textbooks against the reframed syllabus
        # ==================================================================
        textbook_agent_ref = {
            "agent": {
                "name": TEXTBOOK_RESEARCH_AGENT_NAME,
                "type": "agent_reference",
            }
        }

        syllabus_prompt_header = (
            f"You have a reframed course syllabus for a "
            f"{course_level or 'university-level'} course on **{course_name}**.\n\n"
        )
        textbooks_section = (
            f"\n**Textbooks:**\n" + "\n".join(textbook_descriptions) + "\n\n"
        )
        prompt_instructions = (
            f"For EACH module listed above, research the textbooks via web search "
            f"and find:\n"
            f"- Specific textbook chapters/sections that cover that module's topics\n"
            f"- Additional subtopics from textbook content that complement the module\n"
            f"- Any textbook-specific examples or case studies relevant to the module\n\n"
            f"Return ONLY a JSON array where each element has:\n"
            f"- `module_id`: the EXACT module_id from above (e.g. \"mod_1\")\n"
            f"- `textbook_references`: array of references per textbook\n\n"
            f"Example output format:\n"
            f"```json\n"
            f"[\n"
            f"  {{\n"
            f'    "module_id": "mod_1",\n'
            f'    "textbook_references": [\n'
            f"      {{\n"
            f'        "textbook": "Book Title (Author, Year)",\n'
            f'        "chapters_sections": ["Chapter X: ..."],\n'
            f'        "additional_subtopics": ["subtopic1", ...],\n'
            f'        "examples_case_studies": ["example1", ...]\n'
            f"      }}\n"
            f"    ]\n"
            f"  }}\n"
            f"]\n"
            f"```\n\n"
            f"Do NOT return topics, learning_objectives, prerequisites, or any other "
            f"fields — ONLY module_id and textbook_references for each module.\n\n"
            f"Return ONLY the JSON array."
        )

        # Split modules into batches to avoid 408 timeouts from long web searches.
        # Each batch gets its own conversation + retry loop, executed in parallel.
        all_modules = reframed_data.get("syllabus", [])
        if not all_modules:
            logger.error("[Textbook Research] Step 0 produced empty syllabus — skipping Steps 1 & 2")
            return
        BATCH_SIZE = len(all_modules)  # send all modules in a single batch
        module_batches = [
            all_modules[i : i + BATCH_SIZE]
            for i in range(0, len(all_modules), BATCH_SIZE)
        ]

        logger.info(
            f"[Textbook Research] Step 1 ({TEXTBOOK_RESEARCH_AGENT_NAME}): "
            f"Enriching reframed syllabus with textbook research — "
            f"{len(all_modules)} modules in {len(module_batches)} parallel batch(es)"
        )
        step1_start = time.time()

        STEP1_MAX_RETRIES = 3

        def _build_batch_prompt(batch_modules: list, label: str) -> str:
            """Build the prompt for a batch of modules."""
            prompt = syllabus_prompt_header
            prompt += f"**Modules ({label}):**\n"
            for mod in batch_modules:
                mid = mod.get('module_id', '')
                prompt += f"- [{mid}] {mod.get('title', '')}\n"
                topics = mod.get("topics", [])
                if topics:
                    prompt += f"  Topics: {', '.join(topics)}\n"
            prompt += textbooks_section + prompt_instructions
            return prompt

        def _run_batch(batch_modules: list, label: str) -> list:
            """Execute a single batch with retry. On failure, split into halves
            and retry each sub-batch independently. Returns parsed list of refs."""
            for attempt in range(1, STEP1_MAX_RETRIES + 1):
                try:
                    conv1 = openai_client.conversations.create()
                    # Use streaming to avoid Azure gateway 408 timeout
                    response_stream = openai_client.responses.create(
                        conversation=conv1.id,
                        input=_build_batch_prompt(batch_modules, label),
                        extra_body=textbook_agent_ref,
                        stream=True,
                    )
                    # Accumulate streamed text deltas
                    text_chunks = []
                    for event in response_stream:
                        # Abort promptly on shutdown instead of stalling exit.
                        raise_if_research_cancelled()
                        if hasattr(event, 'type') and event.type == 'response.output_text.delta':
                            delta = getattr(event, 'delta', '')
                            if delta:
                                text_chunks.append(delta)
                    batch_raw = ''.join(text_chunks)
                    logger.info(
                        f"[Textbook Research] Step 1 {label} "
                        f"done ({len(batch_raw)} chars, streamed)"
                    )
                    # Parse batch result
                    batch_parsed = _extract_json(batch_raw)
                    if isinstance(batch_parsed, dict):
                        return batch_parsed.get("modules", batch_parsed.get("syllabus", []))
                    elif isinstance(batch_parsed, list):
                        return batch_parsed
                    return []
                except Exception as retry_err:
                    err_code = getattr(retry_err, 'status_code', None)
                    if err_code == 408 and attempt < STEP1_MAX_RETRIES:
                        wait = 60 * attempt  # 60s, 120s
                        logger.warning(
                            f"[Textbook Research] Step 1 {label} "
                            f"attempt {attempt}/{STEP1_MAX_RETRIES} timed out (408), retrying in {wait}s..."
                        )
                        time.sleep(wait)
                    else:
                        # All retries exhausted — split into halves if possible
                        if len(batch_modules) > 1:
                            mid_point = len(batch_modules) // 2
                            left = batch_modules[:mid_point]
                            right = batch_modules[mid_point:]
                            logger.warning(
                                f"[Textbook Research] Step 1 {label} failed after {STEP1_MAX_RETRIES} attempts, "
                                f"splitting into 2 sub-batches ({len(left)} + {len(right)} modules)"
                            )
                            time.sleep(60)  # cooldown before sub-batches
                            results_left = _run_batch(left, f"{label}a")
                            results_right = _run_batch(right, f"{label}b")
                            return results_left + results_right
                        else:
                            raise  # single module, can't split further

        # Run all batches in parallel using the shared research thread pool.
        # Failed batches are retried until all succeed.

        batch_results_by_idx: dict[int, list] = {}
        pending_batches = {idx: batch for idx, batch in enumerate(module_batches, 1)}
        BATCH_ROUND_LIMIT = 3  # max rounds of retrying failed batches

        for round_num in range(1, BATCH_ROUND_LIMIT + 1):
            if not pending_batches:
                break

            round_label = f"round {round_num}/{BATCH_ROUND_LIMIT}" if round_num > 1 else "initial"
            logger.info(
                f"[Textbook Research] Step 1 {round_label}: "
                f"running {len(pending_batches)} batch(es) in parallel"
            )

            failed_this_round: dict[int, str] = {}
            executor = get_research_executor()
            futures = {
                executor.submit(
                    _run_batch, batch, f"batch {idx}/{len(module_batches)}"
                ): idx
                for idx, batch in pending_batches.items()
            }
            for future in as_completed(futures):
                batch_idx = futures[future]
                try:
                    result = future.result()
                    batch_results_by_idx[batch_idx] = result
                except CancelledError:
                    logger.info(
                        f"[Textbook Research] Step 1 batch {batch_idx} cancelled (shutdown)"
                    )
                    raise ResearchShutdown("server shutting down")
                except Exception as e:
                    logger.error(
                        f"[Textbook Research] Step 1 batch {batch_idx} failed ({round_label}): {e}"
                    )
                    failed_this_round[batch_idx] = str(e)

            # Only re-run the failed batches
            pending_batches = {
                idx: module_batches[idx - 1]
                for idx in failed_this_round
            }

            if pending_batches and round_num < BATCH_ROUND_LIMIT:
                wait = 60 * round_num
                logger.warning(
                    f"[Textbook Research] Step 1: {len(pending_batches)} batch(es) failed, "
                    f"retrying in {wait}s..."
                )
                time.sleep(wait)

        if pending_batches:
            failed_ids = sorted(pending_batches.keys())
            raise RuntimeError(
                f"Textbook research failed: batches {failed_ids} did not succeed "
                f"after {BATCH_ROUND_LIMIT} rounds"
            )

        # Reassemble in order
        all_batch_results: list = []
        for idx in sorted(batch_results_by_idx.keys()):
            all_batch_results.extend(batch_results_by_idx[idx])

        # Combine all batch raw outputs for debugging
        syllabus_raw = json.dumps(all_batch_results, indent=2, ensure_ascii=False)
        step1_time = time.time() - step1_start
        logger.info(
            f"[Textbook Research] Step 1 done ({len(all_batch_results)} module refs) "
            f"in {step1_time:.1f}s"
        )

        # Save combined results for debugging
        with open(setup_dir / "syllabus_research_raw.txt", "w", encoding="utf-8") as f:
            f.write(syllabus_raw)

        # all_batch_results is already the parsed list from batches
        tb_refs_list = all_batch_results

        # Build lookups: module_id → refs, and title → refs (fallback)
        tb_refs_by_id = {}
        tb_refs_by_title = {}
        for item in tb_refs_list:
            mid = (item.get("module_id") or "").strip()
            title = (item.get("title") or "").strip()
            refs = item.get("textbook_references", [])
            if mid:
                tb_refs_by_id[mid] = refs
            if title:
                tb_refs_by_title[title.lower()] = refs

        # Fuse: merge textbook_references into the reframed syllabus modules
        syllabus_data = dict(reframed_data)  # start from reframed syllabus
        fused_syllabus = []
        matched = 0
        for mod in reframed_data.get("syllabus", []):
            fused_mod = dict(mod)
            mid = mod.get("module_id", "")
            mod_title = (mod.get("title") or "").strip().lower()
            # Primary: match by module_id; Fallback: match by title
            if mid and mid in tb_refs_by_id:
                fused_mod["textbook_references"] = tb_refs_by_id[mid]
                matched += 1
            elif mod_title in tb_refs_by_title:
                fused_mod["textbook_references"] = tb_refs_by_title[mod_title]
                matched += 1
            fused_syllabus.append(fused_mod)
        syllabus_data["syllabus"] = fused_syllabus

        n_chapters = len(fused_syllabus)
        logger.info(
            f"[Textbook Research] Step 1: Fused textbook references into "
            f"{matched}/{n_chapters} modules"
        )

        # Update partial curriculum with enriched syllabus
        partial_curriculum = {
            "course_name": syllabus_data.get("course_name", course_name),
            "course_level": syllabus_data.get("course_level", course_level),
            "total_chapters": syllabus_data.get("total_chapters", n_chapters),
            "syllabus": syllabus_data.get("syllabus", []),
            "all_threshold_concepts": [],
            "_status": "syllabus_ready",
        }
        if save_course_curriculum(agent_id, partial_curriculum):
            logger.info(f"[Textbook Research] ✓ Saved enriched syllabus for {agent_id}")
        else:
            logger.warning(f"[Textbook Research] ⚠ Could not save enriched syllabus")

        # ==================================================================
        # Step 2: threshold-concept-research-agent  (gpt-5.4)
        #   → Generates module-wise threshold concepts from reframed syllabus
        #   → Batched like Step 1: try all modules at once, recursive split on failure
        #   → After all batches: fuse + deduplicate overlapping TCs
        # ==================================================================
        tc_agent_ref = {
            "agent": {
                "name": THRESHOLD_CONCEPT_RESEARCH_AGENT_NAME,
                "type": "agent_reference",
            }
        }

        # Pass the enriched syllabus (reframed structure + textbook references) to the TC agent
        syllabus_json_str = json.dumps(syllabus_data, indent=2, ensure_ascii=False)

        tc_all_modules = syllabus_data.get("syllabus", [])
        TC_BATCH_SIZE = 2  # modules per TC batch (reduced from 4 to avoid 408 gateway timeouts)
        tc_module_batches = [
            tc_all_modules[i : i + TC_BATCH_SIZE]
            for i in range(0, len(tc_all_modules), TC_BATCH_SIZE)
        ]

        logger.info(
            f"[Textbook Research] Step 2 ({THRESHOLD_CONCEPT_RESEARCH_AGENT_NAME}): "
            f"Generating module-wise threshold concepts — "
            f"{len(tc_all_modules)} modules in {len(tc_module_batches)} batch(es)"
        )
        step2_start = time.time()

        STEP2_MAX_RETRIES = 3

        # Build a lightweight module index (id → title) for cross-referencing
        _tc_module_index = [
            {"module_id": m.get("module_id", ""), "title": m.get("title", "")}
            for m in tc_all_modules
        ]
        _tc_module_index_str = json.dumps(_tc_module_index, indent=2, ensure_ascii=False)

        def _build_tc_batch_prompt(batch_modules: list, label: str) -> str:
            """Build the TC prompt scoped to a subset of modules."""
            batch_ids = [m.get("module_id", "") for m in batch_modules]
            batch_json = json.dumps(batch_modules, indent=2, ensure_ascii=False)
            return (
                f"You are generating threshold concepts for a "
                f"{course_level or 'university-level'} course on **{course_name}**.\n\n"
                f"The full course has these modules (for cross-referencing `related_modules`):\n"
                f"```json\n{_tc_module_index_str}\n```\n\n"
                f"**YOUR TASK ({label}):** Generate threshold concepts ONLY for these modules: "
                f"{', '.join(batch_ids)}\n\n"
                f"Full details for your batch:\n```json\n{batch_json}\n```\n\n"
                f"For each threshold concept:\n"
                f"- Include a `related_modules` array with `module_id` values "
                f"(may reference ANY module in the course, not just your batch).\n"
                f"- Do NOT use textbook chapter names or module titles in `related_modules`.\n\n"
                f"Return ONLY the threshold concepts JSON."
            )

        def _run_tc_batch(batch_modules: list, label: str) -> dict:
            """Execute a TC batch with retry + recursive split. Returns parsed TC dict."""
            for attempt in range(1, STEP2_MAX_RETRIES + 1):
                try:
                    conv2 = openai_client.conversations.create()
                    prompt_text = _build_tc_batch_prompt(batch_modules, label)
                    batch_ids = [m.get("module_id", "") for m in batch_modules]
                    logger.info(
                        f"[Textbook Research] Step 2 {label} attempt {attempt}: "
                        f"sending prompt ({len(prompt_text)} chars) for modules {batch_ids}"
                    )

                    # Use streaming to avoid Azure gateway 408 timeout
                    response_stream = openai_client.responses.create(
                        conversation=conv2.id,
                        input=prompt_text,
                        extra_body=tc_agent_ref,
                        stream=True,
                    )
                    # Accumulate streamed text deltas
                    text_chunks = []
                    for event in response_stream:
                        # Abort promptly on shutdown instead of stalling exit.
                        raise_if_research_cancelled()
                        if hasattr(event, 'type') and event.type == 'response.output_text.delta':
                            delta = getattr(event, 'delta', '')
                            if delta:
                                text_chunks.append(delta)
                    raw = ''.join(text_chunks)
                    logger.info(
                        f"[Textbook Research] Step 2 {label} done ({len(raw)} chars, streamed)"
                    )

                    parsed = _extract_json(raw)
                    return parsed
                except Exception as retry_err:
                    err_code = getattr(retry_err, 'status_code', None)
                    if (err_code in (408, 429)) and attempt < STEP2_MAX_RETRIES:
                        wait = 60 * attempt
                        logger.warning(
                            f"[Textbook Research] Step 2 {label} "
                            f"attempt {attempt}/{STEP2_MAX_RETRIES} failed ({err_code}), "
                            f"retrying in {wait}s..."
                        )
                        time.sleep(wait)
                    else:
                        # All retries exhausted — split into halves if possible
                        if len(batch_modules) > 1:
                            mid_point = len(batch_modules) // 2
                            left = batch_modules[:mid_point]
                            right = batch_modules[mid_point:]
                            logger.warning(
                                f"[Textbook Research] Step 2 {label} failed after "
                                f"{STEP2_MAX_RETRIES} attempts, splitting into "
                                f"2 sub-batches ({len(left)} + {len(right)} modules)"
                            )
                            time.sleep(60)
                            result_left = _run_tc_batch(left, f"{label}a")
                            result_right = _run_tc_batch(right, f"{label}b")
                            # Merge two TC dicts
                            return _merge_tc_dicts(result_left, result_right)
                        else:
                            raise

        def _merge_tc_dicts(a: dict, b: dict) -> dict:
            """Merge two TC result dicts, combining all_threshold_concepts lists
            and copying detail objects."""
            merged = {}
            names_a = set(a.get("all_threshold_concepts", []))
            names_b = set(b.get("all_threshold_concepts", []))
            all_names = list(a.get("all_threshold_concepts", [])) + [
                n for n in b.get("all_threshold_concepts", []) if n not in names_a
            ]
            merged["all_threshold_concepts"] = all_names
            for name in all_names:
                if name in a and isinstance(a[name], dict):
                    merged[name] = a[name]
                if name in b and isinstance(b[name], dict):
                    if name in merged and isinstance(merged[name], dict):
                        # Union related_modules
                        existing_mods = set(merged[name].get("related_modules", []))
                        new_mods = b[name].get("related_modules", [])
                        merged[name]["related_modules"] = list(
                            existing_mods | set(new_mods)
                        )
                    else:
                        merged[name] = b[name]
            return merged

        # Run TC batches sequentially — gpt-5.4 deep reasoning hits Azure
        # gateway ~10 min timeout when multiple batches compete for compute
        tc_batch_results: list[dict] = []
        pending_tc_batches = {
            idx: batch for idx, batch in enumerate(tc_module_batches, 1)
        }
        TC_BATCH_ROUND_LIMIT = 3

        def _save_partial_tc_progress(partial_results: list[dict]):
            """Save intermediate TC results so frontend can display partial progress."""
            try:
                partial_tc: dict = {"all_threshold_concepts": []}
                for batch_tc in partial_results:
                    partial_tc = _merge_tc_dicts(partial_tc, batch_tc)
                partial_curriculum = {
                    "course_name": syllabus_data.get("course_name", course_name),
                    "course_level": syllabus_data.get("course_level", course_level),
                    "total_chapters": syllabus_data.get("total_chapters", n_chapters),
                    "syllabus": syllabus_data.get("syllabus", []),
                    "all_threshold_concepts": partial_tc.get("all_threshold_concepts", []),
                    "_status": "syllabus_ready",  # Keep as processing indicator
                }
                for tc_name in partial_tc.get("all_threshold_concepts", []):
                    if tc_name in partial_tc:
                        partial_curriculum[tc_name] = partial_tc[tc_name]
                save_course_curriculum(agent_id, partial_curriculum)
                logger.info(
                    f"[Textbook Research] Saved partial TC progress: "
                    f"{len(partial_tc.get('all_threshold_concepts', []))} concepts so far"
                )
            except Exception as save_err:
                logger.warning(f"[Textbook Research] Failed to save partial TC progress: {save_err}")

        for round_num in range(1, TC_BATCH_ROUND_LIMIT + 1):
            if not pending_tc_batches:
                break

            round_label = (
                f"round {round_num}/{TC_BATCH_ROUND_LIMIT}"
                if round_num > 1 else "initial"
            )
            logger.info(
                f"[Textbook Research] Step 2 {round_label}: "
                f"running {len(pending_tc_batches)} batch(es) in parallel"
            )

            failed_tc: dict[int, str] = {}
            executor = get_research_executor()
            tc_futures = {
                executor.submit(
                    _run_tc_batch, batch,
                    f"batch {idx}/{len(tc_module_batches)}"
                ): idx
                for idx, batch in pending_tc_batches.items()
            }
            tc_results_by_idx: dict[int, dict] = {}
            for future in as_completed(tc_futures):
                batch_idx = tc_futures[future]
                try:
                    result = future.result()
                    tc_results_by_idx[batch_idx] = result
                except CancelledError:
                    logger.info(
                        f"[Textbook Research] Step 2 batch {batch_idx} cancelled (shutdown)"
                    )
                    raise ResearchShutdown("server shutting down")
                except Exception as e:
                    logger.error(
                        f"[Textbook Research] Step 2 batch {batch_idx} "
                        f"failed ({round_label}): {e}"
                    )
                    failed_tc[batch_idx] = str(e)

            tc_batch_results.extend(
                tc_results_by_idx[idx]
                for idx in sorted(tc_results_by_idx.keys())
            )
            # Save partial progress so frontend can show TCs generated so far
            if tc_batch_results:
                _save_partial_tc_progress(tc_batch_results)
            pending_tc_batches = {
                idx: tc_module_batches[idx - 1]
                for idx in failed_tc
            }
            if pending_tc_batches and round_num < TC_BATCH_ROUND_LIMIT:
                wait = 60 * round_num
                logger.warning(
                    f"[Textbook Research] Step 2: {len(pending_tc_batches)} batch(es) "
                    f"failed, retrying in {wait}s..."
                )
                time.sleep(wait)

        if pending_tc_batches:
            failed_ids = sorted(pending_tc_batches.keys())
            raise RuntimeError(
                f"Threshold concept research failed: batches {failed_ids} "
                f"did not succeed after {TC_BATCH_ROUND_LIMIT} rounds"
            )

        # ------------------------------------------------------------------
        # Fuse all TC batch results into a single tc_data, deduplicating
        # threshold concepts that appear in multiple batches.
        # ------------------------------------------------------------------
        tc_data: dict = {"all_threshold_concepts": []}
        for batch_tc in tc_batch_results:
            tc_data = _merge_tc_dicts(tc_data, batch_tc)

        # Deduplicate: normalize TC names, merge entries with same lowercase name
        seen_lower: dict[str, str] = {}  # lowercase → canonical name
        deduped_names: list[str] = []
        for tc_name in tc_data.get("all_threshold_concepts", []):
            key = tc_name.strip().lower()
            if key in seen_lower:
                # Merge into existing entry
                canonical = seen_lower[key]
                existing = tc_data.get(canonical)
                duplicate = tc_data.get(tc_name)
                if existing and duplicate and isinstance(existing, dict) and isinstance(duplicate, dict):
                    existing_mods = set(existing.get("related_modules", []))
                    dup_mods = set(duplicate.get("related_modules", []))
                    existing["related_modules"] = list(existing_mods | dup_mods)
                    # Keep richer misconceptions / concept_inventory lists
                    for list_key in ("misconceptions", "concept_inventory_questions"):
                        existing_items = existing.get(list_key, [])
                        dup_items = duplicate.get(list_key, [])
                        existing_set = {
                            (item if isinstance(item, str) else json.dumps(item, sort_keys=True))
                            for item in existing_items
                        }
                        for item in dup_items:
                            item_key = item if isinstance(item, str) else json.dumps(item, sort_keys=True)
                            if item_key not in existing_set:
                                existing_items.append(item)
                                existing_set.add(item_key)
                        existing[list_key] = existing_items
                # Remove the duplicate key from tc_data
                if tc_name in tc_data and tc_name != canonical:
                    del tc_data[tc_name]
            else:
                seen_lower[key] = tc_name
                deduped_names.append(tc_name)

        tc_data["all_threshold_concepts"] = deduped_names

        # ------------------------------------------------------------------
        # Semantic dedup: ask the TC research agent to consolidate
        # threshold concepts that overlap semantically but have different names.
        # ------------------------------------------------------------------
        if len(deduped_names) > 1:
            logger.info(
                f"[Textbook Research] Step 2 semantic dedup: sending {len(deduped_names)} "
                f"TC names to {THRESHOLD_CONCEPT_RESEARCH_AGENT_NAME} for consolidation"
            )
            _dedup_prompt = (
                f"You are a threshold-concept expert for a {course_level or 'university-level'} "
                f"course on **{course_name}**.\n\n"
                f"Below is a numbered list of {len(deduped_names)} candidate threshold concept names "
                f"generated from different module batches. This is TOO MANY — the final course "
                f"should have **8–15 threshold concepts total**.\n\n"
                + "\n".join(f"{i+1}. {n}" for i, n in enumerate(deduped_names))
                + "\n\n"
                f"**YOUR TASK — Consolidate & Prune to reach 8–15 final threshold concepts:**\n\n"
                f"**Step 1 — PRUNE:** Remove items that are NOT true threshold concepts. Discard anything that is:\n"
                f"  - A supporting/background concept (important but not a transformative gateway)\n"
                f"  - An implementation detail or case study (e.g., 'Linux CFS scheduler')\n"
                f"  - A topic or skill rather than a conceptual threshold crossing\n"
                f"A true threshold concept must be: Transformative, Irreversible, Integrative, Troublesome, and Bounded.\n\n"
                f"**Step 2 — MERGE:** Group remaining concepts that should be combined into one broader TC because:\n"
                f"  (a) They are semantically the same or near-identical (different wording, same insight), OR\n"
                f"  (b) One concept is a SUBSET of another — understanding the broader concept means the narrower one is already grasped, OR\n"
                f"  (c) They describe the same threshold crossing at different levels of specificity, OR\n"
                f"  (d) They are closely related facets of a single transformative insight (e.g., merge 'spin locks', 'semaphores', 'mutexes' into a single TC about synchronization primitives and mutual exclusion).\n\n"
                f"For each group, pick the BEST canonical name (the most comprehensive one that captures the threshold crossing).\n\n"
                f"Return ONLY a JSON object with this schema:\n"
                f'{{"groups": [\n'
                f'  {{"canonical": "<best name>", "members": ["<name1>", "<name2>", ...]}},\n'
                f"  ...\n"
                f"]}},\n"
                f'"pruned": ["<removed concept 1>", "<removed concept 2>", ...]\n'
                f"}}\n\n"
                f"Rules:\n"
                f"- The FINAL result (groups only, excluding pruned) MUST have between 8 and 15 threshold concepts.\n"
                f"- Every concept from the list above MUST appear in exactly one group OR in the pruned list.\n"
                f"- Be aggressive: merge related concepts into broader, richer threshold concepts.\n"
                f"- Prune ruthlessly: if it's not a genuine transformative gateway that changes how students think, remove it.\n"
                f"- Do NOT merge concepts that cross genuinely DIFFERENT thresholds just to reduce count.\n"
                f"- Return valid JSON only, no markdown fences."
            )

            try:
                dedup_conv = openai_client.conversations.create()
                dedup_stream = openai_client.responses.create(
                    conversation=dedup_conv.id,
                    input=_dedup_prompt,
                    extra_body=tc_agent_ref,
                    stream=True,
                )
                dedup_chunks = []
                for event in dedup_stream:
                    if hasattr(event, 'type') and event.type == 'response.output_text.delta':
                        delta = getattr(event, 'delta', '')
                        if delta:
                            dedup_chunks.append(delta)
                dedup_raw = ''.join(dedup_chunks)

                dedup_parsed = _extract_json(dedup_raw)
                groups = []
                pruned_names: list[str] = []
                if isinstance(dedup_parsed, dict):
                    groups = dedup_parsed.get("groups", [])
                    pruned_names = dedup_parsed.get("pruned", [])
                elif isinstance(dedup_parsed, list):
                    groups = dedup_parsed

                # Remove pruned (non-threshold) concepts from tc_data
                if pruned_names:
                    for pname in pruned_names:
                        if pname in tc_data and isinstance(tc_data[pname], dict):
                            del tc_data[pname]
                    logger.info(
                        f"[Textbook Research] Semantic dedup: pruned {len(pruned_names)} "
                        f"non-threshold concepts: {pruned_names}"
                    )

                if groups:
                    merged_count = 0
                    new_names: list[str] = []
                    for group in groups:
                        if not isinstance(group, dict):
                            continue
                        canonical = group.get("canonical", "")
                        members = group.get("members", [])
                        if not canonical or not members:
                            continue

                        # Find existing detail for canonical (may be a member or new name)
                        base_detail = None
                        for m in members:
                            if m in tc_data and isinstance(tc_data[m], dict):
                                if base_detail is None:
                                    base_detail = tc_data[m]
                                else:
                                    # Merge this member into base_detail
                                    dup = tc_data[m]
                                    base_mods = set(base_detail.get("related_modules", []))
                                    dup_mods = set(dup.get("related_modules", []))
                                    base_detail["related_modules"] = list(base_mods | dup_mods)
                                    for lk in ("misconceptions", "concept_inventory_questions"):
                                        base_items = base_detail.get(lk, [])
                                        dup_items = dup.get(lk, [])
                                        base_set = {
                                            (it if isinstance(it, str) else json.dumps(it, sort_keys=True))
                                            for it in base_items
                                        }
                                        for it in dup_items:
                                            ik = it if isinstance(it, str) else json.dumps(it, sort_keys=True)
                                            if ik not in base_set:
                                                base_items.append(it)
                                                base_set.add(ik)
                                        base_detail[lk] = base_items

                        if base_detail is None:
                            # No detail found at all — keep first member's name
                            canonical = members[0] if members else canonical

                        # Remove all member keys, store under canonical
                        for m in members:
                            if m in tc_data and m != canonical:
                                del tc_data[m]
                        if base_detail:
                            tc_data[canonical] = base_detail
                        new_names.append(canonical)

                        if len(members) > 1:
                            merged_count += len(members) - 1
                            logger.info(
                                f"[Textbook Research] Semantic dedup: merged "
                                f"{members} → '{canonical}'"
                            )

                    tc_data["all_threshold_concepts"] = new_names
                    deduped_names = new_names
                    logger.info(
                        f"[Textbook Research] Semantic dedup complete: "
                        f"{len(new_names)} concepts remain ({merged_count} merged)"
                    )
                else:
                    logger.warning(
                        "[Textbook Research] Semantic dedup: no groups returned, "
                        "keeping name-based dedup results"
                    )
            except Exception as dedup_err:
                logger.warning(
                    f"[Textbook Research] Semantic dedup failed ({dedup_err}), "
                    f"keeping name-based dedup results"
                )

        # Save all raw batch outputs for debugging
        tc_raw = json.dumps(tc_data, indent=2, ensure_ascii=False)
        step2_time = time.time() - step2_start
        n_concepts = len(deduped_names)
        logger.info(
            f"[Textbook Research] Step 2 done — {n_concepts} unique threshold concepts "
            f"(after dedup) in {step2_time:.1f}s"
        )

        with open(setup_dir / "threshold_concepts_research_raw.txt", "w", encoding="utf-8") as f:
            f.write(tc_raw)

        # -----------------------------------------------------------
        # Normalize TC → module links using module_id.
        # The TC agent should return related_modules with module_id values,
        # but may also return related_chapters with titles. We ensure both
        # fields are populated for backward compatibility.
        # -----------------------------------------------------------
        id_to_title = {}
        title_to_id = {}
        for mod in syllabus_data.get("syllabus", []):
            mid = mod.get("module_id", "")
            mtitle = (mod.get("title") or "").strip()
            if mid:
                id_to_title[mid] = mtitle
            if mtitle:
                title_to_id[mtitle.lower()] = mid

        for tc_name in tc_data.get("all_threshold_concepts", []):
            tc_detail = tc_data.get(tc_name)
            if not tc_detail or not isinstance(tc_detail, dict):
                continue

            related_mods = tc_detail.get("related_modules", [])
            related_chaps = tc_detail.get("related_chapters", [])

            if related_mods:
                tc_detail["related_modules"] = [
                    m for m in related_mods if m in id_to_title
                ]
                tc_detail["related_chapters"] = [
                    id_to_title[m] for m in tc_detail["related_modules"]
                ]
            elif related_chaps:
                resolved_ids = []
                for ch in related_chaps:
                    ch_lower = ch.strip().lower()
                    if ch_lower in title_to_id:
                        resolved_ids.append(title_to_id[ch_lower])
                    else:
                        for t, mid in title_to_id.items():
                            if ch_lower in t or t in ch_lower:
                                resolved_ids.append(mid)
                                break
                tc_detail["related_modules"] = resolved_ids
                tc_detail["related_chapters"] = [
                    id_to_title[mid] for mid in resolved_ids if mid in id_to_title
                ]

        logger.info(
            f"[Textbook Research] Normalized TC module links for {n_concepts} concepts"
        )

        client.close()

        # ==================================================================
        # Merge both outputs into a single course_curriculum
        # ==================================================================
        course_curriculum = {
            "course_name": syllabus_data.get("course_name", course_name),
            "course_level": syllabus_data.get("course_level", course_level),
            "total_chapters": syllabus_data.get("total_chapters", n_chapters),
            "syllabus": syllabus_data.get("syllabus", []),
            "all_threshold_concepts": tc_data.get("all_threshold_concepts", []),
        }
        # Copy each threshold concept's detail object into the top-level plan
        for tc_name in course_curriculum["all_threshold_concepts"]:
            if tc_name in tc_data:
                course_curriculum[tc_name] = tc_data[tc_name]

        # Save full course curriculum to Cosmos DB (overwrites the partial syllabus-only plan)
        if save_course_curriculum(agent_id, course_curriculum):
            logger.info(f"[Textbook Research] ✓ Saved course curriculum to Cosmos DB for {agent_id}")
            # Save initial version for history tracking
            try:
                from azure_services.persistence.cosmos_db import save_course_curriculum_version
                save_course_curriculum_version(agent_id, course_curriculum, "Initial generation", "system")
            except Exception as ve:
                logger.warning(f"[Textbook Research] Could not save initial version: {ve}")
        else:
            logger.warning(
                f"[Textbook Research] ⚠ Failed to save course curriculum to Cosmos DB "
                f"— falling back to local file"
            )
            plan_path = setup_dir / "course_curriculum.json"
            with open(plan_path, "w", encoding="utf-8") as f:
                json.dump(course_curriculum, f, indent=2, ensure_ascii=False)
            logger.info(f"[Textbook Research] ✓ Saved course_curriculum.json locally for {agent_id}")

        elapsed = time.time() - start_time
        logger.info(
            f"[Textbook Research] ✅ Complete for '{agent_id}' in {elapsed:.1f}s — "
            f"{n_modules} modules, {n_concepts} threshold concepts "
            f"(Step 0: {step0_time:.1f}s, Step 1: {step1_time:.1f}s, Step 2: {step2_time:.1f}s)"
        )

    except json.JSONDecodeError as e:
        logger.error(f"[Textbook Research] Failed to parse JSON: {e}")
        # Save whatever raw responses we have for debugging
        try:
            with open(setup_dir / "textbook_research_raw.txt", "w", encoding="utf-8") as f:
                f.write(f"=== REFRAMED RAW ===\n{reframed_raw}\n\n=== SYLLABUS RAW ===\n{syllabus_raw}\n\n=== TC RAW ===\n{tc_raw}")
        except Exception:
            pass
        logger.info(f"[Textbook Research] Saved raw responses for debugging")
    except Exception as e:
        logger.error(f"[Textbook Research] Failed: {e}", exc_info=True)
        # If we have a reframed syllabus, ensure at least the partial curriculum is saved
        try:
            if reframed_raw:
                _partial = _extract_json(reframed_raw)
                if isinstance(_partial, dict) and _partial.get("syllabus"):
                    from azure_services.persistence.cosmos_db import save_course_curriculum
                    partial_save = {
                        "course_name": _partial.get("course_name", course_name),
                        "course_level": _partial.get("course_level", course_level),
                        "total_chapters": _partial.get("total_chapters", 0),
                        "syllabus": _partial.get("syllabus", []),
                        "all_threshold_concepts": [],
                        "_status": "syllabus_ready",
                        "_error": str(e),
                    }
                    save_course_curriculum(agent_id, partial_save)
                    logger.info(
                        f"[Textbook Research] Saved partial curriculum (syllabus only) "
                        f"after Step 2 failure for {agent_id}"
                    )
        except Exception:
            pass


def _background_threshold_concept_research(
    agent_id: str,
    course_name: str,
    course_level: str,
):
    """
    BACKGROUND TASK: Run ONLY Step 2 (threshold-concept-research-agent).

    Uses the previously saved reframed syllabus (or enriched syllabus) and generates
    threshold concepts, misconceptions, and concept inventory questions.
    Threshold concepts reference reframed syllabus module titles.
    """
    import time

    setup_dir = _agent_setup_dir(agent_id)
    # Prefer reframed syllabus (Step 0 output), fall back to enriched syllabus (Step 1 output)
    reframed_file = setup_dir / "reframed_syllabus_raw.txt"
    syllabus_file = setup_dir / "syllabus_research_raw.txt"
    source_file = reframed_file if reframed_file.exists() else syllabus_file

    if not source_file.exists():
        logger.error(
            f"[Threshold Concept Research] No syllabus found for '{agent_id}'. "
            f"Run full textbook research first."
        )
        return

    logger.info(f"[Threshold Concept Research] Starting for '{agent_id}'")
    start_time = time.time()

    def _extract_json(raw: str) -> dict:
        text = raw
        if "```json" in raw:
            start = raw.find("```json") + len("```json")
            end = raw.find("```", start)
            if end > start:
                text = raw[start:end].strip()
        elif "```" in raw:
            start = raw.find("```") + len("```")
            end = raw.find("```", start)
            if end > start:
                text = raw[start:end].strip()
        # Strip trailing commas before ] or } (common LLM output issue)
        text = re.sub(r",\s*([\]\}])", r"\1", text)
        return json.loads(text)

    tc_raw = ""

    try:
        with open(source_file, "r", encoding="utf-8") as f:
            syllabus_raw = f.read()

        syllabus_data = _extract_json(syllabus_raw)
        n_chapters = len(syllabus_data.get("syllabus", []))
        logger.info(
            f"[Threshold Concept Research] Loaded syllabus with {n_chapters} modules from {source_file.name}"
        )

        from azure.ai.projects import AIProjectClient
        import httpx

        # ── Retry client creation to handle Azure CLI credential race condition ──
        openai_client = None
        client = None
        for _auth_attempt in range(3):
            try:
                credential = get_sync_credential()
                client = AIProjectClient(
                    endpoint=PROJECT_ENDPOINT,
                    credential=credential,
                )
                openai_client = client.get_openai_client()
                openai_client = openai_client.with_options(
                    timeout=httpx.Timeout(1800.0, connect=60.0)  # 30 min read, 60s connect
                )
                # Force an early token fetch so file-lock errors surface now
                openai_client.conversations.create()
                break
            except Exception as auth_err:
                if _auth_attempt < 2:
                    wait = 5 * (_auth_attempt + 1)
                    logger.warning(
                        f"[Threshold Concept Research] Auth attempt {_auth_attempt + 1} "
                        f"failed for '{agent_id}': {auth_err} — retrying in {wait}s"
                    )
                    time.sleep(wait)
                else:
                    raise

        tc_agent_ref = {
            "agent": {
                "name": THRESHOLD_CONCEPT_RESEARCH_AGENT_NAME,
                "type": "agent_reference",
            }
        }

        syllabus_json_str = json.dumps(syllabus_data, indent=2, ensure_ascii=False)
        tc_prompt = (
            f"Here is the complete module-by-module reframed syllabus for a "
            f"{course_level or 'university-level'} course on **{course_name}**:\n\n"
            f"```json\n{syllabus_json_str}\n```\n\n"
            f"Analyze every module and generate threshold concepts with "
            f"misconceptions and concept inventory questions.\n\n"
            f"**CRITICAL: Generate exactly 8–15 threshold concepts for the ENTIRE course.**\n"
            f"Only include genuine threshold concepts that are transformative, irreversible, "
            f"integrative, troublesome, and bounded. Do NOT include supporting concepts, "
            f"implementation details, or case studies.\n\n"
            f"IMPORTANT: Use `module_id` values (e.g. \"mod_1\", \"mod_2\") in the "
            f"`related_modules` field of each threshold concept. Do NOT use textbook chapter names "
            f"or module titles.\n\n"
            f"Return ONLY the threshold concepts JSON."
        )

        logger.info(
            f"[Threshold Concept Research] Running {THRESHOLD_CONCEPT_RESEARCH_AGENT_NAME}"
        )

        # Retry with backoff — o3-pro deep reasoning can hit 408 timeouts
        MAX_RETRIES = 3
        tc_response = None
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                conv = openai_client.conversations.create()
                tc_response = openai_client.responses.create(
                    conversation=conv.id,
                    input=tc_prompt,
                    extra_body=tc_agent_ref,
                )
                break  # success
            except Exception as retry_err:
                err_code = getattr(retry_err, 'status_code', None)
                if err_code == 408 and attempt < MAX_RETRIES:
                    wait = 60 * attempt  # 60s, 120s
                    logger.warning(
                        f"[Threshold Concept Research] Attempt {attempt}/{MAX_RETRIES} "
                        f"timed out (408), retrying in {wait}s..."
                    )
                    time.sleep(wait)
                else:
                    raise

        tc_raw = (tc_response.output_text or "") if tc_response else ""
        elapsed_tc = time.time() - start_time
        logger.info(
            f"[Threshold Concept Research] Done ({len(tc_raw)} chars) in {elapsed_tc:.1f}s"
        )

        with open(setup_dir / "threshold_concepts_research_raw.txt", "w", encoding="utf-8") as f:
            f.write(tc_raw)

        tc_data = _extract_json(tc_raw)
        n_concepts = len(tc_data.get("all_threshold_concepts", []))
        logger.info(
            f"[Threshold Concept Research] Parsed {n_concepts} threshold concepts"
        )

        client.close()

        # Merge into course_curriculum
        course_curriculum = {
            "course_name": syllabus_data.get("course_name", course_name),
            "course_level": syllabus_data.get("course_level", course_level),
            "total_chapters": syllabus_data.get("total_chapters", n_chapters),
            "syllabus": syllabus_data.get("syllabus", []),
            "all_threshold_concepts": tc_data.get("all_threshold_concepts", []),
        }
        for tc_name in course_curriculum["all_threshold_concepts"]:
            if tc_name in tc_data:
                course_curriculum[tc_name] = tc_data[tc_name]

        from azure_services.persistence.cosmos_db import save_course_curriculum
        if save_course_curriculum(agent_id, course_curriculum):
            logger.info(f"[Threshold Concept Research] ✓ Saved course curriculum to Cosmos DB for {agent_id}")
        else:
            plan_path = setup_dir / "course_curriculum.json"
            with open(plan_path, "w", encoding="utf-8") as f:
                json.dump(course_curriculum, f, indent=2, ensure_ascii=False)
            logger.info(f"[Threshold Concept Research] ✓ Saved course_curriculum.json locally for {agent_id}")

        elapsed = time.time() - start_time
        logger.info(
            f"[Threshold Concept Research] ✅ Complete for '{agent_id}' in {elapsed:.1f}s — "
            f"{n_concepts} threshold concepts"
        )

    except json.JSONDecodeError as e:
        logger.error(f"[Threshold Concept Research] Failed to parse JSON: {e}")
        try:
            with open(setup_dir / "threshold_concepts_research_raw.txt", "w", encoding="utf-8") as f:
                f.write(tc_raw)
        except Exception:
            pass
    except Exception as e:
        logger.error(f"[Threshold Concept Research] Failed: {e}", exc_info=True)


async def _path2_create_agent(
    agent_kind: str,
    name: str,
    user_description: str,
    course_name: str,
    course_level: str,
    course_duration: str,
    additional_context: str,
    model: str,
    created_by_id: str,
    custom_search_instance_name: Optional[str] = None,
    course_urls: Optional[List[str]] = None,
    search_index_name: Optional[str] = None,
    search_index_filter: Optional[str] = None,
    search_connection_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Path 2: Create the agent in Azure AI Foundry
    
    Flow: course details -> CACA meta-agent -> prompt unification -> create agent -> attach tools
    
    Args:
        custom_search_instance_name: Bing Custom Search configuration instance name.
                                     Teachers create this in Azure Portal with allowed domains.
        course_urls: Teacher-curated URLs for focused web search.
                     These are included in the agent's instructions to prioritize searches.
        search_index_name: Common index name for AzureAISearchTool.
        search_index_filter: OData filter for session isolation.
        search_connection_id: Project connection ID for Azure AI Search.
    
    Returns agent creation result with agent_id, name, description, conversation_starters.
    """
    # Validate model
    if model not in ALLOWED_DEPLOYMENTS:
        raise ValueError(f"Model '{model}' not allowed. Allowed: {sorted(ALLOWED_DEPLOYMENTS)}")
    
    if not name:
        raise ValueError("Agent name is required")
    
    logger.info(f"[Path 2] Calling course-agent-creation-agent meta-agent for {agent_kind} agent...")
    
    # Initialize defaults
    generated_description = user_description or f"AI assistant for {course_name}"
    conversation_starters: List[str] = []
    learning_prompt_from_meta = ""
    
    # Call CACA meta-agent to generate course specification
    generated_description, course_prompt_from_meta, conversation_starters = await call_meta_agent_for_prompt(
        course_name=course_name,
        course_level=course_level,
        course_duration=course_duration,
        course_description=additional_context,
        prerequisites="",
    )
    logger.info(f"[Path 2] Meta-agent generated: prompt={len(course_prompt_from_meta)} chars, desc={len(generated_description)} chars, starters={len(conversation_starters)}")
    
    # Build additional context with teacher-curated URLs if provided
    enhanced_context = additional_context or ""
    if course_urls:
        urls_section = "\n\n## Teacher-Curated Web Resources (STRICT)\n"
        urls_section += "The teacher has provided the following URLs as the ONLY approved external web sources:\n"
        for url in course_urls:
            urls_section += f"- {url}\n"
        urls_section += "\n**IMPORTANT URL RESTRICTIONS:**\n"
        urls_section += "1. When using web search, ONLY use content from these exact URLs or their direct sub-pages.\n"
        urls_section += "2. Do NOT use or cite information from any other websites.\n"
        urls_section += "3. If asked about topics not covered by these URLs or the uploaded course materials, say: "
        urls_section += "\"This topic is not covered in the approved course resources. Please ask your teacher for additional materials.\"\n"
        urls_section += "4. Always cite the specific URL when using information from these sources.\n"
        enhanced_context = (enhanced_context + urls_section) if enhanced_context else urls_section
        logger.info(f"[Path 2] Added {len(course_urls)} teacher-curated URLs to agent context (STRICT mode)")
    
    # UNIFY the meta-agent's course spec with prompt store components
    unified_instructions = unify_agent_prompts(
        course_name=course_name,
        course_level=course_level or None,
        course_duration=course_duration or None,
        learning_prompt=course_prompt_from_meta,
        exam_prompt=None,
        additional_context=enhanced_context or None,
        include_agent_behavior=True,
        include_pedagogical_framework=True,
        include_tool_handling=True,
        include_knowledge_grounding=True,
        include_safety_guardrails=True,
    )
    
    instructions = unified_instructions
    logger.info(f"[Path 2] Unified instructions: {len(instructions)} chars")
    
    final_name = sanitize_agent_name(name)
    lam = learning_agent_manager()
    
    # Create a dedicated memory store for this agent
    memory_store_name = None
    try:
        mem_result = create_memory_store_for_agent(final_name)
        memory_store_name = mem_result.get("name")
        logger.info(f"[Path 2] Memory store ready: {memory_store_name}")
    except Exception as e:
        logger.warning(f"[Path 2] Memory store creation failed, continuing without: {e}")

    try:
        # Create agent with unified instructions
        # BingGroundingTool, BingCustomSearchTool, and MemorySearchTool are attached
        agent_id = await lam.create_or_get(
            agent_name=final_name,
            instructions=instructions,
            model_deployment=model,
            custom_search_instance_name=custom_search_instance_name,
            course_urls=course_urls,  # Pass teacher-curated URLs for custom search
            search_index_name=search_index_name,  # Common index name
            search_index_filter=search_index_filter,  # OData filter for session
            search_connection_id=search_connection_id,  # AI Search connection ID
            memory_store_name=memory_store_name,  # Per-agent memory store
        )
    except ValueError as e:
        msg = str(e)
        if "already exists locally" in msg:
            raise ValueError(msg)
        raise
    
    logger.info(f"[Path 2] Created {agent_kind} agent '{final_name}' with ID {agent_id}")
    if search_index_name:
        logger.info(f"[Path 2] Agent configured with AzureAISearchTool (index={search_index_name}, filter={search_index_filter})")
    if course_urls:
        logger.info(f"[Path 2] Agent configured with {len(course_urls)} teacher-curated URLs for custom search")
    if memory_store_name:
        logger.info(f"[Path 2] Agent configured with MemorySearchTool (store={memory_store_name})")
    
    return {
        "agent_id": agent_id,
        "name": final_name,
        "description": generated_description,
        "conversation_starters": conversation_starters,
        "instructions_preview": instructions[:500] + "..." if len(instructions) > 500 else instructions,
        "memory_store_name": memory_store_name,
    }


async def _path3_attach_knowledge(
    agent_id: str,
    index_name: str,
    agent_name: str,
) -> Dict[str, Any]:
    """
    Path 3: Attach the knowledge index to the agent via Azure AI Search tool
    
    Flow: attach index to Azure AI Search tool -> attach tool to agent
    
    This runs AFTER both Path 1 and Path 2 complete.
    """
    SEARCH_CONNECTION_ID = os.environ["AZURE_AI_SEARCH_CONNECTION_ID"]
    
    logger.info(f"[Path 3] Attaching Azure AI Search index '{index_name}' to agent '{agent_id}'")
    
    # Create Azure AI Search tool with semantic hybrid for best results
    ai_search_tool = create_azure_ai_search_tool(
        index_name=index_name,
        connection_id=SEARCH_CONNECTION_ID,
        query_type="vector_semantic_hybrid",
    )
    
    ac = agents_client()
    
    try:
        # Get current agent to preserve existing tools
        agent = ac.get_agent(agent_id)
        existing_tools = list(agent.tools) if agent.tools else []
        
        # Filter out any existing Azure AI Search tools to avoid duplicates
        preserved_tools = [
            t for t in existing_tools 
            if not (isinstance(t, dict) and t.get('type') == 'azure_ai_search')
            and 'AzureAISearch' not in str(type(t))
        ]
        
        # Combine preserved tools with new Azure AI Search tool
        all_tools = preserved_tools + [ai_search_tool]
        
        # Update the agent with new tools
        updated_agent = ac.update_agent(
            agent_id=agent_id,
            tools=all_tools,
        )
        
        logger.info(f"[Path 3] ✓ Attached Azure AI Search to agent '{agent_id}'")
        
        return {
            "ok": True,
            "index_name": index_name,
            "tools_count": len(updated_agent.tools) if updated_agent.tools else 0,
        }
        
    except Exception as e:
        logger.error(f"[Path 3] Failed to attach Azure AI Search: {e}")
        raise


def _path4_save_metadata_background(
    agent_id: str,
    name: str,
    created_by_id: str,
    description: str,
    model: str,
    course_name: str,
    course_level: str,
    course_duration: str,
    agent_kind: str,
    conversation_starters: List[str],
    additional_context: str,
    index_name: Optional[str],
    agent_image_url: Optional[str],
    session_uuid: Optional[str] = None,
    department_id: str = "",
):
    """
    Path 4: Save agent metadata to Cosmos DB (runs in background after Path 3)
    
    This is a synchronous function that will be run in a background task.
    """
    try:
        # Save to Cosmos DB
        create_agent_metadata(
            agent_id=agent_id,
            name=name,
            created_by=created_by_id,
            description=description,
            model=model,
            course_name=course_name,
            course_level=course_level,
            course_duration=course_duration,
            agent_kind=agent_kind,
            conversation_starters=conversation_starters,
            additional_context=additional_context,
            session_uuid=session_uuid,
            department_id=department_id,
        )
        logger.info(f"[Path 4] ✓ Saved agent metadata to Cosmos DB for {agent_id}")
        
        # Also save setup details
        setup_data = {
            "agentId": agent_id,
            "agentKind": agent_kind,
            "courseName": course_name,
            "courseLevel": course_level,
            "courseDuration": course_duration,
            "additionalContext": additional_context,
            "vectorStoreId": index_name,
            "knowledgeUrls": [],
            "agentDescription": description,
            "conversationStarters": conversation_starters,
            "agentImageUrl": agent_image_url,
        }
        _save_setup_json(agent_id, setup_data)
        logger.info(f"[Path 4] ✓ Saved setup details for {agent_id}")
        
    except Exception as e:
        logger.error(f"[Path 4] Failed to save metadata: {e}")
        # Don't raise - this is a background task


@app.post("/api/agents/create-async")
async def create_agent_async(request: AsyncAgentCreateRequest, background_tasks: BackgroundTasks):
    """
    FAST Agent Creation - User can start chatting in ~30 seconds!
    
    FOREGROUND (user waits for this, ~30 sec):
    1. Call CACA meta-agent to generate prompt
    2. Create agent with Web Search tool (automatic via agent_creator)
    3. Return immediately so user can start chatting
    
    BACKGROUND (user doesn't wait):
    1. Wait for Azure AI Search indexer to process uploaded files
    2. Attach Azure AI Search tool to the agent
    3. Save metadata to Cosmos DB
    4. Save setup.json
    
    The user can start chatting with web search + deep research immediately.
    Course-specific knowledge will be attached in ~30-60 seconds in background.
    """
    agent_kind = request.kind
    name = request.name
    user_description = request.description or ""
    course_name = request.courseName or ""
    course_level = request.courseLevel or ""
    course_duration = request.courseDuration or ""
    additional_context = request.additionalContext or ""
    created_by_id = request.createdById or ""
    model = request.model or AGENT_MODEL_DEPLOYMENT
    session_uuid = request.sessionUuid
    kb_scope = request.kbScope or "course"
    index_name = request.indexName
    agent_image_url = request.agentImageUrl
    custom_search_instance_name = request.customSearchInstanceName
    course_urls = request.courseUrls or []
    department_id = request.departmentId or ""
    
    # Validate inputs
    if not name:
        raise HTTPException(status_code=400, detail="Agent name is required")
    
    if agent_kind not in ["learning", "exam", "course"]:
        raise HTTPException(status_code=400, detail="Valid agent kind (learning/exam/course) is required")
    
    if model not in ALLOWED_DEPLOYMENTS:
        raise HTTPException(
            status_code=400,
            detail=f"Model '{model}' not allowed. Allowed: {sorted(ALLOWED_DEPLOYMENTS)}",
        )
    
    logger.info(f"=== FAST Agent Creation for '{name}' ===")
    if course_urls:
        logger.info(f"Teacher-curated URLs: {len(course_urls)} URLs provided")
    
    # ========== STEP 1: Ensure Common Index Pipeline (shared resources) ==========
    # Common index approach: 4 shared resources (datasource, index, skillset, indexer)
    # instead of per-session MCP pipeline (8 resources per session).
    # Data isolation is via OData filter: session_id eq '<uuid>'
    search_index_name = None
    search_index_filter = None
    search_connection_id = None
    knowledge_attached = False
    
    SEARCH_CONNECTION_ID = os.environ["AZURE_AI_SEARCH_CONNECTION_ID"]
    
    if session_uuid:
        try:
            from azure_services.tools.search.course_index_manager import (
                ensure_common_index_pipeline,
                run_common_indexer,
                get_common_index_name,
                get_session_filter,
            )
            
            # Idempotent: creates shared datasource, index, skillset, indexer if not present
            logger.info(f"Ensuring common index pipeline exists...")
            pipeline_ok, pipeline_result = ensure_common_index_pipeline()
            if not pipeline_ok:
                raise Exception(f"Common index pipeline failed: {pipeline_result}")
            
            # Trigger indexer to process any new files for this session
            logger.info(f"Running common indexer for session {session_uuid}...")
            indexer_ok, indexer_result = run_common_indexer()
            if not indexer_ok:
                logger.warning(f"Common indexer run failed (may already be running): {indexer_result}")
            
            search_index_name = get_common_index_name()
            search_index_filter = get_session_filter(session_uuid)
            search_connection_id = SEARCH_CONNECTION_ID
            knowledge_attached = True
            
            logger.info(f"✓ Common index pipeline ready")
            logger.info(f"  Index: {search_index_name}")
            logger.info(f"  Filter: {search_index_filter}")
            logger.info(f"  Connection: {search_connection_id}")
            
        except Exception as e:
            logger.warning(f"Common index pipeline setup failed: {e}. Agent will be created without search tool.")
            search_index_name = None
            search_index_filter = None
            search_connection_id = None
    
    # ========== STEP 2: Create Agent with all tools (including AzureAISearchTool if available) ==========
    try:
        agent_result = await _path2_create_agent(
            agent_kind=agent_kind,
            name=name,
            user_description=user_description,
            course_name=course_name,
            course_level=course_level,
            course_duration=course_duration,
            additional_context=additional_context,
            model=model,
            created_by_id=created_by_id,
            custom_search_instance_name=custom_search_instance_name,
            course_urls=course_urls,
            search_index_name=search_index_name,
            search_index_filter=search_index_filter,
            search_connection_id=search_connection_id,
        )
        logger.info(f"✓ Agent created: {agent_result['agent_id']} (user can now start chatting!)")
        
    except ValueError as e:
        msg = str(e)
        if "already exists" in msg:
            raise HTTPException(status_code=409, detail=msg)
        raise HTTPException(status_code=400, detail=msg)
    except Exception as e:
        logger.error(f"Agent creation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Agent creation failed: {str(e)}")
    
    # ========== Generate manage code for teacher access ==========
    from azure_services.persistence.cosmos_db import _generate_manage_code
    manage_code = _generate_manage_code()
    agent_result["manage_code"] = manage_code
    
    # ========== BACKGROUND: Save metadata to Cosmos DB and setup.json ==========
    background_tasks.add_task(
        _background_save_metadata,
        agent_id=agent_result["agent_id"],
        agent_name=agent_result["name"],
        session_uuid=session_uuid,
        kb_scope=kb_scope,
        index_name=index_name,
        created_by_id=created_by_id,
        description=agent_result["description"],
        model=model,
        course_name=course_name,
        course_level=course_level,
        course_duration=course_duration,
        agent_kind=agent_kind,
        conversation_starters=agent_result["conversation_starters"],
        additional_context=additional_context,
        agent_image_url=agent_image_url,
        knowledge_attached=knowledge_attached,
        textbooks=request.textbooks or [],
        manage_code=manage_code,
        department_id=department_id,
        course_code=request.courseCode or "",
        prerequisites=request.prerequisites or [],
        course_urls=course_urls,
    )
    logger.info(f"✓ Background task scheduled: metadata save")
    
    # ========== BACKGROUND: Textbook Research (if textbooks provided) ==========
    textbooks = request.textbooks or []
    if textbooks:
        threading.Thread(
            target=_background_textbook_research,
            kwargs=dict(
                agent_id=agent_result["agent_id"],
                agent_name=agent_result["name"],
                course_name=course_name,
                course_level=course_level,
                textbooks=textbooks,
                additional_context=additional_context,
            ),
            daemon=True,
        ).start()
        logger.info(f"✓ Background thread started: textbook research ({len(textbooks)} textbooks)")
    
    logger.info(f"=== Agent Creation Complete: {agent_result['agent_id']} ===")
    
    return {
        "agent_id": agent_result["agent_id"],
        "name": agent_result["name"],
        "description": agent_result["description"],
        "conversation_starters": agent_result["conversation_starters"],
        "instructions_preview": agent_result.get("instructions_preview", ""),
        "meta_agent_used": "CACA",
        "created_by_id": created_by_id,
        "index_name": index_name,
        "knowledge_attached": knowledge_attached,  # True if index was attached
        "knowledge_pending": False,  # No longer pending - attached immediately
        "manage_code": agent_result.get("manage_code"),  # 6-char code for teacher access
    }


@app.post("/api/agents/setup/save")
def save_agent_setup_endpoint(details: AgentSetupDetails):
    """Save agent setup details to blob storage."""
    agent_id = details.agentId
    _save_setup_json(agent_id, details.dict())
    logger.info(f"Saved setup details for agent {agent_id}")
    return {"ok": True}


AGENT_IMAGES_CONTAINER = os.environ.get("AGENT_IMAGES_CONTAINER", "agent-images")


@app.post("/api/agents/image/upload")
async def upload_agent_image(
    agent_id: str = Form(...),
    image: UploadFile = File(...),
):
    """
    Upload an agent image to Azure Blob Storage.
    Converts to progressive JPEG for smooth row-by-row loading.
    Returns the blob URL that can be used directly in <img> tags.
    """
    from PIL import Image
    import io
    
    # Validate file type
    allowed_types = {"image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"}
    if image.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type: {image.content_type}. Allowed: {', '.join(allowed_types)}"
        )
    
    # Limit file size (5MB max)
    MAX_SIZE = 5 * 1024 * 1024
    content = await image.read()
    if len(content) > MAX_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Maximum size is 5MB."
        )
    
    try:
        # Convert image to Progressive JPEG for smooth loading
        # Progressive JPEG loads in multiple passes: blurry -> sharper -> final
        img = Image.open(io.BytesIO(content))

        # content_type above is a client-supplied header. Re-check the format
        # Pillow actually sniffed, before any decode, so a file renamed to look
        # like a PNG cannot reach the PSD/FITS/JPEG2000 decoders.
        if img.format not in ("PNG", "JPEG", "GIF", "WEBP"):
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported image format: {img.format}",
            )

        # Convert to RGB if necessary (for PNG with transparency, etc.)
        if img.mode in ('RGBA', 'LA', 'P'):
            # Create white background for transparent images
            background = Image.new('RGB', img.size, (255, 255, 255))
            if img.mode == 'P':
                img = img.convert('RGBA')
            background.paste(img, mask=img.split()[-1] if img.mode == 'RGBA' else None)
            img = background
        elif img.mode != 'RGB':
            img = img.convert('RGB')
        
        # Resize if too large (max 800x800 for profile images)
        max_size = 800
        if img.width > max_size or img.height > max_size:
            img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
        
        # Save as Progressive JPEG
        output = io.BytesIO()
        img.save(output, format='JPEG', quality=85, progressive=True, optimize=True)
        processed_content = output.getvalue()
        
        logger.info(f"Converted image to progressive JPEG: {len(content)} -> {len(processed_content)} bytes")
        
        blob_service = get_blob_service_client()
        container_client = blob_service.get_container_client(AGENT_IMAGES_CONTAINER)
        
        # Ensure container exists with public (blob-level) access for images
        try:
            container_client.create_container(public_access="blob")  # Allow anonymous read for blobs
            logger.info(f"Created container with public blob access: {AGENT_IMAGES_CONTAINER}")
        except Exception:
            # Container already exists - try to set public access
            try:
                container_client.set_container_access_policy(public_access="blob")
                logger.info(f"Set public blob access on container: {AGENT_IMAGES_CONTAINER}")
            except Exception:
                pass  # May not have permission, continue anyway
        
        # Always use .jpg extension since we convert to JPEG
        blob_name = f"{agent_id}/profile.jpg"
        
        blob_client = container_client.get_blob_client(blob_name)
        
        # Upload progressive JPEG with proper content type
        blob_client.upload_blob(
            processed_content,
            overwrite=True,
            content_settings=ContentSettings(
                content_type="image/jpeg",
                cache_control="public, max-age=300, must-revalidate",  # Short cache, revalidate
            )
        )
        
        # Use proxy URL with timestamp for cache busting
        # The timestamp ensures browsers request fresh image after upload
        import time
        timestamp = int(time.time())
        proxy_url = f"/api/agents/image/{agent_id}?v={timestamp}"
        logger.info(f"Uploaded agent image for {agent_id}, proxy URL: {proxy_url}")
        
        # Update Cosmos DB with the proxy URL (includes cache-buster)
        try:
            update_agent_metadata(agent_id, agent_image_url=proxy_url)
            logger.info(f"Updated agent image URL in Cosmos DB for {agent_id}")
        except Exception as cosmos_err:
            logger.warning(f"Failed to update Cosmos DB with image URL: {cosmos_err}")
            # Don't fail - blob upload succeeded
        
        return {"ok": True, "imageUrl": proxy_url}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to upload agent image for {agent_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to upload image: {str(e)}")


@app.delete("/api/agents/image/{agent_id}")
async def delete_agent_image(agent_id: str):
    """Delete an agent's image from Azure Blob Storage and update Cosmos DB."""
    try:
        blob_service = get_blob_service_client()
        container_client = blob_service.get_container_client(AGENT_IMAGES_CONTAINER)
        
        # List and delete all blobs for this agent (handles different extensions)
        deleted_count = 0
        blobs = container_client.list_blobs(name_starts_with=f"{agent_id}/")
        for blob in blobs:
            container_client.delete_blob(blob.name)
            deleted_count += 1
            logger.info(f"Deleted agent image blob: {blob.name}")
        
        # Clear the image URL in Cosmos DB
        try:
            update_agent_metadata(agent_id, agent_image_url="")  # Set to empty string to clear
            logger.info(f"Cleared agent image URL in Cosmos DB for {agent_id}")
        except Exception as cosmos_err:
            logger.warning(f"Failed to clear image URL in Cosmos DB: {cosmos_err}")
        
        return {"ok": True, "deleted": deleted_count}
        
    except Exception as e:
        logger.warning(f"Error deleting agent image for {agent_id}: {e}")
        return {"ok": True, "deleted": 0}  # Don't fail if image doesn't exist


@app.get("/api/agents/image/{agent_id}")
async def get_agent_image(agent_id: str):
    """
    Proxy endpoint to serve agent images from blob storage.
    This allows images to be served without requiring public blob access.
    """
    try:
        blob_service = get_blob_service_client()
        container_client = blob_service.get_container_client(AGENT_IMAGES_CONTAINER)
        
        # Find the image blob for this agent (could be .png, .jpg, etc.)
        blobs = list(container_client.list_blobs(name_starts_with=f"{agent_id}/"))
        if not blobs:
            raise HTTPException(status_code=404, detail="Agent image not found")
        
        # Get the first image blob
        blob_name = blobs[0].name
        blob_client = container_client.get_blob_client(blob_name)
        
        # Download the blob
        download_stream = blob_client.download_blob()
        content = download_stream.readall()
        
        # Get content type and last modified from blob properties for caching
        properties = blob_client.get_blob_properties()
        content_type = properties.content_settings.content_type or "image/png"
        last_modified = properties.last_modified
        
        # Use ETag for proper cache invalidation when image changes
        etag = properties.etag.strip('"') if properties.etag else None
        
        return StreamingResponse(
            iter([content]),
            media_type=content_type,
            headers={
                # Use shorter cache with proper revalidation
                "Cache-Control": "public, max-age=300, must-revalidate",  # 5 min cache, then revalidate
                "Content-Length": str(len(content)),
                **({"ETag": f'"{etag}"'} if etag else {}),
                **({"Last-Modified": last_modified.strftime("%a, %d %b %Y %H:%M:%S GMT")} if last_modified else {}),
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching agent image for {agent_id}: {e}")
        raise HTTPException(status_code=404, detail="Agent image not found")


@app.get("/api/agents/setup/{agent_id}")
def fetch_agent_setup(agent_id: str):
    """Fetch agent setup details (blob → local file → reconstruct from Cosmos)."""
    data = _load_setup_json(agent_id)
    if data:
        return data
    raise HTTPException(status_code=404, detail="Setup details not found")


# ===================== Dynamic Conversation Starters =====================

@app.get("/api/agents/{agent_id}/conversation-starters", tags=["Agent Starters"])
async def generate_conversation_starters(agent_id: str, user_id: Optional[str] = Query(None)):
    """
    Ask the teaching assistant itself to produce 10 personalised conversation starters
    based on:
      • the student's profile (department, institution, interests …)
      • the teacher/creator profile (who made this agent)
      • the course metadata (name, level, duration)

    Returns: { "starters": [ { "title": "…", "prompt": "…" }, … ] }
    """
    import asyncio

    # 1. Agent metadata (course name, creator ID, etc.)
    agent_meta = get_agent_metadata(agent_id)
    if not agent_meta:
        raise HTTPException(status_code=404, detail="Agent not found")

    course_name = agent_meta.get("courseName", agent_meta.get("name", agent_id))
    course_level = agent_meta.get("courseLevel", "")
    creator_id = agent_meta.get("createdById", "")

    # 2. Teacher profile
    teacher_profile: Dict[str, Any] = {}
    if creator_id:
        try:
            teacher_profile = get_user_profile(creator_id) or {}
        except Exception:
            pass

    teacher_name = teacher_profile.get("displayName") or teacher_profile.get("fullName") or ""
    teacher_dept = teacher_profile.get("department") or ""
    teacher_college = teacher_profile.get("college") or teacher_profile.get("institute") or ""

    # 3. Student profile
    student_profile: Dict[str, Any] = {}
    if user_id:
        try:
            student_profile = get_user_profile(user_id) or {}
        except Exception:
            pass

    student_name = student_profile.get("displayName") or student_profile.get("fullName") or "Student"
    student_dept = student_profile.get("department") or ""
    student_college = student_profile.get("college") or ""
    student_interests = student_profile.get("passionateAbout") or student_profile.get("interests") or ""
    student_language = student_profile.get("language") or ""
    student_location = student_profile.get("currentLocation") or ""

    # 4. Build the prompt that asks the TEACHING ASSISTANT to generate starters
    prompt_lines = [
        "Generate exactly 10 personalised conversation-starter questions for a student.",
        "",
        "## Course",
        f"- Name: {course_name}",
    ]
    if course_level:
        prompt_lines.append(f"- Level: {course_level}")
    if teacher_name:
        prompt_lines.append(f"- Created by: {teacher_name}")
    if teacher_dept:
        prompt_lines.append(f"- Teacher department: {teacher_dept}")
    if teacher_college:
        prompt_lines.append(f"- Institution: {teacher_college}")

    prompt_lines.append("")
    prompt_lines.append("## Student profile")
    prompt_lines.append(f"- Name: {student_name}")
    if student_dept:
        prompt_lines.append(f"- Department: {student_dept}")
    if student_college:
        prompt_lines.append(f"- College: {student_college}")
    if student_interests:
        prompt_lines.append(f"- Interests: {student_interests}")
    if student_language:
        prompt_lines.append(f"- Language: {student_language}")
    if student_location:
        prompt_lines.append(f"- Location: {student_location}")

    prompt_lines.extend([
        "",
        "## Output format (strict JSON, nothing else)",
        "Return ONLY a JSON array. Each element must have two keys:",
        '  { "title": "Short 3-6 word label", "prompt": "Full question the student would ask" }',
        "",
        "Requirements:",
        "- The starters should be specific to the course topics, not generic study tips.",
        "- Personalise based on the student's department, interests, and background where possible.",
        "- Cover different topics/modules of the course — ensure variety.",
        "- Return ONLY the JSON array, no markdown fences, no explanation.",
    ])

    request_message = "\n".join(prompt_lines)

    # 5. Call the TEACHING ASSISTANT itself (agent_reference) via the conversations API
    def _call_course_agent():
        import time as _time
        from azure.core.exceptions import ClientAuthenticationError
        from azure.ai.projects import AIProjectClient

        max_retries = 3
        for attempt in range(max_retries):
            client = AIProjectClient(
                endpoint=PROJECT_ENDPOINT,
                credential=get_sync_credential(),
            )
            try:
                openai_client = client.get_openai_client()
                conversation = openai_client.conversations.create()
                response = openai_client.responses.create(
                    conversation=conversation.id,
                    input=request_message,
                    extra_body={"agent": {"name": agent_id, "type": "agent_reference"}},
                )
                return response.output_text or ""
            except ClientAuthenticationError as e:
                logger.warning(f"[Starters] Credential error (attempt {attempt + 1}/{max_retries}): {e}")
                if attempt < max_retries - 1:
                    _time.sleep(1.0 * (attempt + 1))  # back off 1s, 2s
                else:
                    raise
            finally:
                client.close()

    loop = asyncio.get_event_loop()
    raw = await loop.run_in_executor(None, _call_course_agent)
    logger.info(f"[Starters] Agent {agent_id} returned {len(raw)} chars for starters")

    # 6. Parse JSON from the response
    starters: List[Dict[str, str]] = []
    try:
        text = raw.strip()
        # Strip markdown fences if present
        if text.startswith("```"):
            first_newline = text.find("\n")
            text = text[first_newline + 1:] if first_newline != -1 else text[3:]
        if text.endswith("```"):
            text = text[:-3].rstrip()
        parsed = json.loads(text)
        if isinstance(parsed, list):
            for item in parsed[:10]:
                if isinstance(item, dict) and "title" in item and "prompt" in item:
                    starters.append({"title": item["title"], "prompt": item["prompt"]})
                elif isinstance(item, str):
                    starters.append({"title": item[:40], "prompt": item})
    except json.JSONDecodeError as e:
        logger.warning(f"[Starters] Failed to parse JSON from agent response: {e}")

    # 7. Fallback if agent returned nothing usable
    if not starters:
        starters = [
            {"title": "Key Concepts", "prompt": f"What are the key concepts in {course_name}?"},
            {"title": "Getting Started", "prompt": f"Help me understand the fundamentals of {course_name}"},
            {"title": "Learning Path", "prompt": f"What should I learn first in {course_name}?"},
            {"title": "Important Topics", "prompt": f"Can you explain the most important topics in {course_name}?"},
            {"title": "Real-World Applications", "prompt": f"How is {course_name} applied in the real world?"},
            {"title": "Common Mistakes", "prompt": f"What are common mistakes students make in {course_name}?"},
            {"title": "Challenging Topics", "prompt": f"What are the most challenging topics in {course_name}?"},
            {"title": "Study Plan", "prompt": f"Can you recommend a study plan for {course_name}?"},
            {"title": "Career Paths", "prompt": f"What careers use knowledge of {course_name}?"},
            {"title": "Mastery Focus", "prompt": f"What should I focus on to master {course_name}?"},
        ]

    return {"starters": starters}


def remove_readonly(func, path, excinfo):
    """Error handler for shutil.rmtree to handle read-only files on Windows"""
    import stat
    os.chmod(path, stat.S_IWRITE)
    func(path)


def safe_rmtree(path, retries=3, delay=0.5):
    """Safely remove a directory tree with retries for Windows permission issues"""
    import time
    for attempt in range(retries):
        try:
            if os.path.exists(path):
                shutil.rmtree(path, onerror=remove_readonly)
            return True
        except PermissionError as e:
            if attempt < retries - 1:
                logger.warning(f"Retry {attempt + 1}/{retries} deleting {path}: {e}")
                time.sleep(delay)
            else:
                logger.error(f"Failed to delete {path} after {retries} attempts: {e}")
                # Don't raise - just log and continue
                return False
    return False


@app.delete("/api/agents/setup/{agent_id}")
def delete_agent_setup(agent_id: str):
    """Delete agent setup folder and all its contents"""
    setup_dir = _agent_setup_dir(agent_id)

    if setup_dir.exists():
        if safe_rmtree(setup_dir):
            logger.info(f"Deleted setup folder for agent {agent_id}")
        else:
            logger.warning(f"Could not fully delete setup folder for agent {agent_id}")

    return {"ok": True}


@app.post("/api/agents/{agent_id}/verify-code")
def verify_manage_code(agent_id: str, payload: Dict[str, Any]):
    """
    Verify a 6-character manage code for an agent.
    Teachers with the correct code can edit or delete the agent.
    """
    code = (payload.get("code") or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="Code is required")
    
    if verify_agent_manage_code(agent_id, code):
        return {"verified": True}
    else:
        raise HTTPException(status_code=403, detail="Invalid manage code")


@app.get("/api/agents/{agent_id}/manage-code")
def get_manage_code(agent_id: str, requester_id: str = Query(...)):
    """
    Get the manage code for an agent. Only the creator or admin can retrieve it.
    """
    agent = get_agent_metadata(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    
    # Only creator or admin can see the code
    is_creator = agent.get("createdById") == requester_id
    requester_profile = get_user_profile(requester_id)
    is_admin = (requester_profile or {}).get("role") == "admin"
    
    if not (is_creator or is_admin):
        raise HTTPException(status_code=403, detail="Only the creator or admin can view the manage code")
    
    code = agent.get("manageCode")
    if not code:
        # Generate one for existing agents that don't have a code yet
        from azure_services.persistence.cosmos_db import _generate_manage_code, _get_agents_container
        code = _generate_manage_code()
        agent["manageCode"] = code
        agent["updatedAt"] = datetime.utcnow().isoformat() + "Z"
        container = _get_agents_container()
        container.upsert_item(body=agent)
    
    return {"manage_code": code}


@app.post("/api/agents/connect-by-code")
def connect_agent_by_code(payload: Dict[str, Any], request: Request):
    """
    Look up an agent by its 6-character manage code.
    Returns the agent_id and course name so the frontend can navigate to it.
    Rejects if the caller is the agent's creator (they already have access).
    """
    code = (payload.get("code") or "").strip().upper()
    if not code or len(code) != 6:
        raise HTTPException(status_code=400, detail="A valid 6-character code is required")

    from azure_services.persistence.cosmos_db import find_agent_by_manage_code
    agent = find_agent_by_manage_code(code)
    if not agent:
        raise HTTPException(status_code=404, detail="No agent found with that code")

    # Require authentication
    token = _get_session_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    payload_jwt = verify_session_token(token)
    if not payload_jwt:
        raise HTTPException(status_code=401, detail="Invalid or expired session")

    current_user_id = payload_jwt.get("sub", "")
    if not current_user_id:
        raise HTTPException(status_code=401, detail="Invalid session: no user ID")

    # Prevent creator from connecting to their own agent
    if current_user_id == agent.get("createdById", ""):
        raise HTTPException(status_code=409, detail="You already own this agent")

    # Look up caller's role
    caller_profile = get_user_profile(current_user_id)
    current_user_role = (caller_profile or {}).get("role", "student")

    # Add the connecting user to the agent's membership list
    from azure_services.persistence.cosmos_db import add_agent_member
    member_type = "teacher" if current_user_role == "teacher" else "student"
    add_agent_member(agent.get("id", ""), current_user_id, member_type=member_type)

    _invalidate_agent_list_caches(
        current_user_id if member_type == "teacher" else None,
        invalidate_teacher_scope=member_type == "teacher",
    )

    return {
        "agent_id": agent.get("id"),
        "course_name": agent.get("courseName", ""),
        "agent_name": agent.get("agentName", ""),
    }


@app.delete("/api/azure/agents/{agent_id}")
def azure_agents_delete(agent_id: str):
    """
    Delete agent: Remove from Cosmos DB, Azure AI Foundry, cleanup resources.
    
    Uses AIProjectClient to delete named agents.
    
    Args:
        agent_id: The agent name (e.g., "my-course-agent")
    """
    
    # Step 0: Get session UUID from setup to delete the index
    session_uuid = None
    try:
        setup_data = _load_setup_json(agent_id)
        if setup_data:
            session_uuid = setup_data.get("sessionUuid")
            logger.info(f"Found sessionUuid for agent {agent_id}: {session_uuid}")
    except Exception as e:
        logger.warning(f"Could not read setup for agent {agent_id}: {e}")
    
    # Step 1: Delete all chat threads and messages for this agent
    try:
        chat_result = delete_agent_chats(agent_id)
        logger.info(f"Deleted {chat_result['threads']} threads and {chat_result['messages']} messages for agent {agent_id}")
    except Exception as e:
        logger.warning(f"Could not delete chats for agent {agent_id}: {e}")
    
    # Step 2: Remove agent metadata from Cosmos DB
    try:
        delete_agent_metadata(agent_id)
        logger.info(f"Deleted agent metadata from Cosmos DB for {agent_id}")
    except Exception as e:
        logger.warning(f"Could not delete agent metadata from Cosmos DB for {agent_id}: {e}")
    
    # Step 2.5: Delete the agent's dedicated memory store
    try:
        if delete_memory_store_for_agent(agent_id):
            logger.info(f"Deleted memory store for agent {agent_id}")
        else:
            logger.info(f"No memory store found for agent {agent_id} (may not have been created)")
    except Exception as e:
        logger.warning(f"Could not delete memory store for agent {agent_id}: {e}")
    
    # Step 2.6: Delete all learning states for this agent (across all users)
    try:
        from azure_services.persistence.cosmos_db import delete_all_learning_states_for_agent
        deleted_count = delete_all_learning_states_for_agent(agent_id)
        if deleted_count > 0:
            logger.info(f"Deleted {deleted_count} learning state(s) for agent {agent_id}")
        else:
            logger.info(f"No learning states found for agent {agent_id}")
    except Exception as e:
        logger.warning(f"Could not delete learning states for agent {agent_id}: {e}")
    
    # Step 3: Delete from Azure AI Foundry
    deleted = False
    try:
        creator = AgentCreator(project_endpoint=PROJECT_ENDPOINT, model_deployment=AGENT_MODEL_DEPLOYMENT)
        creator.delete_agent(agent_id)
        logger.info(f"Deleted agent from Azure AI Foundry: {agent_id}")
        deleted = True
    except Exception as e:
        logger.warning(f"Could not delete agent {agent_id}: {e}")
    
    if not deleted:
        logger.info(f"Agent {agent_id} was not found in Azure (may have been deleted already)")

    # Step 4: Delete the setup folder
    setup_dir = _agent_setup_dir(agent_id)
    if setup_dir.exists():
        if safe_rmtree(setup_dir):
            logger.info(f"Deleted setup folder for agent {agent_id}")
        else:
            logger.warning(f"Could not fully delete setup folder for agent {agent_id}")

    # Step 5: Delete blob storage files for this session
    # With soft delete detection enabled on the datasource, the indexer will
    # automatically remove deleted documents from the index on next run
    if session_uuid:
        try:
            from azure.storage.blob import BlobServiceClient
            
            credential = get_sync_credential()
            blob_service = BlobServiceClient(
                account_url=f"https://{BLOB_STORAGE_ACCOUNT}.blob.core.windows.net",
                credential=credential
            )
            
            container_name = os.environ.get("AZURE_AI_SEARCH_BLOB_CONTAINER", "course-material-v1")
            container_client = blob_service.get_container_client(container_name)
            
            # Delete all blobs in sessions/{session_uuid}/
            blob_prefix = f"sessions/{session_uuid}/"
            blobs_deleted = 0
            for blob in container_client.list_blobs(name_starts_with=blob_prefix):
                container_client.delete_blob(blob.name)
                blobs_deleted += 1
            
            logger.info(f"✓ Deleted {blobs_deleted} blob files for session {session_uuid}")
            
            # Run the indexer to process deletions (soft delete detection will clean up index)
            if blobs_deleted > 0:
                try:
                    from azure_services.tools.search.course_index_manager import run_common_indexer
                    success, result = run_common_indexer()
                    if success:
                        logger.info(f"✓ Indexer triggered to clean up deleted documents")
                    else:
                        logger.warning(f"Could not run indexer: {result}")
                except Exception as e:
                    logger.warning(f"Could not run indexer: {e}")
            
        except Exception as e:
            logger.warning(f"Could not delete blob files for session {session_uuid}: {e}")

    return {"ok": True}


# ===================== Deep Research =====================

# Deep Research Configuration
DEEP_RESEARCH_PROJECT_ENDPOINT = _require_env("DEEP_RESEARCH_PROJECT_ENDPOINT")
DEEP_RESEARCH_MODEL = os.getenv("DEEP_RESEARCH_MODEL", "o3-deep-research")
DEEP_RESEARCH_BASE_MODEL = os.getenv("DEEP_RESEARCH_BASE_MODEL", "gpt-4o")
DEEP_RESEARCH_BING_CONNECTION_ID = _require_env("DEEP_RESEARCH_BING_CONNECTION_ID")
# Pre-existing Deep Research Agent ID (reuse instead of creating new)
DEEP_RESEARCH_AGENT_ID = _require_env("DEEP_RESEARCH_AGENT_ID")


class DeepResearchRequest(BaseModel):
    query: str
    agent_name: Optional[str] = "deep-research-agent"
    instructions: Optional[str] = "You are a helpful research agent that provides detailed, well-sourced research reports with citations."


class DeepResearchResponse(BaseModel):
    status: str
    response: Optional[str] = None
    citations: Optional[List[Dict[str, str]]] = None
    error: Optional[str] = None


@app.post("/api/deep-research", response_model=DeepResearchResponse)
async def deep_research(request: DeepResearchRequest):
    """
    Run a deep research query using Azure AI Foundry's Deep Research agent.
    Uses azure.ai.projects AIProjectClient with conversations/responses API.
    """
    from azure.ai.projects import AIProjectClient
    
    try:
        logger.info(f"Starting deep research for query: {request.query[:100]}...")
        
        def _run_sync():
            credential = get_sync_credential()
            client = AIProjectClient(
                endpoint=DEEP_RESEARCH_PROJECT_ENDPOINT,
                credential=credential
            )
            try:
                openai_client = client.get_openai_client()
                conversation = openai_client.conversations.create()
                
                response = openai_client.responses.create(
                    conversation=conversation.id,
                    input=request.query,
                    extra_body={
                        "agent": {
                            "name": DEEP_RESEARCH_AGENT_ID,
                            "type": "agent_reference"
                        }
                    },
                )
                
                response_text = response.output_text or ""
                citations = []
                
                # Extract citations from response output
                if response.output:
                    for item in response.output:
                        if hasattr(item, 'content'):
                            for content_item in (item.content or []):
                                if hasattr(content_item, 'annotations'):
                                    for ann in (content_item.annotations or []):
                                        if hasattr(ann, 'url_citation'):
                                            url = ann.url_citation.url
                                            title = getattr(ann.url_citation, 'title', url) or url
                                            if not any(c['url'] == url for c in citations):
                                                citations.append({'title': title, 'url': url})
                
                return response_text, citations
            finally:
                client.close()
        
        loop = asyncio.get_event_loop()
        response_text, citations = await loop.run_in_executor(None, _run_sync)
        
        return DeepResearchResponse(
            status="success",
            response=response_text,
            citations=citations
        )
        
    except Exception as e:
        logger.error(f"Deep research error: {e}")
        return DeepResearchResponse(
            status="error",
            error=str(e)
        )


# ===================== Deep Research SSE Streaming =====================

class DeepResearchStreamRequest(BaseModel):
    query: str
    thread_id: Optional[str] = None  # For multi-turn: continue an existing thread


@app.post("/api/deep-research/stream")
async def stream_deep_research(request: DeepResearchStreamRequest):
    """
    Stream deep research results using Server-Sent Events (SSE).
    Uses AgentsClient with threads/runs API (required for DeepResearchTool).
    Supports multi-turn: first call gets MCQ clarification, second call with thread_id gets research.
    
    SSE Event Types:
    - thread_id: The thread ID for continuing the conversation
    - thinking: Intermediate thinking/reasoning from the agent
    - status: Status updates
    - clarification: MCQ clarification questions (agent asks before researching)
    - complete: Final research response with citations
    - error: Error message
    """
    from azure.ai.agents import AgentsClient
    from azure.ai.agents.models import MessageRole
    import queue
    import threading
    
    def _run_deep_research_in_thread(event_queue: queue.Queue):
        """Run deep research in a background thread, polling for results."""
        try:
            credential = get_sync_credential()
            client = AgentsClient(
                endpoint=DEEP_RESEARCH_PROJECT_ENDPOINT,
                credential=credential
            )
            
            agent_id = DEEP_RESEARCH_AGENT_ID
            logger.info(f"[DeepResearch] Using agent: {agent_id}")
            
            # Reuse existing thread or create new one
            if request.thread_id:
                thread_id = request.thread_id
                logger.info(f"[DeepResearch] Continuing thread: {thread_id}")
            else:
                thread = client.threads.create()
                thread_id = thread.id
                logger.info(f"[DeepResearch] Created new thread: {thread_id}")
            
            # Send the thread_id to frontend for multi-turn
            event_queue.put(('thread_id', {'thread_id': thread_id}))
            
            # Add user message
            message = client.messages.create(
                thread_id=thread_id,
                role="user",
                content=request.query,
            )
            
            event_queue.put(('status', {'status': 'researching', 'message': 'Deep research in progress...'}))
            
            # Start the run
            run = client.runs.create(thread_id=thread_id, agent_id=agent_id)
            logger.info(f"[DeepResearch] Created run: {run.id}")
            
            # Poll for completion and stream thinking tokens
            max_wait_seconds = 1800  # 30 minutes
            start_time = time.time()
            last_message_id = None
            
            while run.status in ("queued", "in_progress"):
                if time.time() - start_time > max_wait_seconds:
                    event_queue.put(('error', {'error': 'Deep research timed out after 30 minutes'}))
                    break
                
                # Fetch latest agent message for thinking tokens
                try:
                    response = client.messages.get_last_message_by_role(
                        thread_id=thread_id,
                        role=MessageRole.AGENT,
                    )
                    
                    if response and response.id != last_message_id:
                        for text_msg in response.text_messages:
                            text_value = text_msg.text.value
                            
                            if text_value.startswith("cot_summary:"):
                                thinking_text = text_value.replace("cot_summary:", "").strip()
                                citations = []
                                if response.url_citation_annotations:
                                    for ann in response.url_citation_annotations:
                                        citations.append({
                                            "title": ann.url_citation.title or ann.url_citation.url,
                                            "url": ann.url_citation.url
                                        })
                                event_queue.put(('thinking', {'summary': thinking_text, 'citations': citations}))
                                last_message_id = response.id
                            elif text_value.strip():
                                event_queue.put(('thinking', {'summary': text_value.strip(), 'citations': []}))
                                last_message_id = response.id
                                
                except Exception as e:
                    logger.warning(f"[DeepResearch] Error fetching messages: {e}")
                
                time.sleep(2)
                run = client.runs.get(thread_id=thread_id, run_id=run.id)
            
            # Handle completion
            if run.status == "failed":
                error_msg = str(run.last_error) if run.last_error else "Unknown error"
                event_queue.put(('error', {'error': f'Deep research failed: {error_msg}'}))
            elif run.status == "completed":
                final_message = client.messages.get_last_message_by_role(
                    thread_id=thread_id,
                    role=MessageRole.AGENT
                )
                
                response_text = ""
                citations = []
                
                if final_message:
                    text_parts = []
                    for t in final_message.text_messages:
                        if not t.text.value.startswith("cot_summary:"):
                            text_parts.append(t.text.value.strip())
                    response_text = "\n\n".join(text_parts)
                    
                    if final_message.url_citation_annotations:
                        seen_urls = set()
                        for ann in final_message.url_citation_annotations:
                            url = ann.url_citation.url
                            if url not in seen_urls:
                                citations.append({"title": ann.url_citation.title or url, "url": url})
                                seen_urls.add(url)
                
                # Detect if this is MCQ clarification (contains A) B) C) D) patterns + "Other" option)
                # vs actual research result (long content with citations)
                import re
                has_mcq = bool(re.search(r'A\)', response_text)) and bool(re.search(r'D\)', response_text))
                has_other = 'other' in response_text.lower() and ('please specify' in response_text.lower() or 'specify' in response_text.lower())
                is_short = len(response_text) < 5000
                is_clarification = has_mcq and is_short and not citations
                
                logger.info(f"[DeepResearch] MCQ detection: has_mcq={has_mcq}, has_other={has_other}, is_short={is_short}, citations={len(citations)}, is_clarification={is_clarification}, text_len={len(response_text)}")
                
                if is_clarification:
                    # This is MCQ clarification — don't delete thread, send as clarification event
                    logger.info(f"[DeepResearch] Response is MCQ clarification, keeping thread for multi-turn")
                    event_queue.put(('clarification', {'response': response_text, 'thread_id': thread_id}))
                else:
                    # This is the actual research result
                    event_queue.put(('complete', {'response': response_text, 'citations': citations}))
                    # Cleanup thread after research completes
                    try:
                        client.threads.delete(thread_id=thread_id)
                        logger.info(f"[DeepResearch] Deleted thread: {thread_id}")
                    except Exception as e:
                        logger.warning(f"[DeepResearch] Failed to delete thread: {e}")
                
        except Exception as e:
            logger.error(f"[DeepResearch] Thread error: {e}")
            event_queue.put(('error', {'error': str(e)}))
        
        event_queue.put(None)
    
    async def event_generator():
        try:
            logger.info(f"Starting deep research stream for query: {request.query[:100]}...")
            
            yield f"event: status\ndata: {json.dumps({'status': 'starting_research', 'message': 'Starting research...'})}\n\n"
            
            event_queue: queue.Queue = queue.Queue()
            thread = threading.Thread(target=_run_deep_research_in_thread, args=(event_queue,), daemon=True)
            thread.start()
            
            while True:
                try:
                    item = event_queue.get_nowait()
                except queue.Empty:
                    await asyncio.sleep(0.1)
                    continue
                
                if item is None:
                    break
                
                event_type, data = item
                yield f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
                
        except Exception as e:
            logger.error(f"Deep research stream error: {e}")
            yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


# ================================================================================================
# BLOB STORAGE FILE UPLOAD ENDPOINTS
# ================================================================================================

from azure.storage.blob import BlobServiceClient, ContentSettings, generate_blob_sas, BlobSasPermissions
from datetime import timedelta

# Configuration for Blob Storage
BLOB_STORAGE_ACCOUNT = os.environ["STORAGE_ACCOUNT_NAME"]
BLOB_STORAGE_CONTAINER = os.environ.get("BLOB_CONTAINER_NAME", "agent-files")
BLOB_STORAGE_CONNECTION_STRING = os.environ.get("BLOB_STORAGE_CONNECTION_STRING", None)

# Initialize Blob Service Client (lazy loading)
_blob_service_client = None

def get_blob_service_client():
    """Get or create the Blob Service Client."""
    global _blob_service_client
    if _blob_service_client is None:
        if BLOB_STORAGE_CONNECTION_STRING:
            _blob_service_client = BlobServiceClient.from_connection_string(BLOB_STORAGE_CONNECTION_STRING)
        else:
            account_url = f"https://{BLOB_STORAGE_ACCOUNT}.blob.core.windows.net"
            _blob_service_client = BlobServiceClient(
                account_url=account_url,
                credential=get_sync_credential()
            )
    return _blob_service_client


def blob_url_to_base64(blob_url: str) -> str:
    """
    Convert a private Azure Blob Storage URL to a base64 data URL.
    Downloads the blob content and encodes it inline.
    If the URL is not a blob URL, returns it as-is.
    
    Args:
        blob_url: The private blob URL (e.g., https://account.blob.core.windows.net/container/blob)
    
    Returns:
        Base64 data URL (data:image/png;base64,...)
    """
    if not blob_url or '.blob.core.windows.net' not in blob_url:
        return blob_url
    
    try:
        from urllib.parse import urlparse
        import base64
        
        parsed = urlparse(blob_url)
        # Path format: /container/blob_name
        path_parts = parsed.path.lstrip('/').split('/', 1)
        if len(path_parts) < 2:
            return blob_url
        
        container_name = path_parts[0]
        blob_name = path_parts[1]
        
        blob_service = get_blob_service_client()
        blob_client = blob_service.get_blob_client(
            container=container_name,
            blob=blob_name
        )
        
        # Download blob content
        blob_data = blob_client.download_blob().readall()
        
        # Detect content type from blob properties
        properties = blob_client.get_blob_properties()
        content_type = properties.content_settings.content_type or "image/png"
        
        # Encode as base64 data URL
        b64_data = base64.b64encode(blob_data).decode('utf-8')
        data_url = f"data:{content_type};base64,{b64_data}"
        
        logger.info(f"Converted blob to base64 data URL: {blob_name} ({len(blob_data)} bytes)")
        return data_url
        
    except Exception as e:
        logger.error(f"Failed to convert blob to base64: {blob_url}: {e}")
        return blob_url


def generate_agent_image_sas_url(blob_name: str, container: str = None, expiry_hours: int = 24 * 365) -> str:
    """
    Generate a SAS URL for an agent image blob that's valid for the specified duration.
    Default is 1 year for long-term caching.
    
    Args:
        blob_name: The blob name (e.g., "agent_id/profile.png")
        container: Container name (defaults to AGENT_IMAGES_CONTAINER)
        expiry_hours: Hours until SAS token expires (default 1 year)
    
    Returns:
        Full URL with SAS token for direct access
    """
    container_name = container or AGENT_IMAGES_CONTAINER
    
    try:
        blob_service = get_blob_service_client()
        
        # Get user delegation key for generating SAS with managed identity
        credential = get_sync_credential()
        
        # Calculate expiry time
        start_time = datetime.utcnow()
        expiry_time = start_time + timedelta(hours=expiry_hours)
        
        # Get user delegation key (valid for up to 7 days, but we only need it for signing)
        delegation_key_expiry = min(expiry_time, start_time + timedelta(days=7))
        user_delegation_key = blob_service.get_user_delegation_key(
            key_start_time=start_time,
            key_expiry_time=delegation_key_expiry,
        )
        
        # Generate SAS token with user delegation key
        sas_token = generate_blob_sas(
            account_name=BLOB_STORAGE_ACCOUNT,
            container_name=container_name,
            blob_name=blob_name,
            user_delegation_key=user_delegation_key,
            permission=BlobSasPermissions(read=True),
            expiry=expiry_time,
            start=start_time,
        )
        
        blob_url_with_sas = f"https://{BLOB_STORAGE_ACCOUNT}.blob.core.windows.net/{container_name}/{blob_name}?{sas_token}"
        return blob_url_with_sas
        
    except Exception as e:
        logger.error(f"Failed to generate SAS URL for {blob_name}: {e}")
        # Fall back to plain URL (will fail if container is not public)
        return f"https://{BLOB_STORAGE_ACCOUNT}.blob.core.windows.net/{container_name}/{blob_name}"


def _sign_generated_images(result: Dict[str, Any]) -> Dict[str, Any]:
    """Attach a readable SAS URL to every stored generated image in a message page.

    Re-signed on every read: a user-delegation SAS cannot outlive its delegation
    key (7 days max), so any token already on the stored URL is discarded rather
    than trusted, which is what keeps images in older threads working.
    """
    from urllib.parse import urlparse

    for message in (result.get("messages") or []):
        blocks = (message.get("metadata") or {}).get("contentBlocks") or []
        for block in blocks:
            if not isinstance(block, dict) or block.get("type") != "generated_image":
                continue
            url = block.get("imageUrl") or ""
            if ".blob.core.windows.net" not in url:
                continue
            path = urlparse(url).path.lstrip("/").split("/", 1)
            if len(path) == 2:
                block["imageUrl"] = generate_agent_image_sas_url(
                    path[1], container=path[0], expiry_hours=24
                )
    return result


class BlobUploadResponse(BaseModel):
    """Response model for blob upload."""
    success: bool
    blob_uri: Optional[str] = None
    blob_name: Optional[str] = None
    error: Optional[str] = None


class BlobListResponse(BaseModel):
    """Response model for listing blobs."""
    blobs: List[Dict[str, Any]]
    count: int


class VectorStoreFromBlobsRequest(BaseModel):
    """Request to create vector store from blob URIs."""
    blob_uris: List[str]
    vector_store_name: str = "agent_vector_store"


class VectorStoreFromBlobsResponse(BaseModel):
    """Response model for vector store creation."""
    success: bool
    vector_store_id: Optional[str] = None
    error: Optional[str] = None


@app.post("/api/blob/upload", response_model=BlobUploadResponse, tags=["Blob Storage"])
async def upload_file_to_blob(
    file: UploadFile = File(...),
    user_id: Optional[str] = Form(None),
    agent_id: Optional[str] = Form(None),
    container: Optional[str] = Form(None),
):
    """
    Upload a file to Azure Blob Storage.
    
    Files are organized by agent_id and user_id:
    - agents/{agent_id}/users/{user_id}/{filename}
    
    This allows per-user file isolation within an agent context.
    """
    try:
        container_name = container or BLOB_STORAGE_CONTAINER
        blob_service = get_blob_service_client()
        
        # Ensure container exists
        container_client = blob_service.get_container_client(container_name)
        try:
            if not container_client.exists():
                container_client.create_container()
        except Exception:
            pass  # Container might already exist
        
        # Construct blob name with organization
        parts = []
        if agent_id:
            parts.append(f"agents/{agent_id}")
        if user_id:
            parts.append(f"users/{user_id}")
        parts.append(file.filename)
        blob_name = "/".join(parts)
        
        # Read file content
        file_content = await file.read()
        
        # Upload to blob
        blob_client = blob_service.get_blob_client(
            container=container_name,
            blob=blob_name
        )
        
        # Set metadata
        metadata = {
            "original_filename": file.filename,
            "content_type": file.content_type or "application/octet-stream",
            "uploaded_at": datetime.utcnow().isoformat(),
        }
        if user_id:
            metadata["user_id"] = user_id
        if agent_id:
            metadata["agent_id"] = agent_id
        
        blob_client.upload_blob(
            file_content,
            overwrite=True,
            metadata=metadata,
            content_settings=ContentSettings(content_type=file.content_type or "application/octet-stream")
        )
        
        logger.info(f"Uploaded file to blob: {blob_name}")
        
        return BlobUploadResponse(
            success=True,
            blob_uri=blob_client.url,
            blob_name=blob_name
        )
        
    except Exception as e:
        logger.error(f"Blob upload error: {e}")
        return BlobUploadResponse(
            success=False,
            error=str(e)
        )


@app.post("/api/blob/upload-multiple", response_model=Dict[str, Any], tags=["Blob Storage"])
async def upload_multiple_files_to_blob(
    files: List[UploadFile] = File(...),
    user_id: Optional[str] = Form(None),
    agent_id: Optional[str] = Form(None),
    container: Optional[str] = Form(None),
):
    """
    Upload multiple files to Azure Blob Storage.
    
    Returns a list of uploaded blob URIs.
    """
    results = []
    errors = []
    
    for file in files:
        try:
            container_name = container or BLOB_STORAGE_CONTAINER
            blob_service = get_blob_service_client()
            
            # Construct blob name
            parts = []
            if agent_id:
                parts.append(f"agents/{agent_id}")
            if user_id:
                parts.append(f"users/{user_id}")
            parts.append(file.filename)
            blob_name = "/".join(parts)
            
            # Read and upload
            file_content = await file.read()
            blob_client = blob_service.get_blob_client(
                container=container_name,
                blob=blob_name
            )
            
            metadata = {
                "original_filename": file.filename,
                "uploaded_at": datetime.utcnow().isoformat(),
            }
            if user_id:
                metadata["user_id"] = user_id
            if agent_id:
                metadata["agent_id"] = agent_id
            
            blob_client.upload_blob(file_content, overwrite=True, metadata=metadata)
            
            results.append({
                "filename": file.filename,
                "blob_uri": blob_client.url,
                "blob_name": blob_name
            })
            
        except Exception as e:
            errors.append({
                "filename": file.filename,
                "error": str(e)
            })
    
    return {
        "success": len(errors) == 0,
        "uploaded": results,
        "errors": errors,
        "total_uploaded": len(results),
        "total_errors": len(errors)
    }


@app.get("/api/blob/list", response_model=BlobListResponse, tags=["Blob Storage"])
async def list_blobs(
    user_id: Optional[str] = Query(None),
    agent_id: Optional[str] = Query(None),
    container: Optional[str] = Query(None),
):
    """
    List blobs in storage, optionally filtered by user_id and/or agent_id.
    """
    try:
        container_name = container or BLOB_STORAGE_CONTAINER
        blob_service = get_blob_service_client()
        container_client = blob_service.get_container_client(container_name)
        
        # Build prefix
        prefix = None
        if agent_id and user_id:
            prefix = f"agents/{agent_id}/users/{user_id}/"
        elif agent_id:
            prefix = f"agents/{agent_id}/"
        elif user_id:
            prefix = f"users/{user_id}/"
        
        blobs = []
        for blob in container_client.list_blobs(name_starts_with=prefix):
            blobs.append({
                "name": blob.name,
                "url": f"{container_client.url}/{blob.name}",
                "size": blob.size,
                "last_modified": blob.last_modified.isoformat() if blob.last_modified else None,
                "metadata": blob.metadata,
            })
        
        return BlobListResponse(blobs=blobs, count=len(blobs))
        
    except Exception as e:
        logger.error(f"Blob list error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/blob/{blob_name:path}", tags=["Blob Storage"])
async def delete_blob(
    blob_name: str,
    container: Optional[str] = Query(None),
):
    """Delete a specific blob."""
    try:
        container_name = container or BLOB_STORAGE_CONTAINER
        blob_service = get_blob_service_client()
        blob_client = blob_service.get_blob_client(
            container=container_name,
            blob=blob_name
        )
        blob_client.delete_blob()
        
        return {"success": True, "deleted": blob_name}
        
    except Exception as e:
        logger.error(f"Blob delete error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/blob/proxy", tags=["Blob Storage"])
async def proxy_blob_image(
    url: str = Query(..., description="The Azure Blob Storage URL to proxy"),
):
    """
    Proxy an image from Azure Blob Storage.
    
    This endpoint fetches an image from Azure Blob Storage using the service's
    credentials and returns it to the client, bypassing CORS and auth issues.
    """
    from urllib.parse import urlparse

    try:
        # Parse the URL to extract container and blob name
        parsed = urlparse(url)

        # Only our own account. Accepting any *.blob.core.windows.net host would let a
        # caller point this at a storage account they control.
        if parsed.scheme != "https" or parsed.hostname != f"{BLOB_STORAGE_ACCOUNT}.blob.core.windows.net":
            raise HTTPException(status_code=400, detail="Invalid blob storage URL")

        # Extract path parts
        path_parts = parsed.path.lstrip('/').split('/', 1)
        if len(path_parts) < 2:
            raise HTTPException(status_code=400, detail="Invalid blob path")

        container_name = path_parts[0]
        blob_name = path_parts[1]
        if ".." in blob_name.split("/"):
            raise HTTPException(status_code=400, detail="Invalid blob path")
        
        # Get the blob
        blob_service = get_blob_service_client()
        blob_client = blob_service.get_blob_client(
            container=container_name,
            blob=blob_name
        )
        
        # Download the blob
        download_stream = blob_client.download_blob()
        content = download_stream.readall()
        
        # Get content type from blob properties
        properties = blob_client.get_blob_properties()
        content_type = properties.content_settings.content_type or "application/octet-stream"
        
        # Return as streaming response with caching headers
        return StreamingResponse(
            iter([content]),
            media_type=content_type,
            headers={
                "Cache-Control": "public, max-age=86400",  # Cache for 1 day
                "Content-Length": str(len(content)),
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Blob proxy error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/blob/create-vector-store", response_model=VectorStoreFromBlobsResponse, tags=["Blob Storage"])
async def create_vector_store_from_blobs(request: VectorStoreFromBlobsRequest):
    """
    Create a vector store from blob URIs.
    
    Use this after uploading files to blob storage to create a searchable
    vector store that can be attached to an agent.
    """
    try:
        from azure.ai.agents.models import VectorStoreDataSource, VectorStoreDataSourceAssetType
        
        # Create data sources from blob URIs
        data_sources = [
            VectorStoreDataSource(
                asset_identifier=uri,
                asset_type=VectorStoreDataSourceAssetType.URI_ASSET
            )
            for uri in request.blob_uris
        ]
        
        # Create vector store using the agents client
        vector_store = async_agents_client.vector_stores.create_and_poll(
            data_sources=data_sources,
            name=request.vector_store_name
        )
        
        logger.info(f"Created vector store from blobs: {vector_store.id}")
        
        return VectorStoreFromBlobsResponse(
            success=True,
            vector_store_id=vector_store.id
        )
        
    except Exception as e:
        logger.error(f"Vector store creation error: {e}")
        return VectorStoreFromBlobsResponse(
            success=False,
            error=str(e)
        )


# NOTE: The following FileSearchTool-based endpoints have been removed:
# - /api/agent/create-with-files (used FileSearchTool)
# - /api/agent/create-with-pdf-extraction (used FileSearchTool)
# Use Azure AI Search Tool instead via /api/agent/{agent_id}/attach-search-index


# ================================================================================================
# DOCUMENT INTELLIGENCE PDF EXTRACTION ENDPOINTS
# Uses Azure Document Intelligence (NOT GPT-4o based OCR)
# ================================================================================================

DOCUMENT_INTELLIGENCE_ENDPOINT = _require_env("DOCUMENT_INTELLIGENCE_ENDPOINT")


class PDFExtractionResponse(BaseModel):
    """Response model for PDF extraction."""
    success: bool
    extracted_text: Optional[str] = None
    blob_uri: Optional[str] = None
    original_pdf_uri: Optional[str] = None
    error: Optional[str] = None


@app.post("/api/pdf/extract", response_model=PDFExtractionResponse, tags=["Document Intelligence"])
async def extract_text_from_pdf(
    file: UploadFile = File(...),
    output_format: str = Form("markdown"),
    upload_to_blob: bool = Form(False),
    user_id: Optional[str] = Form(None),
    agent_id: Optional[str] = Form(None),
):
    """
    Extract text from a PDF using Azure Document Intelligence.
    
    This uses Azure's Document Intelligence service for OCR and layout analysis.
    Optionally uploads the extracted text to Blob Storage.
    
    Args:
        file: PDF file to process
        output_format: "text" or "markdown"
        upload_to_blob: Whether to upload extracted text to blob storage
        user_id: Optional user ID for blob organization
        agent_id: Optional agent ID for blob organization
    """
    try:
        from azure.ai.documentintelligence import DocumentIntelligenceClient
        
        # Read file content
        pdf_bytes = await file.read()
        
        # Initialize Document Intelligence client
        doc_client = DocumentIntelligenceClient(
            endpoint=DOCUMENT_INTELLIGENCE_ENDPOINT,
            credential=get_sync_credential()
        )
        
        # Analyze document
        poller = doc_client.begin_analyze_document(
            model_id="prebuilt-layout",
            body=BytesIO(pdf_bytes),
            content_type="application/pdf"
        )
        result = poller.result()
        
        # Extract text
        if output_format == "markdown":
            extracted_text = _result_to_markdown(result)
        else:
            extracted_text = _result_to_text(result)
        
        response_data = {
            "success": True,
            "extracted_text": extracted_text,
        }
        
        # Optionally upload to blob storage
        if upload_to_blob:
            blob_service = get_blob_service_client()
            container_name = BLOB_STORAGE_CONTAINER
            
            # Upload extracted text
            extension = ".md" if output_format == "markdown" else ".txt"
            extracted_filename = Path(file.filename).stem + "_extracted" + extension
            
            parts = []
            if agent_id:
                parts.append(f"agents/{agent_id}")
            if user_id:
                parts.append(f"users/{user_id}")
            parts.append(extracted_filename)
            blob_name = "/".join(parts)
            
            blob_client = blob_service.get_blob_client(
                container=container_name,
                blob=blob_name
            )
            blob_client.upload_blob(
                extracted_text.encode("utf-8"),
                overwrite=True,
                content_settings={"content_type": "text/markdown" if output_format == "markdown" else "text/plain"}
            )
            response_data["blob_uri"] = blob_client.url
            
            # Also upload original PDF
            original_blob_name = "/".join(parts[:-1] + [file.filename])
            original_blob_client = blob_service.get_blob_client(
                container=container_name,
                blob=original_blob_name
            )
            original_blob_client.upload_blob(pdf_bytes, overwrite=True)
            response_data["original_pdf_uri"] = original_blob_client.url
        
        return PDFExtractionResponse(**response_data)
        
    except Exception as e:
        logger.error(f"PDF extraction error: {e}")
        return PDFExtractionResponse(
            success=False,
            error=str(e)
        )


@app.post("/api/document/extract-text", tags=["Document Intelligence"])
async def extract_text_from_document(
    file: UploadFile = File(...),
):
    """
    Extract text content from a document file (PDF, DOCX, or plain text).
    Used by the course description file upload to get text for additionalContext.
    """
    filename = file.filename or "unknown"
    ext = Path(filename).suffix.lower()
    TEXT_EXTS = {".txt", ".md", ".csv", ".json", ".html", ".htm", ".xml", ".rtf"}

    try:
        file_bytes = await file.read()

        if ext in TEXT_EXTS:
            # Plain text — decode directly
            extracted = file_bytes.decode("utf-8", errors="replace")

        elif ext == ".pdf":
            # PDF — use Azure Document Intelligence
            from azure.ai.documentintelligence import DocumentIntelligenceClient
            doc_client = DocumentIntelligenceClient(
                endpoint=DOCUMENT_INTELLIGENCE_ENDPOINT,
                credential=get_sync_credential(),
            )
            poller = doc_client.begin_analyze_document(
                model_id="prebuilt-layout",
                body=BytesIO(file_bytes),
                content_type="application/pdf",
            )
            result = poller.result()
            extracted = _result_to_text(result)

        elif ext in (".doc", ".docx"):
            # DOCX — use python-docx
            doc = Document(BytesIO(file_bytes))
            parts = []
            for p in doc.paragraphs:
                t = (p.text or "").strip()
                if t:
                    parts.append(t)
            for table in doc.tables:
                for row in table.rows:
                    cells = [(c.text or "").strip() for c in row.cells]
                    line = " | ".join(c for c in cells if c)
                    if line.strip():
                        parts.append(line)
            extracted = "\n\n".join(parts)

        elif ext in (".ppt", ".pptx"):
            # PowerPoint — extract slide text via python-pptx if available
            try:
                from pptx import Presentation
                prs = Presentation(BytesIO(file_bytes))
                slides_text = []
                for slide in prs.slides:
                    for shape in slide.shapes:
                        if shape.has_text_frame:
                            for para in shape.text_frame.paragraphs:
                                t = para.text.strip()
                                if t:
                                    slides_text.append(t)
                extracted = "\n\n".join(slides_text)
            except ImportError:
                return {"success": False, "error": "PPTX extraction not available (python-pptx not installed)"}

        else:
            # Unsupported — try decoding as text
            try:
                extracted = file_bytes.decode("utf-8", errors="strict")
            except UnicodeDecodeError:
                return {"success": False, "error": f"Unsupported file type: {ext}"}

        return {"success": True, "extracted_text": extracted, "filename": filename}

    except Exception as e:
        logger.error(f"Document text extraction error for {filename}: {e}")
        return {"success": False, "error": str(e)}


# Helper functions for Document Intelligence result parsing
def _result_to_text(result) -> str:
    """Convert Document Intelligence result to plain text."""
    pages_text = []
    for page in result.pages:
        lines = [line.content for line in page.lines]
        pages_text.append("\n".join(lines))
    return "\n\n".join(pages_text)


def _result_to_markdown(result) -> str:
    """Convert Document Intelligence result to markdown format."""
    markdown_parts = []
    
    for page_num, page in enumerate(result.pages, 1):
        markdown_parts.append(f"## Page {page_num}\n")
        
        # Extract paragraphs if available
        if hasattr(result, 'paragraphs') and result.paragraphs:
            page_paragraphs = [
                p for p in result.paragraphs 
                if any(br.page_number == page_num for br in getattr(p, 'bounding_regions', []))
            ]
            for para in page_paragraphs:
                role = getattr(para, 'role', None)
                content = para.content
                
                # Format based on role
                if role == 'title':
                    markdown_parts.append(f"# {content}\n")
                elif role == 'sectionHeading':
                    markdown_parts.append(f"### {content}\n")
                else:
                    markdown_parts.append(f"{content}\n")
        else:
            # Fallback to line-by-line
            lines = [line.content for line in page.lines]
            markdown_parts.append("\n".join(lines))
        
        markdown_parts.append("\n---\n")
    
    # Add tables if present
    if hasattr(result, 'tables') and result.tables:
        markdown_parts.append("\n## Tables\n")
        for table_num, table in enumerate(result.tables, 1):
            markdown_parts.append(f"\n### Table {table_num}\n")
            markdown_parts.append(_table_to_markdown(table))
    
    return "\n".join(markdown_parts)


def _table_to_markdown(table) -> str:
    """Convert a Document Intelligence table to markdown format."""
    if not table.cells:
        return ""
    
    # Determine table dimensions
    max_row = max(cell.row_index for cell in table.cells)
    max_col = max(cell.column_index for cell in table.cells)
    
    # Create empty grid
    grid = [["" for _ in range(max_col + 1)] for _ in range(max_row + 1)]
    
    # Fill grid with cell content
    for cell in table.cells:
        grid[cell.row_index][cell.column_index] = cell.content.replace("\n", " ")
    
    # Convert to markdown table
    lines = []
    for row_num, row in enumerate(grid):
        lines.append("| " + " | ".join(row) + " |")
        if row_num == 0:
            lines.append("| " + " | ".join(["---"] * len(row)) + " |")
    
    return "\n".join(lines)


# ================== Async File Processing Endpoints ==================

# Global async file processor instance
_async_file_processor = None

def get_async_file_processor():
    """Get or create the async file processor singleton."""
    global _async_file_processor
    if _async_file_processor is None:
        from azure_services.storage.blob_storage_manager import AsyncFileProcessor
        _async_file_processor = AsyncFileProcessor(
            storage_account_name=BLOB_STORAGE_ACCOUNT,
            document_intelligence_endpoint=DOCUMENT_INTELLIGENCE_ENDPOINT,
            container_name=BLOB_STORAGE_CONTAINER,
            project_endpoint=PROJECT_ENDPOINT,
            output_format="markdown",
        )
    return _async_file_processor


class AsyncProcessingResponse(BaseModel):
    """Response model for async file processing."""
    success: bool
    total_files: int = 0
    successful_files: int = 0
    failed_files: int = 0
    blob_uris: List[str] = []
    results: List[Dict[str, Any]] = []
    error: Optional[str] = None


class AsyncAgentCreationResponse(BaseModel):
    """Response model for async agent creation with file processing."""
    success: bool
    agent_id: Optional[str] = None
    agent_name: Optional[str] = None
    vector_store_id: Optional[str] = None
    files_processed: int = 0
    files_successful: int = 0
    processing_results: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


@app.post("/api/async/process-files", response_model=AsyncProcessingResponse, tags=["Async Processing"])
async def async_process_files(
    files: List[UploadFile] = File(...),
    user_id: Optional[str] = Form(None),
    agent_id: Optional[str] = Form(None),
    output_format: str = Form("markdown"),
):
    """
    Asynchronously process files using Azure Document Intelligence.
    
    Workflow:
    1. Files are saved to a local temp folder
    2. Each file is processed in parallel using Document Intelligence
    3. Processed files (extracted text) are uploaded to Azure Blob Storage
    4. Local temp files are automatically cleaned up
    
    Supports: PDF, PNG, JPG, JPEG, DOCX, TXT, MD files.
    
    Args:
        files: List of files to process
        user_id: Optional user ID for blob organization
        agent_id: Optional agent ID for blob organization
        output_format: "text" or "markdown" for extracted content
    """
    try:
        processor = get_async_file_processor()
        
        # Prepare files as (filename, bytes) tuples
        file_tuples = []
        for file in files:
            content = await file.read()
            file_tuples.append((file.filename, content))
        
        # Process all files asynchronously
        result = await processor.process_uploaded_files(
            files=file_tuples,
            user_id=user_id,
            agent_id=agent_id,
        )
        
        return AsyncProcessingResponse(
            success=result.get("success", False),
            total_files=result.get("total_files", 0),
            successful_files=result.get("successful_files", 0),
            failed_files=result.get("failed_files", 0),
            blob_uris=result.get("blob_uris", []),
            results=result.get("results", []),
        )
        
    except Exception as e:
        logger.error(f"Async file processing error: {e}")
        return AsyncProcessingResponse(
            success=False,
            error=str(e)
        )


@app.post("/api/async/process-single-file", tags=["Async Processing"])
async def async_process_single_file(
    file: UploadFile = File(...),
    user_id: Optional[str] = Form(None),
    agent_id: Optional[str] = Form(None),
):
    """
    Process a single file asynchronously and upload to blob storage.
    
    Args:
        file: File to process
        user_id: Optional user ID
        agent_id: Optional agent ID
        
    Returns:
        Processing result with blob URI
    """
    try:
        processor = get_async_file_processor()
        content = await file.read()
        
        result = await processor.process_single_file(
            filename=file.filename,
            file_bytes=content,
            user_id=user_id,
            agent_id=agent_id,
        )
        
        return result
        
    except Exception as e:
        logger.error(f"Single file processing error: {e}")
        return {
            "success": False,
            "filename": file.filename if file else "unknown",
            "error": str(e)
        }


@app.post("/api/async/create-agent-with-files", response_model=AsyncAgentCreationResponse, tags=["Async Processing", "Agents"])
async def async_create_agent_with_files(
    files: List[UploadFile] = File(...),
    agent_name: str = Form(...),
    instructions: str = Form("You are a helpful assistant that can search and answer questions about uploaded documents."),
    model: str = Form("gpt-4o"),
    user_id: Optional[str] = Form(None),
):
    """
    Complete async workflow: process files, upload to blob, create vector store, create agent.
    
    This endpoint:
    1. Saves uploaded files to a temp folder
    2. Processes each file in parallel using Azure Document Intelligence
    3. Uploads extracted text to Azure Blob Storage
    4. Cleans up local temp files
    5. Creates a vector store from the uploaded blobs
    6. Creates an agent with file search capability
    
    Args:
        files: List of files to process (PDF, DOCX, images, etc.)
        agent_name: Name for the agent
        instructions: System instructions for the agent
        model: Model to use (default: gpt-4o)
        user_id: Optional user ID for file organization
    """
    try:
        processor = get_async_file_processor()
        
        # Prepare files as (filename, bytes) tuples
        file_tuples = []
        for file in files:
            content = await file.read()
            file_tuples.append((file.filename, content))
        
        # Process and create agent
        result = await processor.process_and_create_agent(
            files=file_tuples,
            agent_name=agent_name,
            agent_instructions=instructions,
            model=model,
            user_id=user_id,
        )
        
        return AsyncAgentCreationResponse(
            success=True,
            agent_id=result.get("agent_id"),
            agent_name=agent_name,
            vector_store_id=result.get("vector_store_id"),
            files_processed=result.get("files_processed", 0),
            files_successful=result.get("files_successful", 0),
            processing_results=result.get("processing_results"),
        )
        
    except Exception as e:
        logger.error(f"Async agent creation error: {e}")
        return AsyncAgentCreationResponse(
            success=False,
            error=str(e)
        )


@app.post("/api/async/create-vector-store", tags=["Async Processing", "Vector Stores"])
async def async_create_vector_store_from_blobs(
    blob_uris: List[str] = Form(...),
    vector_store_name: str = Form("processed_documents_vectorstore"),
):
    """
    Create a vector store from previously uploaded blob URIs.
    
    Use this after processing files with /api/async/process-files to create
    a vector store that can be attached to an agent.
    
    Args:
        blob_uris: List of blob URIs from processed files
        vector_store_name: Name for the vector store
    """
    try:
        processor = get_async_file_processor()
        
        vector_store = await processor.create_vector_store_from_results(
            blob_uris=blob_uris,
            vector_store_name=vector_store_name,
        )
        
        return {
            "success": True,
            "vector_store_id": vector_store.id,
            "vector_store_name": vector_store_name,
            "documents_count": len(blob_uris),
        }
        
    except Exception as e:
        logger.error(f"Vector store creation error: {e}")
        return {
            "success": False,
            "error": str(e)
        }


# ===================== Memory Store Management =====================

@app.get("/api/memory/stores", tags=["Memory"])
def list_memory_stores():
    """List all memory stores in the project."""
    try:
        mgr = get_memory_store_manager()
        stores = mgr.list_memory_stores()
        return {"stores": stores, "count": len(stores)}
    except Exception as e:
        logger.error(f"Failed to list memory stores: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/memory/stores/{agent_id}", tags=["Memory"])
def get_agent_memory_store(agent_id: str):
    """Get the memory store associated with an agent."""
    try:
        mgr = get_memory_store_manager()
        store_name = mgr.memory_store_name_for_agent(agent_id)
        store = mgr.get_memory_store(store_name)
        if not store:
            raise HTTPException(status_code=404, detail=f"No memory store found for agent '{agent_id}'")
        return store
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get memory store for agent {agent_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/memory/stores/{agent_id}", tags=["Memory"])
def create_agent_memory_store(agent_id: str, payload: Dict[str, Any] = Body(default={})):
    """
    Create a dedicated memory store for an agent.
    Returns existing store if already created.
    
    Optional body:
    {
        "description": "Custom description",
        "user_profile_details": "What to store/avoid",
        "chat_summary_enabled": true,
        "user_profile_enabled": true
    }
    """
    try:
        result = create_memory_store_for_agent(
            agent_id,
            description=payload.get("description"),
            user_profile_details=payload.get("user_profile_details",
                "Store learning preferences, course progress, topics of interest, and study habits. "
                "Avoid irrelevant or sensitive data such as age, financials, precise location, and credentials."),
            chat_summary_enabled=payload.get("chat_summary_enabled", True),
            user_profile_enabled=payload.get("user_profile_enabled", True),
        )
        return result
    except Exception as e:
        logger.error(f"Failed to create memory store for agent {agent_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/memory/stores/{agent_id}", tags=["Memory"])
def delete_agent_memory_store_endpoint(agent_id: str):
    """Delete the memory store for an agent (irreversible!)."""
    try:
        success = delete_memory_store_for_agent(agent_id)
        if not success:
            raise HTTPException(status_code=404, detail=f"Memory store for agent '{agent_id}' not found or already deleted")
        return {"deleted": True, "agent_id": agent_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete memory store for agent {agent_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/memory/stores/{agent_id}/memories", tags=["Memory"])
def search_agent_memories(
    agent_id: str,
    user_id: str = Query(..., description="User scope to search memories for"),
    query: str = Query("", description="Search query (empty = static/profile memories)"),
    max_memories: int = Query(10, ge=1, le=50, description="Max memories to return"),
):
    """
    Search memories for a specific user within an agent's memory store.
    
    - With query: returns contextual memories matching the query
    - Without query: returns static user profile memories
    """
    try:
        mgr = get_memory_store_manager()
        store_name = mgr.memory_store_name_for_agent(agent_id)
        
        if query:
            results = mgr.search_memories(store_name, scope=user_id, query=query, max_memories=max_memories)
        else:
            results = mgr.get_static_memories(store_name, scope=user_id)
        
        return {"memories": results, "count": len(results), "scope": user_id, "store_name": store_name}
    except Exception as e:
        logger.error(f"Failed to search memories: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/memory/stores/{agent_id}/user/{user_id}", tags=["Memory"])
def delete_user_memories_endpoint(agent_id: str, user_id: str):
    """
    Delete all memories for a specific user within an agent's memory store.
    Useful for GDPR data deletion requests or resetting user memory.
    """
    try:
        mgr = get_memory_store_manager()
        success = mgr.delete_user_memories_for_agent(agent_id, scope=user_id)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to delete user memories")
        return {"deleted": True, "agent_id": agent_id, "user_id": user_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete user memories: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ===================== Chat Persistence (Cosmos DB) =====================

from azure_services.persistence.cosmos_db import (
    create_thread,
    get_thread,
    update_thread,
    delete_thread,
    list_threads_for_user,
    add_message,
    get_messages_for_thread,
    delete_message,
    sync_threads_batch,
    sync_messages_batch,
    check_cosmos_connection,
    # User profile operations
    get_user_profile,
    get_user_by_email,
    upsert_user_profile,
    delete_user_profile,
    # User directory operations (invited + active)
    invite_user,
    list_directory_users,
    promote_invited_user,
    remove_directory_user,
    check_invite,
    get_invite_by_email,
    get_department_onboarding_progress,
    # Agent metadata operations
    create_agent_metadata,
    get_agent_metadata,
    update_agent_metadata,
    delete_agent_metadata,
    delete_agent_chats,
    list_agents_metadata,
    list_agents_for_user,
    add_agent_member,
    remove_agent_member,
    get_agent_members,
    get_users_batch,  # For joining user display names to agents
    get_invited_users_batch,  # Teachers may still be invite-only records
    verify_agent_manage_code,
    get_agent_manage_code,
    # Courses container
    get_courses_container,
    # Feedback operations
    submit_feedback,
    list_feedback,
)


class ChatThreadModel(BaseModel):
    """Thread model for chat persistence."""
    id: str
    userId: str
    agentId: str
    name: str
    lastMessageAt: str
    createdAt: str
    metadata: Optional[Dict[str, Any]] = None


class ChatMessageModel(BaseModel):
    """Message model for chat persistence."""
    id: str
    threadId: str
    userId: str
    role: str  # "user" or "assistant"
    content: str
    timestamp: str
    metadata: Optional[Dict[str, Any]] = None
    messageGroupId: Optional[str] = None  # Groups user message with its assistant responses
    retryNumber: Optional[int] = 0  # 0 = original, 1+ = retry attempts


class SyncRequestModel(BaseModel):
    """Request model for syncing chat data from frontend."""
    userId: str
    threads: List[Dict[str, Any]]
    messages: List[Dict[str, Any]]


class SyncResponseModel(BaseModel):
    """Response model for sync operation."""
    success: bool
    threadsUpserted: int = 0
    messagesUpserted: int = 0
    error: Optional[str] = None


@app.get("/api/chat/health", tags=["Chat Persistence"])
async def chat_health():
    """Check Cosmos DB connection health."""
    is_healthy = await asyncio.to_thread(check_cosmos_connection)
    if is_healthy:
        return {"status": "healthy", "service": "cosmos_db"}
    else:
        raise HTTPException(status_code=503, detail="Cosmos DB connection unhealthy")


@app.get("/api/chat/threads/{user_id}", tags=["Chat Persistence"])
async def get_user_threads(user_id: str, agent_id: Optional[str] = None):
    """
    Get all threads for a user, optionally filtered by agent.
    
    Args:
        user_id: The user ID to fetch threads for
        agent_id: Optional agent ID to filter threads
    """
    try:
        threads = await asyncio.to_thread(list_threads_for_user, user_id, agent_id)
        return {"threads": threads}
    except Exception as e:
        logger.error(f"Error fetching threads for user {user_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/chat/thread/{thread_id}", tags=["Chat Persistence"])
async def get_single_thread(thread_id: str, user_id: str):
    """
    Get a single thread by ID.
    
    Args:
        thread_id: The thread ID
        user_id: The user ID (for partition key)
    """
    try:
        thread = await asyncio.to_thread(get_thread, thread_id, user_id)
        if thread:
            return {"thread": thread}
        raise HTTPException(status_code=404, detail="Thread not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching thread {thread_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/chat/thread", tags=["Chat Persistence"])
async def create_new_thread(thread: ChatThreadModel):
    """Create a new chat thread."""
    try:
        result = await asyncio.to_thread(
            create_thread,
            thread_id=thread.id,
            user_id=thread.userId,
            agent_id=thread.agentId,
            title=thread.name,
        )
        return {"success": True, "thread": result}
    except Exception as e:
        logger.error(f"Error creating thread: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/chat/thread/{thread_id}", tags=["Chat Persistence"])
async def update_existing_thread(
    thread_id: str,
    user_id: str,
    updates: Dict[str, Any] = Body(...)
):
    """
    Update a thread's properties.
    
    Args:
        thread_id: The thread ID
        user_id: The user ID (for partition key)
        updates: Dictionary of fields to update
    """
    try:
        result = await asyncio.to_thread(update_thread, thread_id, user_id, updates)
        if result:
            return {"success": True, "thread": result}
        raise HTTPException(status_code=404, detail="Thread not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating thread {thread_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/chat/thread/{thread_id}", tags=["Chat Persistence"])
async def delete_chat_thread(thread_id: str, user_id: str):
    """
    Delete a thread and all its messages.
    
    Args:
        thread_id: The thread ID
        user_id: The user ID (for partition key)
    """
    try:
        success = await asyncio.to_thread(delete_thread, thread_id, user_id)
        return {"success": success}
    except Exception as e:
        logger.error(f"Error deleting thread {thread_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/chat/user/{user_id}/all", tags=["Chat Persistence"])
async def delete_all_user_chat_data(user_id: str):
    """
    Delete ALL threads and messages for a user. Use with caution!
    
    This is useful for clearing all chat history during development/testing.
    
    Args:
        user_id: The user ID
    """
    try:
        from azure_services.persistence.cosmos_db import delete_all_user_data
        result = await asyncio.to_thread(delete_all_user_data, user_id)
        return {"success": True, **result}
    except Exception as e:
        logger.error(f"Error deleting all data for user {user_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Department Management Endpoints (Admin only)
# ============================================================================

class DepartmentCreateRequest(BaseModel):
    id: str
    name: str
    institutionId: Optional[str] = ""
    institutionName: Optional[str] = ""

class DepartmentUpdateRequest(BaseModel):
    name: Optional[str] = None
    institutionId: Optional[str] = None
    institutionName: Optional[str] = None

class DepartmentMemberRequest(BaseModel):
    userId: str


@app.post("/api/departments", tags=["Departments"])
def create_department_endpoint(req: DepartmentCreateRequest):
    """Create a new department (admin only)."""
    from azure_services.persistence.cosmos_db import create_department, get_department
    if get_department(req.id):
        raise HTTPException(status_code=409, detail="Department already exists")
    dept = create_department(
        dept_id=req.id,
        name=req.name,
        institution_id=req.institutionId or "",
        institution_name=req.institutionName or "",
    )
    return dept


@app.get("/api/departments", tags=["Departments"])
def list_departments_endpoint():
    """List all active departments."""
    from azure_services.persistence.cosmos_db import list_departments
    return list_departments()


@app.get("/api/departments/{dept_id}", tags=["Departments"])
def get_department_endpoint(dept_id: str):
    """Get a single department by ID."""
    from azure_services.persistence.cosmos_db import get_department
    dept = get_department(dept_id)
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")
    return dept


@app.put("/api/departments/{dept_id}", tags=["Departments"])
def update_department_endpoint(dept_id: str, req: DepartmentUpdateRequest):
    """Update a department (admin only)."""
    from azure_services.persistence.cosmos_db import update_department
    updates = {k: v for k, v in req.dict().items() if v is not None}
    dept = update_department(dept_id, updates)
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")
    return dept


@app.delete("/api/departments/{dept_id}", tags=["Departments"])
def delete_department_endpoint(dept_id: str):
    """Soft-delete a department (admin only)."""
    from azure_services.persistence.cosmos_db import delete_department
    if not delete_department(dept_id):
        raise HTTPException(status_code=404, detail="Department not found")
    return {"success": True}


@app.get("/api/departments/{dept_id}/members", tags=["Departments"])
def list_department_members_endpoint(dept_id: str):
    """List all users in a department."""
    from azure_services.persistence.cosmos_db import list_department_members
    return list_department_members(dept_id)


@app.post("/api/departments/{dept_id}/members", tags=["Departments"])
def add_department_member_endpoint(dept_id: str, req: DepartmentMemberRequest):
    """Add a user to a department (admin only)."""
    from azure_services.persistence.cosmos_db import add_user_to_department, get_department
    dept = get_department(dept_id)
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")
    profile = add_user_to_department(req.userId, dept_id)
    if not profile:
        raise HTTPException(status_code=404, detail="User not found")
    return {"success": True, "departments": profile.get("departments", [])}


@app.delete("/api/departments/{dept_id}/members/{user_id}", tags=["Departments"])
def remove_department_member_endpoint(dept_id: str, user_id: str):
    """Remove a user from a department (admin only)."""
    from azure_services.persistence.cosmos_db import remove_user_from_department
    profile = remove_user_from_department(user_id, dept_id)
    if not profile:
        raise HTTPException(status_code=404, detail="User not found")
    return {"success": True, "departments": profile.get("departments", [])}


@app.get("/api/users/{user_id}/departments", tags=["Departments"])
def get_user_departments_endpoint(user_id: str):
    """Get all departments a user belongs to."""
    from azure_services.persistence.cosmos_db import get_user_departments
    return get_user_departments(user_id)


# ============================================================================
# Chat Sharing Endpoints (Public read-only access)
# ============================================================================

@app.post("/api/chat/thread/{thread_id}/share", tags=["Chat Sharing"])
async def create_share_link(thread_id: str, user_id: str):
    """
    Create a shareable link for a chat thread.
    The link allows read-only access to the chat without authentication.
    
    Args:
        thread_id: The thread ID to share
        user_id: The owner's user ID (for verification)
    
    Returns:
        share_token: Token to use in the share URL
        share_url: Full URL for sharing (frontend constructs this)
    """
    try:
        from azure_services.persistence.cosmos_db import create_share_token_for_thread
        share_token = await asyncio.to_thread(create_share_token_for_thread, thread_id, user_id)
        
        if share_token:
            return {
                "success": True,
                "share_token": share_token,
                "thread_id": thread_id,
            }
        raise HTTPException(status_code=404, detail="Thread not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating share link for thread {thread_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/chat/thread/{thread_id}/share", tags=["Chat Sharing"])
async def revoke_share_link(thread_id: str, user_id: str):
    """
    Revoke the shareable link for a chat thread.
    This disables public access to the chat.
    
    Args:
        thread_id: The thread ID
        user_id: The owner's user ID (for verification)
    """
    try:
        from azure_services.persistence.cosmos_db import revoke_share_token
        success = await asyncio.to_thread(revoke_share_token, thread_id, user_id)
        return {"success": success}
    except Exception as e:
        logger.error(f"Error revoking share link for thread {thread_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/shared/{share_token}", tags=["Chat Sharing"])
async def get_shared_chat(share_token: str):
    """
    Get a shared chat by its share token.
    This is a PUBLIC endpoint - no authentication required.
    
    Returns the thread info and all messages for read-only viewing.
    
    Args:
        share_token: The share token from the URL
    """
    try:
        from azure_services.persistence.cosmos_db import get_thread_by_share_token, get_messages_for_shared_thread
        
        # Get thread by share token (cross-partition query)
        thread = await asyncio.to_thread(get_thread_by_share_token, share_token)
        
        if not thread:
            raise HTTPException(status_code=404, detail="Shared chat not found or link has expired")
        
        # Get all messages for this thread
        messages = await asyncio.to_thread(
            get_messages_for_shared_thread,
            thread["id"],
            thread["userId"]
        )
        
        # Return thread and messages (sanitize sensitive fields)
        return {
            "thread": {
                "id": thread["id"],
                "title": thread.get("title", "Shared Chat"),
                "agentId": thread.get("agentId"),
                "createdAt": thread.get("createdAt"),
                "sharedAt": thread.get("sharedAt"),
            },
            "messages": [
                {
                    "id": msg["id"],
                    "role": msg.get("role"),
                    "content": msg.get("content"),
                    "createdAt": msg.get("createdAt"),
                    "metadata": msg.get("metadata"),
                }
                for msg in messages
            ],
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching shared chat {share_token}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==============================================================================
# Assets / Artifacts Endpoints
# ==============================================================================

class QuizAttemptAnswerRequest(BaseModel):
    question: str
    options: List[str]
    selected: List[int]
    correct: List[int]
    reason: str
    explanation: Optional[str] = None
    targetsMisconception: Optional[str] = None


class QuizAssetRequest(BaseModel):
    userId: Optional[str] = None
    quizId: str
    title: str
    agentId: str
    threadId: Optional[str] = None
    assessmentType: str = "practice_quiz"
    thresholdConcept: Optional[str] = None
    questions: List[Dict[str, Any]]
    tags: Optional[List[str]] = None


class FirstQuizAttemptRequest(BaseModel):
    userId: Optional[str] = None
    quizId: str
    title: str
    agentId: str
    threadId: Optional[str] = None
    assessmentType: str = "practice_quiz"
    thresholdConcept: Optional[str] = None
    answers: List[QuizAttemptAnswerRequest]


class QuizAgentFeedbackRequest(BaseModel):
    userId: Optional[str] = None
    agentId: str
    feedback: str


def _validate_concept_inventory_mapping(
    *,
    assessment_type: str,
    threshold_concept: Optional[str],
    title: str,
    agent_id: str,
    questions: List[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    if assessment_type != "concept_inventory":
        return None
    from agent_tools.custom.add_quiz import AddQuizTool

    return AddQuizTool().execute(
        {
            "assessment_type": assessment_type,
            "threshold_concept": threshold_concept,
            "title": title,
            "questions": questions,
        },
        agent_name=agent_id,
    )


def _normalize_first_quiz_attempt(request: FirstQuizAttemptRequest) -> Dict[str, Any]:
    if not request.quizId.strip() or not request.agentId.strip():
        raise HTTPException(status_code=422, detail="quizId and agentId are required")
    if not request.answers:
        raise HTTPException(status_code=422, detail="At least one quiz answer is required")

    score = 0
    normalized_answers: List[Dict[str, Any]] = []
    for index, answer in enumerate(request.answers):
        reason = answer.reason.strip()
        if not reason:
            raise HTTPException(
                status_code=422,
                detail=f"A reason is required for question {index + 1}",
            )
        if not answer.options or not answer.selected or not answer.correct:
            raise HTTPException(
                status_code=422,
                detail=f"Question {index + 1} has incomplete answer data",
            )

        selected = sorted(set(answer.selected))
        correct = sorted(set(answer.correct))
        option_count = len(answer.options)
        if any(option < 0 or option >= option_count for option in selected + correct):
            raise HTTPException(
                status_code=422,
                detail=f"Question {index + 1} contains an invalid option index",
            )

        is_correct = selected == correct
        score += int(is_correct)
        normalized_answers.append({
            "question": answer.question.strip(),
            "options": answer.options,
            "selected": selected,
            "selectedOptions": [answer.options[option] for option in selected],
            "correct": correct,
            "correctOptions": [answer.options[option] for option in correct],
            "reason": reason,
            "isCorrect": is_correct,
            "explanation": (answer.explanation or "").strip(),
            "targetsMisconception": (answer.targetsMisconception or "").strip(),
        })

    total = len(normalized_answers)
    return {
        "schemaVersion": 1,
        "recordType": "concept_inventory_first_attempt",
        "quizId": request.quizId.strip(),
        "title": request.title.strip() or "Concept Inventory",
        "agentId": request.agentId.strip(),
        "threadId": (request.threadId or "").strip(),
        "assessmentType": request.assessmentType,
        "thresholdConcept": (request.thresholdConcept or "").strip(),
        "submittedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "score": score,
        "totalQuestions": total,
        "percentage": round(score / total * 100),
        "answers": normalized_answers,
    }


@app.post("/api/quiz-assets", tags=["Assessments"])
async def upsert_quiz_asset_endpoint(body: QuizAssetRequest, request: Request):
    """Register the generated quiz in its deterministic lifecycle asset."""
    user_id = _resolve_user_id(request, body.userId)
    if not body.quizId.strip() or not body.agentId.strip() or not body.questions:
        raise HTTPException(status_code=422, detail="quizId, agentId, and questions are required")
    from azure_services.persistence.cosmos_db import upsert_quiz_asset

    validated = _validate_concept_inventory_mapping(
        assessment_type=body.assessmentType,
        threshold_concept=body.thresholdConcept,
        title=body.title,
        agent_id=body.agentId.strip(),
        questions=body.questions,
    )
    questions = validated["questions"] if validated else body.questions
    threshold_concept = (
        validated.get("thresholdConcept") if validated else body.thresholdConcept
    )

    asset = await asyncio.to_thread(
        upsert_quiz_asset,
        user_id=user_id,
        agent_id=body.agentId.strip(),
        quiz_id=body.quizId.strip(),
        title=body.title.strip() or "Quiz",
        questions=questions,
        thread_id=(body.threadId or "").strip() or None,
        tags=body.tags,
        assessment_type=body.assessmentType,
        threshold_concept=(threshold_concept or "").strip() or None,
    )
    return {"assetId": asset["id"], "createdAt": asset.get("createdAt")}


@app.get("/api/quiz-attempts/{quiz_id}/first", tags=["Assessments"])
async def get_first_quiz_attempt_status(
    quiz_id: str,
    request: Request,
    agentId: str = Query(..., description="Course agent ID"),
    userId: Optional[str] = Query(None, description="Current user ID"),
):
    """Return whether the current student has a stored first attempt."""
    user_id = _resolve_user_id(request, userId)
    from azure_services.persistence.cosmos_db import get_first_quiz_attempt

    asset = await asyncio.to_thread(
        get_first_quiz_attempt,
        user_id,
        agentId.strip(),
        quiz_id.strip(),
    )
    return {
        "exists": asset is not None,
        "assetId": asset.get("id") if asset else None,
        "submittedAt": asset.get("createdAt") if asset else None,
    }


@app.post("/api/quiz-attempts/first", tags=["Assessments"])
async def submit_first_quiz_attempt(
    body: FirstQuizAttemptRequest,
    request: Request,
):
    """Persist the current student's first concept-inventory attempt once."""
    user_id = _resolve_user_id(request, body.userId)
    attempt = _normalize_first_quiz_attempt(body)
    # Enrichment only: the quiz was already validated when it was authored, so a
    # concept that no longer resolves must not cost the student their answers.
    try:
        validated = _validate_concept_inventory_mapping(
            assessment_type=body.assessmentType,
            threshold_concept=body.thresholdConcept,
            title=body.title,
            agent_id=body.agentId.strip(),
            questions=[
                {
                    "question": answer.question,
                    "options": answer.options,
                    "correct": answer.correct,
                    "explanation": answer.explanation or "",
                    "targetsMisconception": answer.targetsMisconception or "",
                }
                for answer in body.answers
            ],
        )
    except Exception as exc:
        logger.warning(
            f"Concept inventory mapping failed for quiz '{body.quizId}' on agent "
            f"'{body.agentId}'; storing the attempt unenriched: {exc}"
        )
        validated = None
    if validated:
        if validated.get("thresholdConcept"):
            attempt["thresholdConcept"] = validated["thresholdConcept"]
        for answer, question in zip(attempt["answers"], validated["questions"]):
            answer["targetsMisconception"] = question["targetsMisconception"]
    from azure_services.persistence.cosmos_db import create_first_quiz_attempt

    asset, created = await asyncio.to_thread(
        create_first_quiz_attempt,
        user_id=user_id,
        agent_id=body.agentId.strip(),
        quiz_id=body.quizId.strip(),
        title=attempt["title"],
        attempt=attempt,
        thread_id=(body.threadId or "").strip() or None,
    )
    stored_attempt = json.loads(asset.get("content") or "{}")
    return {
        "created": created,
        "assetId": asset["id"],
        "submittedAt": asset.get("createdAt"),
        "score": stored_attempt.get("score", 0),
        "totalQuestions": stored_attempt.get("totalQuestions", 0),
    }


@app.post("/api/quiz-attempts/{quiz_id}/feedback", tags=["Assessments"])
async def append_quiz_feedback_endpoint(
    quiz_id: str,
    body: QuizAgentFeedbackRequest,
    request: Request,
):
    """Append automatic tutor feedback to the same first-attempt quiz asset."""
    user_id = _resolve_user_id(request, body.userId)
    feedback = body.feedback.strip()
    if not quiz_id.strip() or not body.agentId.strip() or not feedback:
        raise HTTPException(status_code=422, detail="quizId, agentId, and feedback are required")
    from azure_services.persistence.cosmos_db import append_quiz_agent_feedback

    asset = await asyncio.to_thread(
        append_quiz_agent_feedback,
        user_id=user_id,
        agent_id=body.agentId.strip(),
        quiz_id=quiz_id.strip(),
        feedback=feedback,
    )
    if asset is None:
        raise HTTPException(status_code=404, detail="Submitted quiz asset not found")
    return {"assetId": asset["id"], "updatedAt": asset.get("updatedAt")}

class AssetCreateRequest(BaseModel):
    title: str
    category: str  # quiz, flashcard, diagram, summary, code, visualization, other
    type: str  # html, markdown, code, mermaid, svg, json, text
    content: str
    agentId: Optional[str] = None
    threadId: Optional[str] = None
    messageId: Optional[str] = None
    description: Optional[str] = None
    previewImageUrl: Optional[str] = None
    isPublic: bool = False
    tags: Optional[List[str]] = None


class AssetUpdateRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    content: Optional[str] = None
    category: Optional[str] = None
    type: Optional[str] = None
    previewImageUrl: Optional[str] = None
    isPublic: Optional[bool] = None
    tags: Optional[List[str]] = None


@app.post("/api/assets", tags=["Assets"])
async def create_asset_endpoint(
    request: AssetCreateRequest,
    user_id: str = Query(..., description="User ID")
):
    """
    Create a new asset/artifact.
    
    Assets can be generated from chat (quizzes, flashcards, diagrams) or created by students.
    """
    try:
        from azure_services.persistence.cosmos_db import create_asset
        
        asset = await asyncio.to_thread(
            create_asset,
            user_id=user_id,
            title=request.title,
            category=request.category,
            asset_type=request.type,
            content=request.content,
            agent_id=request.agentId,
            thread_id=request.threadId,
            message_id=request.messageId,
            description=request.description,
            preview_image_url=request.previewImageUrl,
            is_public=request.isPublic,
            tags=request.tags,
        )
        return asset
    except Exception as e:
        logger.error(f"Error creating asset: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/assets", tags=["Assets"])
async def list_assets(
    user_id: str = Query(..., description="User ID"),
    category: Optional[str] = Query(None, description="Filter by category"),
    agentId: Optional[str] = Query(None, description="Filter by agent ID"),
    threadId: Optional[str] = Query(None, description="Filter by thread ID"),
    limit: int = Query(50, description="Max assets to return")
):
    """
    List assets for the current user with optional filters.
    """
    try:
        from azure_services.persistence.cosmos_db import list_user_assets
        
        assets = await asyncio.to_thread(
            list_user_assets,
            user_id=user_id,
            category=category,
            agent_id=agentId,
            thread_id=threadId,
            limit=limit,
        )
        return {"assets": assets, "total": len(assets)}
    except Exception as e:
        logger.error(f"Error listing assets: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/assets/public", tags=["Assets"])
async def list_public_assets(
    category: Optional[str] = Query(None, description="Filter by category"),
    tags: Optional[str] = Query(None, description="Comma-separated tags to filter by"),
    limit: int = Query(50, description="Max assets to return")
):
    """
    List public assets (inspiration/examples) - no auth required.
    """
    try:
        from azure_services.persistence.cosmos_db import list_public_assets as list_public_assets_db
        
        tag_list = tags.split(",") if tags else None
        assets = await asyncio.to_thread(
            list_public_assets_db,
            category=category,
            tags=tag_list,
            limit=limit,
        )
        return {"assets": assets, "total": len(assets)}
    except Exception as e:
        logger.error(f"Error listing public assets: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/assets/{asset_id}", tags=["Assets"])
async def get_asset_endpoint(
    asset_id: str,
    user_id: Optional[str] = Query(None, description="User ID (required for private assets)")
):
    """
    Get an asset by ID.
    
    If user_id is provided, returns the user's own asset.
    If user_id is not provided, returns only if the asset is public.
    """
    try:
        if user_id:
            from azure_services.persistence.cosmos_db import get_asset
            asset = await asyncio.to_thread(get_asset, asset_id, user_id)
        else:
            from azure_services.persistence.cosmos_db import get_public_asset
            asset = await asyncio.to_thread(get_public_asset, asset_id)
        
        if not asset:
            raise HTTPException(status_code=404, detail="Asset not found")
        return asset
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching asset {asset_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/assets/{asset_id}", tags=["Assets"])
async def update_asset_endpoint(
    asset_id: str,
    request: AssetUpdateRequest,
    user_id: str = Query(..., description="User ID")
):
    """
    Update an asset.
    """
    try:
        from azure_services.persistence.cosmos_db import update_asset
        
        updates = {k: v for k, v in request.model_dump().items() if v is not None}
        asset = await asyncio.to_thread(update_asset, asset_id, user_id, updates)
        
        if not asset:
            raise HTTPException(status_code=404, detail="Asset not found")
        return asset
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating asset {asset_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/assets/{asset_id}", tags=["Assets"])
async def delete_asset_endpoint(
    asset_id: str,
    user_id: str = Query(..., description="User ID")
):
    """
    Delete an asset.
    """
    try:
        from azure_services.persistence.cosmos_db import delete_asset
        
        success = await asyncio.to_thread(delete_asset, asset_id, user_id)
        
        if not success:
            raise HTTPException(status_code=404, detail="Asset not found")
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting asset {asset_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/chat/thread/{thread_id}/messages", tags=["Chat Persistence"])
async def get_thread_messages(
    thread_id: str, 
    user_id: str,
    limit: Optional[int] = Query(None, description="Max messages to return"),
    offset: int = Query(0, description="Number of messages to skip"),
    before: Optional[str] = Query(None, description="Get messages before this ISO timestamp")
):
    """
    Get messages for a thread with pagination support.
    
    Args:
        thread_id: The thread ID
        user_id: The user ID (for partition key)
        limit: Max messages to return (None = all)
        offset: Number of messages to skip
        before: ISO timestamp - get messages older than this (for infinite scroll)
    
    Returns:
        messages: List of messages
        total: Total message count
        hasMore: Whether there are more older messages
    """
    try:
        result = await asyncio.to_thread(
            get_messages_for_thread, 
            thread_id, 
            user_id,
            limit,
            offset,
            before
        )
        return _sign_generated_images(result)
    except Exception as e:
        logger.error(f"Error fetching messages for thread {thread_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/chat/message", tags=["Chat Persistence"])
async def create_new_message(message: ChatMessageModel):
    """Add a new message to a thread."""
    try:
        result = await asyncio.to_thread(
            add_message,
            message_id=message.id,
            thread_id=message.threadId,
            user_id=message.userId,
            role=message.role,
            content=message.content,
            metadata=message.metadata,
            message_group_id=message.messageGroupId,
            retry_number=message.retryNumber or 0
        )
        return {"success": True, "message": result}
    except Exception as e:
        logger.error(f"Error creating message: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/chat/message/{message_id}", tags=["Chat Persistence"])
async def delete_chat_message(message_id: str, user_id: str, thread_id: str):
    """
    Delete a specific message.
    
    Args:
        message_id: The message ID
        user_id: The user ID (for partition key)
        thread_id: The thread ID (for cleanup)
    """
    try:
        success = await asyncio.to_thread(delete_message, message_id, user_id)
        return {"success": success}
    except Exception as e:
        logger.error(f"Error deleting message {message_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ===================== Background Groundedness Evaluation =====================
# NOTE: Groundedness evaluation runs independently on the Dashboard server
# (port 8050) via a periodic background task. No coupling to the Backend's
# sync endpoint — the Dashboard polls Cosmos DB for unevaluated messages.
# See Dashboard/main.py for the periodic evaluator.
# ==============================================================================


@app.post("/api/chat/sync", response_model=SyncResponseModel, tags=["Chat Persistence"])
async def sync_chat_data(request: SyncRequestModel, background_tasks: BackgroundTasks):
    """
    Bulk sync threads and messages from frontend to Cosmos DB.
    
    This endpoint is designed for efficient batch synchronization
    when the frontend needs to persist its local state to the backend.
    
    Args:
        request: Contains userId, threads array, and messages array
    """
    try:
        threads_result = await asyncio.to_thread(
            sync_threads_batch,
            request.threads,
            request.userId
        )
        
        messages_result = await asyncio.to_thread(
            sync_messages_batch,
            request.messages,
            request.userId
        )
        
        return SyncResponseModel(
            success=True,
            threadsUpserted=threads_result.get("upserted", 0),
            messagesUpserted=messages_result.get("upserted", 0)
        )
    except Exception as e:
        logger.error(f"Error syncing chat data for user {request.userId}: {e}")
        return SyncResponseModel(
            success=False,
            error=str(e)
        )


@app.get("/api/chat/load/{user_id}", tags=["Chat Persistence"])
async def load_all_chat_data(user_id: str, agent_id: Optional[str] = None):
    """
    Load all chat data for a user (threads and messages).
    
    This is used when the frontend initializes to hydrate its local state
    from the backend.
    
    Args:
        user_id: The user ID
        agent_id: Optional agent ID to filter threads
    """
    try:
        # Import the optimized batch function
        from azure_services.persistence.cosmos_db import get_recent_messages_for_user
        
        # Get threads and messages in parallel (2 queries instead of N+1)
        threads_task = asyncio.to_thread(list_threads_for_user, user_id, agent_id)
        messages_task = asyncio.to_thread(get_recent_messages_for_user, user_id, 10)
        
        threads, all_messages = await asyncio.gather(threads_task, messages_task)
        
        # Filter messages by agent_id if specified (threads are already filtered)
        if agent_id:
            thread_ids = {t["id"] for t in threads}
            all_messages = [m for m in all_messages if m.get("threadId") in thread_ids]
        
        logger.debug(f"Loaded {len(threads)} threads and {len(all_messages)} messages for user {user_id}")
        
        return {
            "threads": threads,
            # Hydration drops the inline base64, so the blob URL has to be readable.
            "messages": _sign_generated_images({"messages": all_messages})["messages"],
        }
    except Exception as e:
        logger.error(f"Error loading chat data for user {user_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ===================== User Profile (Cosmos DB) =====================

class UserProfileModel(BaseModel):
    """User profile model."""
    fullName: str = ""
    displayName: str = ""
    nickname: str = ""
    email: str = ""
    workFunction: str = ""
    preferences: str = ""
    customInstructions: str = ""
    learningProfile: str = ""  # JSON string with proficiency, goals, skills, instructions
    department: str = ""
    college: str = ""
    authProvider: str = "temp"
    language: str = ""  # Mother tongue / most spoken language other than English
    currentLocation: str = ""
    interests: str = ""
    passionateAbout: str = ""
    onboardingCompleted: bool = False


@app.get("/api/user/{user_id}", tags=["User Profile"])
async def get_user(user_id: str):
    """Get user profile by ID."""
    try:
        profile = await asyncio.to_thread(get_user_profile, user_id)
        if profile:
            return {"success": True, "profile": profile}
        else:
            return {"success": True, "profile": None}
    except Exception as e:
        logger.error(f"Error getting user profile {user_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/user/{user_id}", tags=["User Profile"])
async def update_user(user_id: str, profile: UserProfileModel):
    """Create or update user profile. Uses normalized design - no need to update agents."""
    try:
        # Update the user profile
        # Note: With normalized design, agents store createdById (userId) not username,
        # so we don't need to update agents when the display name changes.
        # The display name is looked up from users_v1 when listing agents.
        updated_profile = await asyncio.to_thread(
            upsert_user_profile,
            user_id,
            profile.fullName,
            profile.displayName,
            profile.nickname,
            profile.email,
            profile.workFunction,
            profile.preferences,
            profile.customInstructions,
            profile.authProvider,
            profile.learningProfile,
            profile.department,
            profile.college,
            language=profile.language,
            current_location=profile.currentLocation,
            interests=profile.interests,
            passionate_about=profile.passionateAbout,
            onboarding_completed=profile.onboardingCompleted,
        )
        
        _invalidate_agent_list_caches(invalidate_teacher_scope=False)
        logger.info(f"Invalidated agents cache after user profile update for {user_id}")
        
        return {"success": True, "profile": updated_profile}
    except Exception as e:
        logger.error(f"Error updating user profile {user_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/user/{user_id}", tags=["User Profile"])
async def delete_user(user_id: str):
    """Delete user profile."""
    try:
        success = await asyncio.to_thread(delete_user_profile, user_id)
        return {"success": success}
    except Exception as e:
        logger.error(f"Error deleting user profile {user_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ===================== Feedback =====================

FEEDBACK_BLOB_CONTAINER = "feedback-attachments-v2"

class FeedbackModel(BaseModel):
    """Feedback submission model."""
    userId: str
    sentiment: Optional[str] = None
    category: str = "General"
    text: str
    userName: Optional[str] = ""
    userEmail: Optional[str] = ""
    imageUrls: Optional[List[str]] = None


@app.post("/api/feedback/upload-image", tags=["Feedback"])
async def upload_feedback_file(file: UploadFile = File(...)):
    """Upload a feedback attachment to Azure Blob Storage."""
    import uuid as _uuid
    try:
        # Read and check size (max 5 MB)
        content = await file.read()
        if len(content) > 5 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="File must be under 5 MB.")

        # Generate unique blob name
        ext = file.filename.rsplit(".", 1)[-1] if "." in (file.filename or "") else "bin"
        blob_name = f"{_uuid.uuid4()}.{ext}"

        # Upload to blob storage
        blob_client = get_blob_service_client().get_blob_client(
            container=FEEDBACK_BLOB_CONTAINER, blob=blob_name
        )
        await asyncio.to_thread(
            blob_client.upload_blob, content, overwrite=True,
            content_settings=ContentSettings(content_type=file.content_type)
        )

        file_url = blob_client.url
        logger.info(f"Feedback file uploaded: {blob_name}")
        return {"success": True, "imageUrl": file_url}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error uploading feedback image: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/feedback", tags=["Feedback"])
async def post_feedback(body: FeedbackModel):
    """Submit user feedback to Cosmos DB."""
    import uuid
    feedback_id = str(uuid.uuid4())
    try:
        item = await asyncio.to_thread(
            submit_feedback,
            feedback_id,
            body.userId,
            body.sentiment,
            body.category,
            body.text,
            body.userName or "",
            body.userEmail or "",
            body.imageUrls,
        )
        return {"success": True, "id": feedback_id}
    except Exception as e:
        logger.error(f"Error submitting feedback: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/feedback", tags=["Feedback"])
async def get_feedback(user_id: Optional[str] = None):
    """List feedback, optionally filtered by user."""
    try:
        items = await asyncio.to_thread(list_feedback, user_id)
        return {"success": True, "feedback": items}
    except Exception as e:
        logger.error(f"Error listing feedback: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ===================== Shutdown Events =====================

@app.on_event("shutdown")
async def shutdown_async_processor():
    """Cleanup async file processor on shutdown."""
    global _async_file_processor
    if _async_file_processor:
        await _async_file_processor.close()
        _async_file_processor = None


# ===================== Additional Agent Endpoints =====================
# These endpoints provide additional functionality not covered by the main endpoints
# All endpoints use AIProjectClient internally


@app.get("/api/agents/check-name", tags=["Agents"])
async def check_agent_name(name: str):
    """
    Check if an agent name already exists.
    
    Returns {"exists": true/false}
    """
    try:
        creator = AgentCreator(
            project_endpoint=PROJECT_ENDPOINT,
            model_deployment=AGENT_MODEL_DEPLOYMENT,
        )
        agents = creator.list_agents()
        
        lower = (name or "").strip().lower()
        exists = any(
            (getattr(a, "name", "") or "").strip().lower() == lower for a in agents
        )
        
        return {"exists": exists}
        
    except Exception as e:
        logger.error(f"Failed to check agent name: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Retry: Full Textbook + Threshold Concept Research Pipeline ──────────────
@app.post("/api/agents/{agent_id}/retry-textbook-research", tags=["Agents"])
async def retry_textbook_research(agent_id: str):
    """
    Re-run the full 2-agent textbook research pipeline (syllabus + threshold concepts).
    Reads textbooks from setup.json. Runs in the background.
    """
    agent_meta = get_agent_metadata(agent_id)
    if not agent_meta:
        raise HTTPException(status_code=404, detail="Agent not found")

    course_name = agent_meta.get("courseName", agent_id)
    course_level = agent_meta.get("courseLevel", "")
    additional_context = agent_meta.get("additionalContext", "")

    # Load textbooks from setup
    setup_data = _load_setup_json(agent_id)
    textbooks: List[Dict[str, Any]] = (setup_data or {}).get("textbooks", [])

    if not textbooks:
        raise HTTPException(
            status_code=400,
            detail="No textbooks found in setup.json. Cannot re-run textbook research.",
        )

    threading.Thread(
        target=_background_textbook_research,
        kwargs=dict(
            agent_id=agent_id,
            agent_name=agent_meta.get("name", agent_id),
            course_name=course_name,
            course_level=course_level,
            textbooks=textbooks,
            additional_context=additional_context,
        ),
        daemon=True,
    ).start()

    return {
        "status": "scheduled",
        "message": f"Full textbook research re-triggered for {agent_id} with {len(textbooks)} textbook(s).",
    }


# ── Retry: Threshold Concept Research Only (uses saved syllabus) ────────────
@app.post("/api/agents/{agent_id}/retry-threshold-research", tags=["Agents"])
async def retry_threshold_research(agent_id: str):
    """
    Re-run ONLY the threshold-concept-research-agent (Agent 2).
    Requires syllabus_research_raw.txt from a prior successful Agent 1 run.
    """
    agent_meta = get_agent_metadata(agent_id)
    if not agent_meta:
        raise HTTPException(status_code=404, detail="Agent not found")

    syllabus_file = _agent_setup_dir(agent_id) / "syllabus_research_raw.txt"
    if not syllabus_file.exists():
        raise HTTPException(
            status_code=400,
            detail="No syllabus found from a prior textbook research run. "
                   "Run the full textbook research first.",
        )

    course_name = agent_meta.get("courseName", agent_id)
    course_level = agent_meta.get("courseLevel", "")

    threading.Thread(
        target=_background_threshold_concept_research,
        kwargs=dict(
            agent_id=agent_id,
            course_name=course_name,
            course_level=course_level,
        ),
        daemon=True,
    ).start()

    return {
        "status": "scheduled",
        "message": f"Threshold concept research re-triggered for {agent_id} using existing syllabus.",
    }


# ── Semantic dedup of threshold concepts for an existing course ─────────────
@app.post("/api/agents/{agent_id}/dedup-threshold-concepts", tags=["Agents"])
async def dedup_threshold_concepts(agent_id: str):
    """
    Run semantic deduplication on an existing course's threshold concepts
    using the TC research agent. Loads the course_curriculum from storage,
    sends all TC names to the LLM for grouping, merges overlapping entries,
    and saves the deduplicated result back.

    Returns the before/after counts and the merge log.
    """
    import re, time as _time

    # 1. Load existing curriculum
    from azure_services.persistence.cosmos_db import get_course_curriculum, save_course_curriculum

    curriculum = get_course_curriculum(agent_id)
    if not curriculum:
        raise HTTPException(status_code=404, detail=f"No course curriculum found for '{agent_id}'")

    tc_names = curriculum.get("all_threshold_concepts", [])
    if len(tc_names) < 2:
        return {
            "status": "skipped",
            "message": f"Only {len(tc_names)} threshold concept(s) — nothing to deduplicate.",
            "before": len(tc_names),
            "after": len(tc_names),
        }

    course_name = curriculum.get("course_name", agent_id)
    course_level = curriculum.get("course_level", "")

    # 2. Build the semantic dedup prompt
    dedup_prompt = (
        f"You are a threshold-concept expert for a {course_level or 'university-level'} "
        f"course on **{course_name}**.\n\n"
        f"Below is a numbered list of threshold concept names generated from different "
        f"module batches. Some may **overlap semantically** — they describe the same "
        f"core insight using different wording, or one concept SUBSUMES another.\n\n"
        + "\n".join(f"{i+1}. {n}" for i, n in enumerate(tc_names))
        + "\n\n"
        f"**YOUR TASK:** Identify groups of concepts that should be MERGED because:\n"
        f"  (a) They are semantically the same or near-identical (different wording, same insight), OR\n"
        f"  (b) One concept is a SUBSET of another — understanding the broader concept means the narrower one is already grasped, OR\n"
        f"  (c) They describe the same threshold crossing at different levels of specificity (e.g., 'context switching as state transfer' and 'preemption, context switching, and parallelism illusion' both cross the same threshold about CPU state management).\n\n"
        f"For each group, pick the BEST canonical name (the most comprehensive one).\n\n"
        f"Return ONLY a JSON object with this schema:\n"
        f'{{"groups": [\n'
        f'  {{"canonical": "<best name>", "members": ["<name1>", "<name2>", ...]}},\n'
        f"  ...\n"
        f"]}}\n\n"
        f"Rules:\n"
        f"- Every concept from the list above MUST appear in exactly one group.\n"
        f"- Concepts that are truly UNIQUE should be a single-member group.\n"
        f"- Merge concepts where a student who deeply understands one would necessarily understand the other.\n"
        f"- Do NOT merge concepts that are merely from the same topic area but cross DIFFERENT thresholds.\n"
        f"- Be aggressive about merging when concepts overlap significantly — err on the side of fewer, richer concepts.\n"
        f"- Return valid JSON only, no markdown fences."
    )

    # 3. Call the TC research agent (streaming)
    from azure.ai.projects import AIProjectClient
    import httpx

    credential = get_sync_credential()
    client = AIProjectClient(endpoint=PROJECT_ENDPOINT, credential=credential)
    openai_client = client.get_openai_client()
    openai_client = openai_client.with_options(
        timeout=httpx.Timeout(1800.0, connect=60.0)
    )

    tc_agent_ref = {
        "agent": {
            "name": THRESHOLD_CONCEPT_RESEARCH_AGENT_NAME,
            "type": "agent_reference",
        }
    }

    dedup_conv = openai_client.conversations.create()
    dedup_stream = openai_client.responses.create(
        conversation=dedup_conv.id,
        input=dedup_prompt,
        extra_body=tc_agent_ref,
        stream=True,
    )
    text_chunks = []
    for event in dedup_stream:
        if hasattr(event, 'type') and event.type == 'response.output_text.delta':
            delta = getattr(event, 'delta', '')
            if delta:
                text_chunks.append(delta)
    dedup_raw = ''.join(text_chunks)

    client.close()

    # 4. Parse the JSON response
    def _extract_json_simple(raw: str) -> dict:
        raw = raw.strip()
        if raw.startswith("```"):
            raw = re.sub(r"^```[a-zA-Z]*\n?", "", raw)
            raw = re.sub(r"\n?```$", "", raw)
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            match = re.search(r"\{[\s\S]*\}", raw)
            if match:
                try:
                    return json.loads(match.group())
                except json.JSONDecodeError:
                    pass
        return {}

    parsed = _extract_json_simple(dedup_raw)
    groups = parsed.get("groups", [])
    if not groups:
        raise HTTPException(
            status_code=500,
            detail="TC agent returned no valid groups. Check standalone_dedup_response.txt for details.",
        )

    # 5. Apply merges to the curriculum
    merge_log = []
    new_names: list = []
    for group in groups:
        if not isinstance(group, dict):
            continue
        canonical = group.get("canonical", "")
        members = group.get("members", [])
        if not canonical or not members:
            continue

        base_detail = None
        for m in members:
            if m in curriculum and isinstance(curriculum[m], dict):
                if base_detail is None:
                    base_detail = curriculum[m]
                else:
                    dup = curriculum[m]
                    base_mods = set(base_detail.get("related_modules", []))
                    dup_mods = set(dup.get("related_modules", []))
                    base_detail["related_modules"] = list(base_mods | dup_mods)
                    for lk in ("misconceptions", "concept_inventory_questions"):
                        base_items = base_detail.get(lk, [])
                        dup_items = dup.get(lk, [])
                        base_set = {
                            (it if isinstance(it, str) else json.dumps(it, sort_keys=True))
                            for it in base_items
                        }
                        for it in dup_items:
                            ik = it if isinstance(it, str) else json.dumps(it, sort_keys=True)
                            if ik not in base_set:
                                base_items.append(it)
                                base_set.add(ik)
                        base_detail[lk] = base_items

        if base_detail is None:
            canonical = members[0] if members else canonical

        for m in members:
            if m in curriculum and m != canonical:
                del curriculum[m]
        if base_detail:
            curriculum[canonical] = base_detail
        new_names.append(canonical)

        if len(members) > 1:
            merge_log.append({"canonical": canonical, "merged": members})

    curriculum["all_threshold_concepts"] = new_names

    # 6. Save back
    if save_course_curriculum(agent_id, curriculum):
        logger.info(
            f"[Dedup TC] Saved deduplicated curriculum for '{agent_id}': "
            f"{len(tc_names)} → {len(new_names)} concepts"
        )
    else:
        raise HTTPException(status_code=500, detail="Failed to save deduplicated curriculum")

    return {
        "status": "completed",
        "agent_id": agent_id,
        "before": len(tc_names),
        "after": len(new_names),
        "merged_count": len(tc_names) - len(new_names),
        "merges": merge_log,
    }


@app.get("/api/agents/{agent_name}/course-curriculum", tags=["Agents"])
async def get_agent_course_curriculum(agent_name: str, status_only: bool = False):
    """
    Get the course curriculum for an agent.
    Returns the structured JSON course curriculum (syllabus, threshold concepts, etc.)
    from blob storage, in-memory cache, or local file fallback.
    If status_only=true, returns only the status without the full curriculum payload.
    """
    try:
        # Try blob storage / cache first
        from azure_services.persistence.cosmos_db import get_course_curriculum as get_cc_from_store
        plan = get_cc_from_store(agent_name)
        if plan:
            # Partial curriculum (syllabus only, threshold concepts still running)
            if plan.get("_status") == "syllabus_ready" or not plan.get("all_threshold_concepts"):
                return {"agent_name": agent_name, "status": "processing",
                        "course_curriculum": None if status_only else plan,
                        "message": "Syllabus ready. Threshold concept analysis is still in progress."}
            return {"agent_name": agent_name, "status": "ready",
                    "course_curriculum": None if status_only else plan}

        # Fallback: local file
        plan_path = _agent_setup_dir(agent_name) / "course_curriculum.json"
        if plan_path.exists():
            with open(plan_path, "r", encoding="utf-8") as f:
                plan = json.load(f)
            if plan.get("_status") == "syllabus_ready" or not plan.get("all_threshold_concepts"):
                return {"agent_name": agent_name, "status": "processing",
                        "course_curriculum": None if status_only else plan,
                        "message": "Syllabus ready. Threshold concept analysis is still in progress."}
            return {"agent_name": agent_name, "status": "ready",
                    "course_curriculum": None if status_only else plan}

        # Check if research is still in progress
        # syllabus_research_raw.txt = Agent 1 done, Agent 2 (threshold concepts) still running
        _agent_dir = _agent_setup_dir(agent_name)
        syllabus_path = _agent_dir / "syllabus_research_raw.txt"
        report_path = _agent_dir / "textbook_research_report.md"
        if syllabus_path.exists() or report_path.exists():
            return {"agent_name": agent_name, "status": "processing", "course_curriculum": None,
                    "message": "Syllabus research complete. Threshold concept analysis is still in progress (this uses deep reasoning and may take 10-15 minutes)."}

        return {"agent_name": agent_name, "status": "not_available", "course_curriculum": None,
                "message": "No course curriculum available. Create the agent with textbooks to generate one."}

    except Exception as e:
        logger.error(f"Failed to get course curriculum for '{agent_name}': {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/agents/{agent_name}/course-curriculum", tags=["Agents"])
async def update_agent_course_curriculum(agent_name: str, body: dict):
    """
    Update (teacher-edit) the course curriculum for an agent.
    Accepts the full curriculum JSON and persists it via save_course_curriculum.
    Also saves a versioned snapshot if commit_message is provided.
    """
    try:
        course_curriculum = body.get("course_curriculum")
        if not course_curriculum or not isinstance(course_curriculum, dict):
            raise HTTPException(status_code=400, detail="Missing or invalid 'course_curriculum' in request body.")

        from azure_services.persistence.cosmos_db import save_course_curriculum, invalidate_course_curriculum_cache, save_course_curriculum_version
        # Remove internal status fields before saving teacher edits
        course_curriculum.pop("_status", None)
        course_curriculum.pop("_error", None)

        success = save_course_curriculum(agent_name, course_curriculum)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to persist curriculum changes.")

        # Save versioned snapshot
        commit_message = body.get("commit_message", "")
        user_id = body.get("user_id", "unknown")
        version_id = None
        if commit_message:
            version_id = save_course_curriculum_version(agent_name, course_curriculum, commit_message, user_id)

        invalidate_course_curriculum_cache(agent_name)
        return {"status": "ok", "message": "Curriculum updated successfully.", "version_id": version_id}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update course curriculum for '{agent_name}': {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/agents/{agent_name}/course-curriculum/versions", tags=["Agents"])
async def list_curriculum_versions(agent_name: str):
    """List all versioned snapshots of the course curriculum."""
    try:
        from azure_services.persistence.cosmos_db import list_course_curriculum_versions, get_course_curriculum, save_course_curriculum_version
        versions = list_course_curriculum_versions(agent_name)
        # If no versions exist but curriculum exists, seed an initial version
        if not versions:
            curriculum = get_course_curriculum(agent_name)
            if curriculum:
                save_course_curriculum_version(agent_name, curriculum, "Initial generation", "system")
                versions = list_course_curriculum_versions(agent_name)
        return {"status": "ok", "versions": versions}
    except Exception as e:
        logger.error(f"Failed to list curriculum versions for '{agent_name}': {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/agents/{agent_name}/course-curriculum/versions/{version_id}", tags=["Agents"])
async def get_curriculum_version(agent_name: str, version_id: str):
    """Retrieve a specific versioned snapshot of the course curriculum."""
    try:
        from azure_services.persistence.cosmos_db import get_course_curriculum_version
        version = get_course_curriculum_version(agent_name, version_id)
        if not version:
            # Fallback: try legacy blob-per-version storage (old timestamp IDs like 20260526T102149Z)
            from azure_services.persistence.cosmos_db import _legacy_get_course_curriculum_version
            version = _legacy_get_course_curriculum_version(agent_name, version_id)
        if not version:
            raise HTTPException(status_code=404, detail="Version not found.")
        return {"status": "ok", "version": version}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get curriculum version '{version_id}' for '{agent_name}': {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/agents/{agent_name}/course-curriculum/diff", tags=["Agents"])
async def diff_curriculum_versions(agent_name: str, old: str, new: str):
    """
    Get curricula at two commits for client-side diffing.
    Query params: ?old=<commit_sha>&new=<commit_sha>
    """
    try:
        from azure_services.persistence.curriculum_git import diff_course_curriculum_versions
        result = diff_course_curriculum_versions(agent_name, old, new)
        if not result:
            raise HTTPException(status_code=404, detail="One or both versions not found.")
        return {"status": "ok", "old": result["old"], "new": result["new"]}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to diff curriculum versions for '{agent_name}': {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/agents/{agent_name}/progress/{user_id}", tags=["Agents"])
async def get_learning_progress(agent_name: str, user_id: str):
    """
    Get a student's learning progress for an agent.
    Returns per-topic status, overall counts, recently active topics, and struggle areas.
    """
    try:
        from azure_services.persistence.cosmos_db import (
            ensure_learning_state, get_learning_state, get_progress_summary,
        )
        # Create the state on first read so the syllabus is visible before any
        # progress tool has ever fired.
        ensure_learning_state(user_id, agent_name)
        summary = get_progress_summary(user_id, agent_name)
        if not summary or summary.get("status") == "no_state":
            return {
                "agent_name": agent_name,
                "user_id": user_id,
                "status": "no_state",
                "message": "No learning state found. Progress tracking begins when the student starts chatting.",
            }
        # get_progress_summary stays compact because the agent reads it; the
        # curriculum panel needs every topic so it can tick the whole syllabus.
        state = get_learning_state(user_id, agent_name) or {}
        return {
            "agent_name": agent_name,
            "user_id": user_id,
            "status": "ok",
            "progress": {
                **summary,
                "topics": state.get("topics", {}),
                "objectives": state.get("objectives", {}),
            },
        }
    except Exception as e:
        logger.error(f"Failed to get learning progress for user={user_id}, agent={agent_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/agents/{agent_name}/reset-progress/{user_id}", tags=["Agents"])
async def reset_learning_progress(agent_name: str, user_id: str):
    """
    Reset a student's learning progress for an agent.
    Deletes the learning state document and invalidates caches.
    """
    try:
        from azure_services.persistence.cosmos_db import delete_learning_state
        delete_learning_state(user_id, agent_name)
        return {
            "agent_name": agent_name,
            "user_id": user_id,
            "status": "reset",
            "message": "Learning progress has been reset. A fresh state will be created on next chat.",
        }
    except Exception as e:
        logger.error(f"Failed to reset learning progress for user={user_id}, agent={agent_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/agents/{agent_name}/details", tags=["Agents"])
async def get_agent_details(agent_name: str):
    """
    Get details of an agent by name.
    
    Returns agent definition including tools, instructions, model, and version info.
    """
    try:
        creator = AgentCreator(
            project_endpoint=PROJECT_ENDPOINT,
            model_deployment=AGENT_MODEL_DEPLOYMENT,
        )
        agents = creator.list_agents()
        
        for agent in agents:
            if agent.name == agent_name:
                versions_info = {}
                if hasattr(agent, 'versions') and agent.versions:
                    if 'latest' in agent.versions:
                        latest = agent.versions['latest']
                        versions_info = {
                            "version": latest.get('version'),
                            "created_at": latest.get('created_at'),
                            "definition": latest.get('definition', {}),
                        }
                
                return {
                    "name": agent.name,
                    "found": True,
                    **versions_info,
                }
        
        raise HTTPException(status_code=404, detail=f"Agent '{agent_name}' not found")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get agent: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/agents/{agent_name}/tools", tags=["Agents"])
async def get_agent_tools(agent_name: str):
    """
    Get the tools configured for an agent.
    """
    try:
        creator = AgentCreator(
            project_endpoint=PROJECT_ENDPOINT,
            model_deployment=AGENT_MODEL_DEPLOYMENT,
        )
        agents = creator.list_agents()
        
        for agent in agents:
            if agent.name == agent_name:
                tools = []
                if hasattr(agent, 'versions') and agent.versions and 'latest' in agent.versions:
                    definition = agent.versions['latest'].get('definition', {})
                    tools = definition.get('tools', [])
                
                return {
                    "agent_name": agent_name,
                    "tools": tools,
                    "tools_count": len(tools),
                }
        
        raise HTTPException(status_code=404, detail=f"Agent '{agent_name}' not found")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get agent tools: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class AgentUpdateRequest(BaseModel):
    """Request body for updating an agent."""
    instructions: Optional[str] = None
    model: Optional[str] = None
    include_web_search: Optional[bool] = None
    include_custom_search: Optional[bool] = None
    search_index_name: Optional[str] = None
    search_index_filter: Optional[str] = None
    search_connection_id: Optional[str] = None


@app.put("/api/agents/{agent_name}", tags=["Agents"])
async def update_agent(agent_name: str, request: AgentUpdateRequest):
    """
    Update an agent by creating a new version.
    
    Agents are immutable - updating creates a new version.
    """
    try:
        creator = AgentCreator(
            project_endpoint=PROJECT_ENDPOINT,
            model_deployment=request.model or AGENT_MODEL_DEPLOYMENT,
        )
        
        # Get current agent to merge settings
        agents = creator.list_agents()
        current_agent = None
        current_instructions = "You are a helpful assistant."
        
        for agent in agents:
            if agent.name == agent_name:
                current_agent = agent
                if hasattr(agent, 'versions') and agent.versions and 'latest' in agent.versions:
                    definition = agent.versions['latest'].get('definition', {})
                    current_instructions = definition.get('instructions', current_instructions)
                break
        
        if not current_agent:
            raise HTTPException(status_code=404, detail=f"Agent '{agent_name}' not found")
        
        # Create new version with updated settings
        new_name, new_version = creator.create_agent(
            name=agent_name,  # Same name = new version
            instructions=request.instructions or current_instructions,
            include_web_search=request.include_web_search if request.include_web_search is not None else False,
            include_custom_search=request.include_custom_search if request.include_custom_search is not None else False,
            search_index_name=request.search_index_name,
            search_index_filter=request.search_index_filter,
            search_connection_id=request.search_connection_id,
            save_to_config=False,
        )
        
        return {
            "success": True,
            "agent_name": new_name,
            "new_version": new_version,
            "message": f"Agent updated to version {new_version}",
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update agent: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


# ===================== Utility Functions =====================

def project_client():
    """
    Get AIProjectClient for API operations.
    
    This is the main client for the new API that supports:
    - Named agents with versions
    - MCP tools with project_connection_id
    - Conversations/responses API
    """
    from azure.ai.projects import AIProjectClient
    return AIProjectClient(endpoint=PROJECT_ENDPOINT, credential=get_sync_credential())


def get_agent_creator_v2():
    """Get a cached AgentCreator instance."""
    return AgentCreator(
        project_endpoint=PROJECT_ENDPOINT,
        model_deployment=AGENT_MODEL_DEPLOYMENT,
    )


# ===================== Conversation Management =====================

@app.get("/api/conversations/{conversation_id}", tags=["Conversations"])
async def get_conversation(conversation_id: str, agent_name: str):
    """
    Get conversation history.
    
    Note: The conversation API may have limited history retrieval capabilities
    compared to the old threads API.
    """
    try:
        ga = get_general_agent(
            project_endpoint=PROJECT_ENDPOINT,
            agent_name=agent_name,
        )
        
        # Try to get conversation info
        return {
            "conversation_id": conversation_id,
            "agent_name": agent_name,
            "message": "Conversation history retrieval is limited",
        }
        
    except Exception as e:
        logger.error(f"Failed to get conversation: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/conversations/{conversation_id}", tags=["Conversations"])
async def delete_conversation(conversation_id: str, agent_name: str):
    """
    Delete a conversation.
    """
    try:
        ga = get_general_agent(
            project_endpoint=PROJECT_ENDPOINT,
            agent_name=agent_name,
        )
        
        # Delete conversation
        ga.openai_client.conversations.delete(conversation_id)
        
        return {"success": True, "message": f"Conversation '{conversation_id}' deleted"}
        
    except Exception as e:
        logger.error(f"Failed to delete conversation: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ===================== Teaching Assistant Creation (with MCP) =====================

class CourseAgentRequest(BaseModel):
    """Request body for creating a teaching assistant with MCP knowledge base."""
    session_uuid: str
    course_name: str
    instructions: Optional[str] = None
    model: Optional[str] = None
    include_web_search: bool = False
    include_custom_search: bool = False


@app.post("/api/agents/create-course", tags=["Agents", "Courses"])
async def create_course_agent(request: CourseAgentRequest):
    """
    Create a teaching assistant with Azure AI Search knowledge access.
    
    This creates:
    1. Ensures common index pipeline exists (shared resources)
    2. An agent with AzureAISearchTool filtered to this session's documents
    
    Prerequisites:
    - Files must already be uploaded to blob storage with session metadata
    - Common indexer will process any new files automatically
    """
    from azure_services.tools.search.course_index_manager import (
        ensure_common_index_pipeline,
        run_common_indexer,
        get_common_index_name,
        get_session_filter,
    )
    
    SEARCH_CONNECTION_ID = os.environ["AZURE_AI_SEARCH_CONNECTION_ID"]
    
    try:
        session_uuid = request.session_uuid
        
        # Ensure common index pipeline and run indexer
        logger.info(f"Ensuring common index pipeline for session: {session_uuid}")
        pipeline_ok, pipeline_result = ensure_common_index_pipeline()
        if not pipeline_ok:
            raise HTTPException(status_code=500, detail=f"Pipeline setup failed: {pipeline_result}")
        
        indexer_ok, indexer_result = run_common_indexer()
        if not indexer_ok:
            logger.warning(f"Indexer may already be running: {indexer_result}")
        
        search_index_name = get_common_index_name()
        search_index_filter = get_session_filter(session_uuid)
        
        # Create agent with AzureAISearchTool
        agent_name = f"course-{request.course_name.replace(' ', '-')[:30]}"
        default_instructions = f"""You are a helpful learning assistant for the course: {request.course_name}.

You have access to a knowledge base containing the course materials. 
Always use the knowledge base tool to search for relevant information before answering questions.
Cite sources when possible and be accurate to the course content."""

        creator = AgentCreator(
            project_endpoint=PROJECT_ENDPOINT,
            model_deployment=request.model or AGENT_MODEL_DEPLOYMENT,
        )
        
        name, version = creator.create_agent(
            name=agent_name,
            instructions=request.instructions or default_instructions,
            include_web_search=request.include_web_search,
            include_custom_search=request.include_custom_search,
            search_index_name=search_index_name,
            search_index_filter=search_index_filter,
            search_connection_id=SEARCH_CONNECTION_ID,
            save_to_config=True,
        )
        
        return {
            "success": True,
            "agent_name": name,
            "agent_version": version,
            "search_index": search_index_name,
            "search_filter": search_index_filter,
            "session_uuid": session_uuid,
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create teaching assistant: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


# ===================== Platform Integration Endpoints =====================

# Named agents used by platform
PLATFORM_AGENTS = {
    "temp-course-agent": "Temporary agent for interactive course creation",
    "course-agent-creation-agent": "Agent that generates instructions for teaching assistants", 
    "course-conversational-agent": "Main conversational agent for courses",
}


@app.get("/api/platform/agents", tags=["Platform"])
async def list_platform_agents():
    """List all platform agents and their status."""
    try:
        creator = AgentCreator(project_endpoint=PROJECT_ENDPOINT)
        all_agents = creator.list_agents()
        
        result = {}
        for name, desc in PLATFORM_AGENTS.items():
            agent_info = all_agents.get(name)
            result[name] = {
                "description": desc,
                "exists": agent_info is not None,
                "version": agent_info.get("version") if agent_info else None,
                "model": agent_info.get("model") if agent_info else None,
            }
        
        return {
            "success": True,
            "agents": result,
        }
    except Exception as e:
        logger.error(f"Failed to list platform agents: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ===================== Course Creation Workflow (Full Integration) =====================


@app.get("/api/courses/{course_id}", tags=["Courses"])
async def get_course(course_id: str):
    """Get course details by ID (session_uuid)."""
    from azure.cosmos.exceptions import CosmosResourceNotFoundError
    try:
        courses_container = get_courses_container()
        course = courses_container.read_item(item=course_id, partition_key=course_id)
        return {"success": True, "course": course}
    except CosmosResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Course not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/courses", tags=["Courses"])
async def list_courses(limit: int = 50):
    """List all courses."""
    try:
        courses_container = get_courses_container()
        query = "SELECT * FROM c ORDER BY c.created_at DESC"
        courses = list(
            courses_container.query_items(
                query=query,
                max_item_count=limit,
                enable_cross_partition_query=True,
            )
        )
        return {"success": True, "courses": courses, "count": len(courses)}
    except Exception as e:
        logger.exception("Failed to list courses")
        raise HTTPException(status_code=500, detail="Could not list courses")
