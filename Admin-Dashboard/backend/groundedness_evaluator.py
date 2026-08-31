"""
RAG Evaluation — Evaluates agent responses using RAGAS-inspired metrics.

Metrics implemented (no ground truth required):
  1. Faithfulness / Groundedness — Is the response supported by the context?
  2. Answer Relevancy — Does the response address the user's question?
  3. Context Precision — Is the retrieved context relevant to the query?

Uses Azure AI Evaluation SDK or direct LLM-as-judge via Azure AI Foundry.

Migrated from Backend/azure_services/groundedness_evaluator.py to Dashboard server.
"""

import os
import json
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone

from azure.identity import DefaultAzureCredential, AzureCliCredential

logger = logging.getLogger(__name__)

# Azure config
AZURE_AI_SEARCH_ENDPOINT = os.environ["AZURE_AI_SEARCH_ENDPOINT"]
COMMON_INDEX_NAME = os.getenv("COMMON_INDEX_NAME", "course-material-common-index-v1")
PROJECT_ENDPOINT = os.environ["AZURE_AI_PROJECT_ENDPOINT"]
EVAL_MODEL = os.getenv("AZURE_EVAL_MODEL", "gpt-5.2-chat")


def _get_credential():
    """Get Azure credential for evaluation."""
    try:
        credential = DefaultAzureCredential()
        credential.get_token("https://cognitiveservices.azure.com/.default")
        return credential
    except Exception:
        logger.info("DefaultAzureCredential failed, falling back to AzureCliCredential")
        return AzureCliCredential()


def _retrieve_context_from_search(
    query: str,
    session_uuid: str,
    top_k: int = 10,
) -> str:
    """
    Retrieve relevant context from Azure AI Search for groundedness evaluation.

    Args:
        query: The user's question
        session_uuid: Session UUID for filtering
        top_k: Number of results to retrieve

    Returns:
        Concatenated text from search results
    """
    _, text = _retrieve_context_with_chunks(query, session_uuid, top_k)
    return text


def _retrieve_context_with_chunks(
    query: str,
    session_uuid: str,
    top_k: int = 10,
) -> tuple:
    """
    Retrieve relevant context from Azure AI Search, returning both structured
    chunk metadata and the concatenated text.

    Args:
        query: The user's question
        session_uuid: Session UUID for filtering
        top_k: Number of results to retrieve

    Returns:
        Tuple of (list of chunk dicts, concatenated text string).
        Each chunk dict: {title, page, text, score}
    """
    from azure.search.documents import SearchClient

    credential = _get_credential()

    search_client = SearchClient(
        endpoint=AZURE_AI_SEARCH_ENDPOINT,
        index_name=COMMON_INDEX_NAME,
        credential=credential,
    )

    # Hybrid search with session filter
    filter_expr = f"session_id eq '{session_uuid}'" if session_uuid else None

    results = search_client.search(
        search_text=query,
        filter=filter_expr,
        top=top_k,
        select=["content_text", "document_title", "page_number"],
        query_type="semantic",
        semantic_configuration_name="semantic-config",
    )

    chunks: list = []
    context_parts: list = []
    for result in results:
        title = result.get("document_title", "Unknown")
        page = result.get("page_number", "")
        text = result.get("content_text", "")
        score = result.get("@search.score", 0)
        if text:
            chunks.append({
                "title": title,
                "page": page,
                "text": text[:2000],
                "score": round(float(score), 4) if score else 0,
            })
            source_info = f"[Source: {title}"
            if page:
                source_info += f", Page {page}"
            source_info += "]"
            context_parts.append(f"{source_info}\n{text}")

    concatenated = "\n\n---\n\n".join(context_parts) if context_parts else ""
    return chunks, concatenated


