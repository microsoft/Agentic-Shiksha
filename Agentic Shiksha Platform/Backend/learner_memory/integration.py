"""Thin, request-scoped bridge between the existing harness and memory service."""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from contextlib import contextmanager
from datetime import datetime, timezone, timezone
from typing import TYPE_CHECKING, Literal

from fastapi import HTTPException, Request

from backend.dependencies import agent_access
from backend.dependencies.learner_access import (
    LearnerAccess,
    course_memory_mode,
    memory_enabled,
    resolve_learner_access,
)

if TYPE_CHECKING:
    from backend.dependencies.auth import ActiveUser
    from backend.schemas.learner_memory import MemoryScope, ProcessingReceipt

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class MemoryToolContext:
    scope: MemoryScope
    actor_id: str
    mode: Literal["shadow", "authoritative"]
    event_id: str
    agent_version: str | None = None


def _service():
    from learner_memory.service import get_service

    return get_service()


@contextmanager
def memory_api_errors():
    from azure_services.persistence.learner_memory import MemoryCapacityError, MemoryConflictError
    from learner_memory.curriculum import GraphValidationError

    try:
        yield
    except HTTPException:
        raise
    except MemoryConflictError:
        raise HTTPException(status_code=409, detail="Memory input or revision conflicts with the saved operation") from None
    except GraphValidationError as error:
        raise HTTPException(status_code=422, detail=str(error)) from None
    except (ValueError, MemoryCapacityError):
        raise HTTPException(status_code=422, detail="Invalid or unsupported learner memory request") from None
    except PermissionError:
        raise HTTPException(status_code=403, detail="Learner memory access denied") from None
    except Exception as error:
        logger.warning("Learner memory operation unavailable error_type=%s", type(error).__name__)
        raise HTTPException(status_code=503, detail="Learner memory is temporarily unavailable; retry the same operation") from None


def graph_mode_for_course(agent_id: str) -> str:
    if not memory_enabled():
        return "off"
    return course_memory_mode(agent_access.load_agent(agent_id))


def assert_legacy_progress_writable(agent_id: str) -> None:
    if graph_mode_for_course(agent_id) == "authoritative":
        raise PermissionError("Graph memory is authoritative; legacy progress is read-only")


def verify_hosted_memory_disabled(agent_id: str) -> str:
    """Read, never mutate, the agent definition; expressions are not scope proof."""
    from utils.course_creation import get_creation_client

    try:
        latest = get_creation_client().agents.get(
            agent_name=agent_id, read_timeout=10
        ).versions.latest
        tools = latest.definition.tools or []
        if any("memory" in str(tool.get("type", "") if isinstance(tool, dict) else getattr(tool, "type", "")).lower() for tool in tools):
            raise HTTPException(
                status_code=409,
                detail="Disable unverified hosted memory before enabling authoritative graph memory",
            )
        version = str(latest.version)
        if not version:
            raise ValueError("Missing agent version")
        return version
    except HTTPException:
        raise
    except Exception:
        logger.warning("Could not verify hosted memory isolation", exc_info=True)
        raise HTTPException(status_code=503, detail="Hosted memory isolation could not be verified") from None


def validate_tool_context(
    context: MemoryToolContext | None, agent_id: str, user_id: str
) -> MemoryToolContext | None:
    if context is not None:
        if (
            not isinstance(context, MemoryToolContext)
            or context.scope.course_id != agent_id
            or context.scope.student_id != user_id
        ):
            raise PermissionError("Tool arguments cannot change the authorized learner scope")
        return context
    if graph_mode_for_course(agent_id) != "off":
        raise PermissionError("Graph-enabled tools require a server-authorized request scope")
    return None


