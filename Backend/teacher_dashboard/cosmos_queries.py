"""
Cosmos DB query layer for the Dashboard server.

Reads learning-state documents from the `learning_states_v1` container
and agent metadata from `agents_v1` to power admin analytics.
"""

import os
import time
import json
import logging
import threading
import hashlib
from collections import defaultdict
from typing import Optional, List, Dict, Any
from datetime import date, datetime, timedelta, timezone

from azure.cosmos import CosmosClient
from azure.cosmos.exceptions import CosmosBatchOperationError, CosmosResourceExistsError

from azure_services.persistence.cosmos_db import get_cosmos_client

logger = logging.getLogger(__name__)

# ── Config ──────────────────────────────────────────────────────────
COSMOS_ENDPOINT = os.environ["COSMOS_ENDPOINT"]
COSMOS_DATABASE = os.getenv("COSMOS_DATABASE", "ekalaiva")

# ── Singleton ───────────────────────────────────────────────────────
_client: Optional[CosmosClient] = None
_database = None
_users_container = None
_agents_container = None
_groundedness_container = None
_messages_container = None
_threads_container = None
_invited_users_container = None
_feedback_container = None
_learning_states_container = None
_init_lock = threading.Lock()


def _init() -> None:
    """Lazy-init Cosmos client + containers (thread-safe, once per process)."""
    global _client, _database, _users_container, _agents_container
    global _groundedness_container, _messages_container, _threads_container
    global _invited_users_container, _feedback_container, _learning_states_container

    # Fast path — already initialized.
    if _client is not None:
        return

    # Slow path — serialize concurrent first-time callers so the client is
    # built exactly once even when FastAPI runs handlers across threads.
    with _init_lock:
        if _client is not None:
            return

        logger.info("Dashboard: reusing shared Cosmos DB client")
        client = get_cosmos_client()
        database = client.get_database_client(COSMOS_DATABASE)
        _users_container = database.get_container_client("users_v1")
        _agents_container = database.get_container_client("agents_v1")
        _groundedness_container = database.get_container_client("groundedness_evaluations_v1")
        _messages_container = database.get_container_client("chat_messages_v1")
        _threads_container = database.get_container_client("chat_threads_v1")
        _invited_users_container = database.get_container_client("invited_users_v1")
        _feedback_container = database.get_container_client("feedback_v1")
        _learning_states_container = database.get_container_client("learning_states_v1")
        _database = database
        # Publish the client LAST so other threads only take the fast path
        # once every container is ready.
        _client = client
        logger.info("Dashboard Cosmos DB client ready")


def _users():
    _init()
    return _users_container


def _agents():
    _init()
    return _agents_container


def _groundedness():
    _init()
    return _groundedness_container


def _messages():
    _init()
    return _messages_container


def _threads():
    _init()
    return _threads_container


def _feedback():
    _init()
    return _feedback_container


# ══════════════════════════════════════════════════════════════════
# Agent helpers (for periodic evaluator)
# ══════════════════════════════════════════════════════════════════

def get_agent_session_uuid(agent_id: str) -> Optional[str]:
    """
    Get the sessionUuid for an agent from agents_v1 Cosmos container.

    Returns:
        The sessionUuid string, or None if not found.
    """
    container = _agents()
    try:
        from azure.cosmos.exceptions import CosmosResourceNotFoundError
        agent = container.read_item(item=agent_id, partition_key=agent_id)
        return agent.get("sessionUuid")
    except CosmosResourceNotFoundError:
        return None
    except Exception as e:
        logger.warning(f"Could not read agent {agent_id}: {e}")
        return None


def get_thread(thread_id: str, user_id: str) -> Optional[Dict[str, Any]]:
    """Get a thread by ID from chat_threads_v1."""
    container = _threads()
    try:
        from azure.cosmos.exceptions import CosmosResourceNotFoundError
        return container.read_item(item=thread_id, partition_key=user_id)
    except CosmosResourceNotFoundError:
        return None
    except Exception as e:
        logger.warning(f"Could not read thread {thread_id}: {e}")
        return None


def get_recent_assistant_messages(
    limit: int = 100,
    since_hours: int = 24,
) -> List[Dict[str, Any]]:
    """
    Get recent assistant messages across all users (cross-partition).
    Used by periodic evaluator to discover unevaluated responses.

    Returns:
        List of message dicts with id, threadId, userId, messageGroupId, createdAt
    """
    container = _messages()
    cutoff = (datetime.now(timezone.utc)
              - __import__("datetime").timedelta(hours=since_hours)).isoformat()

    query = (
        f"SELECT TOP {limit} c.id, c.threadId, c.userId, c.messageGroupId, c.createdAt "
        "FROM c WHERE c.role = 'assistant' AND c.createdAt > @cutoff "
        "ORDER BY c.createdAt DESC"
    )
    try:
        items = list(container.query_items(
            query=query,
            parameters=[{"name": "@cutoff", "value": cutoff}],
            enable_cross_partition_query=True,
        ))
        return items
    except Exception as e:
        logger.error(f"Error querying recent assistant messages: {e}")
        return []


def get_evaluated_message_group_ids() -> set:
    """
    Get the set of messageGroupIds that already have groundedness evaluations.
    Cross-partition lightweight query.
    """
    container = _groundedness()
    try:
        query = "SELECT c.messageGroupId FROM c"
        items = list(container.query_items(
            query=query,
            enable_cross_partition_query=True,
        ))
        return {item["messageGroupId"] for item in items if item.get("messageGroupId")}
    except Exception as e:
        logger.error(f"Error querying evaluated messageGroupIds: {e}")
        return set()


# ════════════════════════════════════════════════════════════════════
# Agent listing
# ════════════════════════════════════════════════════════════════════

def list_agents() -> List[Dict[str, Any]]:
    """Return all agent metadata docs with creator info."""
    _init()
    query = "SELECT c.id, c.agentId, c.name, c.description, c.imageUrl, c.createdAt, c.createdById, c.courseName, c.courseLevel, c.courseCode, c.courseDuration FROM c"
    items = list(_agents().query_items(query=query, enable_cross_partition_query=True))
    # Resolve creator names (check C2 active users, then C1 invited)
    creator_ids = list(set(a.get("createdById", "") for a in items if a.get("createdById")))
    creators = {}
    for cid in creator_ids:
        profile = get_user_profile(cid)
        if not profile:
            profile = get_invite_by_id(cid)
        if profile:
            creators[cid] = profile.get("displayName") or profile.get("fullName") or profile.get("name") or ""
    for a in items:
        cid = a.get("createdById", "")
        a["createdByName"] = creators.get(cid, "")
    return items


# ════════════════════════════════════════════════════════════════════
# Learning-state queries
# ════════════════════════════════════════════════════════════════════

def list_learning_states_for_agent(agent_id: str) -> List[Dict[str, Any]]:
    """
    Return all learning-state docs whose id ends with `_{agent_id}_state`.
    Each doc is one student's progress for this agent.

    Prefers point reads over the course roster: the ENDSWITH fallback cannot use
    an index and scans the whole container.
    """
    _init()

    roster = set()
    try:
        roster = enrolled_student_ids(agent_id) | active_student_ids(agent_id)
    except Exception as e:
        logger.warning(f"roster lookup failed for {agent_id}: {e}")

    if roster:
        items = []
        for uid in roster:
            doc = get_learning_state(uid, agent_id)
            if doc:
                items.append(doc)
        return items

    suffix = f"_{agent_id}_state"
    query = (
        "SELECT * FROM c "
        "WHERE ENDSWITH(c.id, @suffix) "
        "AND c.type = 'learning_state'"
    )
    params: List[Dict[str, str]] = [{"name": "@suffix", "value": suffix}]
    items = list(
        _learning_states_container.query_items(
            query=query,
            parameters=params,
            enable_cross_partition_query=True,
        )
    )
    return items


def get_learning_state(user_id: str, agent_id: str) -> Optional[Dict[str, Any]]:
    """Fetch a single student's learning-state doc."""
    _init()
    doc_id = f"{user_id}_{agent_id}_state"
    try:
        return _learning_states_container.read_item(item=doc_id, partition_key=user_id)
    except Exception:
        return None


# ════════════════════════════════════════════════════════════════════
# Aggregation helpers
# ════════════════════════════════════════════════════════════════════

def _state_user_id(state: Dict[str, Any], agent_id: str = "") -> str:
    """Learning-state docs carry no userId field, so parse it off the `{userId}_{agentId}_state` id."""
    uid = state.get("userId")
    if uid:
        return uid
    doc_id = state.get("id", "")
    suffix = f"_{agent_id}_state" if agent_id else ""
    if suffix and doc_id.endswith(suffix):
        return doc_id[: -len(suffix)]
    return doc_id.split("_")[0] if "_" in doc_id else ""


def _summarise_state(state: Dict[str, Any], agent_id: str = "") -> Dict[str, Any]:
    """
    Compact a full learning-state doc into a lightweight summary dict
    suitable for the dashboard list view.
    """
    topics: Dict[str, Any] = state.get("topics", {})
    overall = state.get("overall", {})

    total = overall.get("total", len(topics))
    learned = overall.get("learned", 0)
    in_progress = overall.get("in_progress", 0)
    not_started = overall.get("not_started", total)

    # Recently active (last 5 topics touched)
    active_topics = sorted(
        [t for t in topics.values() if t.get("last_updated")],
        key=lambda t: t["last_updated"],
        reverse=True,
    )[:5]

    # Struggle areas: topics that have been in_progress for a long time
    # (heuristic: in_progress with no summary and updated > 0 times)
    struggle = [
        name for name, t in topics.items()
        if t.get("status") == "in_progress" and not t.get("latest_summary")
    ]

    concepts = state.get("threshold_concepts", {}) or {}
    concepts_total = len(concepts)
    concepts_learned = sum(1 for c in concepts.values() if c.get("status") == "learned")
    concepts_in_progress = sum(1 for c in concepts.values() if c.get("status") == "in_progress")

    return {
        "user_id": _state_user_id(state, agent_id),
        "agent_id": state.get("agentId", "") or agent_id,
        "total_topics": total,
        "learned": learned,
        "in_progress": in_progress,
        "not_started": not_started,
        "pct_complete": round(learned / total * 100, 1) if total else 0,
        "recently_active": [
            {"topic": t.get("name", ""), "status": t.get("status", ""), "last_updated": t.get("last_updated", "")}
            for t in active_topics
        ],
        "struggle_areas": struggle[:5],
        "concepts_total": concepts_total,
        "concepts_learned": concepts_learned,
        "concepts_in_progress": concepts_in_progress,
        "concepts_not_started": concepts_total - concepts_learned - concepts_in_progress,
        "concepts_pct_complete": (
            round(concepts_learned / concepts_total * 100, 1) if concepts_total else 0
        ),
        "last_updated": state.get("last_updated", ""),
    }


def _syllabus_topic_names(agent_id: str) -> set:
    """Every topic name in the live curriculum, used to spot off-plan exploration."""
    try:
        from azure_services.persistence.cosmos_db import get_course_curriculum

        curriculum = get_course_curriculum(agent_id) or {}
    except Exception as e:
        logger.warning(f"Could not load curriculum for '{agent_id}': {e}")
        return set()

    names = set()
    for module in curriculum.get("syllabus") or []:
        names.update(module.get("topics") or [])
    return names


