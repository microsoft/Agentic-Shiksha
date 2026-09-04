"""
Cosmos DB query layer for the Dashboard server.

Reads learning-state documents from the `learning_states_v1` container
and agent metadata from `agents_v1` to power admin analytics.
"""

import os
import logging
import threading
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone

from azure.cosmos import CosmosClient
from azure.identity import DefaultAzureCredential, AzureCliCredential
from log_safe import scrub

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

        logger.info(f"Dashboard: connecting to Cosmos DB at {COSMOS_ENDPOINT}")

        # Auth – try DefaultAzureCredential first, then AzureCliCredential
        try:
            credential = DefaultAzureCredential()
            credential.get_token("https://cosmos.azure.com/.default")
        except Exception:
            logger.info("DefaultAzureCredential failed, falling back to AzureCliCredential")
            credential = AzureCliCredential()

        client = CosmosClient(url=COSMOS_ENDPOINT, credential=credential)
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
    query = "SELECT c.id, c.agentId, c.name, c.description, c.imageUrl, c.createdAt, c.createdById, c.courseName, c.courseLevel FROM c"
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
    """
    _init()
    # Learning-state doc ids follow the pattern: {userId}_{agentId}_state
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
# Image generation quota (mirrors Backend/azure_services/persistence/image_quota.py)
# ════════════════════════════════════════════════════════════════════

IMAGE_QUOTA_QUALITIES = ("low", "medium")
IMAGE_QUOTA_DEFAULTS = {"medium": 5, "low": 15}
_IMAGE_QUOTA_CONFIG_ID = "__image_quota_config__"
_IMAGE_QUOTA_CONFIG_PARTITION = "__config__"


def get_image_quota_config() -> Dict[str, int]:
    """Weekly per-student image allowance, falling back to the defaults."""
    _init()
    limits = dict(IMAGE_QUOTA_DEFAULTS)
    try:
        doc = _learning_states_container.read_item(
            item=_IMAGE_QUOTA_CONFIG_ID, partition_key=_IMAGE_QUOTA_CONFIG_PARTITION
        )
        for quality in IMAGE_QUOTA_QUALITIES:
            value = (doc.get("limits") or {}).get(quality)
            if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
                limits[quality] = value
    except Exception:
        pass
    return limits


def set_image_quota_config(limits: Dict[str, int]) -> Dict[str, int]:
    """Persist the weekly allowance; unknown or invalid values are ignored."""
    _init()
    merged = get_image_quota_config()
    for quality in IMAGE_QUOTA_QUALITIES:
        value = limits.get(quality)
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            continue
        merged[quality] = value

    _learning_states_container.upsert_item(body={
        "id": _IMAGE_QUOTA_CONFIG_ID,
        "partitionKey": _IMAGE_QUOTA_CONFIG_PARTITION,
        "type": "image_quota_config",
        "limits": merged,
        "updatedAt": datetime.utcnow().isoformat() + "Z",
    })
    return merged


# ════════════════════════════════════════════════════════════════════
# Aggregation helpers
# ════════════════════════════════════════════════════════════════════

def _summarise_state(state: Dict[str, Any]) -> Dict[str, Any]:
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

    return {
        "user_id": state.get("userId", ""),
        "agent_id": state.get("agentId", ""),
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
        "last_updated": state.get("last_updated", ""),
    }


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
        uid = s["id"].split("_")[0] if "_" in s.get("id", "") else ""
        if uid:
            profile = get_user_profile(uid)
            if profile and profile.get("role") in ("admin", "teacher"):
                continue
        student_states.append(s)

    if not student_states:
        first_summary = _summarise_state(states[0]) if states else None
        return {
            "agent_id": agent_id,
            "student_count": 0,
            "avg_pct_complete": 0,
            "total_topics": first_summary["total_topics"] if first_summary else 0,
            "distribution": {"0-25%": 0, "25-50%": 0, "50-75%": 0, "75-100%": 0},
            "top_struggle_topics": [],
        }

    summaries = [_summarise_state(s) for s in student_states]
    total_topics = summaries[0]["total_topics"] if summaries else 0
    avg_pct = round(sum(s["pct_complete"] for s in summaries) / len(summaries), 1)

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


def agent_usage_stats(agent_id: str) -> Dict[str, Any]:
    """
    Count unique students and teachers who actually sent at least one message
    to the given agent. Excludes admins.
    """
    _init()

    # 1. Get all threads for this agent
    threads = list(_threads_container.query_items(
        query="SELECT c.id, c.userId FROM c WHERE c.agentId = @aid",
        parameters=[{"name": "@aid", "value": agent_id}],
        enable_cross_partition_query=True,
    ))
    if not threads:
        return {"agent_id": agent_id, "active_students": 0, "active_teachers": 0,
                "total_threads": 0, "active_threads": 0}

    thread_user = {t["id"]: t.get("userId", "") for t in threads}

    # 2. Get distinct threadIds that have at least one user message
    active_thread_docs = list(_messages_container.query_items(
        query="SELECT DISTINCT c.threadId FROM c WHERE c.role = @role",
        parameters=[{"name": "@role", "value": "user"}],
        enable_cross_partition_query=True,
    ))
    all_active_tids = set(d["threadId"] for d in active_thread_docs)

    # 3. Intersect with this agent's threads
    agent_tids = set(thread_user.keys())
    active_tids = agent_tids & all_active_tids

    # 4. Collect unique user IDs who sent messages in this agent
    active_uids = set()
    for tid in active_tids:
        uid = thread_user.get(tid)
        if uid:
            active_uids.add(uid)

    # 5. Look up roles, split into students / teachers
    active_students = 0
    active_teachers = 0
    for uid in active_uids:
        profile = get_user_profile(uid)
        if not profile:
            continue
        role = profile.get("role", "")
        if role == "admin":
            continue
        elif role == "teacher":
            active_teachers += 1
        else:
            active_students += 1

    return {
        "agent_id": agent_id,
        "active_students": active_students,
        "active_teachers": active_teachers,
        "total_threads": len(threads),
        "active_threads": len(active_tids),
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

    return {
        "user_id": user_id,
        "agent_id": agent_id,
        "total_topics": total,
        "learned": learned,
        "in_progress": overall.get("in_progress", 0),
        "not_started": overall.get("not_started", total),
        "pct_complete": round(learned / total * 100, 1) if total else 0,
        "topics_by_status": by_status,
        "last_updated": state.get("last_updated", ""),
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
    logger.info(f"Transferred agent '{scrub(agent_id)}' ownership to '{scrub(new_owner_id)}'")
    return agent


def set_agent_teachers(agent_id: str, teacher_ids: List[str]) -> Optional[Dict[str, Any]]:
    """
    Replace an agent's assigned teachers. The owner stays a teacher so the course
    never ends up without one.
    Returns the updated agent doc, or None if not found.
    """
    _init()
    agent = get_agent_metadata(agent_id)
    if not agent:
        return None

    unique_ids: List[str] = []
    for tid in teacher_ids:
        tid = (tid or "").strip()
        if tid and tid not in unique_ids:
            unique_ids.append(tid)

    owner_id = agent.get("createdById")
    if owner_id and owner_id not in unique_ids:
        unique_ids.insert(0, owner_id)

    agent["teacherIds"] = unique_ids
    agent["updatedAt"] = datetime.now(timezone.utc).isoformat()
    _agents().upsert_item(body=agent)
    logger.info(f"Set teachers for agent '{scrub(agent_id)}': {scrub(unique_ids)}")
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
        logger.error(f"Error querying invite by email {scrub(email)}: {scrub(e)}")
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
        logger.error(f"Error querying user by email {scrub(email)}: {scrub(e)}")
        return None


def get_user_profile(user_id: str) -> Optional[Dict[str, Any]]:
    """Get user profile by ID from users_v1."""
    container = _users()
    try:
        from azure.cosmos.exceptions import CosmosResourceNotFoundError
        return container.read_item(item=user_id, partition_key=user_id)
    except Exception:
        return None


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
        logger.error(f"Error querying invite by id {scrub(invite_id)}: {scrub(e)}")
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
    logger.info(f"Invited user {scrub(normalized_email)} as {scrub(role)} (id={scrub(dir_id)})")
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
    """Remove a user from C2 (users_v1) and C1 (invited_users_v1).

    A promoted user exists in both containers, so both are always cleared —
    stopping at the first hit leaves an orphaned invite that keeps re-inviting
    the same address failing with "already exists".
    """
    from azure.cosmos.exceptions import CosmosResourceNotFoundError
    removed = False

    try:
        _users().delete_item(item=user_id, partition_key=user_id)
        logger.info(f"Deleted user {scrub(user_id)} from users_v1")
        removed = True
    except CosmosResourceNotFoundError:
        pass
    except Exception as e:
        logger.error(f"Error deleting user {scrub(user_id)} from C2: {scrub(e)}")

    try:
        items = list(_invited().query_items(
            query="SELECT * FROM c WHERE c.id = @id",
            parameters=[{"name": "@id", "value": user_id}],
            enable_cross_partition_query=True,
        ))
        if items:
            doc = items[0]
            _invited().delete_item(item=doc["id"], partition_key=doc["email"])
            logger.info(f"Deleted invite {scrub(user_id)} from invited_users_v1")
            removed = True
    except Exception as e:
        logger.error(f"Error deleting invite {scrub(user_id)} from C1: {scrub(e)}")
    return removed


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
