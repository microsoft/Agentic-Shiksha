import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from time import monotonic
from typing import Annotated

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request

from backend.dependencies.auth import ActiveUser, get_current_active_user
from backend.dependencies.agent_access import check_agent_access
from backend.schemas.curriculum_translation import (
    CurriculumTranslation,
    CurriculumTranslationCatalog,
    CurriculumTranslationRequest,
    DEFAULT_TRANSLATION_INSTRUCTIONS,
    TranslationBatch,
    TranslationLanguage,
    TranslationStyle,
)
from utils.curriculum_translation import (
    LANGUAGES,
    TranslationInProgressError,
    get_or_create_translation,
    list_translations,
    load_translation,
    syllabus_source_hash,
    syllabus_strings,
    validate_translations,
)


logger = logging.getLogger(__name__)
PROMPT = (Path(__file__).resolve().parents[2] / "prompt_store" / "tools" / "syllabus_translation_v4.md").read_text(encoding="utf-8")


@asynccontextmanager
async def translation_lifespan(app: FastAPI):
    from azure.ai.projects import AIProjectClient
    from azure_services.config import CHAT_MODEL, PROJECT_ENDPOINT
    from common_azure_auth import get_sync_credential

    with AIProjectClient(endpoint=PROJECT_ENDPOINT, credential=get_sync_credential()) as project:
        with project.get_openai_client() as client:
            app.state.syllabus_translation_client = client
            app.state.syllabus_translation_model = CHAT_MODEL
            yield


router = APIRouter(
    prefix="/api/agents/{agent_name}/course-curriculum/translations",
    tags=["Curriculum translations"], lifespan=translation_lifespan,
)
CurrentUser = Annotated[ActiveUser, Depends(get_current_active_user)]
SourceHash = Annotated[str, Query(pattern=r"^[0-9a-f]{64}$")]


def load_agent(agent_name: str) -> dict | None:
    from azure_services.persistence.cosmos_db import get_agent_metadata
    return get_agent_metadata(agent_name)


def load_curriculum(agent_name: str) -> dict | None:
    from azure_services.persistence.cosmos_db import get_course_curriculum
    return get_course_curriculum(agent_name)


def get_container():
    from azure_services.persistence.cosmos_db import _COURSE_CURRICULUM_CONTAINER, _get_blob_service_client
    return _get_blob_service_client().get_container_client(_COURSE_CURRICULUM_CONTAINER)


def require_curriculum(agent_name: str, user: ActiveUser, source_hash: str | None = None) -> dict:
    agent = load_agent(agent_name)
    if not agent:
        raise HTTPException(status_code=404, detail="Course not found")
    check_agent_access(agent, user)
    curriculum = load_curriculum(agent_name)
    if not curriculum or not curriculum.get("syllabus"):
        raise HTTPException(status_code=404, detail="Syllabus not available")
    if source_hash and source_hash != syllabus_source_hash(curriculum):
        raise HTTPException(status_code=409, detail="The syllabus changed. Reopen it before translating.")
    return curriculum


def translate_texts(
    request: Request, texts: list[str], language: TranslationLanguage, style: TranslationStyle,
    instructions: str = DEFAULT_TRANSLATION_INSTRUCTIONS,
) -> object:
    translations = []
    batches: list[list[str]] = []
    batch: list[str] = []
    batch_size = 0
    for text in texts:
        if batch and (len(batch) >= 80 or batch_size + len(text) > 10000):
            batches.append(batch)
            batch = []
            batch_size = 0
        batch.append(text)
        batch_size += len(text)
    if batch:
        batches.append(batch)
    deadline = monotonic() + 180
    for batch in batches:
        remaining = deadline - monotonic()
        if remaining <= 0:
            raise TimeoutError("Translation request exceeded its time limit")
        client = request.app.state.syllabus_translation_client.with_options(timeout=min(90, remaining), max_retries=0)
        response = client.responses.create(
            model=request.app.state.syllabus_translation_model,
            instructions=PROMPT,
            input=json.dumps({
                "language": LANGUAGES[language], "style": style,
                "translation_instructions": instructions, "texts": batch,
            }, ensure_ascii=False),
            text={"format": {
                "type": "json_schema", "name": "syllabus_translation", "strict": True,
                "schema": TranslationBatch.model_json_schema(),
            }},
            max_output_tokens=16384, store=False,
        )
        if response.status != "completed":
            raise ValueError("Translation response was incomplete")
        translated = TranslationBatch.model_validate_json(response.output_text)
        validated = validate_translations(batch, translated.model_dump())
        translations.extend(validated[text] for text in batch)
    return {"translations": translations}


@router.get("", response_model=CurriculumTranslationCatalog)
def get_translation_catalog(agent_name: str, user: CurrentUser):
    try:
        curriculum = require_curriculum(agent_name, user)
        return CurriculumTranslationCatalog(
            source_hash=syllabus_source_hash(curriculum),
            translations=list_translations(get_container(), agent_name, curriculum, user.id),
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Unable to list syllabus translations")
        raise HTTPException(status_code=503, detail="Saved translations could not be loaded. Please retry.") from None


@router.get("/{language}/{style}", response_model=CurriculumTranslation)
def get_saved_translation(
    agent_name: str, language: TranslationLanguage, style: TranslationStyle, source_hash: SourceHash,
    user: CurrentUser,
    instructions_hash: Annotated[str, Query(pattern=r"^(default|[0-9a-f]{64})$")] = "default",
):
    try:
        curriculum = require_curriculum(agent_name, user, source_hash)
        translation = load_translation(get_container(), agent_name, curriculum, language, style, instructions_hash, user.id)
        if translation is None:
            raise HTTPException(status_code=404, detail="Translation not available")
        return translation
    except HTTPException:
        raise
    except Exception:
        logger.exception("Unable to load syllabus translation")
        raise HTTPException(status_code=503, detail="The saved translation could not be loaded. Please retry.") from None


@router.post("", response_model=CurriculumTranslation)
def create_translation(agent_name: str, body: CurriculumTranslationRequest, request: Request, user: CurrentUser):
    try:
        curriculum = require_curriculum(agent_name, user, body.source_hash)
        texts = syllabus_strings(curriculum)
        if len(texts) > 800 or sum(map(len, texts)) > 80000 or any(len(text) > 8000 for text in texts):
            raise HTTPException(status_code=413, detail="This syllabus is too large to translate in one request.")
        return get_or_create_translation(
            get_container(), agent_name, curriculum, body.language, body.style,
            lambda strings, language, style: translate_texts(request, strings, language, style, body.instructions),
            instructions=body.instructions, user_id=user.id,
        )
    except HTTPException:
        raise
    except TranslationInProgressError:
        raise HTTPException(status_code=409, detail="This translation is already being created. Please try again shortly.") from None
    except Exception:
        logger.exception("Unable to create syllabus translation")
        raise HTTPException(status_code=503, detail="Translation could not be completed and saved. Please retry.") from None