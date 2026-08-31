"""Read-only Cosmos DB queries for the logging/analytics agent. See README.md."""

import json
import logging
from typing import Dict, Any, Optional, List

from azure_services.persistence.cosmos_db import (
    get_learning_state,
    get_progress_summary,
)
from utils.tool_definitions import load_tool_definition
from agent_tools.custom.base import CustomTool

logger = logging.getLogger(__name__)


# ════════════════════════════════════════════════════════════════════
# Cosmos DB helpers (cross-partition queries for admin use)
# ════════════════════════════════════════════════════════════════════

def _get_users_container():
    """Get the users_v1 container handle."""
    from azure_services.persistence.cosmos_db import get_cosmos_client
    get_cosmos_client()
    from azure_services.persistence.cosmos_db import _users_container
    return _users_container


def _get_agents_container():
    """Get the agents_v1 container handle."""
    from azure_services.persistence.cosmos_db import get_cosmos_client
    get_cosmos_client()
    from azure_services.persistence.cosmos_db import _agents_container
    return _agents_container


def _list_all_learning_states() -> List[Dict[str, Any]]:
    """Query all learning_state docs across all partitions."""
    container = _get_users_container()
    query = "SELECT * FROM c WHERE c.type = 'learning_state'"
    return list(container.query_items(
        query=query,
        enable_cross_partition_query=True,
    ))


def _list_learning_states_for_agent(agent_id: str) -> List[Dict[str, Any]]:
    """Query all learning_state docs for a specific agent."""
    container = _get_users_container()
    suffix = f"_{agent_id}_state"
    query = (
        "SELECT * FROM c "
        "WHERE ENDSWITH(c.id, @suffix) "
        "AND c.type = 'learning_state'"
    )
    return list(container.query_items(
        query=query,
        parameters=[{"name": "@suffix", "value": suffix}],
        enable_cross_partition_query=True,
    ))


# ════════════════════════════════════════════════════════════════════
# Tool 1: list_all_students
# ════════════════════════════════════════════════════════════════════

LIST_ALL_STUDENTS_TOOL_DEFINITION = load_tool_definition("list_all_students")


def handle_list_all_students(args: Dict[str, Any]) -> str:
    """Execute the list_all_students tool."""
    agent_id = args.get("agent_id")

    try:
        if agent_id:
            states = _list_learning_states_for_agent(agent_id)
        else:
            states = _list_all_learning_states()

        if not states:
            return json.dumps({
                "count": 0,
                "students": [],
                "message": f"No students found{' for agent ' + agent_id if agent_id else ''}.",
            })

        summaries = []
        for s in states:
            overall = s.get("overall", {})
            topics = s.get("topics", {})
            total = overall.get("total_topics", len(topics))
            learned = overall.get("learned", 0)
            in_progress = overall.get("in_progress", 0)
            not_started = overall.get("not_started", total)
            pct = round((learned / total) * 100, 1) if total > 0 else 0

            summaries.append({
                "user_id": s.get("userId", ""),
                "agent_id": s.get("agentId", ""),
                "total_topics": total,
                "learned": learned,
                "in_progress": in_progress,
                "not_started": not_started,
                "pct_complete": pct,
                "last_active": overall.get("last_active", ""),
            })

        # Sort by pct_complete descending
        summaries.sort(key=lambda x: x["pct_complete"], reverse=True)

        return json.dumps({
            "count": len(summaries),
            "students": summaries,
        })
    except Exception as e:
        logger.error(f"list_all_students failed: {e}")
        return json.dumps({"error": str(e)})


# ════════════════════════════════════════════════════════════════════
# Tool 2: get_student_progress
# ════════════════════════════════════════════════════════════════════

GET_STUDENT_PROGRESS_TOOL_DEFINITION = load_tool_definition("get_student_progress")


def handle_get_student_progress(args: Dict[str, Any]) -> str:
    """Execute the get_student_progress tool."""
    user_id = args.get("user_id", "")
    agent_id = args.get("agent_id", "")

    if not user_id or not agent_id:
        return json.dumps({"error": "Both user_id and agent_id are required."})

    try:
        state = get_learning_state(user_id, agent_id)
        if not state:
            return json.dumps({
                "error": f"No learning state found for user '{user_id}' on agent '{agent_id}'."
            })

        topics = state.get("topics", {})
        overall = state.get("overall", {})
        objectives = state.get("objectives", {})
        threshold_concepts = state.get("threshold_concepts", {})

        # Group topics by status
        by_status: Dict[str, list] = {"learned": [], "in_progress": [], "not_started": []}
        for name, t in topics.items():
            status = t.get("status", "not_started")
            entry = {
                "topic": name,
                "module": t.get("module", ""),
                "status": status,
                "latest_summary": t.get("latest_summary", ""),
                "last_touched": t.get("last_touched", ""),
            }
            by_status.setdefault(status, []).append(entry)

        # Struggle detection
        struggle_keywords = ["confused", "stuck", "doesn't understand", "incorrect", "wrong", "struggling"]
        struggles = [
            {"topic": name, "summary": t.get("latest_summary", "")}
            for name, t in topics.items()
            if t.get("latest_summary") and any(kw in t["latest_summary"].lower() for kw in struggle_keywords)
        ]

        # Recently active (by last_touched)
        active = sorted(
            [{"topic": n, **t} for n, t in topics.items() if t.get("last_touched")],
            key=lambda x: x["last_touched"],
            reverse=True,
        )[:10]

        total = overall.get("total_topics", len(topics))
        learned = overall.get("learned", 0)

        result = {
            "user_id": user_id,
            "agent_id": agent_id,
            "overall": {
                "total_topics": total,
                "learned": learned,
                "in_progress": overall.get("in_progress", 0),
                "not_started": overall.get("not_started", total - learned),
                "pct_complete": round((learned / total) * 100, 1) if total > 0 else 0,
                "last_active": overall.get("last_active", ""),
            },
            "topics_by_status": by_status,
            "recently_active": active,
            "struggle_areas": struggles,
            "objectives_count": len(objectives),
            "threshold_concepts_count": len(threshold_concepts),
        }

        return json.dumps(result)
    except Exception as e:
        logger.error(f"get_student_progress failed: {e}")
        return json.dumps({"error": str(e)})


