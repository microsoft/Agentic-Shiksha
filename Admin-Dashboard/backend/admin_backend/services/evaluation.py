import asyncio
import logging
from collections.abc import Callable
from typing import Any

from admin_backend.core.contracts import DashboardRepository, EvaluationBackend
from admin_backend.core.errors import InvalidOperation
from admin_backend.core.log_safe import scrub
from admin_backend.core.settings import RuntimeSettings

logger = logging.getLogger(__name__)


def summarize(evaluations: list[dict[str, Any]], *, distribution: bool = False) -> dict[str, Any]:
    def average(field: str):
        values = [item.get(field) for item in evaluations if item.get(field) is not None]
        return round(sum(values) / len(values), 2) if values else None

    result: dict[str, Any] = {
        "total": len(evaluations),
        "avgFaithfulness": average("groundednessScore"),
        "avgAnswerRelevancy": average("answerRelevancyScore"),
        "avgContextPrecision": average("contextPrecisionScore"),
        "avgOverall": average("overallScore"),
        "maxScore": 5,
    }
    if distribution:
        buckets = {"1-2": 0, "2-3": 0, "3-4": 0, "4-5": 0}
        for item in evaluations:
            value = item.get("overallScore")
            if value is None:
                continue
            if value < 2:
                buckets["1-2"] += 1
            elif value < 3:
                buckets["2-3"] += 1
            elif value < 4:
                buckets["3-4"] += 1
            else:
                buckets["4-5"] += 1
        result["distribution"] = buckets
    return result


class EvaluationService:
    def __init__(
        self,
        queries: DashboardRepository,
        backend: Callable[[], EvaluationBackend],
    ) -> None:
        self.queries = queries
        self.backend = backend
        self._agent_sessions: dict[str, str | None] = {}
        self._threads: dict[str, dict[str, str]] = {}

    async def batch(self, payload: dict[str, Any]) -> dict[str, Any]:
        evaluate = self.backend().evaluate_groundedness
        items = payload.get("items", [])
        method = payload.get("method", "auto")
        if not items:
            raise InvalidOperation("items list is required")

        results = []
        scores = []
        for index, item in enumerate(items):
            try:
                result = await asyncio.to_thread(
                    evaluate,
                    query=item.get("query", ""),
                    response=item.get("response", ""),
                    session_uuid=item.get("session_uuid"),
                    context=item.get("context"),
                    method=method,
                )
                score = result.get("groundedness_score")
                if score is not None:
                    scores.append(float(score))
                results.append({"index": index, "ok": True, **result})
            except Exception:
                logger.error("Groundedness evaluation failed for item %s", index, exc_info=True)
                results.append({"index": index, "ok": False, "error": "Evaluation failed"})
        average = sum(scores) / len(scores) if scores else None
        return {
            "ok": True,
            "results": results,
            "summary": {
                "total": len(items),
                "evaluated": len(scores),
                "average_groundedness": round(average, 2) if average is not None else None,
            },
        }

    async def for_session(self, session_id: str) -> dict[str, Any]:
        evaluations = await asyncio.to_thread(
            self.queries.get_groundedness_evaluations_for_session, session_id,
        )
        return {"ok": True, "evaluations": evaluations, "summary": summarize(evaluations)}

    async def for_thread(self, thread_id: str, session_id: str) -> dict[str, Any]:
        evaluations = await asyncio.to_thread(
            self.queries.get_groundedness_evaluations_for_thread, thread_id, session_id,
        )
        return {"ok": True, "evaluations": evaluations, "summary": summarize(evaluations)}

    async def all_results(self, limit: int) -> dict[str, Any]:
        evaluations = await asyncio.to_thread(self.queries.get_all_groundedness_evaluations, limit)
        return {
            "ok": True,
            "evaluations": evaluations,
            "summary": summarize(evaluations, distribution=True),
        }

    async def evaluate_recent(self, runtime: RuntimeSettings) -> None:
        evaluate = self.backend().evaluate_and_store_groundedness
        recent = await asyncio.to_thread(
            self.queries.get_recent_assistant_messages,
            limit=runtime.eval_batch_limit * 2,
            since_hours=runtime.eval_lookback_hours,
        )
        if not recent:
            logger.info("[Periodic-Eval] No recent assistant messages found")
            return
        evaluated_ids = await asyncio.to_thread(self.queries.get_evaluated_message_group_ids)
        seen: set[str] = set()
        candidates = []
        for message in recent:
            group_id = message.get("messageGroupId")
            if not group_id or group_id in seen or group_id in evaluated_ids:
                continue
            seen.add(group_id)
            candidates.append(message)
        if not candidates:
            logger.info("[Periodic-Eval] All recent messages already evaluated")
            return
        candidates = candidates[:runtime.eval_batch_limit]
        evaluated = skipped = errors = 0
        for message in candidates:
            group_id = message["messageGroupId"]
            thread_id = message.get("threadId", "")
            user_id = message.get("userId", "")
            agent_id = ""
            if thread_id in self._threads:
                agent_id = self._threads[thread_id].get("agentId", "")
            else:
                try:
                    thread = await asyncio.to_thread(self.queries.get_thread, thread_id, user_id)
                    if thread:
                        agent_id = thread.get("agentId", "")
                        self._threads[thread_id] = {"agentId": agent_id, "userId": user_id}
                except Exception:
                    logger.warning("[Periodic-Eval] Could not resolve thread %s", scrub(thread_id), exc_info=True)
            session_id = None
            if agent_id:
                if agent_id not in self._agent_sessions:
                    self._agent_sessions[agent_id] = self.queries.get_agent_session_uuid(agent_id)
                session_id = self._agent_sessions[agent_id]
            try:
                result = await asyncio.to_thread(
                    evaluate,
                    message_group_id=group_id,
                    session_id=session_id,
                    thread_id=thread_id,
                    user_id=user_id,
                    method="llm",
                )
                if result:
                    evaluated += 1
                else:
                    skipped += 1
            except Exception:
                logger.error("[Periodic-Eval] Failed for mgid=%s", scrub(group_id), exc_info=True)
                errors += 1
        logger.info(
            "[Periodic-Eval] Cycle done: evaluated=%s, skipped=%s, errors=%s",
            evaluated, skipped, errors,
        )

    async def run_periodic(self, runtime: RuntimeSettings) -> None:
        logger.info(
            "[Periodic-Eval] Started - interval=%ss, lookback=%sh, batch_limit=%s",
            runtime.eval_interval_seconds, runtime.eval_lookback_hours, runtime.eval_batch_limit,
        )
        while True:
            try:
                await asyncio.sleep(runtime.eval_interval_seconds)
                await self.evaluate_recent(runtime)
            except asyncio.CancelledError:
                logger.info("[Periodic-Eval] Shutting down")
                break
            except Exception:
                logger.error("[Periodic-Eval] Unexpected error", exc_info=True)
                await asyncio.sleep(30)