def agent_asset_counts(agent_id: str) -> Dict[str, int]:
    """How many assets each student created in this course, keyed by user id."""
    from azure_services.persistence.cosmos_db import _get_assets_container

    try:
        rows = list(_get_assets_container().query_items(
            query="SELECT c.userId FROM c WHERE c.agentId = @agentId",
            parameters=[{"name": "@agentId", "value": agent_id}],
            enable_cross_partition_query=True,
        ))
    except Exception as e:
        logger.warning(f"Could not count assets for '{agent_id}': {e}")
        return {}

    counts: Dict[str, int] = defaultdict(int)
    for row in rows:
        uid = row.get("userId")
        if uid:
            counts[uid] += 1
    return dict(counts)


def agent_overview(agent_id: str) -> Dict[str, Any]:
    """
    Aggregate stats across all students for an agent.
    Excludes non-student roles (admin, teacher) from the count.
    """
    states = list_learning_states_for_agent(agent_id)
    if not states:
        return {
            "agent_id": agent_id,
            "student_count": 0,
            "avg_pct_complete": 0,
            "total_topics": 0,
            "students": [],
        }

    # Filter out non-student roles (admin, teacher) by looking up user profiles
    student_states = []
    for s in states:
        uid = _state_user_id(s, agent_id)
        if uid:
            profile = get_user_profile(uid)
            if profile and profile.get("role") in ("admin", "teacher"):
                continue
        student_states.append(s)

    if not student_states:
        first_summary = _summarise_state(states[0], agent_id) if states else None
        return {
            "agent_id": agent_id,
            "student_count": 0,
            "avg_pct_complete": 0,
            "total_topics": first_summary["total_topics"] if first_summary else 0,
            "distribution": {"0-25%": 0, "25-50%": 0, "50-75%": 0, "75-100%": 0},
            "top_struggle_topics": [],
        }

    summaries = [_summarise_state(s, agent_id) for s in student_states]
    total_topics = summaries[0]["total_topics"] if summaries else 0
    avg_pct = round(sum(s["pct_complete"] for s in summaries) / len(summaries), 1)

    # Topics the student covered that aren't on the current syllabus.
    syllabus_topics = _syllabus_topic_names(agent_id)
    for state, summary in zip(student_states, summaries):
        summary["explored"] = sum(
            1
            for name, t in (state.get("topics") or {}).items()
            if name not in syllabus_topics and t.get("status") != "not_started"
        )

    # Distribution buckets
    buckets = {"0-25%": 0, "25-50%": 0, "50-75%": 0, "75-100%": 0}
    for s in summaries:
        pct = s["pct_complete"]
        if pct < 25:
            buckets["0-25%"] += 1
        elif pct < 50:
            buckets["25-50%"] += 1
        elif pct < 75:
            buckets["50-75%"] += 1
        else:
            buckets["75-100%"] += 1

    # Most-struggled topics across students
    struggle_freq: Dict[str, int] = {}
    for s in summaries:
        for topic in s["struggle_areas"]:
            struggle_freq[topic] = struggle_freq.get(topic, 0) + 1
    top_struggles = sorted(struggle_freq.items(), key=lambda x: x[1], reverse=True)[:10]

    return {
        "agent_id": agent_id,
        "student_count": len(summaries),
        "avg_pct_complete": avg_pct,
        "total_topics": total_topics,
        "distribution": buckets,
        "top_struggle_topics": [{"topic": t, "count": c} for t, c in top_struggles],
        "students": sorted(summaries, key=lambda s: s["pct_complete"], reverse=True),
    }


_ACTIVE_USERS_CACHE: Dict[str, Any] = {}
_ACTIVE_USERS_TTL = 30


def _agent_active_users(agent_id: str) -> Dict[str, Any]:
    """
    Shared helper: resolve the users who actually sent at least one message to
    the given agent, split by role.

    Returns total/active thread counts plus the student and teacher user-id sets.
    Cached briefly: the message scan is expensive and several callers need it.
    """
    _init()

    cached = _ACTIVE_USERS_CACHE.get(agent_id)
    if cached and time.time() - cached["ts"] < _ACTIVE_USERS_TTL:
        return cached["value"]

    threads = list(_threads_container.query_items(
        query="SELECT c.id, c.userId FROM c WHERE c.agentId = @aid",
        parameters=[{"name": "@aid", "value": agent_id}],
        enable_cross_partition_query=True,
    ))
    if not threads:
        return {"total_threads": 0, "active_threads": 0, "students": set(), "teachers": set()}

    thread_user = {t["id"]: t.get("userId", "") for t in threads}

    # Distinct threadIds that have at least one user (student-authored) message
    active_thread_docs = list(_messages_container.query_items(
        query="SELECT DISTINCT c.threadId FROM c WHERE c.role = @role",
        parameters=[{"name": "@role", "value": "user"}],
        enable_cross_partition_query=True,
    ))
    all_active_tids = set(d["threadId"] for d in active_thread_docs)
    active_tids = set(thread_user.keys()) & all_active_tids

    active_uids = {thread_user[tid] for tid in active_tids if thread_user.get(tid)}

    students: set = set()
    teachers: set = set()
    for uid in active_uids:
        profile = get_user_profile(uid)
        if not profile:
            continue
        role = (profile.get("role") or "").lower()
        if role == "admin":
            continue
        if role == "teacher":
            teachers.add(uid)
        else:
            students.add(uid)

    result = {
        "total_threads": len(threads),
        "active_threads": len(active_tids),
        "students": students,
        "teachers": teachers,
    }
    _ACTIVE_USERS_CACHE[agent_id] = {"ts": time.time(), "value": result}
    return result


def active_student_ids(agent_id: str) -> set:
    """User IDs of students who actually sent at least one message to this agent."""
    return _agent_active_users(agent_id)["students"]


def enrolled_student_ids(agent_id: str) -> set:
    """
    User IDs of students enrolled in this agent (added to `studentIds` when they
    connect with the course manage code). This is the "total students" figure.
    """
    agent = get_agent_metadata(agent_id) or {}
    return {uid for uid in (agent.get("studentIds") or []) if uid}


def agent_usage_stats(agent_id: str) -> Dict[str, Any]:
    """
    Count students and teachers for the given agent. Excludes admins.

    `total_students` counts everyone enrolled in the course, while
    `active_students` counts only those who have actually sent a message
    (i.e. finished onboarding and started using it).
    """
    info = _agent_active_users(agent_id)
    try:
        enrolled = enrolled_student_ids(agent_id)
    except Exception as e:
        logger.warning(f"enrolled student lookup failed for {agent_id}: {e}")
        enrolled = set()
    return {
        "agent_id": agent_id,
        "total_students": len(enrolled | info["students"]),
        "active_students": len(info["students"]),
        "active_teachers": len(info["teachers"]),
        "total_threads": info["total_threads"],
        "active_threads": info["active_threads"],
    }


def courses_overview() -> List[Dict[str, Any]]:
    """
    Build an overview table of all teaching assistants.
    Returns per-course: name, institute, department, professors,
    active/total users, and thread/round counts.
    """
    _init()

    # 1. All agents
    agents = list(_agents_container.query_items(
        query="SELECT c.agentId, c.name, c.courseName, c.teacherIds, c.createdById FROM c",
        enable_cross_partition_query=True,
    ))

    # 2. All users (C2) — build lookup
    all_users = list(_users_container.query_items(
        query="SELECT c.id, c.displayName, c.fullName, c.email, c.role, c.institute, c.department FROM c",
        enable_cross_partition_query=True,
    ))
    user_map: Dict[str, Dict[str, Any]] = {u["id"]: u for u in all_users}

    # 3. All invited users (C1) — count by institute+department
    all_invited = list(_invited_users_container.query_items(
        query="SELECT c.id, c.email, c.role, c.status, c.institute, c.department FROM c",
        enable_cross_partition_query=True,
    ))

    # 4. All threads — group by agent → set of userIds
    all_threads = list(_threads_container.query_items(
        query="SELECT c.id, c.userId, c.agentId FROM c",
        enable_cross_partition_query=True,
    ))
    from collections import defaultdict
    threads_by_agent: Dict[str, set] = defaultdict(set)
    thread_count_by_agent: Dict[str, int] = defaultdict(int)
    for t in all_threads:
        aid = t.get("agentId", "")
        uid = t.get("userId", "")
        if aid and uid:
            threads_by_agent[aid].add(uid)
            thread_count_by_agent[aid] += 1

    # 4b. Count assistant messages per agent (= rounds) + aggregate token usage
    #     Only count messages from student threads (exclude admin/teacher)
    all_messages = list(_messages_container.query_items(
        query="SELECT c.threadId, c.metadata.tokenUsage FROM c WHERE c.role = 'assistant'",
        enable_cross_partition_query=True,
    ))
    # Build threadId → agentId lookup
    thread_to_agent: Dict[str, str] = {}
    thread_to_user_map: Dict[str, str] = {}
    for t in all_threads:
        thread_to_agent[t["id"]] = t.get("agentId", "")
        thread_to_user_map[t["id"]] = t.get("userId", "")
    rounds_by_agent: Dict[str, int] = defaultdict(int)
    tokens_by_agent: Dict[str, int] = defaultdict(int)
    for m in all_messages:
        tid = m.get("threadId", "")
        aid = thread_to_agent.get(tid, "")
        if not aid:
            continue
        # Skip admin/teacher messages
        msg_uid = thread_to_user_map.get(tid, "")
        msg_profile = user_map.get(msg_uid, {})
        if msg_profile.get("role", "") in ("admin", "teacher"):
            continue
        rounds_by_agent[aid] += 1
        tu = m.get("tokenUsage")
        if tu and isinstance(tu, dict):
            tokens_by_agent[aid] += tu.get("total_tokens", 0) or 0

    # 5. Count total users per institute+department (C1 invited + C2 active)
    inst_dept_totals: Dict[str, int] = defaultdict(int)
    seen_emails: set = set()
    for u in all_invited:
        inst = (u.get("institute") or "").strip()
        dept = (u.get("department") or "").strip()
        email = (u.get("email") or "").strip().lower()
        if inst and dept and email and email not in seen_emails:
            seen_emails.add(email)
            inst_dept_totals[f"{inst}||{dept}"] += 1
    for u in all_users:
        inst = (u.get("institute") or "").strip()
        dept = (u.get("department") or "").strip()
        email = (u.get("email") or "").strip().lower()
        if inst and dept and email and email not in seen_emails:
            seen_emails.add(email)
            inst_dept_totals[f"{inst}||{dept}"] += 1

    results = []
    for agent in agents:
        aid = agent.get("agentId", "")
        course_name = agent.get("courseName") or agent.get("name") or aid

        # Resolve teachers
        teacher_ids = agent.get("teacherIds") or []
        teachers = []
        institute = ""
        department = ""
        for tid in teacher_ids:
            u = user_map.get(tid)
            if u:
                name = u.get("fullName") or u.get("displayName") or ""
                if name:
                    teachers.append(name)
                # Use first teacher's institute/department for the course
                if not institute:
                    institute = (u.get("institute") or "").strip()
                if not department:
                    department = (u.get("department") or "").strip()

        # Active users (students who have threads with this agent, excluding admins/teachers)
        agent_user_ids = threads_by_agent.get(aid, set())
        active_students = 0
        for uid in agent_user_ids:
            profile = user_map.get(uid)
            if not profile:
                active_students += 1  # Unknown user, count as student
                continue
            role = profile.get("role", "")
            if role not in ("admin", "teacher"):
                active_students += 1

        # Total users in the same institute+department
        total_users = inst_dept_totals.get(f"{institute}||{department}", 0)
        if total_users < active_students:
            total_users = active_students

        results.append({
            "agentId": aid,
            "course": course_name,
            "institute": institute,
            "department": department,
            "professors": teachers,
            "activeUsers": active_students,
            "totalUsers": total_users,
            "conversations": thread_count_by_agent.get(aid, 0),
            "rounds": rounds_by_agent.get(aid, 0),
            "totalTokens": tokens_by_agent.get(aid, 0),
        })

    # Sort by active users descending
    results.sort(key=lambda r: r["activeUsers"], reverse=True)

    # Global unique user count (deduplicated across all inst/dept)
    unique_total_users = len(seen_emails)

    return results, unique_total_users


