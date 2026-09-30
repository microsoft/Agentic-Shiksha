import asyncio
import logging
from typing import Any, Dict

from fastapi import APIRouter, Body, HTTPException, Query

from admin_backend.dependencies import Services
from admin_backend.schemas.evaluation import GroundednessRequest, RAGEvalRequest

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/api/dashboard/evaluation/groundedness", tags=["Evaluation"])
async def evaluate_groundedness_endpoint(request: GroundednessRequest, *, services: Services):
    """
    Evaluate groundedness of an agent response against knowledge base content.

    Checks whether the agent's response is factually supported by the retrieved
    course materials. Uses Azure AI Evaluation SDK (if installed) or falls back
    to an LLM-as-judge approach.
    """
    evaluate_groundedness = services.evaluation.backend().evaluate_groundedness

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


@router.post("/api/dashboard/evaluation/groundedness/batch", tags=["Evaluation"])
async def evaluate_groundedness_batch(payload: Dict[str, Any]=Body(...), *, services: Services):
    """
    Batch groundedness evaluation for multiple query-response pairs.

    Request body:
        items: List of {query, response, session_uuid?, context?}
        method: "sdk", "llm", or "auto" (default: "auto")
    """
    return await services.evaluation.batch(payload)


@router.post("/api/dashboard/evaluation/rag", tags=["Evaluation"])
async def evaluate_rag_endpoint(request: RAGEvalRequest, *, services: Services):
    """
    Evaluate all three RAG metrics for a query-response pair:
      - Faithfulness (groundedness)
      - Answer Relevancy
      - Context Precision
    """
    evaluator = services.evaluation.backend()
    evaluate_rag_metrics = evaluator.evaluate_rag_metrics
    _retrieve_context_from_search = evaluator._retrieve_context_from_search

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


@router.get("/api/dashboard/evaluation/groundedness/{message_group_id}", tags=["Evaluation"])
async def get_groundedness_result(message_group_id: str, session_id: str, *, services: Services):
    """
    Retrieve a stored groundedness evaluation for a specific messageGroupId.
    """
    result = await asyncio.to_thread(
        services.queries.get_groundedness_evaluation, message_group_id, session_id
    )
    if result:
        return {"ok": True, "evaluation": result}
    raise HTTPException(status_code=404, detail="No groundedness evaluation found for this messageGroupId")


@router.get("/api/dashboard/evaluation/groundedness/session/{session_id}", tags=["Evaluation"])
async def get_session_groundedness(session_id: str, *, services: Services):
    """
    Get all groundedness evaluations for a session (agent).
    """
    return await services.evaluation.for_session(session_id)


@router.get("/api/dashboard/evaluation/groundedness/thread/{thread_id}", tags=["Evaluation"])
async def get_thread_groundedness(thread_id: str, session_id: str, *, services: Services):
    """
    Get all groundedness evaluations for a specific chat thread.
    """
    return await services.evaluation.for_thread(thread_id, session_id)


@router.get("/api/dashboard/evaluation/groundedness/all", tags=["Evaluation"])
async def get_all_groundedness(limit: int=Query(200, ge=1, le=1000), *, services: Services):
    """
    Get all groundedness evaluations across all sessions.
    Returns evaluations and aggregate summary stats.
    """
    return await services.evaluation.all_results(limit)


@router.post("/api/dashboard/evaluation/groundedness/trigger", tags=["Evaluation"])
async def trigger_groundedness_evaluation(payload: Dict[str, Any]=Body(...), *, services: Services):
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

    evaluate_and_store_groundedness = services.evaluation.backend().evaluate_and_store_groundedness

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
