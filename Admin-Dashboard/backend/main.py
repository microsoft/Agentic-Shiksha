"""
Ekalaiva Dashboard Server
─────────────────────────
Separate FastAPI server (port 8050) providing instructor/admin
analytics over student learning progress stored in Cosmos DB.
"""

from dotenv import load_dotenv
load_dotenv()

import os
import json
import logging
import asyncio
from typing import Optional, Dict, Any, List
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Body, BackgroundTasks, Request
from datetime import datetime
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, Field

import cosmos_queries as cq
import research_storage as rs
from research_json import parse_research_json

# ── Logging ─────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("dashboard")

# Suppress verbose Azure SDK logs
logging.getLogger("azure").setLevel(logging.WARNING)

# ── Config ──────────────────────────────────────────────────────────
EVAL_ENABLED = os.getenv("EVAL_ENABLED", "false").lower() in ("true", "1", "yes")
EVAL_INTERVAL_SECONDS = int(os.getenv("EVAL_INTERVAL_SECONDS", "5"))
EVAL_LOOKBACK_HOURS = int(os.getenv("EVAL_LOOKBACK_HOURS", "24"))
EVAL_BATCH_LIMIT = int(os.getenv("EVAL_BATCH_LIMIT", "50"))

# ── Research Config ─────────────────────────────────────────────────
PROJECT_ENDPOINT = os.environ["PROJECT_ENDPOINT"]
# The only storage account this service will proxy blobs from.
STORAGE_ACCOUNT_NAME = os.environ["STORAGE_ACCOUNT_NAME"]
INSTITUTE_RESEARCH_AGENT_NAME = os.getenv(
    "INSTITUTE_RESEARCH_AGENT_NAME", "institute-research-agent"
)


def _get_research_credential():
    """Use shared auth in the monorepo and a patient CLI fallback standalone."""
    try:
        from common_azure_auth import get_sync_credential

        return get_sync_credential()
    except ImportError:
        from azure.identity import DefaultAzureCredential

        return DefaultAzureCredential(
            process_timeout=int(os.getenv("AZURE_CLI_TIMEOUT", "60"))
        )


# ════════════════════════════════════════════════════════════════════
# Periodic Groundedness Evaluator (runs independently of Backend)
# ════════════════════════════════════════════════════════════════════

# In-memory cache: agentId → sessionUuid (populated from Cosmos agents_v1)
_agent_session_cache: Dict[str, Optional[str]] = {}


def _resolve_session_uuid(agent_id: str) -> Optional[str]:
    """Resolve agentId → sessionUuid from Cosmos agents_v1 (cached)."""
    if agent_id in _agent_session_cache:
        return _agent_session_cache[agent_id]
    session_uuid = cq.get_agent_session_uuid(agent_id)
    _agent_session_cache[agent_id] = session_uuid
    return session_uuid


# Thread cache: threadId → {agentId, userId}  (avoids re-reading threads)
_thread_cache: Dict[str, Dict[str, str]] = {}


async def _periodic_groundedness_evaluator():
    """
    Runs in an infinite loop: every EVAL_INTERVAL_SECONDS, discover
    unevaluated assistant messages from Cosmos DB and run RAG evaluation.

    Fully independent of the Backend server — reads directly from Cosmos.
    """
    from groundedness_evaluator import evaluate_and_store_groundedness

    logger.info(
        f"[Periodic-Eval] Started — interval={EVAL_INTERVAL_SECONDS}s, "
        f"lookback={EVAL_LOOKBACK_HOURS}h, batch_limit={EVAL_BATCH_LIMIT}"
    )

    while True:
        try:
            await asyncio.sleep(EVAL_INTERVAL_SECONDS)
            logger.info("[Periodic-Eval] Checking for unevaluated messages...")

            # 1. Get recent assistant messages (cross-partition)
            recent = await asyncio.to_thread(
                cq.get_recent_assistant_messages,
                limit=EVAL_BATCH_LIMIT * 2,  # fetch extra since some may be evaluated
                since_hours=EVAL_LOOKBACK_HOURS,
            )
            if not recent:
                logger.info("[Periodic-Eval] No recent assistant messages found")
                continue

            # 2. Get already-evaluated messageGroupIds
            evaluated_ids = await asyncio.to_thread(cq.get_evaluated_message_group_ids)

            # 3. Filter to unevaluated only (deduplicate by messageGroupId)
            seen: set = set()
            candidates: list = []
            for msg in recent:
                mgid = msg.get("messageGroupId")
                if not mgid or mgid in seen or mgid in evaluated_ids:
                    continue
                seen.add(mgid)
                candidates.append(msg)

            if not candidates:
                logger.info("[Periodic-Eval] All recent messages already evaluated")
                continue

            # Limit to batch size
            candidates = candidates[:EVAL_BATCH_LIMIT]
            logger.info(f"[Periodic-Eval] Found {len(candidates)} unevaluated messages")

            evaluated = 0
            skipped = 0
            errors = 0

            for msg in candidates:
                mgid = msg["messageGroupId"]
                tid = msg.get("threadId", "")
                uid = msg.get("userId", "")

                # Resolve threadId → agentId
                agent_id = ""
                if tid in _thread_cache:
                    agent_id = _thread_cache[tid].get("agentId", "")
                else:
                    try:
                        thread_doc = await asyncio.to_thread(cq.get_thread, tid, uid)
                        if thread_doc:
                            agent_id = thread_doc.get("agentId", "")
                            _thread_cache[tid] = {
                                "agentId": agent_id,
                                "userId": uid,
                            }
                    except Exception:
                        pass

                # Resolve agentId → sessionUuid (optional — search works without it)
                session_uuid = _resolve_session_uuid(agent_id) if agent_id else None
                if not session_uuid:
                    logger.debug(
                        f"[Periodic-Eval] No sessionUuid for agent={agent_id}, "
                        f"will search without filter for mgid={mgid}"
                    )

                # Run evaluation
                try:
                    result = await asyncio.to_thread(
                        evaluate_and_store_groundedness,
                        message_group_id=mgid,
                        session_id=session_uuid,
                        thread_id=tid,
                        user_id=uid,
                        method="llm",
                    )
                    if result:
                        evaluated += 1
                    else:
                        skipped += 1
                except Exception as e:
                    logger.error(f"[Periodic-Eval] Failed for mgid={mgid}: {e}")
                    errors += 1

            logger.info(
                f"[Periodic-Eval] Cycle done: evaluated={evaluated}, "
                f"skipped={skipped}, errors={errors}"
            )

        except asyncio.CancelledError:
            logger.info("[Periodic-Eval] Shutting down")
            break
        except Exception as e:
            logger.error(f"[Periodic-Eval] Unexpected error: {e}", exc_info=True)
            await asyncio.sleep(30)  # Back off on unexpected errors


