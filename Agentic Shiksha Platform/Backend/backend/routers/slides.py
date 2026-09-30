import json
import logging
from typing import Annotated
from uuid import uuid4

from azure.ai.projects.models import FunctionTool, PromptAgentDefinition
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import ValidationError

from backend.routers.circuit import project_client, require_tool_owner, tool_update_lock
from backend.routers.course_materials import CurrentUser, require_course
from backend.schemas.slides import (
    EnableSlidesToolRequest, SlidesBlock, SlidesExportRequest, SlidesSaveRequest, SlidesSaveResponse, SlidesToolStatus,
    SlideSpeechRequest, SlideSpeechVoicesResponse,
)
from utils import slide_speech
from utils.slide_export import PPTX_MEDIA_TYPE, SlideLayoutError, presentation_filename, render_presentation
from utils.tool_definitions import load_tool_definition


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/agents", tags=["Presentations"])


def require_speech_course(agent_name: str, user: CurrentUser) -> None:
    try:
        require_course(agent_name, user)
    except HTTPException:
        raise
    except Exception:
        logger.warning("Presentation speech course access could not be verified")
        raise HTTPException(status_code=503, detail="Course access could not be verified. Please retry.") from None


@router.get(
    "/{agent_name}/slides/voices",
    response_model=SlideSpeechVoicesResponse,
    response_model_exclude_none=True,
    dependencies=[Depends(require_speech_course)],
)
def get_slide_voices(response: Response) -> SlideSpeechVoicesResponse:
    response.headers["Cache-Control"] = "private, no-store"
    return slide_speech.voice_catalog()


async def speech_request_body(request: Request) -> SlideSpeechRequest:
    # Parse after course authorization, without echoing scripts or invalid Unicode in errors.
    try:
        return SlideSpeechRequest.model_validate_json(await request.body())
    except ValidationError:
        raise HTTPException(status_code=422, detail="Invalid speech text or voice.") from None


@router.post(
    "/{agent_name}/slides/speech",
    response_class=Response,
    response_model=None,
    dependencies=[Depends(require_speech_course)],
    responses={200: {"content": {slide_speech.AUDIO_MEDIA_TYPE: {"schema": {"type": "string", "format": "binary"}}}}},
    openapi_extra={"requestBody": {
        "required": True,
        "content": {"application/json": {"schema": SlideSpeechRequest.model_json_schema()}},
    }},
)
def generate_slide_speech(body: Annotated[SlideSpeechRequest, Depends(speech_request_body)]) -> Response:
    headers = {"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"}
    try:
        audio = slide_speech.synthesize_speech(body)
    except slide_speech.SlideSpeechError as error:
        if error.retry_after is not None:
            headers["Retry-After"] = error.retry_after
        raise HTTPException(status_code=error.status_code, detail=error.detail, headers=headers) from None
    except Exception:
        logger.warning("Presentation speech could not be generated")
        raise HTTPException(status_code=503, detail=slide_speech.UPSTREAM_FAILURE, headers=headers) from None
    return Response(audio, media_type=slide_speech.AUDIO_MEDIA_TYPE, headers=headers)


def tool_status(version) -> SlidesToolStatus:
    tools = [
        tool for tool in version.definition.tools or []
        if tool.type == "function" and tool.name == "add_slides"
    ]
    current = load_tool_definition("add_slides")
    return SlidesToolStatus(
        enabled=bool(tools),
        agent_version=str(version.version),
        update_available=any(
            tool.description != current["description"] or tool.parameters != current["parameters"]
            for tool in tools
        ),
    )


@router.get("/{agent_name}/slides/tool", response_model=SlidesToolStatus)
def get_slides_tool(agent_name: str, user: CurrentUser):
    try:
        require_tool_owner(agent_name, user)
        return tool_status(project_client().agents.get(agent_name=agent_name, read_timeout=10).versions.latest)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Presentation tool status could not be checked")
        raise HTTPException(status_code=503, detail="Presentation tool status could not be checked. Please retry.") from None