def today_stats(start_date: Optional[str] = None, end_date: Optional[str] = None) -> Dict[str, Any]:
    """
    Returns usage stats for a date range.
    start_date/end_date are ISO date strings (YYYY-MM-DD). Defaults to today.
    """
    _init()
    from collections import defaultdict

    if not start_date:
        start_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if not end_date:
        end_date = start_date

    def in_range(iso_ts: str) -> bool:
        day = iso_ts[:10]
        return start_date <= day <= end_date

    # 1. Threads (new conversations in range)
    all_threads = list(_threads_container.query_items(
        query="SELECT c.id, c.userId, c.agentId, c.createdAt FROM c",
        enable_cross_partition_query=True,
    ))
    thread_to_user: Dict[str, str] = {}
    range_threads = 0
    for t in all_threads:
        thread_to_user[t["id"]] = t.get("userId", "")
        created = t.get("createdAt", "")
        if created and in_range(created):
            range_threads += 1

    # 2. Assistant messages in range → tokens + rounds + active students
    all_messages = list(_messages_container.query_items(
        query="SELECT c.threadId, c.createdAt, c.metadata.tokenUsage FROM c WHERE c.role = 'assistant'",
        enable_cross_partition_query=True,
    ))
    range_tokens = 0
    range_rounds = 0
    range_students: set = set()
    for m in all_messages:
        created = m.get("createdAt", "")
        if not created or not in_range(created):
            continue
        range_rounds += 1
        tid = m.get("threadId", "")
        uid = thread_to_user.get(tid, "")
        if uid:
            range_students.add(uid)
        tu = m.get("tokenUsage")
        if tu and isinstance(tu, dict):
            range_tokens += tu.get("total_tokens", 0) or 0

    return {
        "activeStudents": len(range_students),
        "tokens": range_tokens,
        "rounds": range_rounds,
        "newConversations": range_threads,
        "startDate": start_date,
        "endDate": end_date,
    }


MIN_USAGE_DISTRIBUTION_STUDENTS = 5
USAGE_QUERY_THREAD_BATCH_SIZE = 100
TOKEN_USAGE_EVENT_TYPE = "token_usage_event"
TOKEN_USAGE_SYNC_PARTITION = "__token_usage_sync__"
TOKEN_USAGE_SYNC_STATE_ID = "token-usage-sync-state"


def _token_usage_partition(agent_id: str) -> str:
    return f"__token_usage__:{agent_id}"


def _token_usage_event_id(source_event_id: str) -> str:
    digest = hashlib.sha256(source_event_id.encode("utf-8")).hexdigest()
    return f"token-usage-{digest}"