# ── Lifespan ────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start periodic evaluator on app startup, cancel on shutdown."""
    eval_task = None
    if EVAL_ENABLED:
        eval_task = asyncio.create_task(_periodic_groundedness_evaluator())
        logger.info("[Lifespan] Periodic groundedness evaluator started")
    else:
        logger.info("[Lifespan] Periodic groundedness evaluator DISABLED (set EVAL_ENABLED=true to enable)")
    yield
    if eval_task:
        eval_task.cancel()
        try:
            await eval_task
        except asyncio.CancelledError:
            pass
        logger.info("[Lifespan] Periodic groundedness evaluator stopped")


# ── App ─────────────────────────────────────────────────────────────
app = FastAPI(
    title="Ekalaiva Dashboard",
    description="Instructor / Admin analytics server for student learning progress",
    version="0.1.0",
    docs_url="/api/dashboard/docs",
    openapi_url="/api/dashboard/openapi.json",
    lifespan=lifespan,
)

# CORS – allow the Vite dev server + production frontend origins
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:5173,http://localhost:5174,http://localhost:3000,http://localhost:8000",
    ).split(",")
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ════════════════════════════════════════════════════════════════════
# Health
# ════════════════════════════════════════════════════════════════════

@app.get("/api/dashboard/health", tags=["Health"])
def health():
    return {"status": "ok", "service": "ekalaiva-dashboard"}


# ════════════════════════════════════════════════════════════════════
# Image generation quota
# ════════════════════════════════════════════════════════════════════

class ImageQuotaUpdate(BaseModel):
    """Weekly per-student image allowance."""
    medium: Optional[int] = Field(default=None, ge=0, le=1000)
    low: Optional[int] = Field(default=None, ge=0, le=1000)


# Measured on gpt-image-2 at 1536x1024, priced with the published gpt-image-1
# rates since gpt-image-2 has none. Used to show admins the cost of a change.
_IMAGE_COST_USD = {"medium": 0.0551, "low": 0.0065}


def _quota_payload(limits: Dict[str, int]) -> Dict[str, Any]:
    weekly = sum(_IMAGE_COST_USD[q] * limits.get(q, 0) for q in _IMAGE_COST_USD)
    return {
        "limits": limits,
        "costPerImageUsd": _IMAGE_COST_USD,
        "estimatedWeeklyUsdPerStudent": round(weekly, 4),
        "estimatedMonthlyUsdPerStudent": round(weekly * 4.3, 2),
    }


@app.get("/api/dashboard/image-quota", tags=["Image Quota"])
def get_image_quota():
    """Current weekly image quota applied to every student, per course."""
    try:
        return _quota_payload(cq.get_image_quota_config())
    except Exception as e:
        logger.error(f"Failed to read image quota: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/dashboard/image-quota", tags=["Image Quota"])