@router.post("/{agent_name}/slides/tool", response_model=SlidesToolStatus)
def enable_slides_tool(agent_name: str, body: EnableSlidesToolRequest, user: CurrentUser):
    try:
        require_tool_owner(agent_name, user)
        with tool_update_lock(agent_name):
            client = project_client()
            version = client.agents.get(agent_name=agent_name, read_timeout=10).versions.latest
            status = tool_status(version)
            if status.agent_version != body.expected_version:
                raise HTTPException(status_code=409, detail="The TA changed. Reload its tool status before enabling or updating slides.")
            if status.enabled and not status.update_available:
                return status
            if version.definition.kind != "prompt":
                raise HTTPException(status_code=409, detail="Slides require a prompt-based TA.")
            definition = PromptAgentDefinition(version.definition.as_dict())
            tool = load_tool_definition("add_slides")
            if status.enabled:
                for existing in definition.tools:
                    if existing.type == "function" and existing.name == "add_slides":
                        existing.description = tool["description"]
                        existing.parameters = tool["parameters"]
            else:
                definition.tools = [*(definition.tools or []), FunctionTool(
                    name=tool["name"], description=tool["description"], parameters=tool["parameters"], strict=False,
                )]
            updated = client.agents.create_version(
                agent_name=agent_name, definition=definition,
                metadata=dict(version.metadata or {}), description=version.description,
                retry_total=0, read_timeout=30,
            )
            from utils.metadata_cache import invalidate_agent_metadata

            invalidate_agent_metadata(agent_name)
            return tool_status(updated)
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Presentation tool update could not be confirmed")
        if getattr(error, "status_code", None) in {409, 412}:
            raise HTTPException(status_code=409, detail="A tool update is already in progress. Recheck its status.") from None
        raise HTTPException(status_code=503, detail="The tool update could not be confirmed. Recheck its status before retrying.") from None


@router.post(
    "/{agent_name}/slides/export",
    response_class=Response,
    response_model=None,
    responses={200: {"content": {PPTX_MEDIA_TYPE: {"schema": {"type": "string", "format": "binary"}}}}},
)
def export_slides(agent_name: str, body: SlidesExportRequest, user: CurrentUser) -> Response:
    try:
        require_course(agent_name, user)
        content = render_presentation(body.deck)
        return Response(content, media_type=PPTX_MEDIA_TYPE, headers={
            "Content-Disposition": f'attachment; filename="{presentation_filename(body.deck.title)}"',
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        })
    except HTTPException:
        raise
    except SlideLayoutError as error:
        logger.warning("Presentation export rejected an overcrowded deck")
        raise HTTPException(status_code=422, detail=str(error)) from None
    except Exception:
        logger.exception("PowerPoint export failed")
        raise HTTPException(status_code=503, detail="The PowerPoint could not be generated. Please retry.") from None


@router.post("/{agent_name}/slides/save", response_model=SlidesSaveResponse)
def save_slides(
    agent_name: str, body: SlidesSaveRequest, user: CurrentUser, response: Response,
) -> SlidesSaveResponse:
    try:
        require_course(agent_name, user)
        render_presentation(body.deck)
    except HTTPException:
        raise
    except SlideLayoutError:
        logger.warning("Presentation save rejected an overcrowded deck")
        raise HTTPException(
            status_code=422,
            detail="Slide text is too dense. Shorten the title or bullets, or split the content into more slides.",
        ) from None
    except Exception:
        logger.exception("Presentation save preflight failed")
        raise HTTPException(
            status_code=503, detail="The presentation copy could not be prepared. Please retry.",
        ) from None

    try:
        from azure_services.persistence.cosmos_db import create_asset

        block = SlidesBlock(slidesId=str(uuid4()), title=body.deck.title, deck=body.deck)
        asset = create_asset(
            user_id=user.id,
            title=block.title,
            category="presentation",
            asset_type="json",
            content=json.dumps({**block.model_dump(mode="json"), "agentId": agent_name}, ensure_ascii=False),
            agent_id=agent_name,
            is_public=False,
        )
        saved = SlidesSaveResponse.model_validate({"assetId": asset["id"], "block": block})
        response.headers["Cache-Control"] = "private, no-store"
        return saved
    except Exception:
        logger.exception("Presentation copy save could not be confirmed")
        raise HTTPException(
            status_code=503,
            detail="The presentation copy could not be saved. Check your assets before saving again.",
        ) from None