def evaluate_groundedness_with_sdk(
    query: str,
    response: str,
    context: str,
) -> Dict[str, Any]:
    """
    Evaluate groundedness using Azure AI Evaluation SDK's GroundednessEvaluator.
    """
    try:
        from azure.ai.evaluation import GroundednessEvaluator
        from azure.ai.projects import AIProjectClient

        credential = _get_credential()

        project_client = AIProjectClient(
            endpoint=PROJECT_ENDPOINT,
            credential=credential,
        )

        groundedness_eval = GroundednessEvaluator(model_config=project_client)

        result = groundedness_eval(
            query=query,
            response=response,
            context=context,
        )

        return {
            "method": "azure_ai_evaluation_sdk",
            "groundedness_score": result.get("groundedness", None),
            "groundedness_reason": result.get("groundedness_reason", ""),
            "raw_result": {k: v for k, v in result.items() if k not in ("groundedness", "groundedness_reason")},
        }

    except ImportError:
        logger.warning("azure-ai-evaluation SDK not installed. Install with: pip install azure-ai-evaluation")
        raise
    except Exception as e:
        logger.error(f"SDK groundedness evaluation failed: {e}")
        raise


def evaluate_groundedness_with_llm(
    query: str,
    response: str,
    context: str,
) -> Dict[str, Any]:
    """
    Evaluate groundedness using a direct LLM call (fallback when SDK is not available).
    Score 1-5.
    """
    from azure.ai.projects import AIProjectClient

    credential = _get_credential()
    project_client = AIProjectClient(
        endpoint=PROJECT_ENDPOINT,
        credential=credential,
    )
    openai_client = project_client.get_openai_client()

    eval_prompt = f"""You are an expert evaluator. Your task is to evaluate the GROUNDEDNESS of an AI assistant's response.

GROUNDEDNESS measures whether the response is factually supported by the provided context (source documents).

Score on a 1-5 scale:
1 = Completely ungrounded: Response makes claims with no support in the context
2 = Mostly ungrounded: Most claims are unsupported by the context
3 = Partially grounded: Some claims are supported, some are not
4 = Mostly grounded: Most claims are supported by the context, minor unsupported details
5 = Fully grounded: All claims in the response are directly supported by the context

USER QUESTION:
{query}

CONTEXT (Source Documents):
{context[:6000]}

AI RESPONSE TO EVALUATE:
{response[:3000]}

Respond in this exact JSON format:
{{
    "score": <1-5>,
    "reasoning": "<Brief explanation of your assessment>",
    "unsupported_claims": ["<list of claims not found in context, if any>"],
    "supported_claims": ["<list of key claims that ARE supported by context>"]
}}"""

    try:
        response_obj = openai_client.responses.create(
            model=EVAL_MODEL,
            input=eval_prompt,
            text={"format": {"type": "json_object"}},
        )

        result_text = response_obj.output_text
        result = json.loads(result_text)

        return {
            "method": "llm_judge",
            "groundedness_score": result.get("score", 0),
            "groundedness_reason": result.get("reasoning", ""),
            "unsupported_claims": result.get("unsupported_claims", []),
            "supported_claims": result.get("supported_claims", []),
            "max_score": 5,
        }

    except Exception as e:
        logger.error(f"LLM groundedness evaluation failed: {e}")
        raise


# ---------------------------------------------------------------------------
# Answer Relevancy  (Query, Response)
# ---------------------------------------------------------------------------

def evaluate_answer_relevancy(
    query: str,
    response: str,
) -> Dict[str, Any]:
    """
    Evaluate whether the response is relevant to / addresses the user's query.
    Score 1-5.
    """
    from azure.ai.projects import AIProjectClient

    credential = _get_credential()
    project_client = AIProjectClient(
        endpoint=PROJECT_ENDPOINT,
        credential=credential,
    )
    openai_client = project_client.get_openai_client()

    eval_prompt = f"""You are an expert evaluator. Your task is to evaluate the ANSWER RELEVANCY of an AI assistant's response.

ANSWER RELEVANCY measures whether the response actually addresses the user's question.
It does NOT judge factual correctness—only whether the response is on-topic and helpful.

Score on a 1-5 scale:
1 = Completely irrelevant: Response does not address the question at all
2 = Mostly irrelevant: Response touches on the topic but misses the core question
3 = Partially relevant: Response addresses some aspects of the question but omits key parts
4 = Mostly relevant: Response addresses the question well with minor omissions or tangents
5 = Fully relevant: Response directly and completely addresses the user's question

USER QUESTION:
{query}

AI RESPONSE TO EVALUATE:
{response[:3000]}

Respond in this exact JSON format:
{{
    "score": <1-5>,
    "reasoning": "<Brief explanation of your assessment>",
    "addressed_aspects": ["<aspects of the question that the response covers>"],
    "missed_aspects": ["<aspects of the question the response fails to cover, if any>"]
}}"""

    try:
        response_obj = openai_client.responses.create(
            model=EVAL_MODEL,
            input=eval_prompt,
            text={"format": {"type": "json_object"}},
        )

        result = json.loads(response_obj.output_text)

        return {
            "method": "llm_judge",
            "answer_relevancy_score": result.get("score", 0),
            "answer_relevancy_reason": result.get("reasoning", ""),
            "addressed_aspects": result.get("addressed_aspects", []),
            "missed_aspects": result.get("missed_aspects", []),
            "max_score": 5,
        }

    except Exception as e:
        logger.error(f"LLM answer relevancy evaluation failed: {e}")
        raise


