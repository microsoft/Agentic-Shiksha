import asyncio
import hashlib
import json
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Literal
from uuid import NAMESPACE_URL, uuid4, uuid5

from azure.ai.projects import AIProjectClient
from azure.ai.projects.models import MemoryStoreDefaultDefinition, MemoryStoreDefaultOptions, PromptAgentDefinition
from azure.core.exceptions import HttpResponseError, ResourceNotFoundError
from azure.cosmos.exceptions import CosmosResourceExistsError, CosmosResourceNotFoundError
from azure.storage.blob import ContentSettings
from pydantic import ValidationError

from backend.schemas.course_creation import CourseCreationRequest, CourseCreationState, CourseCreationStatus, CourseSpecification, CreatedCourse, CreationTextbook, CurriculumResearchInput, CurriculumResearchJob, CurriculumStatus
from backend.schemas.course_materials import MaterialJob
from utils import material_jobs


logger = logging.getLogger(__name__)
PROMPTS = Path(__file__).resolve().parents[1] / "prompt_store" / "tools"


class CourseSpecificationError(RuntimeError):
    pass


@lru_cache(maxsize=1)
def get_creation_client():
    from azure_services.config import PROJECT_ENDPOINT
    from common_azure_auth import get_sync_credential

    return AIProjectClient(endpoint=PROJECT_ENDPOINT, credential=get_sync_credential(), allow_preview=True, retry_total=0, connection_timeout=10, read_timeout=180)


def close_creation_client() -> None:
    if get_creation_client.cache_info().currsize:
        get_creation_client().close()
        get_creation_client.cache_clear()


def normalize_request(request: CourseCreationRequest, owner_id: str) -> CourseCreationRequest:
    from backend.main import AGENT_MODEL_DEPLOYMENT, ALLOWED_DEPLOYMENTS, sanitize_agent_name
    from azure_services.config import COMMON_INDEX_NAME

    model = request.model or AGENT_MODEL_DEPLOYMENT
    if model not in ALLOWED_DEPLOYMENTS or (request.indexName and request.indexName != COMMON_INDEX_NAME):
        raise ValueError("Invalid creation configuration")
    return request.model_copy(update={"name": sanitize_agent_name(request.name), "model": model, "createdById": owner_id, "createdByName": None, "indexName": COMMON_INDEX_NAME})


def request_digest(request: CourseCreationRequest) -> str:
    return hashlib.sha256(request.model_dump_json().encode()).hexdigest()


def reserve_name(job: MaterialJob, name: str) -> None:
    identity = "agent-reservation-" + hashlib.sha256(name.lower().encode()).hexdigest()
    try:
        material_jobs.job_container().create_item(body={
            "id": identity, "job_type": "course_agent_reservation", "owner_id": job.owner_id,
            "job_id": job.id, "name": name,
        })
    except CosmosResourceExistsError:
        reservation = material_jobs.job_container().read_item(item=identity, partition_key=identity)
        if reservation.get("job_id") != job.id or reservation.get("owner_id") != job.owner_id:
            raise ValueError("Course name is already reserved") from None


def start_creation(job: MaterialJob, request: CourseCreationRequest) -> MaterialJob:
    from azure_services.persistence.cosmos_db import _generate_manage_code

    request = normalize_request(request, job.owner_id)
    digest = request_digest(request)
    if job.creation:
        if job.creation.input_digest != digest:
            raise ValueError("Creation request changed")
        return job
    if job.agent_name:
        raise ValueError("This draft already belongs to a course")
    if job.lease_until and job.lease_until > datetime.now(timezone.utc):
        raise ValueError("Draft is processing")
    reserve_name(job, request.name)
    if job.progress == "uploading":
        job.progress = "preparing" if job.files else "ready"
    job.creation = CourseCreationState(request=request, input_digest=digest, manage_code=_generate_manage_code())
    job.status = "PENDING"
    job.next_attempt_at = datetime.now(timezone.utc)
    return material_jobs.save_job(job)


