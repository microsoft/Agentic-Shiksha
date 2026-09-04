"""
teacher_scope.py
────────────────
Scoping helpers that restrict analytics to the courses a teacher owns.

A teacher "owns" an agent/course when either:
  - agent.createdById == teacher_id, OR
  - teacher_id in agent.teacherIds

Admins are not implicitly scoped here; the route layer decides whether an admin
sees everything or a specific teacher's view. These helpers always scope to the
given user id so they are safe to call for any role.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Dict, Any, List, Set, Optional

from . import cosmos_queries as cq
from utils.log_safe import scrub

logger = logging.getLogger("teacher-dashboard.scope")

_TEACHER_AGENTS_CACHE_TTL = 15.0
_teacher_agents_cache: Dict[str, tuple[float, List[Dict[str, Any]]]] = {}
_teacher_agents_cache_lock = threading.Lock()
_teacher_agents_load_locks: Dict[str, threading.Lock] = {}


def _teacher_agents_load_lock(teacher_id: str) -> threading.Lock:
    with _teacher_agents_cache_lock:
        return _teacher_agents_load_locks.setdefault(teacher_id, threading.Lock())


def invalidate_teacher_agents_cache(teacher_id: Optional[str] = None) -> None:
    with _teacher_agents_cache_lock:
        if teacher_id is None:
            _teacher_agents_cache.clear()
        else:
            _teacher_agents_cache.pop(teacher_id, None)


def get_teacher_agents(teacher_id: str, role: str = "teacher") -> List[Dict[str, Any]]:
    """
    Return the agent metadata docs this user may analyse.

    Teachers see the courses they own or co-teach. Admins see every course, which
    matches the access check in ``require_agent_access``.
    """
    is_admin = role == "admin"
    # Admins share one cache entry: their result does not depend on the user id.
    cache_key = "__admin__" if is_admin else teacher_id
    now = time.monotonic()
    with _teacher_agents_cache_lock:
        cached = _teacher_agents_cache.get(cache_key)
    if cached and now - cached[0] < _TEACHER_AGENTS_CACHE_TTL:
        return cached[1]

    with _teacher_agents_load_lock(cache_key):
        now = time.monotonic()
        with _teacher_agents_cache_lock:
            cached = _teacher_agents_cache.get(cache_key)
        if cached and now - cached[0] < _TEACHER_AGENTS_CACHE_TTL:
            return cached[1]

        cq._init()
        fields = (
            "SELECT c.id, c.agentId, c.name, c.description, c.imageUrl, c.createdAt, "
            "c.createdById, c.teacherIds, c.courseName, c.courseLevel, c.courseCode, "
            "c.courseDuration, c.sessionUuid FROM c"
        )
        if is_admin:
            query = fields
            params: List[Dict[str, Any]] = []
        else:
            query = (
                f"{fields} WHERE c.createdById = @tid OR ARRAY_CONTAINS(c.teacherIds, @tid)"
            )
            params = [{"name": "@tid", "value": teacher_id}]
        try:
            agents = list(
                cq._agents().query_items(
                    query=query,
                    parameters=params,
                    enable_cross_partition_query=True,
                )
            )
        except Exception as e:
            logger.error(f"Failed to list agents for {scrub(teacher_id)} (role={scrub(role)}): {scrub(e)}")
            agents = []

        with _teacher_agents_cache_lock:
            _teacher_agents_cache[cache_key] = (time.monotonic(), agents)
        return agents


def get_teacher_agent_ids(teacher_id: str, role: str = "teacher") -> Set[str]:
    """Return the set of agentIds this user may analyse."""
    return {
        a.get("agentId") or a.get("id")
        for a in get_teacher_agents(teacher_id, role)
        if a.get("agentId") or a.get("id")
    }


def owns_agent(teacher_id: str, agent_id: str, role: str = "teacher") -> bool:
    """
    True if the teacher owns/co-teaches the agent. Admins always pass.
    """
    if role == "admin":
        return True
    agent = cq.get_agent_metadata(agent_id)
    if not agent:
        return False
    if agent.get("createdById") == teacher_id:
        return True
    return teacher_id in (agent.get("teacherIds") or [])


def require_agent_access(teacher_id: str, agent_id: str, role: str = "teacher") -> Dict[str, Any]:
    """
    Return the agent metadata if the teacher may access it, else raise 403/404.
    Imported lazily to avoid a hard FastAPI dependency in this module.
    """
    from fastapi import HTTPException

    agent = cq.get_agent_metadata(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail=f"Course '{agent_id}' not found")
    if role != "admin":
        is_owner = agent.get("createdById") == teacher_id or teacher_id in (
            agent.get("teacherIds") or []
        )
        if not is_owner:
            raise HTTPException(
                status_code=403,
                detail="You do not have access to this course.",
            )
    return agent


def _extract_user_id(state_doc: Dict[str, Any], agent_id: str) -> str:
    """Derive the student's userId from a learning-state doc."""
    uid = state_doc.get("userId")
    if uid:
        return uid
    # Fall back to the id pattern: {userId}_{agentId}_state
    doc_id = state_doc.get("id", "")
    suffix = f"_{agent_id}_state"
    if doc_id.endswith(suffix):
        return doc_id[: -len(suffix)]
    return ""