def build_token_usage_event(
    *,
    agent_id: str,
    source_event_id: str,
    created_at: str,
    input_tokens: int,
    output_tokens: int,
    total_tokens: int,
    source: str,
    student_user_id: Optional[str] = None,
    conversation_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Build an immutable token fact isolated from real chat partitions."""
    partition = _token_usage_partition(agent_id)
    document = {
        "id": _token_usage_event_id(source_event_id),
        "userId": partition,
        "recordType": TOKEN_USAGE_EVENT_TYPE,
        "agentId": agent_id,
        "sourceEventId": source_event_id,
        "source": source,
        "createdAt": created_at,
        "inputTokens": _positive_token_count(input_tokens),
        "outputTokens": _positive_token_count(output_tokens),
        "totalTokens": _positive_token_count(total_tokens),
    }
    if student_user_id:
        document["studentUserId"] = student_user_id
    if conversation_id:
        document["conversationId"] = conversation_id
    return document


def store_token_usage_event(event: Dict[str, Any]) -> bool:
    """Create one event once. False means it was already materialized."""
    _init()
    try:
        _messages_container.create_item(body=event)
        return True
    except CosmosResourceExistsError:
        return False


def store_token_usage_events(events: List[Dict[str, Any]]) -> Dict[str, int]:
    """Materialize usage facts in partition-local batches."""
    _init()
    grouped: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for event in events:
        partition = event.get("userId")
        if partition:
            grouped[partition].append(event)

    stored = 0
    existing = 0
    for partition, partition_events in grouped.items():
        existing_ids = {
            item["id"]
            for item in _messages_container.query_items(
                query="SELECT c.id FROM c WHERE c.recordType = @recordType",
                parameters=[
                    {"name": "@recordType", "value": TOKEN_USAGE_EVENT_TYPE}
                ],
                partition_key=partition,
            )
        }
        missing = [event for event in partition_events if event["id"] not in existing_ids]
        existing += len(partition_events) - len(missing)
        for offset in range(0, len(missing), 100):
            batch = missing[offset : offset + 100]
            try:
                _messages_container.execute_item_batch(
                    [("create", (event,)) for event in batch],
                    partition_key=partition,
                )
                stored += len(batch)
            except CosmosBatchOperationError:
                for event in batch:
                    if store_token_usage_event(event):
                        stored += 1
                    else:
                        existing += 1
    return {"stored": stored, "existing": existing}


def get_persisted_token_usage_events(
    agent_ids: List[str],
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
) -> List[Dict[str, Any]]:
    """Read materialized token facts by agent partition; never calls Foundry."""
    _init()
    events: List[Dict[str, Any]] = []
    for agent_id in sorted({agent_id for agent_id in agent_ids if agent_id}):
        partition = _token_usage_partition(agent_id)
        conditions = ["c.recordType = @recordType"]
        parameters: List[Dict[str, Any]] = [
            {"name": "@recordType", "value": TOKEN_USAGE_EVENT_TYPE}
        ]
        if start_date is not None:
            conditions.append("c.createdAt >= @startDate")
            parameters.append(
                {"name": "@startDate", "value": f"{start_date.isoformat()}T00:00:00Z"}
            )
        if end_date is not None:
            conditions.append("c.createdAt < @endDate")
            parameters.append(
                {
                    "name": "@endDate",
                    "value": f"{(end_date + timedelta(days=1)).isoformat()}T00:00:00Z",
                }
            )
        query = (
            "SELECT c.agentId, c.createdAt, c.inputTokens, c.outputTokens, "
            "c.totalTokens, c.source, c.studentUserId "
            f"FROM c WHERE {' AND '.join(conditions)}"
        )
        events.extend(
            _messages_container.query_items(
                query=query,
                parameters=parameters,
                partition_key=partition,
            )
        )
    return events


def get_persisted_token_stats(agent_ids: List[str]) -> Dict[str, Dict[str, Any]]:
    """Return all-time per-agent totals from materialized Cosmos events."""
    result: Dict[str, Dict[str, Any]] = {}
    for event in get_persisted_token_usage_events(agent_ids):
        agent_id = event.get("agentId")
        if not agent_id:
            continue
        stats = result.setdefault(
            agent_id,
            {
                "total_tokens": 0,
                "input_tokens": 0,
                "output_tokens": 0,
                "rounds": 0,
                "conversations": 0,
            },
        )
        stats["input_tokens"] += _positive_token_count(event.get("inputTokens"))
        stats["output_tokens"] += _positive_token_count(event.get("outputTokens"))
        stats["total_tokens"] += _positive_token_count(event.get("totalTokens"))
        stats["rounds"] += 1
    return result


def get_token_usage_sync_state() -> Optional[Dict[str, Any]]:
    _init()
    try:
        return _messages_container.read_item(
            item=TOKEN_USAGE_SYNC_STATE_ID,
            partition_key=TOKEN_USAGE_SYNC_PARTITION,
        )
    except Exception:
        return None


def save_token_usage_sync_state(state: Dict[str, Any]) -> None:
    _init()
    _messages_container.upsert_item(
        body={
            **state,
            "id": TOKEN_USAGE_SYNC_STATE_ID,
            "userId": TOKEN_USAGE_SYNC_PARTITION,
            "recordType": "token_usage_sync_state",
        }
    )


def _usage_bucket_start(value: date, granularity: str) -> date:
    if granularity == "day":
        return value
    if granularity == "week":
        return value - timedelta(days=value.weekday())
    if granularity == "month":
        return value.replace(day=1)
    raise ValueError(f"Unsupported usage granularity: {granularity}")


def _next_usage_bucket_start(value: date, granularity: str) -> date:
    if granularity == "day":
        return value + timedelta(days=1)
    if granularity == "week":
        return value + timedelta(days=7)
    if value.month == 12:
        return date(value.year + 1, 1, 1)
    return date(value.year, value.month + 1, 1)


def _message_date(created_at: Any) -> Optional[date]:
    if not isinstance(created_at, str) or len(created_at) < 10:
        return None
    try:
        return date.fromisoformat(created_at[:10])
    except ValueError:
        return None


def _positive_token_count(value: Any) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def _usage_distribution(student_tokens: Dict[str, int]) -> tuple[List[Dict[str, Any]], bool]:
    student_count = len(student_tokens)
    if student_count < MIN_USAGE_DISTRIBUTION_STUDENTS:
        return [], True

    average = sum(student_tokens.values()) / student_count
    counts = {"light": 0, "typical": 0, "high": 0}
    for tokens in student_tokens.values():
        if tokens < average * 0.5:
            counts["light"] += 1
        elif tokens <= average * 1.5:
            counts["typical"] += 1
        else:
            counts["high"] += 1

    labels = {
        "light": "Light",
        "typical": "Typical",
        "high": "High",
    }
    distribution = [
        {
            "key": key,
            "label": labels[key],
            "studentCount": counts[key],
            "studentPercentage": round(counts[key] / student_count * 100, 1),
        }
        for key in ("light", "typical", "high")
    ]
    return distribution, False


def _aggregate_token_usage(
    messages: List[Dict[str, Any]],
    start_date: date,
    end_date: date,
    granularity: str,
) -> Dict[str, Any]:
    bucket_cursor = _usage_bucket_start(start_date, granularity)
    bucket_tokens: Dict[date, Dict[str, int]] = {}
    bucket_ranges: List[tuple[date, date, date]] = []
    while bucket_cursor <= end_date:
        next_bucket = _next_usage_bucket_start(bucket_cursor, granularity)
        bucket_ranges.append(
            (
                bucket_cursor,
                max(bucket_cursor, start_date),
                min(next_bucket - timedelta(days=1), end_date),
            )
        )
        bucket_tokens[bucket_cursor] = {"input": 0, "output": 0, "total": 0}
        bucket_cursor = next_bucket

    daily_tokens: Dict[date, Dict[str, int]] = {}
    day_cursor = start_date
    while day_cursor <= end_date:
        daily_tokens[day_cursor] = {"input": 0, "output": 0, "total": 0}
        day_cursor += timedelta(days=1)

    total_responses = 0
    tracked_responses = 0
    total_input_tokens = 0
    total_output_tokens = 0
    total_tokens = 0
    active_student_ids: set[str] = set()
    student_tokens: Dict[str, int] = defaultdict(int)

    for message in messages:
        message_day = _message_date(message.get("createdAt"))
        if message_day is None or not start_date <= message_day <= end_date:
            continue
        total_responses += 1
        user_id = message.get("userId")
        if isinstance(user_id, str) and user_id:
            active_student_ids.add(user_id)
        input_tokens = _positive_token_count(message.get("inputTokens"))
        output_tokens = _positive_token_count(message.get("outputTokens"))
        tokens = _positive_token_count(message.get("totalTokens"))
        if tokens == 0 and input_tokens + output_tokens > 0:
            tokens = input_tokens + output_tokens
        if tokens == 0:
            continue

        tracked_responses += 1
        total_input_tokens += input_tokens
        total_output_tokens += output_tokens
        total_tokens += tokens
        bucket = bucket_tokens[_usage_bucket_start(message_day, granularity)]
        bucket["input"] += input_tokens
        bucket["output"] += output_tokens
        bucket["total"] += tokens
        daily_bucket = daily_tokens[message_day]
        daily_bucket["input"] += input_tokens
        daily_bucket["output"] += output_tokens
        daily_bucket["total"] += tokens
        if isinstance(user_id, str) and user_id:
            student_tokens[user_id] += tokens

    cumulative = {"input": 0, "output": 0, "total": 0}
    series = []
    for bucket_start, period_start, period_end in bucket_ranges:
        period_tokens = bucket_tokens[bucket_start]
        for key in cumulative:
            cumulative[key] += period_tokens[key]
        series.append(
            {
                "periodStart": period_start.isoformat(),
                "periodEnd": period_end.isoformat(),
                "inputTokens": period_tokens["input"],
                "outputTokens": period_tokens["output"],
                "totalTokens": period_tokens["total"],
                "cumulativeInputTokens": cumulative["input"],
                "cumulativeOutputTokens": cumulative["output"],
                "cumulativeTokens": cumulative["total"],
            }
        )

    daily_cumulative = {"input": 0, "output": 0, "total": 0}
    daily_series = []
    for day, day_tokens in daily_tokens.items():
        for key in daily_cumulative:
            daily_cumulative[key] += day_tokens[key]
        daily_series.append(
            {
                "periodStart": day.isoformat(),
                "periodEnd": day.isoformat(),
                "inputTokens": day_tokens["input"],
                "outputTokens": day_tokens["output"],
                "totalTokens": day_tokens["total"],
                "cumulativeInputTokens": daily_cumulative["input"],
                "cumulativeOutputTokens": daily_cumulative["output"],
                "cumulativeTokens": daily_cumulative["total"],
            }
        )

    distribution, distribution_suppressed = _usage_distribution(student_tokens)
    coverage = round(tracked_responses / total_responses * 100, 1) if total_responses else 0
    return {
        "startDate": start_date.isoformat(),
        "endDate": end_date.isoformat(),
        "granularity": granularity,
        "totalInputTokens": total_input_tokens,
        "totalOutputTokens": total_output_tokens,
        "totalTokens": total_tokens,
        "activeStudents": len(active_student_ids),
        "trackedResponses": tracked_responses,
        "totalResponses": total_responses,
        "coveragePct": coverage,
        "series": series,
        "dailySeries": daily_series,
        "distribution": distribution,
        "distributionSuppressed": distribution_suppressed,
        "minimumDistributionStudents": MIN_USAGE_DISTRIBUTION_STUDENTS,
    }


def _aggregate_activity_events(
    events: List[Dict[str, Any]],
    start_date: date,
    end_date: date,
    granularity: str,
    metric: str,
) -> Dict[str, Any]:
    """Aggregate timestamped learning events without exposing student values."""
    bucket_cursor = _usage_bucket_start(start_date, granularity)
    bucket_counts: Dict[date, int] = {}
    bucket_ranges: List[tuple[date, date, date]] = []
    while bucket_cursor <= end_date:
        next_bucket = _next_usage_bucket_start(bucket_cursor, granularity)
        bucket_ranges.append(
            (
                bucket_cursor,
                max(bucket_cursor, start_date),
                min(next_bucket - timedelta(days=1), end_date),
            )
        )
        bucket_counts[bucket_cursor] = 0
        bucket_cursor = next_bucket

    daily_counts: Dict[date, int] = {}
    day_cursor = start_date
    while day_cursor <= end_date:
        daily_counts[day_cursor] = 0
        day_cursor += timedelta(days=1)

    active_students: set[str] = set()
    active_courses: set[str] = set()
    student_counts: Dict[str, int] = defaultdict(int)
    total_events = 0
    for event in events:
        event_day = _message_date(event.get("occurredAt") or event.get("createdAt"))
        if event_day is None or not start_date <= event_day <= end_date:
            continue
        total_events += 1
        bucket_counts[_usage_bucket_start(event_day, granularity)] += 1
        daily_counts[event_day] += 1
        user_id = event.get("userId")
        if isinstance(user_id, str) and user_id:
            active_students.add(user_id)
            student_counts[user_id] += 1
        agent_id = event.get("agentId")
        if isinstance(agent_id, str) and agent_id:
            active_courses.add(agent_id)

    cumulative_count = 0
    series = []
    for bucket_start, period_start, period_end in bucket_ranges:
        count = bucket_counts[bucket_start]
        cumulative_count += count
        series.append(
            {
                "periodStart": period_start.isoformat(),
                "periodEnd": period_end.isoformat(),
                "count": count,
                "cumulativeCount": cumulative_count,
            }
        )

    daily_cumulative = 0
    daily_series = []
    for day, count in daily_counts.items():
        daily_cumulative += count
        daily_series.append(
            {
                "periodStart": day.isoformat(),
                "periodEnd": day.isoformat(),
                "count": count,
                "cumulativeCount": daily_cumulative,
            }
        )

    distribution, distribution_suppressed = _usage_distribution(student_counts)
    return {
        "metric": metric,
        "startDate": start_date.isoformat(),
        "endDate": end_date.isoformat(),
        "granularity": granularity,
        "totalEvents": total_events,
        "activeStudents": len(active_students),
        "activeCourses": len(active_courses),
        "activeDays": sum(1 for count in daily_counts.values() if count > 0),
        "series": series,
        "dailySeries": daily_series,
        "distribution": distribution,
        "distributionSuppressed": distribution_suppressed,
        "minimumDistributionStudents": MIN_USAGE_DISTRIBUTION_STUDENTS,
    }


def merge_token_usage_sources(
    cosmos_result: Dict[str, Any], foundry_result: Dict[str, Any]
) -> Dict[str, Any]:
    """Use Foundry totals while retaining Cosmos student-attribution metrics."""
    merged = dict(cosmos_result)
    merged["usageSource"] = "cosmos"
    merged["sourceResponses"] = cosmos_result.get("trackedResponses", 0)
    if _positive_token_count(foundry_result.get("totalTokens")) == 0:
        return merged

    for key in (
        "totalInputTokens",
        "totalOutputTokens",
        "totalTokens",
        "series",
        "dailySeries",
    ):
        merged[key] = foundry_result[key]
    merged["usageSource"] = foundry_result.get("usageSource", "cosmos")
    merged["sourceResponses"] = foundry_result.get("trackedResponses", 0)
    return merged


def aggregate_token_usage_events(
    events: List[Dict[str, Any]],
    start_date: date,
    end_date: date,
    granularity: str,
) -> Dict[str, Any]:
    """Aggregate normalized token events from a non-Cosmos source."""
    return _aggregate_token_usage(events, start_date, end_date, granularity)


def _threshold_crossing_events(
    agent_id: str,
    states: List[Dict[str, Any]],
) -> List[Dict[str, str]]:
    """Project current learned threshold concepts into timestamped crossing events."""
    events = []
    for state in states:
        user_id = _state_user_id(state, agent_id)
        for concept in (state.get("threshold_concepts") or {}).values():
            occurred_at = concept.get("last_updated") or concept.get("last_touched")
            if concept.get("status") != "learned" or not occurred_at:
                continue
            events.append(
                {
                    "occurredAt": occurred_at,
                    "userId": user_id,
                    "agentId": agent_id,
                }
            )
    return events


def _exclude_staff_activity(events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Remove teacher/admin test activity from student-facing aggregates."""
    user_ids = sorted({event.get("userId") for event in events if event.get("userId")})
    excluded_user_ids: set[str] = set()
    for offset in range(0, len(user_ids), USAGE_QUERY_THREAD_BATCH_SIZE):
        user_batch = user_ids[offset : offset + USAGE_QUERY_THREAD_BATCH_SIZE]
        users = _users_container.query_items(
            query=(
                "SELECT c.id, c.role FROM c "
                "WHERE ARRAY_CONTAINS(@userIds, c.id)"
            ),
            parameters=[{"name": "@userIds", "value": user_batch}],
            enable_cross_partition_query=True,
        )
        for user in users:
            if user.get("role") in ("teacher", "admin"):
                excluded_user_ids.add(user.get("id", ""))
    if not excluded_user_ids:
        return events
    return [event for event in events if event.get("userId") not in excluded_user_ids]


def learning_activity_analytics(
    agent_ids: List[str],
    start_date: date,
    end_date: date,
    granularity: str,
    metric: str,
) -> Dict[str, Any]:
    """Return teacher-scoped threshold-crossing or asset-creation analytics."""
    _init()
    unique_agent_ids = sorted({agent_id for agent_id in agent_ids if agent_id})
    events: List[Dict[str, Any]] = []
    if metric == "threshold_crossings":
        for agent_id in unique_agent_ids:
            events.extend(
                _threshold_crossing_events(
                    agent_id,
                    list_learning_states_for_agent(agent_id),
                )
            )
    elif metric == "assets_created" and unique_agent_ids:
        from azure_services.persistence.cosmos_db import _get_assets_container

        end_exclusive = end_date + timedelta(days=1)
        assets = _get_assets_container().query_items(
            query=(
                "SELECT c.userId, c.agentId, c.createdAt FROM c "
                "WHERE ARRAY_CONTAINS(@agentIds, c.agentId) "
                "AND c.createdAt >= @startDate AND c.createdAt < @endDate"
            ),
            parameters=[
                {"name": "@agentIds", "value": unique_agent_ids},
                {"name": "@startDate", "value": f"{start_date.isoformat()}T00:00:00Z"},
                {"name": "@endDate", "value": f"{end_exclusive.isoformat()}T00:00:00Z"},
            ],
            enable_cross_partition_query=True,
        )
        events.extend(
            {
                "occurredAt": asset.get("createdAt"),
                "userId": asset.get("userId", ""),
                "agentId": asset.get("agentId", ""),
            }
            for asset in assets
        )
    elif metric not in ("threshold_crossings", "assets_created"):
        raise ValueError(f"Unsupported activity metric: {metric}")

    return _aggregate_activity_events(
        _exclude_staff_activity(events),
        start_date,
        end_date,
        granularity,
        metric,
    )


def token_usage_analytics(
    agent_ids: List[str],
    start_date: date,
    end_date: date,
    granularity: str,
) -> Dict[str, Any]:
    """Return teacher-scoped aggregate usage without student-level values."""
    _init()
    unique_agent_ids = sorted({agent_id for agent_id in agent_ids if agent_id})
    if not unique_agent_ids:
        return _aggregate_token_usage([], start_date, end_date, granularity)

    thread_to_user: Dict[str, str] = {}
    threads = _threads_container.query_items(
        query=(
            "SELECT c.id, c.userId FROM c "
            "WHERE ARRAY_CONTAINS(@agentIds, c.agentId)"
        ),
        parameters=[{"name": "@agentIds", "value": unique_agent_ids}],
        enable_cross_partition_query=True,
    )
    for thread in threads:
        thread_id = thread.get("id")
        if thread_id:
            thread_to_user[thread_id] = thread.get("userId", "")

    user_ids = sorted({user_id for user_id in thread_to_user.values() if user_id})
    excluded_user_ids: set[str] = set()
    for offset in range(0, len(user_ids), USAGE_QUERY_THREAD_BATCH_SIZE):
        user_batch = user_ids[offset : offset + USAGE_QUERY_THREAD_BATCH_SIZE]
        users = _users_container.query_items(
            query=(
                "SELECT c.id, c.role FROM c "
                "WHERE ARRAY_CONTAINS(@userIds, c.id)"
            ),
            parameters=[{"name": "@userIds", "value": user_batch}],
            enable_cross_partition_query=True,
        )
        for user in users:
            if user.get("role") in ("teacher", "admin"):
                excluded_user_ids.add(user.get("id", ""))
    if excluded_user_ids:
        thread_to_user = {
            thread_id: user_id
            for thread_id, user_id in thread_to_user.items()
            if user_id not in excluded_user_ids
        }

    if not thread_to_user:
        return _aggregate_token_usage([], start_date, end_date, granularity)

    end_exclusive = end_date + timedelta(days=1)
    scoped_messages = []
    thread_ids = list(thread_to_user)
    for offset in range(0, len(thread_ids), USAGE_QUERY_THREAD_BATCH_SIZE):
        thread_batch = thread_ids[offset : offset + USAGE_QUERY_THREAD_BATCH_SIZE]
        messages = _messages_container.query_items(
            query=(
                "SELECT c.threadId, c.createdAt, "
                "c.metadata.tokenUsage.input_tokens AS inputTokens, "
                "c.metadata.tokenUsage.output_tokens AS outputTokens, "
                "c.metadata.tokenUsage.total_tokens AS totalTokens "
                "FROM c WHERE c.role = @role "
                "AND c.createdAt >= @startDate AND c.createdAt < @endDate "
                "AND ARRAY_CONTAINS(@threadIds, c.threadId)"
            ),
            parameters=[
                {"name": "@role", "value": "assistant"},
                {"name": "@startDate", "value": f"{start_date.isoformat()}T00:00:00Z"},
                {"name": "@endDate", "value": f"{end_exclusive.isoformat()}T00:00:00Z"},
                {"name": "@threadIds", "value": thread_batch},
            ],
            enable_cross_partition_query=True,
        )
        for message in messages:
            thread_id = message.get("threadId")
            scoped_messages.append(
                {
                    "createdAt": message.get("createdAt"),
                    "inputTokens": message.get("inputTokens", 0),
                    "outputTokens": message.get("outputTokens", 0),
                    "totalTokens": message.get("totalTokens", 0),
                    "userId": thread_to_user.get(thread_id, ""),
                }
            )

    result = _aggregate_token_usage(
        scoped_messages,
        start_date,
        end_date,
        granularity,
    )
    logger.debug(
        "Teacher usage analytics: %s agents, %s/%s tracked responses",
        len(unique_agent_ids),
        result["trackedResponses"],
        result["totalResponses"],
    )
    return result


def per_student_token_usage(agent_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Per-student token usage, optionally filtered to a single agent/course.
    Returns a list of { userId, displayName, email, totalTokens, rounds }.
    """
    _init()
    from collections import defaultdict

    # 1. All threads → userId + agentId mapping
    all_threads = list(_threads_container.query_items(
        query="SELECT c.id, c.userId, c.agentId FROM c",
        enable_cross_partition_query=True,
    ))
    thread_to_user: Dict[str, str] = {}
    thread_to_agent: Dict[str, str] = {}
    for t in all_threads:
        thread_to_user[t["id"]] = t.get("userId", "")
        thread_to_agent[t["id"]] = t.get("agentId", "")

    # 2. All assistant messages with token usage
    all_messages = list(_messages_container.query_items(
        query="SELECT c.threadId, c.metadata.tokenUsage FROM c WHERE c.role = 'assistant'",
        enable_cross_partition_query=True,
    ))

    # 3. Aggregate by userId (filter by agent_id if provided)
    user_tokens: Dict[str, int] = defaultdict(int)
    user_rounds: Dict[str, int] = defaultdict(int)
    for m in all_messages:
        tid = m.get("threadId", "")
        uid = thread_to_user.get(tid, "")
        if not uid:
            continue
        if agent_id and thread_to_agent.get(tid, "") != agent_id:
            continue
        user_rounds[uid] += 1
        tu = m.get("tokenUsage")
        if tu and isinstance(tu, dict):
            user_tokens[uid] += tu.get("total_tokens", 0) or 0

    # 4. Resolve user names
    all_users = list(_users_container.query_items(
        query="SELECT c.id, c.displayName, c.fullName, c.email, c.role FROM c",
        enable_cross_partition_query=True,
    ))
    user_map: Dict[str, Dict[str, Any]] = {u["id"]: u for u in all_users}

    # 5. Build result — only users that have usage, exclude admin/teacher
    results = []
    all_user_ids = set(user_tokens.keys()) | set(user_rounds.keys())
    for uid in all_user_ids:
        profile = user_map.get(uid, {})
        role = profile.get("role", "")
        if role in ("admin", "teacher"):
            continue
        tokens = user_tokens.get(uid, 0)
        rounds = user_rounds.get(uid, 0)
        if tokens == 0 and rounds == 0:
            continue
        results.append({
            "userId": uid,
            "displayName": profile.get("fullName") or profile.get("displayName") or uid,
            "email": profile.get("email", ""),
            "totalTokens": tokens,
            "rounds": rounds,
        })

    # Sort by tokens desc
    results.sort(key=lambda r: r["totalTokens"], reverse=True)
    return results


def student_detail(user_id: str, agent_id: str) -> Optional[Dict[str, Any]]:
    """Full per-topic breakdown for a single student."""
    state = get_learning_state(user_id, agent_id)
    if not state:
        return None

    topics = state.get("topics", {})

    # Group by status
    by_status: Dict[str, list] = {"learned": [], "in_progress": [], "not_started": []}
    for name, t in topics.items():
        status = t.get("status", "not_started")
        entry = {
            "topic": name,
            "status": status,
            "latest_summary": t.get("latest_summary", ""),
            "last_updated": t.get("last_updated", ""),
            "module": t.get("module", ""),
        }
        by_status.setdefault(status, []).append(entry)

    overall = state.get("overall", {})
    total = overall.get("total", len(topics))
    learned = overall.get("learned", 0)

    # Threshold concepts are tracked separately from syllabus topics.
    concepts = state.get("threshold_concepts", {})
    concepts_by_status: Dict[str, list] = {"learned": [], "in_progress": [], "not_started": []}
    for name, c in concepts.items():
        status = c.get("status", "not_started")
        concepts_by_status.setdefault(status, []).append({
            "concept": name,
            "status": status,
            "misconceptions_addressed": c.get("misconceptions_addressed", []),
            "misconception_notes": c.get("misconception_notes", {}),
            "last_updated": c.get("last_updated", ""),
        })
    concepts_total = len(concepts)
    concepts_learned = len(concepts_by_status.get("learned", []))

    return {
        "user_id": user_id,
        "agent_id": agent_id,
        "total_topics": total,
        "learned": learned,
        "in_progress": overall.get("in_progress", 0),
        "not_started": overall.get("not_started", total),
        "pct_complete": round(learned / total * 100, 1) if total else 0,
        "topics_by_status": by_status,
        "concepts_by_status": concepts_by_status,
        "total_concepts": concepts_total,
        "concepts_learned": concepts_learned,
        "concepts_in_progress": len(concepts_by_status.get("in_progress", [])),
        "concepts_pct_complete": (
            round(concepts_learned / concepts_total * 100, 1) if concepts_total else 0
        ),
        "last_updated": state.get("last_updated", ""),
    }


def student_assets(user_id: str, agent_id: str, limit: int = 100) -> List[Dict[str, Any]]:
    """
    Assets a student created while working inside one course.

    Scoped to the course so a teacher only ever sees what was made in their own
    agent, and metadata-only: asset bodies are user-authored HTML/markdown and
    are deliberately never sent to the dashboard.
    """
    from azure_services.persistence.cosmos_db import list_user_assets

    try:
        assets = list_user_assets(user_id=user_id, agent_id=agent_id, limit=limit)
    except Exception as e:
        logger.warning(f"Failed to list assets for '{user_id}' on '{agent_id}': {e}")
        return []

    return [
        {
            "id": a.get("id", ""),
            "title": a.get("title") or "Untitled",
            "description": a.get("description") or "",
            "category": a.get("category") or "other",
            "type": a.get("type") or "text",
            "tags": a.get("tags") or [],
            "thread_id": a.get("threadId") or "",
            "preview_image_url": a.get("previewImageUrl") or "",
            "created_at": a.get("createdAt", ""),
            "updated_at": a.get("updatedAt", ""),
        }
        for a in assets
    ]


def student_asset(user_id: str, agent_id: str, asset_id: str) -> Optional[Dict[str, Any]]:
    """One asset with its body, refusing anything created outside this course."""
    from azure_services.persistence.cosmos_db import get_asset

    asset = get_asset(asset_id, user_id)
    if not asset or asset.get("agentId") != agent_id:
        return None

    return {
        "id": asset.get("id", ""),
        "title": asset.get("title") or "Untitled",
        "description": asset.get("description") or "",
        "category": asset.get("category") or "other",
        "type": asset.get("type") or "text",
        "content": asset.get("content") or "",
        "created_at": asset.get("createdAt", ""),
    }


def _evidence_excerpt(value: Any, limit: int = 600) -> str:
    """Bound user-authored text before it enters an analytics-agent prompt."""
    text = " ".join(str(value or "").replace("\x00", " ").split())
    return text[:limit] + ("…" if len(text) > limit else "")


def _student_chat_evidence(
    user_id: str,
    agent_id: str,
    max_excerpts: int = 6,
) -> Dict[str, Any]:
    """
    Rebuild recent conversation turns for one student in one course.

    Mirrors how the tutor persists history: `chat_threads_v1` holds one doc per
    conversation (partitioned by userId, tagged with agentId) and
    `chat_messages_v1` holds one doc per message. A turn is a `messageGroupId`
    pairing the student prompt with its assistant replies; edits mark superseded
    rows `isLatest = false` and retries add rows with a higher `retryNumber`, so
    the canonical turn is the surviving row with the largest `retryNumber`.
    """
    threads = list(
        _threads().query_items(
            query="SELECT c.id, c.title FROM c WHERE c.agentId = @agentId",
            parameters=[{"name": "@agentId", "value": agent_id}],
            partition_key=user_id,
        )
    )
    thread_titles = {
        thread.get("id"): thread.get("title") or "" for thread in threads if thread.get("id")
    }
    thread_ids = list(thread_titles)
    if not thread_ids:
        return {
            "thread_count": 0,
            "student_message_count": 0,
            "tutor_reply_count": 0,
            "recent_turns": [],
        }

    messages = list(
        _messages().query_items(
            query=(
                "SELECT c.role, c.content, c.createdAt, c.threadId, "
                "c.messageGroupId, c.retryNumber FROM c "
                "WHERE ARRAY_CONTAINS(@threadIds, c.threadId) "
                "AND (NOT IS_DEFINED(c.isLatest) OR c.isLatest = true)"
            ),
            parameters=[{"name": "@threadIds", "value": thread_ids}],
            partition_key=user_id,
        )
    )

    # Collapse retries: keep the highest retryNumber per role within each turn.
    turns: Dict[str, Dict[str, Any]] = {}
    student_message_count = 0
    tutor_reply_count = 0
    for message in messages:
        role = message.get("role")
        if role not in ("user", "assistant"):
            continue
        if role == "user":
            student_message_count += 1
        else:
            tutor_reply_count += 1
        group_id = message.get("messageGroupId") or message.get("threadId", "")
        turn = turns.setdefault(group_id, {"user": None, "assistant": None, "retried": False})
        current = turn[role]
        if current is None:
            turn[role] = message
            continue
        if _positive_token_count(message.get("retryNumber")) > _positive_token_count(
            current.get("retryNumber")
        ):
            turn[role] = message
            turn["retried"] = True
        else:
            turn["retried"] = True

    ordered = sorted(
        turns.values(),
        key=lambda turn: (turn["user"] or turn["assistant"] or {}).get("createdAt", ""),
        reverse=True,
    )

    recent_turns = []
    for turn in ordered:
        student_message = turn["user"] or {}
        tutor_message = turn["assistant"] or {}
        if not student_message.get("content") and not tutor_message.get("content"):
            continue
        recent_turns.append(
            {
                "observed_at": student_message.get("createdAt")
                or tutor_message.get("createdAt", ""),
                "thread_title": _evidence_excerpt(
                    thread_titles.get(
                        student_message.get("threadId") or tutor_message.get("threadId")
                    ),
                    80,
                ),
                "untrusted_student_text": _evidence_excerpt(student_message.get("content"), 400),
                "untrusted_tutor_reply": _evidence_excerpt(tutor_message.get("content"), 400),
                "was_retried_or_edited": turn["retried"],
            }
        )
        if len(recent_turns) >= max_excerpts:
            break

    return {
        "thread_count": len(thread_ids),
        "student_message_count": student_message_count,
        "tutor_reply_count": tutor_reply_count,
        "recent_turns": recent_turns,
    }


def _student_asset_evidence(
    user_id: str,
    agent_id: str,
    max_assets: int = 5,
) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Separate structured concept inventories from other recent artifacts."""
    from azure_services.persistence.cosmos_db import (
        QUIZ_FIRST_ATTEMPT_RECORD_TYPE,
        list_user_assets,
    )

    assets = list_user_assets(user_id=user_id, agent_id=agent_id, limit=100)
    inventories: List[Dict[str, Any]] = []
    artifacts: List[Dict[str, Any]] = []
    for asset in assets:
        if asset.get("recordType") == QUIZ_FIRST_ATTEMPT_RECORD_TYPE:
            try:
                record = json.loads(asset.get("content") or "{}")
            except (TypeError, json.JSONDecodeError):
                record = {}
            attempt = record.get("firstAttempt") or record
            wrong_answers = []
            for answer in attempt.get("answers") or []:
                if answer.get("isCorrect") is not False:
                    continue
                wrong_answers.append(
                    {
                        "question": _evidence_excerpt(answer.get("question"), 300),
                        "selected": answer.get("selectedOptions") or [],
                        "expected": answer.get("correctOptions") or [],
                        "reason": _evidence_excerpt(answer.get("reason"), 250),
                    }
                )
            inventories.append(
                {
                    "title": asset.get("title") or "Concept inventory",
                    "submitted_at": asset.get("createdAt", ""),
                    "score": int(attempt.get("score", 0) or 0),
                    "total_questions": int(attempt.get("totalQuestions", 0) or 0),
                    "percentage": int(attempt.get("percentage", 0) or 0),
                    "wrong_answer_evidence": wrong_answers[:10],
                    "tutor_feedback": _evidence_excerpt(
                        (record.get("agentFeedback") or {}).get("content"),
                        600,
                    ),
                }
            )
            continue
        if len(artifacts) >= max_assets:
            continue
        content = asset.get("content") or ""
        artifacts.append(
            {
                "title": asset.get("title") or "Untitled",
                "category": asset.get("category") or "other",
                "type": asset.get("type") or "text",
                "created_at": asset.get("createdAt", ""),
                "description": _evidence_excerpt(asset.get("description"), 250),
                "untrusted_content_excerpt": _evidence_excerpt(content, 700),
                "content_length": len(str(content)),
            }
        )
    return inventories[:10], artifacts


def student_learning_evidence(
    user_id: str,
    agent_id: str,
    *,
    include_chat_evidence: bool = True,
    max_assets: int = 5,
    max_chat_excerpts: int = 6,
    max_observations: int = 30,
    max_inventories: int = 10,
) -> Dict[str, Any]:
    """Build one bounded, multi-source evidence record for teacher analytics."""
    profile = get_user_profile(user_id) or {}
    state = get_learning_state(user_id, agent_id) or {}
    topics = state.get("topics") or {}
    concepts = state.get("threshold_concepts") or {}
    inventories, artifacts = _student_asset_evidence(
        user_id, agent_id, max_assets=max_assets
    )

    topic_evidence = [
        {
            "topic": name,
            "status": topic.get("status", "not_started"),
            "module": topic.get("module", ""),
            "latest_summary": _evidence_excerpt(topic.get("latest_summary"), 350),
            "last_updated": topic.get("last_updated") or topic.get("last_touched") or "",
        }
        for name, topic in topics.items()
        if topic.get("status") != "not_started" or topic.get("latest_summary")
    ]
    topic_evidence.sort(key=lambda item: item.get("last_updated", ""), reverse=True)
    concept_evidence = [
        {
            "concept": name,
            "status": concept.get("status", "not_started"),
            "misconceptions_addressed": concept.get("misconceptions_addressed") or [],
            "misconception_notes": concept.get("misconception_notes") or {},
            "latest_summary": _evidence_excerpt(concept.get("latest_summary"), 350),
            "last_updated": concept.get("last_updated", ""),
        }
        for name, concept in concepts.items()
    ]
    concept_evidence.sort(key=lambda item: item.get("last_updated", ""), reverse=True)

    overall = state.get("overall") or {}
    evidence = {
        "user_id": user_id,
        "display_name": profile.get("displayName") or profile.get("fullName") or user_id,
        "agent_id": agent_id,
        "progress": {
            "topics": {
                "total": overall.get("total") or overall.get("total_topics") or len(topics),
                "learned": overall.get("learned", 0),
                "in_progress": overall.get("in_progress", 0),
                "observed": topic_evidence[:max_observations],
            },
            "threshold_concepts": {
                "total": len(concepts),
                "learned": sum(1 for concept in concepts.values() if concept.get("status") == "learned"),
                "in_progress": sum(1 for concept in concepts.values() if concept.get("status") == "in_progress"),
                "concepts": concept_evidence[:max_observations],
            },
        },
        "concept_inventory_first_attempts": inventories[:max_inventories],
        "recent_assets": artifacts,
        "evidence_coverage": {
            "has_learning_state": bool(state),
            "concept_inventory_attempts": len(inventories),
            "assets_reviewed": len(artifacts),
            "topics_with_observations": len(topic_evidence),
            "threshold_concepts_tracked": len(concepts),
        },
    }
    if include_chat_evidence:
        chat = _student_chat_evidence(
            user_id, agent_id, max_excerpts=max_chat_excerpts
        )
        evidence["recent_chat_signals"] = chat
        evidence["evidence_coverage"]["chat_turns_reviewed"] = len(
            chat["recent_turns"]
        )
    return evidence


def learning_evidence_bundle(
    agent_id: str,
    student_ids: List[str],
    *,
    include_chat_evidence: bool = True,
    max_students: int = 25,
) -> Dict[str, Any]:
    """Build a course-scoped bundle for selected students or the whole class."""
    requested_count = len(list(dict.fromkeys(student_ids)))
    selected = list(dict.fromkeys(student_ids))[:max_students]
    compact = requested_count > 8
    students = []
    evidence_catalog = []
    for index, user_id in enumerate(selected, start=1):
        evidence = student_learning_evidence(
            user_id,
            agent_id,
            include_chat_evidence=include_chat_evidence,
            max_assets=2 if compact else 5,
            max_chat_excerpts=2 if compact else 6,
            max_observations=8 if compact else 30,
            max_inventories=3 if compact else 10,
        )
        evidence.pop("user_id", None)
        student_ref = f"S{index}"
        evidence["student_ref"] = student_ref
        display_name = evidence.get("display_name") or student_ref
        reference_groups = [
            (
                "CI",
                "concept_inventory",
                evidence.get("concept_inventory_first_attempts") or [],
                lambda item: item.get("title") or "Concept inventory",
                lambda item: item.get("submitted_at", ""),
            ),
            (
                "TC",
                "threshold_concept",
                evidence.get("progress", {})
                .get("threshold_concepts", {})
                .get("concepts", []),
                lambda item: item.get("concept") or "Threshold concept",
                lambda item: item.get("last_updated", ""),
            ),
            (
                "TP",
                "topic_progress",
                evidence.get("progress", {}).get("topics", {}).get("observed", []),
                lambda item: item.get("topic") or "Topic progress",
                lambda item: item.get("last_updated", ""),
            ),
            (
                "AS",
                "asset",
                evidence.get("recent_assets") or [],
                lambda item: item.get("title") or "Student asset",
                lambda item: item.get("created_at", ""),
            ),
        ]
        for prefix, kind, items, label_for, date_for in reference_groups:
            for item_index, item in enumerate(items, start=1):
                evidence_ref = f"{student_ref}-{prefix}{item_index}"
                item["evidence_ref"] = evidence_ref
                evidence_catalog.append(
                    {
                        "ref": evidence_ref,
                        "student_ref": student_ref,
                        "kind": kind,
                        "label": label_for(item),
                        "student": display_name,
                        "observed_at": date_for(item),
                    }
                )
        students.append(evidence)
    return {
        "schema_version": 1,
        "agent_id": agent_id,
        "student_count": len(students),
        "requested_student_count": requested_count,
        "truncated": requested_count > len(selected),
        "detail_level": "compact" if compact else "detailed",
        "students": students,
        "evidence_catalog": evidence_catalog,
        "chat_signals_reviewed": any(
            student.get("evidence_coverage", {}).get("chat_turns_reviewed", 0) > 0
            for student in students
        ),
        "evidence_policy": {
            "strength_order": [
                "concept_inventory_first_attempts",
                "threshold_concept_progress",
                "topic_progress",
                "student_assets",
                "recent_chat_signals",
            ],
            "user_authored_text_is_untrusted": True,
            "chat_and_asset_excerpts_are_bounded": True,
        },
    }


# ════════════════════════════════════════════════════════════════════
# Groundedness Evaluation Operations
# ════════════════════════════════════════════════════════════════════

def save_groundedness_evaluation(evaluation: Dict[str, Any]) -> Dict[str, Any]:
    """
    Save a groundedness evaluation result to Cosmos DB.

    The document uses sessionId as the partition key and messageGroupId as id.
    """
    container = _groundedness()

    # Ensure required fields
    if "id" not in evaluation:
        evaluation["id"] = evaluation.get("messageGroupId", "")
    if "evaluatedAt" not in evaluation:
        evaluation["evaluatedAt"] = datetime.now(timezone.utc).isoformat()

    try:
        result = container.upsert_item(body=evaluation)
        logger.info(
            f"Saved groundedness evaluation for messageGroupId={evaluation.get('messageGroupId')}, "
            f"score={evaluation.get('groundednessScore')}"
        )
        return result
    except Exception as e:
        logger.error(f"Failed to save groundedness evaluation: {e}")
        raise


def get_groundedness_evaluation(message_group_id: str, session_id: str) -> Optional[Dict[str, Any]]:
    """
    Get groundedness evaluation by messageGroupId.

    Args:
        message_group_id: The messageGroupId (also the document id)
        session_id: The session UUID (partition key)

    Returns:
        Evaluation document or None
    """
    container = _groundedness()

    try:
        from azure.cosmos.exceptions import CosmosResourceNotFoundError
        item = container.read_item(item=message_group_id, partition_key=session_id)
        return item
    except CosmosResourceNotFoundError:
        return None
    except Exception as e:
        logger.error(f"Error reading groundedness evaluation: {e}")
        return None


def get_groundedness_evaluations_for_session(session_id: str) -> List[Dict[str, Any]]:
    """
    Get all groundedness evaluations for a session.

    Args:
        session_id: The session UUID (partition key)

    Returns:
        List of evaluation documents ordered by evaluatedAt
    """
    container = _groundedness()

    try:
        query = "SELECT * FROM c WHERE c.sessionId = @sid ORDER BY c.evaluatedAt DESC"
        items = list(container.query_items(
            query=query,
            parameters=[{"name": "@sid", "value": session_id}],
            partition_key=session_id,
        ))
        return items
    except Exception as e:
        logger.error(f"Error listing groundedness evaluations for session {session_id}: {e}")
        return []


def get_all_groundedness_evaluations(limit: int = 200) -> List[Dict[str, Any]]:
    """
    Get all groundedness evaluations across all sessions (cross-partition).

    Args:
        limit: Maximum number of evaluations to return (newest first)

    Returns:
        List of evaluation documents ordered by evaluatedAt DESC
    """
    container = _groundedness()

    try:
        query = f"SELECT TOP {limit} * FROM c ORDER BY c.evaluatedAt DESC"
        items = list(container.query_items(
            query=query,
            enable_cross_partition_query=True,
        ))
        return items
    except Exception as e:
        logger.error(f"Error listing all groundedness evaluations: {e}")
        return []


def get_groundedness_evaluations_for_thread(thread_id: str, session_id: str) -> List[Dict[str, Any]]:
    """
    Get all groundedness evaluations for a specific chat thread.

    Args:
        thread_id: The thread/conversation ID
        session_id: The session UUID (partition key)

    Returns:
        List of evaluation documents for this thread
    """
    container = _groundedness()

    try:
        query = "SELECT * FROM c WHERE c.sessionId = @sid AND c.threadId = @tid ORDER BY c.evaluatedAt DESC"
        items = list(container.query_items(
            query=query,
            parameters=[
                {"name": "@sid", "value": session_id},
                {"name": "@tid", "value": thread_id},
            ],
            partition_key=session_id,
        ))
        return items
    except Exception as e:
        logger.error(f"Error listing groundedness evaluations for thread {thread_id}: {e}")
        return []


# ════════════════════════════════════════════════════════════════════
# Chat Messages (read-only, for groundedness evaluation)
# ════════════════════════════════════════════════════════════════════

def get_messages_by_group_id(message_group_id: str, user_id: str) -> List[Dict[str, Any]]:
    """
    Get all messages belonging to a messageGroupId (user question + assistant response).

    Args:
        message_group_id: The messageGroupId
        user_id: The user ID (partition key for messages container)

    Returns:
        List of messages (user + assistant) sorted by createdAt
    """
    container = _messages()

    try:
        query = "SELECT * FROM c WHERE c.messageGroupId = @gid ORDER BY c.createdAt ASC"
        items = list(container.query_items(
            query=query,
            parameters=[{"name": "@gid", "value": message_group_id}],
            partition_key=user_id,
        ))
        return items
    except Exception as e:
        logger.error(f"Error fetching messages for group {message_group_id}: {e}")
        return []


def get_agent_metadata(agent_id: str) -> Optional[Dict[str, Any]]:
    """Get full agent metadata document by ID."""
    _init()
    try:
        return _agents().read_item(item=agent_id, partition_key=agent_id)
    except Exception:
        return None


def transfer_agent_ownership(agent_id: str, new_owner_id: str) -> Optional[Dict[str, Any]]:
    """
    Transfer agent ownership by updating createdById.
    Also adds the new owner to teacherIds if not already present.
    Returns the updated agent doc, or None if not found.
    """
    _init()
    agent = get_agent_metadata(agent_id)
    if not agent:
        return None
    agent["createdById"] = new_owner_id
    # Ensure new owner is in teacherIds
    teacher_ids = agent.get("teacherIds", [])
    if new_owner_id not in teacher_ids:
        teacher_ids.append(new_owner_id)
        agent["teacherIds"] = teacher_ids
    agent["updatedAt"] = datetime.now(timezone.utc).isoformat()
    _agents().upsert_item(body=agent)
    logger.info(f"Transferred agent '{agent_id}' ownership to '{new_owner_id}'")
    return agent


# ══════════════════════════════════════════════════════════════════
# User Directory Operations (for Dashboard admin panel)
# ══════════════════════════════════════════════════════════════════

def _invited():
    _init()
    return _invited_users_container


def get_invite_by_email(email: str) -> Optional[Dict[str, Any]]:
    """Look up an invite record in invited_users_v1 by email (partition key)."""
    container = _invited()
    normalized = email.lower().strip()
    try:
        items = list(container.query_items(
            query="SELECT * FROM c WHERE c.email = @email",
            parameters=[{"name": "@email", "value": normalized}],
            partition_key=normalized,
        ))
        return items[0] if items else None
    except Exception as e:
        logger.error(f"Error querying invite by email {email}: {e}")
        return None


def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    """Look up a user profile by email (case-insensitive)."""
    container = _users()
    normalized = email.lower().strip()
    try:
        items = list(container.query_items(
            query="SELECT * FROM c WHERE c.email = @email",
            parameters=[{"name": "@email", "value": normalized}],
            enable_cross_partition_query=True,
        ))
        return items[0] if items else None
    except Exception as e:
        logger.error(f"Error querying user by email {email}: {e}")
        return None


_PROFILE_CACHE: Dict[str, Optional[Dict[str, Any]]] = {}
_PROFILE_CACHE_TTL = 60
_profile_cache_ts = 0.0


def get_user_profile(user_id: str) -> Optional[Dict[str, Any]]:
    """Get user profile by ID from users_v1 (short-lived cache — reads repeat a lot)."""
    global _profile_cache_ts
    now = time.time()
    if now - _profile_cache_ts > _PROFILE_CACHE_TTL:
        _PROFILE_CACHE.clear()
        _profile_cache_ts = now
    if user_id in _PROFILE_CACHE:
        return _PROFILE_CACHE[user_id]

    container = _users()
    try:
        profile = container.read_item(item=user_id, partition_key=user_id)
    except Exception:
        profile = None
    _PROFILE_CACHE[user_id] = profile
    return profile


def get_invite_by_id(invite_id: str) -> Optional[Dict[str, Any]]:
    """Look up an invite record in invited_users_v1 by document ID."""
    container = _invited()
    try:
        items = list(container.query_items(
            query="SELECT * FROM c WHERE c.id = @id",
            parameters=[{"name": "@id", "value": invite_id}],
            enable_cross_partition_query=True,
        ))
        return items[0] if items else None
    except Exception as e:
        logger.error(f"Error querying invite by id {invite_id}: {e}")
        return None


def invite_user(
    email: str,
    name: str = "",
    role: str = "student",
    institute: str = "",
    department: str = "",
) -> tuple:
    """Add an invited user to invited_users_v1 (C1). Returns (doc, is_new, aff_added)."""
    import uuid
    container = _invited()
    users_c = _users()

    existing = get_invite_by_email(email)
    if existing:
        # Update name if provided and currently missing
        if name and not existing.get("name"):
            existing["name"] = name
            existing["updatedAt"] = datetime.utcnow().isoformat() + "Z"
            container.upsert_item(body=existing)
        # Try to add a new affiliation
        affiliations = existing.get("affiliations", [])
        if not affiliations and existing.get("institute"):
            affiliations.append({
                "institute": existing.get("institute", ""),
                "department": existing.get("department", ""),
                "role": existing.get("role", "student"),
            })
        new_aff = {"institute": institute, "department": department, "role": role}
        dup = any(
            a.get("institute") == institute and a.get("department") == department
            for a in affiliations
        )
        if dup:
            return (existing, False, False)
        affiliations.append(new_aff)
        existing["affiliations"] = affiliations
        existing["updatedAt"] = datetime.utcnow().isoformat() + "Z"
        container.upsert_item(body=existing)
        return (existing, False, True)

    # Check users_v1 for active user
    active = get_user_by_email(email)
    if active:
        affiliations = active.get("affiliations", [])
        if not affiliations and active.get("institute"):
            affiliations.append({
                "institute": active.get("institute", ""),
                "department": active.get("department", ""),
                "role": active.get("role", "student"),
            })
        new_aff = {"institute": institute, "department": department, "role": role}
        dup = any(
            a.get("institute") == institute and a.get("department") == department
            for a in affiliations
        )
        if dup:
            return (active, False, False)
        affiliations.append(new_aff)
        active["affiliations"] = affiliations
        active["updatedAt"] = datetime.utcnow().isoformat() + "Z"
        users_c.upsert_item(body=active)
        return (active, False, True)

    dir_id = f"dir-{uuid.uuid4().hex[:8]}"
    normalized_email = email.lower().strip()
    now = datetime.utcnow().isoformat() + "Z"
    doc = {
        "id": dir_id,
        "email": normalized_email,
        "name": name,
        "role": role,
        "status": "invited",
        "institute": institute,
        "department": department,
        "affiliations": [{"institute": institute, "department": department, "role": role}],
        "activeAffiliation": 0,
        "createdAt": now,
        "updatedAt": now,
    }
    container.upsert_item(body=doc)
    logger.info(f"Invited user {normalized_email} as {role} (id={dir_id})")
    return (doc, True, False)


def list_directory_users(
    role: Optional[str] = None,
    status: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """List users from both C1 and C2."""
    results: List[Dict[str, Any]] = []

    # C1: invited_users_v1
    if status in (None, "invited"):
        conditions = ["c.status != 'promoted'"]
        params: list = []
        if role:
            conditions.append("c.role = @role")
            params.append({"name": "@role", "value": role})
        where = " WHERE " + " AND ".join(conditions)
        query = f"SELECT * FROM c{where}"
        try:
            items = list(_invited().query_items(
                query=query, parameters=params, enable_cross_partition_query=True,
            ))
            for it in items:
                it.setdefault("userId", it["id"])
                it.setdefault("fullName", it.get("name", ""))
                it.setdefault("displayName", it.get("name", ""))
                it.setdefault("status", "invited")
            results.extend(items)
        except Exception as e:
            logger.error(f"Error listing invited users: {e}")

    # C2: users_v1
    if status in (None, "active"):
        conditions2 = []
        params2: list = []
        if role:
            conditions2.append("c.role = @role")
            params2.append({"name": "@role", "value": role})
        if status == "active":
            conditions2.append("c.status = 'active'")
        where2 = (" WHERE " + " AND ".join(conditions2)) if conditions2 else ""
        query2 = f"SELECT * FROM c{where2}"
        try:
            items2 = list(_users().query_items(
                query=query2, parameters=params2, enable_cross_partition_query=True,
            ))
            results.extend(items2)
        except Exception as e:
            logger.error(f"Error listing active users: {e}")

    # Deduplicate: if a user exists in both C1 and C2 (same email),
    # keep the C2 (active) version and drop the C1 (invited) one.
    if status is None:
        seen_emails: set = set()
        deduped: List[Dict[str, Any]] = []
        # C2 (active) entries come after C1 entries in results — process in
        # reverse so C2 entries are kept over C1 when emails collide
        for item in reversed(results):
            email = (item.get("email") or "").lower()
            if email and email in seen_emails:
                continue
            if email:
                seen_emails.add(email)
            deduped.append(item)
        deduped.reverse()
        return deduped

    return results


def remove_directory_user(user_id: str) -> bool:
    """Remove a user from C2 (users_v1) or C1 (invited_users_v1)."""
    from azure.cosmos.exceptions import CosmosResourceNotFoundError
    # Try C2 first
    try:
        _users().delete_item(item=user_id, partition_key=user_id)
        logger.info(f"Deleted user {user_id} from users_v1")
        return True
    except CosmosResourceNotFoundError:
        pass
    except Exception as e:
        logger.error(f"Error deleting user {user_id} from C2: {e}")

    # Fall back to C1
    try:
        items = list(_invited().query_items(
            query="SELECT * FROM c WHERE c.id = @id",
            parameters=[{"name": "@id", "value": user_id}],
            enable_cross_partition_query=True,
        ))
        if items:
            doc = items[0]
            _invited().delete_item(item=doc["id"], partition_key=doc["email"])
            logger.info(f"Deleted invite {user_id} from invited_users_v1")
            return True
    except Exception as e:
        logger.error(f"Error deleting invite {user_id} from C1: {e}")
    return False


def upsert_user_profile(user_id: str, **kwargs) -> Dict[str, Any]:
    """Update fields on a user profile in users_v1."""
    container = _users()
    profile = get_user_profile(user_id) or {}
    for k, v in kwargs.items():
        if v is not None:
            profile[k] = v
    profile["id"] = user_id
    profile["userId"] = user_id
    profile["updatedAt"] = datetime.utcnow().isoformat() + "Z"
    container.upsert_item(body=profile)
    return profile


def rename_institute(old_name: str, new_name: str) -> int:
    """Rename an institution across both C1 and C2."""
    query = "SELECT * FROM c WHERE c.institute = @old"
    params: list = [{"name": "@old", "value": old_name}]
    count = 0
    for doc in list(_users().query_items(query=query, parameters=params, enable_cross_partition_query=True)):
        doc["institute"] = new_name
        if "college" in doc:
            doc["college"] = new_name
        doc["updatedAt"] = datetime.utcnow().isoformat() + "Z"
        _users().upsert_item(body=doc)
        count += 1
    for doc in list(_invited().query_items(query=query, parameters=params, enable_cross_partition_query=True)):
        doc["institute"] = new_name
        doc["updatedAt"] = datetime.utcnow().isoformat() + "Z"
        _invited().upsert_item(body=doc)
        count += 1
    return count


def delete_institute(name: str) -> int:
    """Clear the institute field on all users belonging to this institution."""
    query = "SELECT * FROM c WHERE c.institute = @name"
    params: list = [{"name": "@name", "value": name}]
    count = 0
    for doc in list(_users().query_items(query=query, parameters=params, enable_cross_partition_query=True)):
        doc["institute"] = ""
        doc["department"] = ""
        if "college" in doc:
            doc["college"] = ""
        doc["updatedAt"] = datetime.utcnow().isoformat() + "Z"
        _users().upsert_item(body=doc)
        count += 1
    for doc in list(_invited().query_items(query=query, parameters=params, enable_cross_partition_query=True)):
        doc["institute"] = ""
        doc["department"] = ""
        doc["updatedAt"] = datetime.utcnow().isoformat() + "Z"
        _invited().upsert_item(body=doc)
        count += 1
    return count


def rename_department(institute: str, old_name: str, new_name: str) -> int:
    """Rename a department within an institute across both C1 and C2."""
    query = "SELECT * FROM c WHERE c.institute = @inst AND c.department = @old"
    params: list = [{"name": "@inst", "value": institute}, {"name": "@old", "value": old_name}]
    count = 0
    for doc in list(_users().query_items(query=query, parameters=params, enable_cross_partition_query=True)):
        doc["department"] = new_name
        doc["updatedAt"] = datetime.utcnow().isoformat() + "Z"
        _users().upsert_item(body=doc)
        count += 1
    for doc in list(_invited().query_items(query=query, parameters=params, enable_cross_partition_query=True)):
        doc["department"] = new_name
        doc["updatedAt"] = datetime.utcnow().isoformat() + "Z"
        _invited().upsert_item(body=doc)
        count += 1
    return count


def delete_department_users(institute: str, department: str) -> int:
    """Clear the department field on affected users across both C1 and C2."""
    query = "SELECT * FROM c WHERE c.institute = @inst AND c.department = @dept"
    params: list = [{"name": "@inst", "value": institute}, {"name": "@dept", "value": department}]
    count = 0
    for doc in list(_users().query_items(query=query, parameters=params, enable_cross_partition_query=True)):
        doc["department"] = ""
        doc["updatedAt"] = datetime.utcnow().isoformat() + "Z"
        _users().upsert_item(body=doc)
        count += 1
    for doc in list(_invited().query_items(query=query, parameters=params, enable_cross_partition_query=True)):
        doc["department"] = ""
        doc["updatedAt"] = datetime.utcnow().isoformat() + "Z"
        _invited().upsert_item(body=doc)
        count += 1
    return count


def get_department_onboarding_progress(institute: str, department: str) -> Dict[str, Any]:
    """Compare C1 vs C2 counts for a given institute+department."""
    params: list = [{"name": "@inst", "value": institute}, {"name": "@dept", "value": department}]
    try:
        c1_query = "SELECT VALUE COUNT(1) FROM c WHERE c.institute = @inst AND c.department = @dept AND c.status != 'promoted'"
        c1_count = list(_invited().query_items(query=c1_query, parameters=params, enable_cross_partition_query=True))[0]
        c2_query = "SELECT VALUE COUNT(1) FROM c WHERE c.institute = @inst AND c.department = @dept AND c.status = 'active'"
        c2_count = list(_users().query_items(query=c2_query, parameters=params, enable_cross_partition_query=True))[0]
        total = c1_count + c2_count
        return {"invited": c1_count, "active": c2_count, "total": total, "done": c1_count == 0 and c2_count > 0}
    except Exception as e:
        logger.error(f"Error getting onboarding progress: {e}")
        return {"invited": 0, "active": 0, "total": 0, "done": False}


def switch_active_affiliation(user_id: str, index: int) -> Optional[Dict[str, Any]]:
    """Switch the user's active affiliation by index."""
    profile = get_user_profile(user_id)
    if not profile:
        return None
    affiliations = profile.get("affiliations", [])
    if not affiliations or index < 0 or index >= len(affiliations):
        return None
    aff = affiliations[index]
    profile["activeAffiliation"] = index
    profile["institute"] = aff.get("institute", "")
    profile["department"] = aff.get("department", "")
    profile["role"] = aff.get("role", profile.get("role", "student"))
    profile["college"] = aff.get("institute", "")
    profile["updatedAt"] = datetime.utcnow().isoformat() + "Z"
    _users().upsert_item(body=profile)
    return profile


# ══════════════════════════════════════════════════════════════════
# Feedback Operations
# ══════════════════════════════════════════════════════════════════

def list_feedback(limit: int = 200) -> List[Dict[str, Any]]:
    """List all feedback, newest first."""
    try:
        query = "SELECT * FROM c ORDER BY c.createdAt DESC"
        items = list(_feedback().query_items(
            query=query,
            enable_cross_partition_query=True,
            max_item_count=limit,
        ))
        return items
    except Exception as e:
        logger.error(f"Error listing feedback: {e}")
        return []


def get_feedback_stats() -> Dict[str, Any]:
    """Get aggregate feedback statistics."""
    items = list_feedback(limit=1000)
    total = len(items)
    sentiments: Dict[str, int] = {}
    categories: Dict[str, int] = {}
    for item in items:
        s = item.get("sentiment") or "unknown"
        sentiments[s] = sentiments.get(s, 0) + 1
        c = item.get("category") or "General"
        categories[c] = categories.get(c, 0) + 1
    return {
        "total": total,
        "sentiments": sentiments,
        "categories": categories,
    }
