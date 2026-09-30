import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute

from backend.dependencies.auth import ActiveUser, get_current_active_user
from backend.schemas.course_form import (
    MAX_COURSE_NOTES_LENGTH,
    MAX_FORM_CONTEXT_LENGTH,
    CourseFormRequest,
    CourseFormResult,
    form_output_schema,
    validate_form_result,
)
from utils.form_attachments import AttachmentRejected, form_agent_input


logger = logging.getLogger(__name__)
FORM_ASSISTANT_NAME = "form-fill-assistant"
FORM_ASSISTANT_MODEL = "gpt-5"
FORM_ASSISTANT_VERSION = "4"
FORM_ASSISTANT_PROMPT = (
    Path(__file__).resolve().parents[2] / "prompt_store" / "agents" / "form_fill_assistant_v3.md"
).read_text(encoding="utf-8")


def agent_definition() -> dict:
    return {
        "kind": "prompt",
        "model": FORM_ASSISTANT_MODEL,
        "instructions": FORM_ASSISTANT_PROMPT,
        "reasoning": {"effort": "low"},
        "tools": [],
        "text": {"format": {
            "type": "json_schema", "name": "course_form", "strict": True, "schema": form_output_schema(),
        }},
    }


@asynccontextmanager
async def form_assistant_lifespan(app: FastAPI):
    from azure.ai.projects import AIProjectClient
    from azure_services.config import PROJECT_ENDPOINT
    from common_azure_auth import get_sync_credential

    with AIProjectClient(endpoint=PROJECT_ENDPOINT, credential=get_sync_credential()) as project:
        with project.get_openai_client() as client:
            app.state.course_form_client = client
            yield


class CourseFormRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def validate_request(request: Request):
            try:
                return await handler(request)
            except RequestValidationError as error:
                detail = "Check the course fields and attachment limits, then retry. Your form has not been changed."
                for issue in error.errors():
                    location = tuple(issue.get("loc", ()))
                    if location == ("body", "form", "courseNotes") and issue.get("type") == "string_too_long":
                        detail = f"The course description exceeds {MAX_COURSE_NOTES_LENGTH:,} characters. Shorten it before using Course Companion. Your form has not been changed."
                        break
                    if location == ("body", "text") and issue.get("type") == "string_too_long":
                        detail = "Your message exceeds 16,000 characters. Send a shorter message. Your form has not been changed."
                        break
                    if location == ("body",) and issue.get("type") == "value_error":
                        detail = f"The combined course form and chat context exceeds {MAX_FORM_CONTEXT_LENGTH:,} characters. Reduce the context before retrying. Your form has not been changed."
                raise HTTPException(status_code=422, detail=detail) from None

        return validate_request


router = APIRouter(prefix="/api/course-form", tags=["Course form assistant"], lifespan=form_assistant_lifespan, route_class=CourseFormRoute)


@router.post("/assist", response_model=CourseFormResult, response_model_exclude_none=True)
def assist_course_form(
    body: CourseFormRequest,
    request: Request,
    user: Annotated[ActiveUser, Depends(get_current_active_user)],
) -> CourseFormResult:
    if user.role not in {"teacher", "admin", "superadmin"}:
        raise HTTPException(status_code=403, detail="Only teachers and administrators can use the form assistant.")
    try:
        agent_input = form_agent_input(body)
        client = request.app.state.course_form_client.with_options(timeout=90, max_retries=0)
        response = client.responses.create(
            input=agent_input,
            extra_body={"agent_reference": {
                "name": FORM_ASSISTANT_NAME, "version": FORM_ASSISTANT_VERSION, "type": "agent_reference",
            }},
            max_output_tokens=6000,
            store=False,
        )
        if response.status != "completed":
            raise ValueError("The course form response did not complete")
        return validate_form_result(response.output_text, body)
    except AttachmentRejected as error:
        raise HTTPException(status_code=422, detail=str(error)) from None
    except Exception:
        logger.exception("Course form assistant failed")
        raise HTTPException(
            status_code=503,
            detail="The form assistant could not complete this request. Your form has not been changed. Please retry.",
        ) from None