def get_teacher_student_ids(teacher_id: str, role: str = "teacher") -> Set[str]:
    """
    Return the set of student userIds across all of the teacher's courses.

    Includes students who have simply chatted with a course agent, not just
    those with a tracked learning-state document.
    """
    student_ids: Set[str] = set()
    for aid in get_teacher_agent_ids(teacher_id, role):
        for state in cq.list_learning_states_for_agent(aid):
            uid = _extract_user_id(state, aid)
            if uid:
                student_ids.add(uid)
        try:
            student_ids |= cq.active_student_ids(aid)
        except Exception as e:
            logger.warning(f"active student lookup failed for {aid}: {e}")
    return student_ids


def teacher_summary(teacher_id: str, role: str = "teacher") -> Dict[str, Any]:
    """
    Aggregate a compact, scoped summary across the user's courses: course count,
    unique students, average completion, token totals, and active thread counts.
    """
    agents = get_teacher_agents(teacher_id, role)
    agent_ids = [a.get("agentId") or a.get("id") for a in agents]

    unique_students: Set[str] = set()
    active_students: Set[str] = set()
    pct_values: List[float] = []
    total_tokens = 0
    total_threads = 0
    active_threads = 0
    per_course: List[Dict[str, Any]] = []
    try:
        foundry_stats = cq.get_persisted_token_stats(agent_ids)
    except Exception as e:
        logger.warning(f"Persisted token summary unavailable: {e}")
        foundry_stats = {}

    for a in agents:
        aid = a.get("agentId") or a.get("id")
        if not aid:
            continue
        try:
            overview = cq.agent_overview(aid)
        except Exception as e:
            logger.warning(f"overview failed for {aid}: {e}")
            overview = {}
        try:
            usage = cq.agent_usage_stats(aid)
        except Exception:
            usage = {}

        students = overview.get("students", []) or []
        course_students: Set[str] = {
            s.get("user_id") for s in students if s.get("user_id")
        }
        # Students who have chatted (finished onboarding and started using it).
        course_active: Set[str] = set()
        try:
            course_active = cq.active_student_ids(aid)
        except Exception as e:
            logger.warning(f"active student lookup failed for {aid}: {e}")
        # Everyone enrolled in the course, whether or not they've started.
        try:
            course_students |= cq.enrolled_student_ids(aid)
        except Exception as e:
            logger.warning(f"enrolled student lookup failed for {aid}: {e}")
        course_students |= course_active
        unique_students |= course_students
        active_students |= course_active
        avg_pct = overview.get("avg_pct_complete")
        if isinstance(avg_pct, (int, float)):
            pct_values.append(float(avg_pct))

        try:
            course_tokens = sum(
                int(x.get("totalTokens", 0) or 0)
                for x in cq.per_student_token_usage(agent_id=aid)
            )
        except Exception:
            course_tokens = 0
        foundry_tokens = int(
            (foundry_stats.get(aid) or {}).get("total_tokens", 0) or 0
        )
        if foundry_tokens > 0:
            course_tokens = foundry_tokens
        total_tokens += course_tokens
        total_threads += int(usage.get("total_threads", 0) or 0)
        active_threads += int(usage.get("active_threads", 0) or 0)

        per_course.append(
            {
                "agentId": aid,
                "name": a.get("courseName") or a.get("name") or aid,
                "studentCount": len(course_students),
                "activeStudentCount": len(course_active),
                "avgPctComplete": avg_pct or 0,
                "totalTokens": course_tokens,
                "activeThreads": int(usage.get("active_threads", 0) or 0),
            }
        )

    avg_completion = round(sum(pct_values) / len(pct_values), 1) if pct_values else 0
    return {
        "teacherId": teacher_id,
        "courseCount": len(agents),
        "agentIds": agent_ids,
        "totalStudents": len(unique_students),
        "activeStudents": len(active_students),
        "avgPctComplete": avg_completion,
        "totalTokens": total_tokens,
        "totalThreads": total_threads,
        "activeThreads": active_threads,
        "courses": per_course,
    }