def creation_status(job: MaterialJob) -> CourseCreationStatus:
    if job.creation is None:
        return CourseCreationStatus(
            job_id=job.id, status="NOT_STARTED", progress="not_started", materials_status=job.progress,
            error="TA creation was not submitted. Return to the form to submit it.",
        )
    creation = job.creation
    stopped = job.status in {"FAILED", "COMPLETED"} and creation.status in {"PENDING", "RUNNING"}
    status = "FAILED" if stopped else creation.status
    error = creation.error
    if status == "FAILED" and not error:
        error = "TA creation stopped before completion. Retry to resume its saved progress."
    materials = material_jobs.job_status(job)
    result = None
    if creation.status == "COMPLETED":
        result = CreatedCourse(
            agent_id=creation.request.name, name=creation.request.name,
            description=creation.specification.description, conversation_starters=creation.request.conversationStarters,
            index_name=materials.index_name,
            knowledge_pending=materials.progress != "ready", materials_job_id=job.id, materials_status=materials.progress,
            manage_code=creation.manage_code,
        )
    return CourseCreationStatus(
        job_id=job.id, status=status, progress=creation.progress, course_name=creation.request.courseName,
        materials_status=materials.progress, error=error, result=result,
    )


def generate_specification(request: CourseCreationRequest) -> CourseSpecification:
    from backend.main import COURSE_AGENT_CREATION_AGENT_ID, redact_pii_for_model

    brief = json.dumps({
        "course_name": request.courseName, "level": request.courseLevel,
        "duration": request.courseDuration, "description": request.additionalContext,
        "prerequisites": request.prerequisites,
    }, ensure_ascii=False)
    prompt = (PROMPTS / "course_creation_request_v1.md").read_text(encoding="utf-8").replace("{course_brief}", brief)
    with get_creation_client().get_openai_client().with_options(max_retries=0, timeout=180) as client:
        response = client.responses.create(
            input=redact_pii_for_model(prompt), store=False,
            tool_choice="none",
            extra_body={"agent_reference": {"name": COURSE_AGENT_CREATION_AGENT_ID, "type": "agent_reference"}},
        )
    if response.status != "completed":
        logger.warning("Course specification response did not complete (%s)", response.status)
        raise CourseSpecificationError("Course specification generation did not complete.")
    text = (response.output_text or "").strip()
    if text.startswith("```json\n") and text.endswith("```"):
        text = text[8:-3].strip()
    try:
        return CourseSpecification.model_validate_json(text)
    except ValidationError as error:
        logger.warning("Rejected invalid course specification response (%s)", type(error).__name__)
        raise CourseSpecificationError("Course specification response did not match the required format.") from None


def find_owned_agent(job: MaterialJob):
    try:
        agent = get_creation_client().agents.get(agent_name=job.creation.request.name)
    except ResourceNotFoundError:
        return None
    version = agent.versions.latest
    if (version.metadata or {}).get("course_job_id") != job.id:
        raise ValueError("An unrelated agent already uses this name")
    return version


def prepare_memory(job: MaterialJob) -> str:
    from learner_memory.settings import get_memory_settings

    if get_memory_settings().enabled:
        return ""
    from azure_services.tools.memory.memory_store_manager import DEFAULT_CHAT_MODEL, DEFAULT_EMBEDDING_MODEL

    name = job.creation.request.name + "-memory"
    client = get_creation_client()
    try:
        memory = client.beta.memory_stores.get(name=name)
    except ResourceNotFoundError:
        memory = client.beta.memory_stores.create(
            name=name, metadata={"course_job_id": job.id},
            definition=MemoryStoreDefaultDefinition(
                chat_model=DEFAULT_CHAT_MODEL, embedding_model=DEFAULT_EMBEDDING_MODEL,
                options=MemoryStoreDefaultOptions(chat_summary_enabled=True, user_profile_enabled=True),
            ), retry_total=0,
        )
    if (memory.metadata or {}).get("course_job_id") != job.id:
        raise ValueError("Memory store ownership could not be verified")
    return memory.name