def capture_chat(
    agent_id: str,
    user: ActiveUser,
    *,
    event_id: str | None,
    occurred_at: datetime | None,
    text: str,
    thread_id: str | None = None,
    image_urls: list[str] | None = None,
    supersedes_event_id: str | None = None,
) -> tuple[MemoryToolContext | None, ProcessingReceipt | None]:
    if not memory_enabled():
        return None, None
    agent = agent_access.load_agent(agent_id)
    if course_memory_mode(agent) == "off":
        return None, None
    if user.role != "student":
        # Teachers may preview a TA, but that must not manufacture learner evidence.
        raise HTTPException(status_code=403, detail="Learner chat requires the enrolled student account")
    if not event_id:
        raise HTTPException(status_code=422, detail="A stable event_id is required for learner memory")
    if event_id.startswith("operation_"):
        raise HTTPException(status_code=422, detail="This event namespace is reserved for server operations")
    access = resolve_learner_access(agent_id, user.id, user, agent=agent)
    version = verify_hosted_memory_disabled(agent_id) if access.mode == "authoritative" else None
    from backend.schemas.learner_memory import EvidenceSource, EventType, LearningEventInput

    answer = text
    if image_urls:
        # Bind retries to the attachments without treating pixels or tutor prose as reasoning.
        answer = {
            "text": text,
            "attachment_hashes": json.dumps([
                hashlib.sha256(value.encode()).hexdigest() for value in image_urls
            ], separators=(",", ":")),
        }
    event = LearningEventInput(
        event_id=event_id,
        event_type=EventType.LEARNER_MESSAGE,
        source=EvidenceSource.LEARNER_CHAT,
        source_id=event_id,
        thread_id=thread_id,
        occurred_at=datetime.now(timezone.utc),
        answer=answer, supersedes_event_id=supersedes_event_id,
    )
    receipt = _service().accept_event(access.scope, event, artifacts=image_urls) if image_urls else _service().accept_event(access.scope, event)
    return MemoryToolContext(
        scope=access.scope, actor_id=user.id, mode=access.mode,
        event_id=event_id, agent_version=version,
    ), receipt


def request_memory_kwargs(request: Request) -> dict:
    context = getattr(request.state, "memory_context", None)
    return {"memory_context": context} if context is not None else {}


def memory_tool_context(context: MemoryToolContext, tc_id: str | None = None) -> dict:
    return _service().context(context.scope, tc_id=tc_id, mode="ta")


def reject_progress_proposal(context: MemoryToolContext) -> dict:
    """The captured learner turn is evidence; model-authored summaries are not."""
    return {
        "status": "read_only",
        "memory_source": "graph_memory",
        "event_id": context.event_id,
        "message": (
            "Learner evidence was durably captured at request ingress. This tool cannot "
            "set mastery, clear misconceptions, or cross thresholds. Read the committed "
            "graph context; processing may still be pending."
        ),
    }


def freeze_tool_quiz(
    context: MemoryToolContext, arguments: dict, call_id: str
) -> dict:
    from backend.schemas.learner_memory import opaque_key

    if not call_id:
        raise ValueError("An assessment needs a stable server tool-call identity")
    problem_ids = arguments.get("problem_ids") or []
    if not isinstance(problem_ids, list) or any(not isinstance(item, str) for item in problem_ids):
        raise ValueError("problem_ids must be a list of published problem IDs")
    # The service selects keys/diagnostic mappings from the published catalog for
    # qualifying items. Model-authored questions remain non-qualifying practice.
    instance_id = opaque_key("assessment", context.event_id, call_id)
    public = _service().freeze_assessment(
        context.scope,
        questions=arguments.get("questions") or [],
        title=str(arguments.get("title") or "Quiz"),
        problem_ids=problem_ids,
        instance_id=instance_id,
    )
    return {"type": "quiz", **public}


def context_agent_reference(agent_id: str, context: MemoryToolContext | None) -> dict:
    reference = {"name": agent_id, "type": "agent_reference"}
    if context is not None and context.agent_version:
        reference["version"] = context.agent_version
    return reference


def conversation_memory_metadata(context: MemoryToolContext) -> dict[str, str]:
    from backend.schemas.learner_memory import opaque_key

    return {
        "learner_memory_scope": opaque_key(
            "conversation", context.scope.partition_key, context.scope.graph_key,
            str(context.scope.learning_epoch),
        ),
    }


def verify_memory_conversation(client, conversation_id: str, context: MemoryToolContext) -> None:
    conversation = client.conversations.retrieve(conversation_id)
    metadata = getattr(conversation, "metadata", None) or {}
    expected = conversation_memory_metadata(context)
    if any(metadata.get(key) != value for key, value in expected.items()):
        raise PermissionError("This conversation belongs to a different learner scope or memory version; start a new chat")