# ---------------------------------------------------------------------------
# Context Precision  (Query, Context)
# ---------------------------------------------------------------------------

def evaluate_context_precision(
    query: str,
    context: str,
) -> Dict[str, Any]:
    """
    Evaluate whether the retrieved context is relevant and precise for the query.
    Score 1-5.
    """
    from azure.ai.projects import AIProjectClient

    credential = _get_credential()
    project_client = AIProjectClient(
        endpoint=PROJECT_ENDPOINT,
        credential=credential,
    )
    openai_client = project_client.get_openai_client()

    eval_prompt = f"""You are an expert evaluator. Your task is to evaluate the CONTEXT PRECISION of retrieved documents for a user's query.

CONTEXT PRECISION measures how relevant and well-targeted the retrieved context is for answering the given query.
High precision means most retrieved chunks are actually useful for answering the question.
Low precision means the retrieved chunks are mostly irrelevant or off-topic.

Score on a 1-5 scale:
1 = No precision: None of the retrieved context is relevant to the query
2 = Low precision: Very little of the context is relevant; mostly noise
3 = Moderate precision: Some chunks are relevant but many are not useful
4 = High precision: Most retrieved chunks are relevant to the query
5 = Perfect precision: All retrieved chunks are directly relevant and useful

USER QUESTION:
{query}

RETRIEVED CONTEXT:
{context[:6000]}

Respond in this exact JSON format:
{{
    "score": <1-5>,
    "reasoning": "<Brief explanation of your assessment>",
    "relevant_chunks": <number of context chunks that are relevant>,
    "total_chunks": <total number of context chunks evaluated>,
    "noise_description": "<brief description of irrelevant content, if any>"
}}"""

    try:
        response_obj = openai_client.responses.create(
            model=EVAL_MODEL,
            input=eval_prompt,
            text={"format": {"type": "json_object"}},
        )

        result = json.loads(response_obj.output_text)

        return {
            "method": "llm_judge",
            "context_precision_score": result.get("score", 0),
            "context_precision_reason": result.get("reasoning", ""),
            "relevant_chunks": result.get("relevant_chunks", 0),
            "total_chunks": result.get("total_chunks", 0),
            "noise_description": result.get("noise_description", ""),
            "max_score": 5,
        }

    except Exception as e:
        logger.error(f"LLM context precision evaluation failed: {e}")
        raise


# ---------------------------------------------------------------------------
# Combined RAG Evaluation — runs all three metrics
# ---------------------------------------------------------------------------