def create_foundry_agent(job: MaterialJob) -> str:
    from azure_services.agents.agent_creation import AgentToolBuilder
    from azure_services.config import COMMON_INDEX_NAME, SEARCH_CONNECTION_ID
    from utils.prompt_unifier import unify_agent_prompts

    creation = job.creation
    request = creation.request
    existing = find_owned_agent(job)
    if existing:
        return str(existing.version)
    if creation.agent_create_started:
        raise RuntimeError("A previous agent creation is awaiting confirmation")
    context = request.additionalContext or ""
    if request.courseUrls:
        template = (PROMPTS / "teacher_resources_context_v1.md").read_text(encoding="utf-8")
        context += "\n\n" + template.replace("{urls}", "\n".join(f"- {url}" for url in request.courseUrls))
    instructions = unify_agent_prompts(
        course_name=request.courseName, course_level=request.courseLevel,
        course_duration=request.courseDuration, learning_prompt=creation.specification.instructions,
        exam_prompt=None, additional_context=context or None,
        include_agent_behavior=True, include_pedagogical_framework=True, include_tool_handling=True,
        include_knowledge_grounding=True, include_safety_guardrails=True,
    )
    tools = AgentToolBuilder(agent_name=request.name).build(
        include_web_search=False, include_custom_search=bool(request.customSearchInstanceName),
        custom_search_instance_name=request.customSearchInstanceName,
        search_index_name=COMMON_INDEX_NAME, search_index_filter=f"session_id eq '{job.session_uuid}'",
        search_connection_id=SEARCH_CONNECTION_ID, memory_store_name=creation.memory_store_name,
        memory_scope="{{$userId}}", memory_update_delay=300,
    )
    creation.agent_create_started = True
    material_jobs.save_checkpoint(job)
    try:
        agent = get_creation_client().agents.create_version(
            agent_name=request.name, metadata={"course_job_id": job.id},
            definition=PromptAgentDefinition(model=request.model, instructions=instructions, tools=tools),
            retry_total=0,
        )
    except HttpResponseError as error:
        if error.status_code in {400, 401, 403, 404, 409, 422, 429}:
            creation.agent_create_started = False
            material_jobs.save_checkpoint(job)
        raise
    return str(agent.version)


def persist_created_course(job: MaterialJob) -> None:
    from azure_services.persistence import cosmos_db
    from utils.metadata_cache import invalidate_agent_metadata

    creation = job.creation
    request = creation.request
    existing = material_jobs.course_materials.load_course(request.name)
    if existing and (existing.get("metadata") or {}).get("creationJobId") != job.id:
        raise ValueError("Course metadata ownership changed")
    setup = {
        "agentId": request.name, "agentKind": request.kind, "courseName": request.courseName,
        "courseLevel": request.courseLevel or "", "courseDuration": request.courseDuration or "",
        "additionalContext": request.additionalContext or "", "courseCode": request.courseCode or "",
        "prerequisites": request.prerequisites, "textbooks": [{"id": hashlib.sha256(f"{job.id}:{position}".encode()).hexdigest()[:16], **book.model_dump()} for position, book in enumerate(request.textbooks)],
        "vectorStoreId": request.indexName, "indexName": request.indexName, "knowledgeUrls": request.courseUrls,
        "conversationStarters": [starter.model_dump() for starter in request.conversationStarters],
        "agentDescription": creation.specification.description, "agentImageUrl": request.agentImageUrl,
        "agentAvatar": request.agentAvatar.model_dump() if request.agentAvatar else None,
        "knowledgeAttached": True, "sessionUuid": job.session_uuid, "materialJobId": job.id,
    }
    blob = cosmos_db._get_blob_service_client().get_blob_client(cosmos_db._AGENT_SETUPS_CONTAINER, f"{request.name}/setup.json")
    blob.upload_blob(json.dumps(setup).encode(), overwrite=True, content_settings=ContentSettings(content_type="application/json"))
    if not existing:
        cosmos_db.create_agent_metadata(
            agent_id=request.name, name=request.name, created_by=job.owner_id,
            description=creation.specification.description, model=request.model,
            course_name=request.courseName, course_level=request.courseLevel or "", course_duration=request.courseDuration or "",
            agent_kind=request.kind, conversation_starters=setup["conversationStarters"],
            additional_context=request.additionalContext or "", session_uuid=job.session_uuid,
            manage_code=creation.manage_code, department_id=request.departmentId or "", course_code=request.courseCode or "",
            agent_image_url=request.agentImageUrl,
            metadata={"creationJobId": job.id, "materialJobId": job.id, "agentAvatar": setup["agentAvatar"]},
        )
    invalidate_agent_metadata(request.name)
    enqueue_curriculum(job)