def legacy_projection(
    user_id: str, agent_id: str, *, memory_context: MemoryToolContext | None = None
) -> dict | None:
    """Compatibility reads never initialize or rewrite legacy progress."""
    if not memory_enabled():
        return None
    agent = agent_access.load_agent(agent_id)
    if course_memory_mode(agent) != "authoritative":
        return None
    if memory_context is None:
        return {
            "memory_source": "graph_memory", "read_only": True,
            "status": "authorized_memory_endpoint_required",
            "topics": {}, "threshold_concepts": {}, "overall": {},
        }
    validate_tool_context(memory_context, agent_id, user_id)
    snapshot = _service().get_snapshot(memory_context.scope)
    graph = _service().get_graph(memory_context.scope)
    stale = bool(
        snapshot.next_revalidation_at and snapshot.next_revalidation_at <= datetime.now(timezone.utc)
    )
    concepts = {}
    for node in graph.nodes:
        if str(node.type) != "TC":
            continue
        threshold = snapshot.threshold_states.get(node.id)
        mastery = snapshot.concept_states.get(node.id)
        state = str(threshold.state) if threshold else "NOT_CROSSED"
        historical = state
        if stale and state == "CROSSED":
            state = "CANDIDATE"
        concepts[node.name] = {
            "tc_id": node.id,
            "status": "learned" if state == "CROSSED" else (
                "in_progress" if mastery is not None else "not_started"
            ),
            "threshold_state": state,
            "historical_threshold_state": historical,
            "concept_state": str(mastery.state) if mastery else "NOT_ATTEMPTED",
            "misconceptions_addressed": [],
        }
    crossed = sum(item["threshold_state"] == "CROSSED" for item in concepts.values())
    return {
        "memory_source": "graph_memory", "read_only": True, "scope": snapshot.scope.model_dump(),
        "snapshot_version": snapshot.snapshot_version, "curriculum_version": graph.version,
        "freshness": "stale" if stale else "current",
        "topics": {}, "threshold_concepts": concepts, "learning_profile": snapshot.profile.model_dump(mode="json"),
        "overall": {
            "total_topics": len(concepts), "learned": crossed, "in_progress": len(concepts) - crossed,
            "percent": round(crossed / len(concepts) * 100) if concepts else 0,
            "label": "Threshold crossings (compatibility view)",
        },
    }


def authorized_evidence_bundle(accesses: list[LearnerAccess], tc_id: str | None = None) -> dict:
    if len(accesses) == 1:
        return _service().context(accesses[0].scope, tc_id=tc_id, mode="individual")
    return _service().cohort([access.scope for access in accesses], tc_id=tc_id)


def teacher_memory_bundle(
    accesses: list[LearnerAccess], *, individual: bool = False,
    student_ref: str = "S1", tc_id: str | None = None,
) -> dict:
    data = (
        _service().context(accesses[0].scope, tc_id=tc_id, mode="individual")
        if individual and len(accesses) == 1
        else _service().cohort([access.scope for access in accesses], tc_id=tc_id)
    )
    data = dict(data)
    if "students" in data:
        data["students"] = [
            {key: value for key, value in row.items() if key != "student_id"}
            for row in data["students"]
        ]
    catalog = []
    for evidence in data.get("evidence") or []:
        ref = f"{student_ref}-G{evidence['evidence_id'][-12:]}"
        evidence["evidence_ref"] = ref
        catalog.append({
            "ref": ref, "kind": "graph_evidence", "evidence_id": evidence["evidence_id"],
            "student_ref": student_ref, "observed_at": evidence["occurred_at"],
        })
    return {
        "memory_source": "graph_memory",
        "student_count": 1 if individual and accesses else data.get("student_count", 0),
        "requested_student_count": len(accesses),
        "complete": bool(individual and accesses) or bool(data.get("complete", False)),
        "mode": "individual" if individual else "cohort",
        "graph_context": data, "evidence_catalog": catalog,
        "chat_signals_reviewed": False,
        "students": (
            [{"student_ref": student_ref}] if individual and accesses
            else [{"student_ref": row["student_ref"]} for row in data.get("students", [])]
        ),
    }