# ════════════════════════════════════════════════════════════════════
# Tool 3: get_agent_overview
# ════════════════════════════════════════════════════════════════════

GET_AGENT_OVERVIEW_TOOL_DEFINITION = load_tool_definition("get_agent_overview")


def handle_get_agent_overview(args: Dict[str, Any]) -> str:
    """Execute the get_agent_overview tool."""
    agent_id = args.get("agent_id", "")
    if not agent_id:
        return json.dumps({"error": "agent_id is required."})

    try:
        states = _list_learning_states_for_agent(agent_id)
        if not states:
            return json.dumps({
                "agent_id": agent_id,
                "student_count": 0,
                "message": "No students have started this course yet.",
            })

        summaries = []
        for s in states:
            overall = s.get("overall", {})
            topics = s.get("topics", {})
            total = overall.get("total_topics", len(topics))
            learned = overall.get("learned", 0)
            pct = round((learned / total) * 100, 1) if total > 0 else 0
            summaries.append({
                "user_id": s.get("userId", ""),
                "pct_complete": pct,
                "learned": learned,
                "in_progress": overall.get("in_progress", 0),
                "not_started": overall.get("not_started", total),
                "last_active": overall.get("last_active", ""),
            })

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

        # Top struggle topics
        struggle_keywords = ["confused", "stuck", "doesn't understand", "incorrect", "wrong", "struggling"]
        struggle_freq: Dict[str, int] = {}
        for s in states:
            for name, t in s.get("topics", {}).items():
                summary = t.get("latest_summary", "") or ""
                if any(kw in summary.lower() for kw in struggle_keywords):
                    struggle_freq[name] = struggle_freq.get(name, 0) + 1
        top_struggles = sorted(struggle_freq.items(), key=lambda x: x[1], reverse=True)[:10]

        result = {
            "agent_id": agent_id,
            "student_count": len(summaries),
            "avg_pct_complete": avg_pct,
            "total_topics": states[0].get("overall", {}).get("total_topics", 0) if states else 0,
            "distribution": buckets,
            "top_struggle_topics": [{"topic": t, "count": c} for t, c in top_struggles],
            "students": summaries,
        }

        return json.dumps(result)
    except Exception as e:
        logger.error(f"get_agent_overview failed: {e}")
        return json.dumps({"error": str(e)})


# ════════════════════════════════════════════════════════════════════
# Tool 4: list_agents
# ════════════════════════════════════════════════════════════════════

LIST_AGENTS_TOOL_DEFINITION = load_tool_definition("list_agents")


def handle_list_agents(args: Dict[str, Any]) -> str:
    """Execute the list_agents tool."""
    try:
        container = _get_agents_container()
        query = "SELECT c.id, c.agentId, c.name, c.description, c.createdAt FROM c"
        items = list(container.query_items(
            query=query,
            enable_cross_partition_query=True,
        ))
        return json.dumps({
            "count": len(items),
            "agents": items,
        })
    except Exception as e:
        logger.error(f"list_agents failed: {e}")
        return json.dumps({"error": str(e)})


# ════════════════════════════════════════════════════════════════════
# CustomTool wrappers
#
# These read-only analytics tools already return a JSON string, which is
# exactly what the model should receive — so ``output`` echoes the result.
# ════════════════════════════════════════════════════════════════════


class _LoggingQueryTool(CustomTool):
    """Base for the read-only Cosmos analytics tools."""

    _handler = None

    def execute(self, arguments: Dict[str, Any], **context: Any) -> str:
        return type(self)._handler(arguments)

    def output(self, result: Any, arguments: Dict[str, Any]) -> str:
        return result if isinstance(result, str) else json.dumps(result)


class ListAllStudentsTool(_LoggingQueryTool):
    name = "list_all_students"
    _handler = staticmethod(handle_list_all_students)


class GetStudentProgressTool(_LoggingQueryTool):
    name = "get_student_progress"
    _handler = staticmethod(handle_get_student_progress)


class GetAgentOverviewTool(_LoggingQueryTool):
    name = "get_agent_overview"
    _handler = staticmethod(handle_get_agent_overview)


class ListAgentsTool(_LoggingQueryTool):
    name = "list_agents"
    _handler = staticmethod(handle_list_agents)

