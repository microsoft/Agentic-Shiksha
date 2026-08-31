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
import re
from typing import Dict, Any, List

from . import cosmos_queries as cq

logger = logging.getLogger(__name__)


def resolve_evidence_citations(
    response_text: str,
    evidence_bundle: Dict[str, Any],
) -> Dict[str, Any]:
    """Resolve response refs against the authorized catalog; chats never enter it."""
    catalog = {
        item.get("ref"): item
        for item in evidence_bundle.get("evidence_catalog") or []
        if item.get("ref") and item.get("kind") != "chat"
    }
    refs = re.findall(r"\[\[([A-Za-z0-9-]+)\]\]", response_text or "")
    citations = []
    seen = set()
    for ref in refs:
        if ref in seen or ref not in catalog:
            continue
        seen.add(ref)
        citations.append(catalog[ref])
    return {
        "citations": citations,
        "chatSignalsReviewed": bool(evidence_bundle.get("chat_signals_reviewed")),
    }


GET_LEARNING_EVIDENCE_TOOL_DEFINITION = {
    "name": "get_learning_evidence",
    "description": (
        "Return the server-authorized learning evidence bundle for the current "
        "teacher request. It includes concept-inventory first attempts, threshold-"
        "concept progress, topic progress, recent student-created assets, bounded "
        "recent chat signals, and evidence coverage. The server fixes the course "
        "and student scope; this tool takes no IDs."
    ),
    "parameters": {
        "type": "object",
        "properties": {},
        "required": [],
    },
}


def _identify(state: Dict[str, Any], agent_id: str = "") -> Dict[str, str]:
    """Learning-state docs have no userId field, so derive it from the doc id."""
    uid = cq._state_user_id(state, agent_id)
    profile = cq.get_user_profile(uid) or {} if uid else {}
    return {
        "user_id": uid,
        "display_name": profile.get("displayName") or profile.get("fullName") or uid,
    }


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
                **_identify(s, agent_id),
                "agent_id": s.get("agentId", "") or agent_id,
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
                **_identify(s, agent_id),
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
    GET_LEARNING_EVIDENCE_TOOL_DEFINITION,
    LIST_AGENTS_TOOL_DEFINITION,
    LIST_ALL_STUDENTS_TOOL_DEFINITION,
    GET_STUDENT_PROGRESS_TOOL_DEFINITION,
    GET_AGENT_OVERVIEW_TOOL_DEFINITION,
]

TOOL_HANDLERS = {
    "get_learning_evidence": lambda args: json.dumps(
        {"error": "Learning evidence requires an authorized teacher request scope."}
    ),
    "list_agents": handle_list_agents,
    "list_all_students": handle_list_all_students,
    "get_student_progress": handle_get_student_progress,
    "get_agent_overview": handle_get_agent_overview,
}


def execute_scoped_tool(
    name: str,
    args: Dict[str, Any],
    scope: Dict[str, Any],
) -> str:
    """Dispatch a tool only within the route-authorized course/student scope."""
    allowed_agents = set(scope.get("allowed_agent_ids") or [])
    target_students = set(scope.get("target_student_ids") or [])
    selected_mode = bool(scope.get("selected_mode"))

    if name == "get_learning_evidence":
        return json.dumps(scope.get("evidence_bundle") or {"students": []})

    if name == "list_agents":
        agents = []
        for agent_id in sorted(allowed_agents):
            agent = cq.get_agent_metadata(agent_id) or {}
            agents.append({
                "agentId": agent_id,
                "name": agent.get("courseName") or agent.get("name") or agent_id,
                "description": agent.get("description", ""),
            })
        return json.dumps({"count": len(agents), "agents": agents})

    requested_agent = args.get("agent_id")
    if requested_agent and requested_agent not in allowed_agents:
        return json.dumps({"error": "That course is outside the authorized teacher scope."})
    if not requested_agent and len(allowed_agents) == 1:
        args = {**args, "agent_id": next(iter(allowed_agents))}

    if name == "get_student_progress":
        if args.get("user_id") not in target_students:
            return json.dumps({"error": "That student is outside the authorized insight scope."})
    elif name == "list_all_students":
        result = json.loads(handle_list_all_students(args))
        students = [
            student
            for student in result.get("students", [])
            if student.get("user_id") in target_students
            and student.get("agent_id") in allowed_agents
        ]
        return json.dumps({**result, "count": len(students), "students": students})
    elif name == "get_agent_overview" and selected_mode:
        return json.dumps({
            "error": (
                "Class overview is unavailable in selected-student mode. "
                "Use get_learning_evidence for the selected students."
            )
        })
    elif name == "get_agent_overview":
        return json.dumps(cq.agent_overview(args["agent_id"]))

    handler = TOOL_HANDLERS.get(name)
    if not handler:
        return json.dumps({"error": f"Unknown analytics tool '{name}'."})
    return handler(args)