def evaluate_rag_metrics(
    query: str,
    response: str,
    context: str,
) -> Dict[str, Any]:
    """
    Run all three RAG evaluation metrics (faithfulness, answer relevancy,
    context precision) and return a combined result.
    """
    results: Dict[str, Any] = {"method": "llm_judge", "max_score": 5}

    # 1) Faithfulness / Groundedness
    try:
        g = evaluate_groundedness_with_llm(query, response, context)
        results["faithfulness_score"] = g.get("groundedness_score")
        results["faithfulness_reason"] = g.get("groundedness_reason", "")
        results["supported_claims"] = g.get("supported_claims", [])
        results["unsupported_claims"] = g.get("unsupported_claims", [])
    except Exception as e:
        logger.error(f"Faithfulness evaluation failed: {e}")
        results["faithfulness_score"] = None
        results["faithfulness_reason"] = f"Error: {e}"

    # 2) Answer Relevancy
    try:
        ar = evaluate_answer_relevancy(query, response)
        results["answer_relevancy_score"] = ar.get("answer_relevancy_score")
        results["answer_relevancy_reason"] = ar.get("answer_relevancy_reason", "")
        results["addressed_aspects"] = ar.get("addressed_aspects", [])
        results["missed_aspects"] = ar.get("missed_aspects", [])
    except Exception as e:
        logger.error(f"Answer relevancy evaluation failed: {e}")
        results["answer_relevancy_score"] = None
        results["answer_relevancy_reason"] = f"Error: {e}"

    # 3) Context Precision
    try:
        cp = evaluate_context_precision(query, context)
        results["context_precision_score"] = cp.get("context_precision_score")
        results["context_precision_reason"] = cp.get("context_precision_reason", "")
        results["relevant_chunks"] = cp.get("relevant_chunks", 0)
        results["total_chunks"] = cp.get("total_chunks", 0)
    except Exception as e:
        logger.error(f"Context precision evaluation failed: {e}")
        results["context_precision_score"] = None
        results["context_precision_reason"] = f"Error: {e}"

    # Overall average (only non-None scores)
    scores = [
        v for v in [
            results.get("faithfulness_score"),
            results.get("answer_relevancy_score"),
            results.get("context_precision_score"),
        ]
        if v is not None
    ]
    results["overall_score"] = round(sum(scores) / len(scores), 2) if scores else None

    return results


def evaluate_groundedness(
    query: str,
    response: str,
    session_uuid: Optional[str] = None,
    context: Optional[str] = None,
    method: str = "auto",
) -> Dict[str, Any]:
    """
    Evaluate groundedness of an agent response.

    Args:
        query: The user's question
        response: The agent's response to evaluate
        session_uuid: Optional session UUID to retrieve context from search index
        context: Optional pre-provided context.
        method: "sdk", "llm", or "auto"

    Returns:
        Evaluation result dict with score, reasoning, and metadata
    """
    # Retrieve context from search if not provided
    if not context and session_uuid:
        logger.info(f"Retrieving context from search index for session: {session_uuid}")
        context = _retrieve_context_from_search(query, session_uuid)

    if not context:
        return {
            "error": "No context available for groundedness evaluation. Provide either session_uuid or context.",
            "groundedness_score": None,
        }

    # Try evaluation methods
    if method == "sdk":
        return evaluate_groundedness_with_sdk(query, response, context)
    elif method == "llm":
        return evaluate_groundedness_with_llm(query, response, context)
    else:  # auto
        try:
            return evaluate_groundedness_with_sdk(query, response, context)
        except (ImportError, Exception) as e:
            logger.info(f"SDK evaluation unavailable ({e}), falling back to LLM judge")
            return evaluate_groundedness_with_llm(query, response, context)


