import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from backend.dependencies.auth import ActiveUser, get_current_active_user
from backend.routers.course_materials import require_course
from backend.schemas.chat_suggestions import CourseSuggestions, SuggestionRequest
from base_agents.general_agent import get_general_agent


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/agents", tags=["Chat suggestions"])


@router.post("/{agent_name}/chat/suggestions", response_model=CourseSuggestions)
def suggest_questions(
    agent_name: str, body: SuggestionRequest,
    user: Annotated[ActiveUser, Depends(get_current_active_user)],
):
    from azure_services.config import PROJECT_ENDPOINT

    try:
        course, session = require_course(agent_name, user)
        agent = get_general_agent(PROJECT_ENDPOINT, agent_name, session_id=session)
        queries = agent.generate_next_queries(body.question, body.answer, course_context={
            "name": str(course.get("courseName") or course.get("name") or agent_name)[:300],
            "description": str(course.get("description") or "")[:4000],
        })
        return CourseSuggestions(queries=queries)
    except HTTPException:
        raise
    except Exception as error:
        logger.warning("Course suggestions unavailable (%s)", type(error).__name__)
        raise HTTPException(status_code=503, detail="Suggestions are unavailable. Your answer is complete.") from None