def update_image_quota(body: ImageQuotaUpdate):
    """Set the weekly image quota. Applies to every student on every course."""
    supplied = {k: v for k, v in body.model_dump().items() if v is not None}
    if not supplied:
        raise HTTPException(status_code=400, detail="Provide at least one of: medium, low")
    try:
        limits = cq.set_image_quota_config(supplied)
        logger.info(f"Image quota updated to {limits}")
        return _quota_payload(limits)
    except Exception as e:
        logger.error(f"Failed to update image quota: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ════════════════════════════════════════════════════════════════════
# Agents
# ════════════════════════════════════════════════════════════════════

@app.get("/api/dashboard/agents", tags=["Agents"])
def list_agents():
    """List all agents (courses) with basic metadata."""
    try:
        agents = cq.list_agents()
        return {"agents": agents, "count": len(agents)}
    except Exception as e:
        logger.error(f"Failed to list agents: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ════════════════════════════════════════════════════════════════════
# Feedback
# ════════════════════════════════════════════════════════════════════

@app.get("/api/dashboard/feedback", tags=["Feedback"])
def get_feedback(limit: int = Query(200, ge=1, le=1000)):
    """List all user feedback, newest first."""
    try:
        items = cq.list_feedback(limit=limit)
        stats = cq.get_feedback_stats()
        return {"feedback": items, "count": len(items), "stats": stats}
    except Exception as e:
        logger.error(f"Failed to list feedback: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/dashboard/blob/proxy", tags=["Feedback"])
def proxy_blob(url: str = Query(...)):
    """Proxy a blob from Azure Storage (for feedback attachments)."""
    from urllib.parse import urlparse
    from azure.storage.blob import BlobServiceClient
    from azure.identity import DefaultAzureCredential

    parsed = urlparse(url)
    # Our own account only. Any *.blob.core.windows.net host would otherwise do, and the
    # request carries this service's Entra token — pointing it at an attacker-owned
    # storage account would hand them that token.
    if parsed.scheme != "https" or parsed.hostname != f"{STORAGE_ACCOUNT_NAME}.blob.core.windows.net":
        raise HTTPException(status_code=400, detail="Invalid blob storage URL")
    path_parts = parsed.path.lstrip("/").split("/", 1)
    if len(path_parts) < 2:
        raise HTTPException(status_code=400, detail="Invalid blob path")

    account_url = f"https://{parsed.hostname}"
    container_name, blob_name = path_parts[0], path_parts[1]
    # This route exists to serve feedback attachments; it is not a general blob reader.
    if not container_name.startswith("feedback-attachments") or ".." in blob_name.split("/"):
        raise HTTPException(status_code=400, detail="Invalid blob path")

    try:
        blob_service = BlobServiceClient(account_url=account_url, credential=DefaultAzureCredential())
        blob_client = blob_service.get_blob_client(container=container_name, blob=blob_name)
        download = blob_client.download_blob()
        content = download.readall()
        props = blob_client.get_blob_properties()
        content_type = props.content_settings.content_type or "application/octet-stream"
        return StreamingResponse(
            iter([content]),
            media_type=content_type,
            headers={"Cache-Control": "public, max-age=86400", "Content-Length": str(len(content))},
        )
    except Exception as e:
        logger.error(f"Blob proxy error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/dashboard/agents/{agent_id}/transfer-ownership", tags=["Agents"])
def transfer_ownership(agent_id: str, payload: Dict[str, Any] = Body(...)):
    """
    Transfer agent ownership to another user.

    Request body:
        new_owner_id: The userId of the new owner
    """
    new_owner_id = (payload.get("new_owner_id") or "").strip()
    if not new_owner_id:
        raise HTTPException(status_code=400, detail="new_owner_id is required")

    # Verify new owner exists — check C2 (active users) first, then C1 (invited)
    profile = cq.get_user_profile(new_owner_id)
    if not profile:
        profile = cq.get_invite_by_id(new_owner_id)
    if not profile:
        raise HTTPException(status_code=404, detail="New owner user not found")

    updated = cq.transfer_agent_ownership(agent_id, new_owner_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Agent not found")

    return {
        "status": "ok",
        "agent_id": agent_id,
        "new_owner_id": new_owner_id,
        "new_owner_name": profile.get("displayName") or profile.get("fullName") or profile.get("name", ""),
    }


@app.get("/api/dashboard/agents/{agent_id}/teachers", tags=["Agents"])
def get_agent_teachers(agent_id: str):
    """Return the teachers currently assigned to a course."""
    agent = cq.get_agent_metadata(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    teachers = []
    for tid in agent.get("teacherIds") or []:
        profile = cq.get_user_profile(tid) or cq.get_invite_by_id(tid) or {}
        teachers.append({
            "user_id": tid,
            "name": profile.get("displayName") or profile.get("fullName") or profile.get("name", ""),
            "email": profile.get("email", ""),
            "is_owner": tid == agent.get("createdById"),
        })

    return {"agent_id": agent_id, "owner_id": agent.get("createdById", ""), "teachers": teachers}


@app.post("/api/dashboard/agents/{agent_id}/teachers", tags=["Agents"])
def set_agent_teachers(agent_id: str, payload: Dict[str, Any] = Body(...)):
    """
    Replace the teachers assigned to a course.

    Request body:
        teacher_ids: List of userIds to assign as teachers
    """
    raw_ids = payload.get("teacher_ids")
    if not isinstance(raw_ids, list):
        raise HTTPException(status_code=400, detail="teacher_ids must be a list")

    teacher_ids = [str(tid).strip() for tid in raw_ids if str(tid or "").strip()]
    for tid in teacher_ids:
        if not (cq.get_user_profile(tid) or cq.get_invite_by_id(tid)):
            raise HTTPException(status_code=404, detail=f"User not found: {tid}")

    updated = cq.set_agent_teachers(agent_id, teacher_ids)
    if not updated:
        raise HTTPException(status_code=404, detail="Agent not found")

    return {"status": "ok", "agent_id": agent_id, "teacher_ids": updated.get("teacherIds", [])}


# ════════════════════════════════════════════════════════════════════
# Courses Overview (all-courses analytics table)
# ════════════════════════════════════════════════════════════════════

@app.get("/api/dashboard/overview/courses", tags=["Overview"])
def courses_overview():
    """
    Returns per-course analytics: name, institute, department, professors,
    active/total users.
    """
    try:
        courses, unique_total_users = cq.courses_overview()
        return {"courses": courses, "uniqueTotalUsers": unique_total_users}
    except Exception as e:
        logger.error(f"Failed to get courses overview: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/dashboard/overview/tokens", tags=["Overview"])
def token_usage_overview():
    """
    Returns per-agent token + round stats from Azure AI Foundry.
    Cached for 10 minutes.
    """
    try:
        import token_stats
        return {"tokens": token_stats.get_token_stats()}
    except Exception as e:
        logger.error(f"Failed to get token stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/dashboard/overview/tokens/per-student", tags=["Overview"])
def token_usage_per_student(agent_id: Optional[str] = Query(None)):
    """
    Returns per-student token usage, optionally filtered by agent_id (course).
    Each entry: { userId, displayName, email, totalTokens, rounds }.
    """
    try:
        return {"students": cq.per_student_token_usage(agent_id=agent_id)}
    except Exception as e:
        logger.error(f"Failed to get per-student token usage: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/dashboard/overview/today", tags=["Overview"])
def today_overview(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
):
    """
    Returns usage stats for a date range (defaults to today).
    """
    try:
        return cq.today_stats(start_date=start_date, end_date=end_date)
    except Exception as e:
        logger.error(f"Failed to get period stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ════════════════════════════════════════════════════════════════════
# Per-Agent Overview (aggregate across students)
# ════════════════════════════════════════════════════════════════════

@app.get("/api/dashboard/agents/{agent_name}/overview", tags=["Progress"])
def agent_overview(agent_name: str):
    """
    Aggregate learning-progress stats for an agent:
    student count, avg completion %, distribution buckets, top struggle topics,
    per-student summaries, and real usage stats (active students/teachers).
    """
    try:
        overview = cq.agent_overview(agent_name)
        usage = cq.agent_usage_stats(agent_name)
        overview["usage"] = usage
        return overview
    except Exception as e:
        logger.error(f"Failed to get overview for agent '{agent_name}': {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ════════════════════════════════════════════════════════════════════
# Single student detail
# ════════════════════════════════════════════════════════════════════

@app.get("/api/dashboard/agents/{agent_name}/students/{user_id}", tags=["Progress"])
def student_detail(agent_name: str, user_id: str):
    """
    Full per-topic breakdown for a single student on an agent.
    """
    try:
        detail = cq.student_detail(user_id, agent_name)
        if detail is None:
            raise HTTPException(
                status_code=404,
                detail=f"No learning state found for user '{user_id}' on agent '{agent_name}'",
            )
        return detail
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get detail for user '{user_id}' on agent '{agent_name}': {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ════════════════════════════════════════════════════════════════════
# Groundedness / RAG Evaluation
# ════════════════════════════════════════════════════════════════════

class GroundednessRequest(BaseModel):
    query: str
    response: str
    session_uuid: Optional[str] = None
    context: Optional[str] = None
    method: Optional[str] = "auto"  # "sdk", "llm", or "auto"


@app.post("/api/dashboard/evaluation/groundedness", tags=["Evaluation"])
async def evaluate_groundedness_endpoint(request: GroundednessRequest):
    """
    Evaluate groundedness of an agent response against knowledge base content.

    Checks whether the agent's response is factually supported by the retrieved
    course materials. Uses Azure AI Evaluation SDK (if installed) or falls back
    to an LLM-as-judge approach.
    """
    from groundedness_evaluator import evaluate_groundedness

    try:
        result = await asyncio.to_thread(
            evaluate_groundedness,
            query=request.query,
            response=request.response,
            session_uuid=request.session_uuid,
            context=request.context,
            method=request.method or "auto",
        )
        return {"ok": True, **result}
    except Exception as e:
        logger.error(f"Groundedness evaluation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/dashboard/evaluation/groundedness/batch", tags=["Evaluation"])
async def evaluate_groundedness_batch(payload: Dict[str, Any] = Body(...)):
    """
    Batch groundedness evaluation for multiple query-response pairs.

    Request body:
        items: List of {query, response, session_uuid?, context?}
        method: "sdk", "llm", or "auto" (default: "auto")
    """
    from groundedness_evaluator import evaluate_groundedness

    items = payload.get("items", [])
    method = payload.get("method", "auto")

    if not items:
        raise HTTPException(status_code=400, detail="items list is required")

    results = []
    scores = []

    for i, item in enumerate(items):
        try:
            result = await asyncio.to_thread(
                evaluate_groundedness,
                query=item.get("query", ""),
                response=item.get("response", ""),
                session_uuid=item.get("session_uuid"),
                context=item.get("context"),
                method=method,
            )
            score = result.get("groundedness_score")
            if score is not None:
                scores.append(float(score))
            results.append({"index": i, "ok": True, **result})
        except Exception as e:
            results.append({"index": i, "ok": False, "error": str(e)})

    avg_score = sum(scores) / len(scores) if scores else None

    return {
        "ok": True,
        "results": results,
        "summary": {
            "total": len(items),
            "evaluated": len(scores),
            "average_groundedness": round(avg_score, 2) if avg_score is not None else None,
        },
    }


class RAGEvalRequest(BaseModel):
    query: str
    response: str
    session_uuid: Optional[str] = None
    context: Optional[str] = None


@app.post("/api/dashboard/evaluation/rag", tags=["Evaluation"])
async def evaluate_rag_endpoint(request: RAGEvalRequest):
    """
    Evaluate all three RAG metrics for a query-response pair:
      - Faithfulness (groundedness)
      - Answer Relevancy
      - Context Precision
    """
    from groundedness_evaluator import (
        evaluate_rag_metrics,
        _retrieve_context_from_search,
    )

    context = request.context
    if not context and request.session_uuid:
        context = await asyncio.to_thread(
            _retrieve_context_from_search, request.query, request.session_uuid
        )
    if not context:
        raise HTTPException(
            status_code=400,
            detail="No context available. Provide session_uuid or context.",
        )

    try:
        result = await asyncio.to_thread(
            evaluate_rag_metrics,
            query=request.query,
            response=request.response,
            context=context,
        )
        return {"ok": True, **result}
    except Exception as e:
        logger.error(f"RAG evaluation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/dashboard/evaluation/groundedness/{message_group_id}", tags=["Evaluation"])
async def get_groundedness_result(message_group_id: str, session_id: str):
    """
    Retrieve a stored groundedness evaluation for a specific messageGroupId.
    """
    result = await asyncio.to_thread(
        cq.get_groundedness_evaluation, message_group_id, session_id
    )
    if result:
        return {"ok": True, "evaluation": result}
    raise HTTPException(status_code=404, detail="No groundedness evaluation found for this messageGroupId")


@app.get("/api/dashboard/evaluation/groundedness/session/{session_id}", tags=["Evaluation"])
async def get_session_groundedness(session_id: str):
    """
    Get all groundedness evaluations for a session (agent).
    """
    evals = await asyncio.to_thread(
        cq.get_groundedness_evaluations_for_session, session_id
    )

    def _avg(field):
        vals = [e.get(field) for e in evals if e.get(field) is not None]
        return round(sum(vals) / len(vals), 2) if vals else None

    return {
        "ok": True,
        "evaluations": evals,
        "summary": {
            "total": len(evals),
            "avgFaithfulness": _avg("groundednessScore"),
            "avgAnswerRelevancy": _avg("answerRelevancyScore"),
            "avgContextPrecision": _avg("contextPrecisionScore"),
            "avgOverall": _avg("overallScore"),
            "maxScore": 5,
        },
    }


@app.get("/api/dashboard/evaluation/groundedness/thread/{thread_id}", tags=["Evaluation"])
async def get_thread_groundedness(thread_id: str, session_id: str):
    """
    Get all groundedness evaluations for a specific chat thread.
    """
    evals = await asyncio.to_thread(
        cq.get_groundedness_evaluations_for_thread, thread_id, session_id
    )

    def _avg(field):
        vals = [e.get(field) for e in evals if e.get(field) is not None]
        return round(sum(vals) / len(vals), 2) if vals else None

    return {
        "ok": True,
        "evaluations": evals,
        "summary": {
            "total": len(evals),
            "avgFaithfulness": _avg("groundednessScore"),
            "avgAnswerRelevancy": _avg("answerRelevancyScore"),
            "avgContextPrecision": _avg("contextPrecisionScore"),
            "avgOverall": _avg("overallScore"),
            "maxScore": 5,
        },
    }


@app.get("/api/dashboard/evaluation/groundedness/all", tags=["Evaluation"])
async def get_all_groundedness(limit: int = Query(200, ge=1, le=1000)):
    """
    Get all groundedness evaluations across all sessions.
    Returns evaluations and aggregate summary stats.
    """
    evals = await asyncio.to_thread(cq.get_all_groundedness_evaluations, limit)

    def _avg(field):
        vals = [e.get(field) for e in evals if e.get(field) is not None]
        return round(sum(vals) / len(vals), 2) if vals else None

    def _distribution(field):
        """Count evaluations in score buckets: 1-2 (low), 2-3 (mid), 3-4 (good), 4-5 (high)."""
        buckets = {"1-2": 0, "2-3": 0, "3-4": 0, "4-5": 0}
        for e in evals:
            v = e.get(field)
            if v is None:
                continue
            if v < 2:
                buckets["1-2"] += 1
            elif v < 3:
                buckets["2-3"] += 1
            elif v < 4:
                buckets["3-4"] += 1
            else:
                buckets["4-5"] += 1
        return buckets

    return {
        "ok": True,
        "evaluations": evals,
        "summary": {
            "total": len(evals),
            "avgFaithfulness": _avg("groundednessScore"),
            "avgAnswerRelevancy": _avg("answerRelevancyScore"),
            "avgContextPrecision": _avg("contextPrecisionScore"),
            "avgOverall": _avg("overallScore"),
            "maxScore": 5,
            "distribution": _distribution("overallScore"),
        },
    }


@app.post("/api/dashboard/evaluation/groundedness/trigger", tags=["Evaluation"])
async def trigger_groundedness_evaluation(payload: Dict[str, Any] = Body(...)):
    """
    Manually trigger groundedness evaluation for a specific messageGroupId.

    Request body:
        messageGroupId: The message group to evaluate
        sessionId: The session UUID
        threadId: The chat thread ID
        userId: The user ID
        method: Optional evaluation method (default: "llm")
    """
    mgid = payload.get("messageGroupId")
    session_id = payload.get("sessionId")
    thread_id = payload.get("threadId")
    user_id = payload.get("userId")
    method = payload.get("method", "llm")

    if not all([mgid, session_id, thread_id, user_id]):
        raise HTTPException(
            status_code=400,
            detail="messageGroupId, sessionId, threadId, and userId are all required"
        )

    from groundedness_evaluator import evaluate_and_store_groundedness

    try:
        result = await asyncio.to_thread(
            evaluate_and_store_groundedness,
            message_group_id=mgid,
            session_id=session_id,
            thread_id=thread_id,
            user_id=user_id,
            method=method,
        )
        if result:
            return {"ok": True, "evaluation": result}
        raise HTTPException(
            status_code=422,
            detail="Evaluation could not be completed (missing messages or context)"
        )
    except Exception as e:
        logger.error(f"Manual groundedness trigger error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ════════════════════════════════════════════════════════════════════
# Logging-Agent Chat (SSE streaming)
# ════════════════════════════════════════════════════════════════════

@app.options("/api/dashboard/logging-agent/chat/stream", tags=["Chat"])
def logging_agent_chat_options():
    return {}


@app.post("/api/dashboard/logging-agent/chat/stream", tags=["Chat"])
def logging_agent_chat_stream(payload: Dict[str, Any] = Body(...)):
    """
    Stream a conversation with the logging-agent via SSE.

    Request body:
        text: The user's message (required)
        conversation_id: Optional existing conversation ID for continuation
    """
    import logging_agent_chat as lac

    text = payload.get("text", "")
    conversation_id = payload.get("thread_id") or payload.get("conversation_id")

    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    logger.info(
        f"[Logging Chat] text_len={len(text)}, conv_id={conversation_id}"
    )

    def generate_sse():
        try:
            for event_type, data, conv_id in lac.chat_stream(text, conversation_id):
                if event_type == "thread_id":
                    yield f"data: {json.dumps({'type': 'thread_id', 'thread_id': data, 'conversation_id': data})}\n\n"
                elif event_type == "delta":
                    yield f"data: {json.dumps({'type': 'delta', 'content': data, 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
                elif event_type == "message_block_start":
                    yield f"data: {json.dumps({'type': 'message_block_start', 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
                elif event_type == "message_block_delta":
                    try:
                        dd = json.loads(data)
                        yield f"data: {json.dumps({'type': 'message_block_delta', 'delta': dd.get('delta', ''), 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
                    except json.JSONDecodeError:
                        pass
                elif event_type == "message_block":
                    try:
                        md = json.loads(data)
                        yield f"data: {json.dumps({'type': 'message_block', 'content': md.get('content', ''), 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
                    except json.JSONDecodeError:
                        pass
                elif event_type == "done":
                    yield f"data: {json.dumps({'type': 'done', 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
                elif event_type == "error":
                    yield f"data: {json.dumps({'type': 'error', 'error': data, 'thread_id': conv_id, 'conversation_id': conv_id})}\n\n"
        except Exception as e:
            logger.error(f"SSE stream error: {e}")
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"

    return StreamingResponse(
        generate_sse(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ════════════════════════════════════════════════════════════════════
# Institute / Department Deep Research
# ════════════════════════════════════════════════════════════════════

class InstituteResearchRequest(BaseModel):
    name: str
    instructions: Optional[str] = None

class DepartmentResearchRequest(BaseModel):
    institute: str
    department: str
    instructions: Optional[str] = None


# ════════════════════════════════════════════════════════════════════
# User Directory Endpoints (admin panel)
# ════════════════════════════════════════════════════════════════════

class InviteUserRequest(BaseModel):
    email: str
    name: str = ""
    role: str = "student"
    institute: str = ""
    department: str = ""

class UpdateUserRequest(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    institute: Optional[str] = None
    department: Optional[str] = None

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

class SwitchAffiliationRequest(BaseModel):
    index: int


@app.get("/api/directory", tags=["Directory"])
def api_list_directory(role: Optional[str] = None, status: Optional[str] = None):
    """List all users in the directory (invited + active). No auth required (Dashboard admin tool)."""
    users = cq.list_directory_users(role=role, status=status)
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


@app.post("/api/directory", tags=["Directory"])
def api_invite_user(body: InviteUserRequest):
    """Invite (allowlist) a new user."""
    doc, is_new_user, affiliation_added = cq.invite_user(
        email=body.email, name=body.name, role=body.role,
        institute=body.institute, department=body.department,
    )
    from starlette.responses import JSONResponse
    result = {
        "id": doc.get("id", ""), "userId": doc.get("userId", ""),
        "name": doc.get("displayName") or doc.get("fullName", ""),
        "email": doc.get("email", ""), "role": doc.get("role", "student"),
        "status": doc.get("status", "invited"), "institute": doc.get("institute", ""),
        "department": doc.get("department", ""), "affiliations": doc.get("affiliations", []),
        "affiliationAdded": affiliation_added,
        "alreadyExists": not is_new_user and not affiliation_added,
    }
    return JSONResponse(content=result, status_code=201 if is_new_user else 200)


@app.patch("/api/directory/{user_id}", tags=["Directory"])
def api_update_directory_user(user_id: str, body: UpdateUserRequest):
    """Edit an existing user in the directory."""
    target = cq.get_user_profile(user_id)
    target_in_c1 = False
    if not target:
        try:
            hits = list(cq._invited().query_items(
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

    if target_in_c1:
        if body.name is not None: target["name"] = body.name
        if body.role is not None: target["role"] = body.role
        if body.institute is not None: target["institute"] = body.institute
        if body.department is not None: target["department"] = body.department
        # Keep affiliations in sync with top-level fields
        affs = target.get("affiliations", [])
        active_idx = target.get("activeAffiliation", 0)
        if affs and 0 <= active_idx < len(affs):
            if body.institute is not None: affs[active_idx]["institute"] = body.institute
            if body.department is not None: affs[active_idx]["department"] = body.department
            if body.role is not None: affs[active_idx]["role"] = body.role
            target["affiliations"] = affs
        target["updatedAt"] = datetime.utcnow().isoformat() + "Z"
        cq._invited().upsert_item(body=target)
        updated = target
        updated.setdefault("fullName", target.get("name", ""))
        updated.setdefault("displayName", target.get("name", ""))
    else:
        kwargs: dict = {}
        if body.name is not None:
            kwargs["fullName"] = body.name
            kwargs["displayName"] = body.name
        if body.role is not None:
            kwargs["role"] = body.role
        if body.institute is not None:
            kwargs["institute"] = body.institute
        if body.department is not None:
            kwargs["department"] = body.department
        updated = cq.upsert_user_profile(user_id, **kwargs)
        # Sync affiliations for C2 users too
        affs = updated.get("affiliations", [])
        active_idx = updated.get("activeAffiliation", 0)
        if affs and 0 <= active_idx < len(affs):
            changed = False
            if body.institute is not None:
                affs[active_idx]["institute"] = body.institute
                changed = True
            if body.department is not None:
                affs[active_idx]["department"] = body.department
                changed = True
            if body.role is not None:
                affs[active_idx]["role"] = body.role
                changed = True
            if changed:
                updated["affiliations"] = affs
                cq._users().upsert_item(body=updated)
    return {
        "id": updated.get("id", ""), "userId": updated.get("userId", ""),
        "name": updated.get("displayName") or updated.get("fullName", ""),
        "email": updated.get("email", ""), "role": updated.get("role", "student"),
        "status": updated.get("status", "active"),
        "institute": updated.get("institute", ""), "department": updated.get("department", ""),
    }


@app.delete("/api/directory/{user_id}", tags=["Directory"])
def api_remove_directory_user(user_id: str):
    """Remove a user from the directory."""
    # Check target exists
    target = cq.get_user_profile(user_id)
    if not target:
        try:
            hits = list(cq._invited().query_items(
                query="SELECT * FROM c WHERE c.id = @id",
                parameters=[{"name": "@id", "value": user_id}],
                enable_cross_partition_query=True,
            ))
            target = hits[0] if hits else None
        except Exception:
            target = None
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    deleted = cq.remove_directory_user(user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="User not found")
    return {"status": "ok", "deleted": user_id}


@app.post("/api/directory/{user_id}/switch-affiliation", tags=["Directory"])
def api_switch_affiliation(user_id: str, body: SwitchAffiliationRequest):
    """Switch the user's active affiliation."""
    updated = cq.switch_active_affiliation(user_id, body.index)
    if not updated:
        raise HTTPException(status_code=400, detail="Invalid affiliation index or user not found")
    return {
        "id": updated.get("id", ""), "userId": updated.get("userId", ""),
        "institute": updated.get("institute", ""), "department": updated.get("department", ""),
        "role": updated.get("role", ""), "affiliations": updated.get("affiliations", []),
        "activeAffiliation": updated.get("activeAffiliation", 0),
    }


@app.post("/api/directory/institutes/rename", tags=["Directory"])
def api_rename_institute(body: RenameInstituteRequest):
    """Rename an institution across all user records."""
    if not body.old_name.strip() or not body.new_name.strip():
        raise HTTPException(status_code=400, detail="old_name and new_name are required")
    count = cq.rename_institute(body.old_name.strip(), body.new_name.strip())
    return {"status": "ok", "updated": count}


@app.post("/api/directory/institutes/delete", tags=["Directory"])
def api_delete_institute(body: DeleteInstituteRequest):
    """Delete an institution — clears institute & department on affected users."""
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="name is required")
    count = cq.delete_institute(body.name.strip())
    return {"status": "ok", "cleared": count}


@app.post("/api/directory/departments/rename", tags=["Directory"])
def api_rename_department(body: RenameDepartmentRequest):
    """Rename a department within an institution across all user records."""
    if not body.institute.strip() or not body.old_name.strip() or not body.new_name.strip():
        raise HTTPException(status_code=400, detail="institute, old_name and new_name are required")
    count = cq.rename_department(body.institute.strip(), body.old_name.strip(), body.new_name.strip())
    return {"status": "ok", "updated": count}


@app.post("/api/directory/departments/delete", tags=["Directory"])
def api_delete_department(body: DeleteDepartmentRequest):
    """Delete a department — clears the department field on affected users."""
    if not body.institute.strip() or not body.department.strip():
        raise HTTPException(status_code=400, detail="institute and department are required")
    count = cq.delete_department_users(body.institute.strip(), body.department.strip())
    return {"status": "ok", "cleared": count}


@app.get("/api/directory/onboarding-progress", tags=["Directory"])
def api_onboarding_progress(institute: str, department: str):
    """Return onboarding progress (invited vs active counts) for a department."""
    return cq.get_department_onboarding_progress(institute.strip(), department.strip())


@app.get("/api/user/{user_id}", tags=["Directory"])
def api_get_user_profile(user_id: str):
    """Get a user profile by ID."""
    profile = cq.get_user_profile(user_id)
    if not profile:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "success": True,
        "profile": {
            "id": profile.get("id", ""),
            "userId": profile.get("userId", ""),
            "fullName": profile.get("fullName", ""),
            "displayName": profile.get("displayName", ""),
            "email": profile.get("email", ""),
            "role": profile.get("role", "student"),
            "status": profile.get("status", "active"),
            "institute": profile.get("institute", ""),
            "department": profile.get("department", ""),
            "affiliations": profile.get("affiliations", []),
            "activeAffiliation": profile.get("activeAffiliation", 0),
        },
    }


# ════════════════════════════════════════════════════════════════════


def _background_institute_research(institute_name: str, instructions: str = ""):
    """Background task: research an institute via institute-research-agent."""
    import time
    from datetime import datetime

    logger.info(f"[Institute Research] Starting research for '{institute_name}'")
    start_time = time.time()

    rs.save_institute_research(institute_name, {
        "status": "researching",
        "institute_name": institute_name,
        "started_at": datetime.utcnow().isoformat() + "Z",
    })

    research_prompt = (
        f"Research the following educational institute and return a structured JSON profile:\n\n"
        f"**Institute:** {institute_name}\n\n"
        f"This is a Type 1 (Institute Research) request. Research thoroughly — official website, NIRF data, "
        f"placement reports, student reviews, Wikipedia, department pages.\n\n"
        f"Return the JSON with EXACTLY these top-level keys and structure:\n"
        f"```json\n"
        f'{{\n'
        f'  "research_type": "institute",\n'
        f'  "profile": {{\n'
        f'    "name": "Full official institute name",\n'
        f'    "location": "City, State, Country",\n'
        f'    "type": "Public/Private, Autonomous/Affiliated, University/College",\n'
        f'    "established": "Year",\n'
        f'    "description": "2-3 sentence overview",\n'
        f'    "societal_commitments": "Community outreach, social responsibility initiatives, rural engagement, sustainability efforts, NSS/NCC activities",\n'
        f'    "website": "Official website URL"\n'
        f'  }},\n'
        f'  "academic_system": {{\n'
        f'    "curriculum_standards": "Credit system, semester structure, etc.",\n'
        f'    "exam_pattern": "Mid-sem, end-sem, assignments — typical weightages",\n'
        f'    "grading_system": "Grading scale (e.g., 10-point CGPA)",\n'
        f'    "attendance_policy": "Minimum attendance and consequences",\n'
        f'    "backlog_policy": "Re-examination and repeat course rules",\n'
        f'    "academic_calendar": "Typical semester dates, exam periods, breaks"\n'
        f'  }},\n'
        f'  "campus_life": {{\n'
        f'    "hostels": [{{"name": "Hostel Name", "description": "Capacity, amenities, culture, notable facts"}}],\n'
        f'    "student_clubs": [{{"name": "Club Name", "category": "Technical/Cultural/Sports", "description": "Activities and significance"}}],\n'
        f'    "library_resources": "Library facilities, digital access",\n'
        f'    "study_culture": "Typical study patterns",\n'
        f'    "food_and_facilities": "Canteens, mess, medical, sports facilities"\n'
        f'  }},\n'
        f'  "student_demographics": {{\n'
        f'    "typical_background": "Entrance exam, expected academic maturity",\n'
        f'    "batch_size": "Total intake per year and per department",\n'
        f'    "admission_process": "Entrance exams, cutoffs, reservation policies",\n'
        f'    "diversity": "Geographic, socioeconomic diversity patterns",\n'
        f'    "common_strengths": "What students typically excel at",\n'
        f'    "common_struggles": "Known weak areas students arrive with"\n'
        f'  }},\n'
        f'  "industry_connections": {{\n'
        f'    "alumni_network": "Notable alumni, alumni associations",\n'
        f'    "industry_collaborations": "MoUs, sponsored labs, joint research"\n'
        f'  }}\n'
        f'}}\n'
        f"```\n\n"
        f"IMPORTANT: hostels MUST be an array of objects with \"name\" and \"description\" keys "
        f"(include capacity, amenities, culture). student_clubs MUST be an array of objects with "
        f"\"name\", \"category\", and \"description\" keys. Return ONLY the JSON. No markdown fences, "
        f"no commentary, no text before or after."
    )
    if instructions and instructions.strip():
        research_prompt += f"\n\n**Additional Instructions from Admin:**\n{instructions.strip()}"

    try:
        from azure.ai.projects import AIProjectClient

        credential = _get_research_credential()
        client = AIProjectClient(endpoint=PROJECT_ENDPOINT, credential=credential)
        openai_client = client.get_openai_client()

        logger.info(f"[Institute Research] Calling {INSTITUTE_RESEARCH_AGENT_NAME} via responses API")

        conversation = openai_client.conversations.create()
        response = openai_client.responses.create(
            conversation=conversation.id,
            input=research_prompt,
            extra_body={
                "agent": {
                    "name": INSTITUTE_RESEARCH_AGENT_NAME,
                    "type": "agent_reference",
                }
            },
        )

        raw_response = response.output_text or ""
        logger.info(f"[Institute Research] Got response ({len(raw_response)} chars): {raw_response[:200]}")
        client.close()

        research_data = parse_research_json(raw_response)
        research_data["status"] = "completed"
        research_data["institute_name"] = institute_name
        research_data["completed_at"] = datetime.utcnow().isoformat() + "Z"
        research_data["research_duration_seconds"] = round(time.time() - start_time, 1)

        rs.save_institute_research(institute_name, research_data)

        elapsed = time.time() - start_time
        logger.info(f"[Institute Research] Complete for '{institute_name}' in {elapsed:.1f}s")

    except json.JSONDecodeError as e:
        logger.error(f"[Institute Research] Failed to parse JSON: {e}. Raw response: {raw_response[:300]}")
        # Save the raw text response as a partial result instead of just "failed"
        rs.save_institute_research(institute_name, {
            "status": "failed",
            "institute_name": institute_name,
            "error": f"Agent returned non-JSON response: {raw_response[:200]}",
            "raw_response": raw_response[:500],
        })
    except Exception as e:
        logger.error(f"[Institute Research] Failed: {e}", exc_info=True)
        rs.save_institute_research(institute_name, {
            "status": "failed",
            "institute_name": institute_name,
            "error": str(e),
        })


def _background_department_research(institute_name: str, department_name: str, instructions: str = ""):
    """Background task: research a department via institute-research-agent."""
    import time
    from datetime import datetime

    logger.info(f"[Department Research] Starting research for '{department_name}' at '{institute_name}'")
    start_time = time.time()

    rs.save_department_research(institute_name, department_name, {
        "status": "researching",
        "institute_name": institute_name,
        "department_name": department_name,
        "started_at": datetime.utcnow().isoformat() + "Z",
    })

    research_prompt = (
        f"Research the following department at an educational institute and return a structured JSON profile:\n\n"
        f"**Institute:** {institute_name}\n"
        f"**Department:** {department_name}\n\n"
        f"This is a Type 2 (Department Research) request. Research thoroughly — official department page, faculty lists, "
        f"lab pages, curriculum details, research output.\n\n"
        f"Return the JSON with EXACTLY these top-level keys and structure:\n"
        f"```json\n"
        f'{{\n'
        f'  "research_type": "department",\n'
        f'  "profile": {{\n'
        f'    "name": "Department Name",\n'
        f'    "institute": "Institute Name",\n'
        f'    "description": "Focus areas, strengths, reputation",\n'
        f'    "established": "Year the department was established",\n'
        f'    "hod_or_chair": "Current HoD name if findable"\n'
        f'  }},\n'
        f'  "faculty": {{\n'
        f'    "strength": "Approximate faculty count",\n'
        f'    "specializations": ["Area 1", "Area 2"],\n'
        f'    "notable_faculty": [{{"name": "Prof. Name", "specialization": "Area", "notable_work": "Key contributions"}}],\n'
        f'    "student_faculty_ratio": "Ratio if findable"\n'
        f'  }},\n'
        f'  "facilities": {{\n'
        f'    "labs": [{{"name": "Lab Name", "description": "Equipment, purpose, courses that use it"}}],\n'
        f'    "computing_resources": "Servers, GPU clusters, software licenses",\n'
        f'    "research_centers": [{{"name": "Center Name", "focus": "Research focus area"}}]\n'
        f'  }},\n'
        f'  "curriculum": {{\n'
        f'    "teaching_philosophy": "Theoretical vs practical emphasis",\n'
        f'    "core_courses": ["Course 1", "Course 2"],\n'
        f'    "elective_tracks": ["Specialization 1", "Specialization 2"],\n'
        f'    "project_requirements": "Capstone projects, mini-projects, thesis requirements",\n'
        f'    "industry_exposure": "Industrial visits, workshops, guest lectures"\n'
        f'  }},\n'
        f'  "research": {{\n'
        f'    "focus_areas": ["Area 1", "Area 2"],\n'
        f'    "funded_projects": "Active grants, sponsorships, government projects",\n'
        f'    "phd_program": "PhD intake, research output, notable theses"\n'
        f'  }}\n'
        f'}}\n'
        f"```\n\n"
        f"IMPORTANT: labs MUST be an array of objects with \"name\" and \"description\" keys. "
        f"notable_faculty MUST be an array of objects with \"name\", \"specialization\", and \"notable_work\" keys. "
        f"research_centers MUST be an array of objects with \"name\" and \"focus\" keys. "
        f"Return ONLY the JSON. No markdown fences, no commentary, no text before or after."
    )
    if instructions and instructions.strip():
        research_prompt += f"\n\n**Additional Instructions from Admin:**\n{instructions.strip()}"

    try:
        from azure.ai.projects import AIProjectClient

        credential = _get_research_credential()
        client = AIProjectClient(endpoint=PROJECT_ENDPOINT, credential=credential)
        openai_client = client.get_openai_client()

        logger.info(f"[Department Research] Calling {INSTITUTE_RESEARCH_AGENT_NAME} via responses API")

        conversation = openai_client.conversations.create()
        response = openai_client.responses.create(
            conversation=conversation.id,
            input=research_prompt,
            extra_body={
                "agent": {
                    "name": INSTITUTE_RESEARCH_AGENT_NAME,
                    "type": "agent_reference",
                }
            },
        )

        raw_response = response.output_text or ""
        logger.info(f"[Department Research] Got response ({len(raw_response)} chars): {raw_response[:200]}")
        client.close()

        research_data = parse_research_json(raw_response)
        research_data["status"] = "completed"
        research_data["institute_name"] = institute_name
        research_data["department_name"] = department_name
        research_data["completed_at"] = datetime.utcnow().isoformat() + "Z"
        research_data["research_duration_seconds"] = round(time.time() - start_time, 1)

        rs.save_department_research(institute_name, department_name, research_data)

        elapsed = time.time() - start_time
        logger.info(f"[Department Research] Complete for '{department_name}@{institute_name}' in {elapsed:.1f}s")

    except json.JSONDecodeError as e:
        logger.error(f"[Department Research] Failed to parse JSON: {e}. Raw response: {raw_response[:300]}")
        rs.save_department_research(institute_name, department_name, {
            "status": "failed",
            "institute_name": institute_name,
            "department_name": department_name,
            "error": f"Agent returned non-JSON response: {raw_response[:200]}",
            "raw_response": raw_response[:500],
        })
    except Exception as e:
        logger.error(f"[Department Research] Failed: {e}", exc_info=True)
        rs.save_department_research(institute_name, department_name, {
            "status": "failed",
            "institute_name": institute_name,
            "department_name": department_name,
            "error": str(e),
        })


@app.post("/api/dashboard/directory/research/bulk-status", tags=["Research"])
def api_bulk_research_status(payload: Dict[str, Any] = Body(...)):
    """
    Get research statuses for multiple institutes and departments in one call.

    Request body:
        items: [{ type: "institute"|"department", institute: str, department?: str }]

    Returns:
        statuses: { key: ResearchStatus }
    """
    items = payload.get("items", [])
    statuses: Dict[str, Any] = {}
    for item in items:
        t = item.get("type", "institute")
        inst = (item.get("institute") or "").strip()
        dept = (item.get("department") or "").strip()
        if not inst:
            continue
        if t == "department" and dept:
            key = f"{inst}::{dept}"
            data = rs.get_department_research(inst, dept)
        else:
            key = inst
            data = rs.get_institute_research(inst)
        statuses[key] = data or {"status": "not_started"}
    return {"statuses": statuses}


@app.post("/api/dashboard/directory/institutes/research", tags=["Research"])
def api_trigger_institute_research(
    body: InstituteResearchRequest,
    background_tasks: BackgroundTasks,
):
    """Trigger research on an institute. Runs in background."""
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")

    existing = rs.get_institute_research(name)
    if existing and existing.get("status") == "researching":
        return {"status": "already_researching", "institute": name}

    background_tasks.add_task(_background_institute_research, institute_name=name, instructions=body.instructions or "")
    logger.info(f"Background task scheduled: institute research for '{name}'")
    return {"status": "researching", "institute": name}


@app.get("/api/dashboard/directory/institutes/research", tags=["Research"])
def api_get_institute_research(name: str):
    """Get institute research status/results."""
    data = rs.get_institute_research(name.strip())
    if not data:
        return {"status": "not_started", "institute": name}
    return data


@app.post("/api/dashboard/directory/departments/research", tags=["Research"])
def api_trigger_department_research(
    body: DepartmentResearchRequest,
    background_tasks: BackgroundTasks,
):
    """Trigger research on a department. Runs in background."""
    institute = body.institute.strip()
    department = body.department.strip()
    if not institute or not department:
        raise HTTPException(status_code=400, detail="institute and department are required")

    existing = rs.get_department_research(institute, department)
    if existing and existing.get("status") == "researching":
        return {"status": "already_researching", "institute": institute, "department": department}

    background_tasks.add_task(
        _background_department_research,
        institute_name=institute,
        department_name=department,
        instructions=body.instructions or "",
    )
    logger.info(f"Background task scheduled: department research for '{department}@{institute}'")
    return {"status": "researching", "institute": institute, "department": department}


@app.get("/api/dashboard/directory/departments/research", tags=["Research"])
def api_get_department_research(institute: str, department: str):
    """Get department research status/results."""
    data = rs.get_department_research(institute.strip(), department.strip())
    if not data:
        return {"status": "not_started", "institute": institute, "department": department}
    return data


@app.delete("/api/dashboard/directory/institutes/research", tags=["Research"])
def api_cancel_institute_research(name: str):
    """Cancel an in-progress institute research."""
    from datetime import datetime
    existing = rs.get_institute_research(name.strip())
    if not existing or existing.get("status") != "researching":
        return {"status": existing.get("status", "not_started") if existing else "not_started", "institute": name}
    rs.save_institute_research(name.strip(), {
        "status": "cancelled",
        "institute_name": name.strip(),
        "cancelled_at": datetime.utcnow().isoformat() + "Z",
    })
    logger.info(f"Institute research cancelled for '{name}'")
    return {"status": "cancelled", "institute": name}


@app.delete("/api/dashboard/directory/departments/research", tags=["Research"])
def api_cancel_department_research(institute: str, department: str):
    """Cancel an in-progress department research."""
    from datetime import datetime
    existing = rs.get_department_research(institute.strip(), department.strip())
    if not existing or existing.get("status") != "researching":
        return {"status": existing.get("status", "not_started") if existing else "not_started", "institute": institute, "department": department}
    rs.save_department_research(institute.strip(), department.strip(), {
        "status": "cancelled",
        "institute_name": institute.strip(),
        "department_name": department.strip(),
        "cancelled_at": datetime.utcnow().isoformat() + "Z",
    })
    logger.info(f"Department research cancelled for '{department}@{institute}'")
    return {"status": "cancelled", "institute": institute, "department": department}


# ════════════════════════════════════════════════════════════════════
# Run
# ════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("DASHBOARD_PORT", "8050"))
    logger.info(f"Starting Dashboard server on port {port}")
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
