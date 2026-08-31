"""
Logging Agent Tools (Dashboard version)
────────────────────────────────────────
Function tool definitions and handlers for the logging/analytics agent.
These tools give the agent read-only access to student learning data
stored in Cosmos DB so it can answer questions about learning trajectories.

Adapted for the Dashboard server — uses cosmos_queries.py instead of
Backend's azure_services.cosmos_db.
"""

import json
import logging
from typing import Dict, Any, List

import cosmos_queries as cq

logger = logging.getLogger(__name__)


# ════════════════════════════════════════════════════════════════════
# Tool 1: list_all_students
# ════════════════════════════════════════════════════════════════════

LIST_ALL_STUDENTS_TOOL_DEFINITION = {
    "name": "list_all_students",
    "description": (
        "List all students who have learning progress data, optionally filtered "
        "by a specific agent/course. Returns each student's user ID, agent, "
        "completion percentage, topic counts (learned / in_progress / not_started), "
        "and last active time."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "agent_id": {
                "type": "string",
                "description": (
                    "Optional. Filter to a specific agent/course name "
                    "(e.g. 'course-Machine-Learning'). If omitted, returns students across all agents."
                ),
            }
        },
        "required": [],
    },
}


def handle_list_all_students(args: Dict[str, Any]) -> str:
    """Execute the list_all_students tool."""
    agent_id = args.get("agent_id")

    try:
        if agent_id:
            states = cq.list_learning_states_for_agent(agent_id)
        else:
            # All learning states across all agents
            states = list(cq._users().query_items(
                query="SELECT * FROM c WHERE c.type = 'learning_state'",
                enable_cross_partition_query=True,
            ))

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

GET_STUDENT_PROGRESS_TOOL_DEFINITION = {
    "name": "get_student_progress",
    "description": (
        "Get detailed learning progress for a specific student on a specific agent/course. "
        "Returns the full topic-by-topic breakdown grouped by status (learned, in_progress, not_started), "
        "overall completion percentage, recently active topics, struggle areas, "
        "and each topic's latest summary of what the student understood."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "user_id": {
                "type": "string",
                "description": "The student's user ID (e.g. their email address or user identifier).",
            },
            "agent_id": {
                "type": "string",
                "description": "The agent/course name (e.g. 'course-Machine-Learning').",
            },
        },
        "required": ["user_id", "agent_id"],
    },
}


def handle_get_student_progress(args: Dict[str, Any]) -> str:
    """Execute the get_student_progress tool."""
    user_id = args.get("user_id", "")
    agent_id = args.get("agent_id", "")

    if not user_id or not agent_id:
        return json.dumps({"error": "Both user_id and agent_id are required."})

    try:
        state = cq.get_learning_state(user_id, agent_id)
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

GET_AGENT_OVERVIEW_TOOL_DEFINITION = {
    "name": "get_agent_overview",
    "description": (
        "Get aggregate learning analytics for an agent/course across ALL students. "
        "Returns total student count, average completion percentage, "
        "completion distribution buckets (0-25%, 25-50%, 50-75%, 75-100%), "
        "and the most commonly struggled topics."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "agent_id": {
                "type": "string",
                "description": "The agent/course name (e.g. 'course-Machine-Learning').",
            },
        },
        "required": ["agent_id"],
    },
}


def handle_get_agent_overview(args: Dict[str, Any]) -> str:
    """Execute the get_agent_overview tool."""
    agent_id = args.get("agent_id", "")
    if not agent_id:
        return json.dumps({"error": "agent_id is required."})

    try:
        states = cq.list_learning_states_for_agent(agent_id)
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

LIST_AGENTS_TOOL_DEFINITION = {
    "name": "list_agents",
    "description": (
        "List all available agents/courses in the system. "
        "Returns each agent's ID, name, and description."
    ),
    "parameters": {
        "type": "object",
        "properties": {},
        "required": [],
    },
}


def handle_list_agents(args: Dict[str, Any]) -> str:
    """Execute the list_agents tool."""
    try:
        items = cq.list_agents()
        return json.dumps({
            "count": len(items),
            "agents": items,
        })
    except Exception as e:
        logger.error(f"list_agents failed: {e}")
        return json.dumps({"error": str(e)})


# ════════════════════════════════════════════════════════════════════
# Tool Dispatch Map (convenience for the Dashboard server)
# ════════════════════════════════════════════════════════════════════

TOOL_DEFINITIONS = [
    LIST_AGENTS_TOOL_DEFINITION,
    LIST_ALL_STUDENTS_TOOL_DEFINITION,
    GET_STUDENT_PROGRESS_TOOL_DEFINITION,
    GET_AGENT_OVERVIEW_TOOL_DEFINITION,
]

TOOL_HANDLERS = {
    "list_agents": handle_list_agents,
    "list_all_students": handle_list_all_students,
    "get_student_progress": handle_get_student_progress,
    "get_agent_overview": handle_get_agent_overview,
}