def advance_creation(job: MaterialJob) -> MaterialJob:
    creation = job.creation
    creation.status = "RUNNING"
    creation.attempts += 1
    job = material_jobs.save_checkpoint(job)
    creation = job.creation
    try:
        if creation.progress == "preparing":
            find_owned_agent(job)
            failures = []
            with ThreadPoolExecutor(max_workers=2) as executor:
                pending = {}
                if creation.specification is None:
                    pending[executor.submit(generate_specification, creation.request)] = "specification"
                if creation.memory_store_name is None:
                    pending[executor.submit(prepare_memory, job)] = "memory_store_name"
                for future in as_completed(pending):
                    try:
                        setattr(creation, pending[future], future.result())
                        job = material_jobs.save_checkpoint(job)
                        creation = job.creation
                    except Exception as error:
                        failures.append(error)
            if failures:
                raise failures[0]
            creation.progress = "creating"
        elif creation.progress == "creating":
            creation.agent_version = create_foundry_agent(job)
            creation.progress = "saving"
        elif creation.progress == "saving":
            persist_created_course(job)
            job.agent_name = creation.request.name
            creation.status, creation.progress = "COMPLETED", "created"
        creation.error = None
        job.next_attempt_at = datetime.now(timezone.utc)
        job.failures = 0
        if creation.status == "COMPLETED" and job.progress == "ready":
            job.status = "COMPLETED"
    except Exception as error:
        logger.warning("Course creation job %s failed at %s (%s)", job.id, creation.progress, type(error).__name__)
        status_code = getattr(error, "status_code", None)
        permanent = isinstance(error, ValueError) or (status_code is not None and status_code < 500 and status_code not in {408, 409, 429})
        creation.error = (
            "The TA specification generator returned an invalid or incomplete response. Retry creation to resume its saved progress."
            if isinstance(error, CourseSpecificationError)
            else "TA creation could not complete. Retry to resume its saved progress."
        )
        job.failures += 1
        creation.status = "FAILED" if permanent or job.failures >= 4 else "PENDING"
        job.next_attempt_at = datetime.now(timezone.utc) + timedelta(seconds=min(60, 5 * 2 ** min(creation.attempts, 4)))
    return material_jobs.save_checkpoint(job)


def retry_creation(job: MaterialJob) -> MaterialJob:
    if job.creation is None:
        raise ValueError("Creation has not been requested")
    if creation_status(job).status != "FAILED":
        return job
    if job.lease_until and job.lease_until > datetime.now(timezone.utc):
        raise ValueError("Draft is processing")
    job.creation.status = "PENDING"
    job.creation.attempts = 0
    job.creation.error = None
    job.failures = 0
    job.status = "PENDING"
    if job.progress == "uploading":
        job.progress = "preparing" if job.files else "ready"
    job.next_attempt_at = datetime.now(timezone.utc)
    return material_jobs.save_job(job)


def enqueue_curriculum(job: MaterialJob) -> None:
    if not job.creation.request.textbooks:
        return
    existing = load_curriculum_research(job.creation.request.name, job.session_uuid)
    if existing:
        if existing.owner_id != job.owner_id:
            raise ValueError("Curriculum ownership changed")
        return
    research = CurriculumResearchJob(
        id=f"curriculum-{uuid5(NAMESPACE_URL, f'course-curriculum:{job.creation.request.name}')}",
        source_job_id=job.id, owner_id=job.owner_id,
        agent_name=job.creation.request.name, next_attempt_at=datetime.now(timezone.utc),
    )
    try:
        material_jobs.job_container().create_item(body=research.model_dump(mode="json"))
    except CosmosResourceExistsError:
        existing = CurriculumResearchJob.model_validate(material_jobs.job_container().read_item(item=research.id, partition_key=research.id))
        if existing.owner_id != job.owner_id or existing.agent_name != research.agent_name:
            raise ValueError("Curriculum ownership changed") from None


def load_curriculum_research(agent_name: str, session_uuid: str) -> CurriculumResearchJob | None:
    identities = [f"curriculum-{uuid5(NAMESPACE_URL, f'course-curriculum:{agent_name}')}", f"curriculum-{session_uuid}"]
    matched = []
    for identity in dict.fromkeys(identities):
        try:
            research = CurriculumResearchJob.model_validate(material_jobs.job_container().read_item(item=identity, partition_key=identity))
        except CosmosResourceNotFoundError:
            continue
        if research.agent_name == agent_name:
            if research.status in {"PENDING", "RUNNING"} or (research.lease_until and research.lease_until > datetime.now(timezone.utc)):
                return research
            matched.append(research)
    return matched[0] if matched else None


def load_curriculum_snapshot(agent_name: str) -> dict | None:
    from azure_services.persistence.cosmos_db import _COURSE_CURRICULUM_CONTAINER, _get_blob_service_client

    blob = _get_blob_service_client().get_blob_client(_COURSE_CURRICULUM_CONTAINER, f"{agent_name}/course_curriculum.json")
    try:
        curriculum = json.loads(blob.download_blob().readall())
    except ResourceNotFoundError:
        from backend.main import _agent_setup_dir

        saved = _agent_setup_dir(agent_name) / "course_curriculum.json"
        if not saved.is_file():
            return None
        curriculum = json.loads(saved.read_text(encoding="utf-8"))
    if not isinstance(curriculum, dict):
        raise ValueError("Invalid curriculum data")
    return curriculum