def evaluate_and_store_groundedness(
    message_group_id: str,
    session_id: str,
    thread_id: str,
    user_id: str,
    method: str = "auto",
) -> Optional[Dict[str, Any]]:
    """
    Fetch messages for a messageGroupId from Cosmos DB, run all RAG evaluation
    metrics, and store the combined result in groundedness_evaluations_v1.

    Flow:
    1. Fetch user query + assistant response from chat_messages_v1 by messageGroupId
    2. Retrieve relevant context from Azure AI Search
    3. Run all three RAG metrics via LLM judge
    4. Store the evaluation result

    Args:
        message_group_id: The messageGroupId that groups user + assistant messages
        session_id: The session UUID
        thread_id: The chat thread ID
        user_id: The user ID (partition key for messages)
        method: Evaluation method - "sdk", "llm", or "auto"

    Returns:
        The stored evaluation document, or None on failure
    """
    import cosmos_queries as cq

    logger.info(
        f"[RAG-Eval] Starting evaluation for messageGroupId={message_group_id}, "
        f"session={session_id}, thread={thread_id}"
    )

    # Step 1: Fetch messages by messageGroupId
    try:
        messages = cq.get_messages_by_group_id(message_group_id, user_id)
    except Exception as e:
        logger.error(f"[RAG-Eval] Failed to fetch messages for group {message_group_id}: {e}")
        return None

    if not messages:
        logger.warning(f"[RAG-Eval] No messages found for messageGroupId={message_group_id}")
        return None

    # Extract user query and assistant response
    user_query = ""
    assistant_response = ""
    for msg in messages:
        role = msg.get("role", "")
        content = msg.get("content", "")
        if role == "user" and not user_query:
            user_query = content
        elif role == "assistant":
            assistant_response = content

    if not user_query or not assistant_response:
        logger.warning(
            f"[RAG-Eval] Incomplete messages for group {message_group_id}: "
            f"query={'yes' if user_query else 'no'}, response={'yes' if assistant_response else 'no'}"
        )
        return None

    # Step 2: Retrieve context from search index (with structured chunks)
    context = ""
    retrieved_chunks: list = []
    if session_id:
        try:
            retrieved_chunks, context = _retrieve_context_with_chunks(user_query, session_id)
        except Exception as e:
            logger.warning(f"[RAG-Eval] Context retrieval failed: {e}")

    if not context:
        logger.warning(f"[RAG-Eval] No context available for session {session_id}, proceeding with empty context")
        context = "(No grounding context available for this session)"

    # Step 3: Run all RAG metrics
    logger.info(f"[RAG-Eval] Running all three RAG metrics for messageGroupId={message_group_id}")
    try:
        rag_result = evaluate_rag_metrics(
            query=user_query,
            response=assistant_response,
            context=context,
        )
    except Exception as e:
        logger.error(f"[RAG-Eval] Combined evaluation failed: {e}")
        return None

    # Step 4: Store in Cosmos DB
    evaluation_doc = {
        "id": message_group_id,
        "sessionId": session_id,
        "messageGroupId": message_group_id,
        "threadId": thread_id,
        "userId": user_id,
        "query": user_query,
        "response": assistant_response[:5000],
        "context": context[:8000],
        "retrievedDocuments": retrieved_chunks[:20],  # Structured chunk metadata
        # Faithfulness / Groundedness
        "groundednessScore": rag_result.get("faithfulness_score"),
        "groundednessReason": rag_result.get("faithfulness_reason", ""),
        "supportedClaims": rag_result.get("supported_claims", []),
        "unsupportedClaims": rag_result.get("unsupported_claims", []),
        # Answer Relevancy
        "answerRelevancyScore": rag_result.get("answer_relevancy_score"),
        "answerRelevancyReason": rag_result.get("answer_relevancy_reason", ""),
        "addressedAspects": rag_result.get("addressed_aspects", []),
        "missedAspects": rag_result.get("missed_aspects", []),
        # Context Precision
        "contextPrecisionScore": rag_result.get("context_precision_score"),
        "contextPrecisionReason": rag_result.get("context_precision_reason", ""),
        "relevantChunks": rag_result.get("relevant_chunks", 0),
        "totalChunks": rag_result.get("total_chunks", 0),
        # Overall
        "overallScore": rag_result.get("overall_score"),
        "method": rag_result.get("method", "unknown"),
        "maxScore": 5,
        "evaluatedAt": datetime.now(timezone.utc).isoformat(),
    }

    try:
        stored = cq.save_groundedness_evaluation(evaluation_doc)
        logger.info(
            f"[RAG-Eval] Stored evaluation: messageGroupId={message_group_id}, "
            f"faithfulness={rag_result.get('faithfulness_score')}/5, "
            f"relevancy={rag_result.get('answer_relevancy_score')}/5, "
            f"precision={rag_result.get('context_precision_score')}/5, "
            f"overall={rag_result.get('overall_score')}/5"
        )
        return stored
    except Exception as e:
        logger.error(f"[RAG-Eval] Failed to store evaluation: {e}")
        return None