def curriculum_status(
    agent_name: str, curriculum: dict | None, research: CurriculumResearchJob | None,
    *, can_edit: bool = False, status_only: bool = False, legacy_running: bool = False,
) -> CurriculumStatus:
    complete = bool(
        curriculum and curriculum.get("syllabus") and curriculum.get("all_threshold_concepts")
        and not curriculum.get("_status") and not curriculum.get("_error")
    )
    leased = research and research.lease_until and research.lease_until > datetime.now(timezone.utc)
    if (research and research.status in {"PENDING", "RUNNING"}) or leased or legacy_running:
        state, message = "processing", "Curriculum generation is in progress."
    elif complete:
        state, message = "ready", "Course curriculum is available."
    elif research or curriculum:
        state, message = "failed", "Curriculum generation did not complete. Retry generation."
    else:
        state, message = "not_available", "No course curriculum has been generated yet."
    return CurriculumStatus(
        agent_name=agent_name, status=state, message=message,
        can_retry=can_edit and state in {"not_available", "failed"},
        course_curriculum=None if status_only or curriculum is None else {key: value for key, value in curriculum.items() if key != "_error"},
    )


def curriculum_inputs(course: dict, setup: dict) -> CurriculumResearchInput:
    textbooks = []
    for book in setup.get("textbooks") or []:
        if not isinstance(book, dict):
            raise ValueError("Invalid saved textbook")
        textbooks.append(CreationTextbook.model_validate({
            key: value for key, value in book.items() if key in CreationTextbook.model_fields
        }))
    return CurriculumResearchInput(
        course_name=setup.get("courseName") or course.get("courseName") or course["name"],
        course_level=setup.get("courseLevel") or course.get("courseLevel") or "",
        additional_context=setup.get("additionalContext") or course.get("additionalContext") or "",
        textbooks=textbooks,
    )


def retry_curriculum(
    course: dict, session_uuid: str, requester_id: str, *, mode: Literal["full", "threshold"] = "full",
) -> CurriculumStatus:
    agent_name = course["id"]
    research = load_curriculum_research(agent_name, session_uuid)
    curriculum = load_curriculum_snapshot(agent_name)
    current = curriculum_status(agent_name, curriculum, research, can_edit=True, status_only=True)
    if not current.can_retry:
        return current
    if mode == "threshold":
        from backend.main import _agent_setup_dir

        if not (_agent_setup_dir(agent_name) / "syllabus_research_raw.txt").is_file():
            raise ValueError("The saved syllabus is missing. Retry full curriculum generation instead.")
    setup = material_jobs.course_materials.load_setup(agent_name)
    inputs = curriculum_inputs(course, setup)
    if not inputs.textbooks and not inputs.additional_context.strip():
        raise ValueError("Add a course description or textbook in Edit TA before generating the curriculum.")
    now = datetime.now(timezone.utc)
    if research is None:
        research = CurriculumResearchJob(
            id=f"curriculum-{uuid5(NAMESPACE_URL, f'course-curriculum:{agent_name}')}",
            agent_name=agent_name, owner_id=course.get("createdById") or requester_id,
            inputs=inputs, next_attempt_at=now, mode=mode,
        )
        try:
            material_jobs.job_container().create_item(body=research.model_dump(mode="json"))
        except CosmosResourceExistsError:
            research = load_curriculum_research(agent_name, session_uuid)
            if research is None:
                raise RuntimeError("Curriculum job could not be confirmed") from None
    else:
        research.inputs = inputs
        research.mode = mode
        research.status, research.attempts, research.error = "PENDING", 0, None
        research.next_attempt_at = now
        research.lease_owner, research.lease_until, research.output_ref = None, None, None
        try:
            material_jobs.job_container().replace_item(
                item=research.id, body=research.model_dump(mode="json"),
                etag=research.revision, match_condition=material_jobs.MatchConditions.IfNotModified,
            )
        except HttpResponseError as error:
            if error.status_code != 412:
                raise
            research = load_curriculum_research(agent_name, session_uuid)
            if research is None:
                raise RuntimeError("Curriculum job could not be confirmed") from None
    return curriculum_status(agent_name, curriculum, research, can_edit=True, status_only=True)


def curriculum_is_complete(agent_name: str) -> bool:
    curriculum = load_curriculum_snapshot(agent_name)
    return bool(
        isinstance(curriculum, dict) and curriculum.get("syllabus")
        and isinstance(curriculum.get("all_threshold_concepts"), list) and curriculum["all_threshold_concepts"]
        and not curriculum.get("_status") and not curriculum.get("_error")
    )


def run_curriculum_research(research: CurriculumResearchJob) -> None:
    if curriculum_is_complete(research.agent_name):
        return
    inputs = research.inputs
    if inputs is None:
        source = material_jobs.load_job(research.source_job_id) if research.source_job_id else None
        if source is None or source.owner_id != research.owner_id or source.creation is None or source.creation.status != "COMPLETED" or source.creation.request.name != research.agent_name:
            raise RuntimeError("Course creation is not complete")
        request = source.creation.request
        inputs = CurriculumResearchInput(
            course_name=request.courseName, course_level=request.courseLevel or "",
            additional_context=request.additionalContext or "", textbooks=request.textbooks,
        )
    if research.mode == "threshold":
        from backend.main import _background_threshold_concept_research

        _background_threshold_concept_research(
            agent_id=research.agent_name, course_name=inputs.course_name, course_level=inputs.course_level,
        )
    else:
        from backend.main import _background_textbook_research

        _background_textbook_research(
            agent_id=research.agent_name, agent_name=research.agent_name,
            course_name=inputs.course_name, course_level=inputs.course_level,
            textbooks=[book.model_dump() for book in inputs.textbooks], additional_context=inputs.additional_context,
        )
    if not curriculum_is_complete(research.agent_name):
        raise RuntimeError("Curriculum generation did not persist a complete result")


def claim_curriculum() -> CurriculumResearchJob | None:
    now = datetime.now(timezone.utc)
    items = list(material_jobs.job_container().query_items(
        query="SELECT TOP 1 * FROM c WHERE c.job_type = @kind AND c.status IN ('PENDING', 'RUNNING') AND c.next_attempt_at <= @now AND (IS_NULL(c.lease_until) OR c.lease_until <= @now)",
        parameters=[{"name": "@kind", "value": "course_curriculum"}, {"name": "@now", "value": now.isoformat()}],
        enable_cross_partition_query=True, max_item_count=1,
    ))
    if not items:
        return None
    research = CurriculumResearchJob.model_validate(items[0])
    research.status = "RUNNING"
    research.attempts += 1
    research.lease_owner = uuid4().hex
    research.lease_until = now + timedelta(minutes=5)
    saved = material_jobs.job_container().replace_item(
        item=research.id, body=research.model_dump(mode="json"),
        etag=research.revision, match_condition=material_jobs.MatchConditions.IfNotModified,
    )
    return CurriculumResearchJob.model_validate(saved)


def finish_curriculum(research: CurriculumResearchJob, failed: bool) -> None:
    current = CurriculumResearchJob.model_validate(material_jobs.job_container().read_item(item=research.id, partition_key=research.id))
    if current.lease_owner != research.lease_owner:
        raise ValueError("Curriculum lease changed")
    research.status = ("FAILED" if research.attempts >= 2 else "PENDING") if failed else "COMPLETED"
    research.error = "Curriculum generation did not complete. Retry from the TA menu." if failed else None
    research.output_ref = None if failed else research.agent_name
    research.lease_owner, research.lease_until = None, None
    research.next_attempt_at = datetime.now(timezone.utc) + timedelta(minutes=1)
    material_jobs.job_container().replace_item(
        item=research.id, body=research.model_dump(mode="json"),
        etag=current.revision, match_condition=material_jobs.MatchConditions.IfNotModified,
    )


async def run_curriculum_worker(stop: asyncio.Event) -> None:
    while not stop.is_set():
        try:
            research = await asyncio.to_thread(claim_curriculum)
            if research:
                failed = False
                work = asyncio.create_task(asyncio.to_thread(run_curriculum_research, research))
                try:
                    while not work.done():
                        done, _pending = await asyncio.wait({work}, timeout=30)
                        if not done:
                            try:
                                await asyncio.to_thread(material_jobs.renew_lease, research)
                            except Exception:
                                await work
                                raise
                    await work
                except Exception as error:
                    logger.warning("Curriculum job %s failed (%s)", research.id, type(error).__name__)
                    failed = True
                await asyncio.to_thread(finish_curriculum, research, failed)
        except Exception as error:
            logger.warning("Curriculum worker unavailable (%s)", type(error).__name__)
        try:
            await asyncio.wait_for(stop.wait(), timeout=10)
        except asyncio.TimeoutError:
            continue