import logging

from fastapi import APIRouter, HTTPException

from backend.routers.course_materials import CurrentUser, require_course, require_material_job, require_teacher
from backend.schemas.course_creation import (
    CourseCreationRequest, CourseCreationStatus, CurriculumRetryRequest, CurriculumStatus,
    CurriculumUpdateRequest, CurriculumUpdateResponse,
)
from utils import course_creation


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/agents", tags=["Course creation"])


@router.put("/{agent_name}/course-curriculum", response_model=CurriculumUpdateResponse)
def update_course_curriculum(agent_name: str, body: CurriculumUpdateRequest, user: CurrentUser):
    from backend.dependencies.agent_access import load_agent, check_agent_access
    from learner_memory.integration import graph_mode_for_course

    require_teacher(user)
    check_agent_access(load_agent(agent_name), user)
    if body.user_id and body.user_id != user.id:
        raise HTTPException(status_code=403, detail="Curriculum editor must match the signed-in account")
    if graph_mode_for_course(agent_name) == "authoritative":
        raise HTTPException(status_code=409, detail="Edit the versioned graph draft and publish it; legacy curriculum cannot change authoritative memory")
    if not body.course_curriculum:
        raise HTTPException(status_code=400, detail="A course curriculum is required")
    try:
        from azure_services.persistence.cosmos_db import (
            invalidate_course_curriculum_cache, save_course_curriculum, save_course_curriculum_version,
        )

        content = {key: value for key, value in body.course_curriculum.items() if key not in {"_status", "_error"}}
        if not save_course_curriculum(agent_name, content):
            raise RuntimeError("Curriculum could not be saved")
        version = (
            save_course_curriculum_version(agent_name, content, body.commit_message, user.id)
            if body.commit_message else None
        )
        invalidate_course_curriculum_cache(agent_name)
        return CurriculumUpdateResponse(version_id=version)
    except Exception:
        logger.warning("Curriculum update failed", exc_info=True)
        raise HTTPException(status_code=503, detail="Curriculum changes could not be saved. Please retry.") from None


@router.get("/{agent_name}/course-curriculum", response_model=CurriculumStatus)
def get_course_curriculum(agent_name: str, user: CurrentUser, status_only: bool = False):
    try:
        course, session = require_course(agent_name, user)
        can_edit = user.role in {"admin", "superadmin"} or (
            user.role != "student" and (course.get("createdById") == user.id or user.id in course.get("teacherIds", []))
        )
        research = course_creation.load_curriculum_research(agent_name, session)
        curriculum = course_creation.load_curriculum_snapshot(agent_name)
        return course_creation.curriculum_status(agent_name, curriculum, research, can_edit=can_edit, status_only=status_only)
    except HTTPException:
        raise
    except Exception as error:
        logger.warning("Curriculum status failed (%s)", type(error).__name__)
        raise HTTPException(status_code=503, detail="Curriculum status could not be checked. Please retry.") from None


@router.post("/{agent_name}/course-curriculum/retry", response_model=CurriculumStatus, status_code=202)
def retry_course_curriculum(agent_name: str, body: CurriculumRetryRequest, user: CurrentUser):
    try:
        course, session = require_course(agent_name, user, edit=True)
        return course_creation.retry_curriculum(course, session, user.id)
    except HTTPException:
        raise
    except ValueError:
        raise HTTPException(status_code=422, detail="Saved course details are incomplete. Add a course description or textbook in Edit TA, then retry.") from None
    except Exception as error:
        logger.warning("Curriculum retry failed (%s)", type(error).__name__)
        raise HTTPException(status_code=503, detail="Curriculum generation could not be queued. Recheck its status before retrying.") from None


@router.post("/{agent_name}/retry-textbook-research", response_model=CurriculumStatus, status_code=202)
def retry_textbook_research(agent_name: str, user: CurrentUser):
    return retry_course_curriculum(agent_name, CurriculumRetryRequest(), user)


@router.post("/{agent_name}/retry-threshold-research", response_model=CurriculumStatus, status_code=202)
def retry_threshold_research(agent_name: str, user: CurrentUser):
    try:
        course, session = require_course(agent_name, user, edit=True)
        return course_creation.retry_curriculum(course, session, user.id, mode="threshold")
    except HTTPException:
        raise
    except ValueError:
        raise HTTPException(status_code=422, detail="Saved syllabus or course details are unavailable. Retry full curriculum generation from the TA menu.") from None
    except Exception as error:
        logger.warning("Threshold curriculum retry failed (%s)", type(error).__name__)
        raise HTTPException(status_code=503, detail="Curriculum generation could not be queued. Recheck its status before retrying.") from None


def creation_error(error: Exception) -> HTTPException:
    if isinstance(error, ValueError) or getattr(error, "status_code", None) == 412:
        return HTTPException(status_code=409, detail="Course name or draft changed. Check its creation status before retrying.")
    logger.warning("Course creation request failed (%s)", type(error).__name__)
    return HTTPException(status_code=503, detail="TA creation could not be queued. Please retry.")


@router.post("/create-async", response_model=CourseCreationStatus, status_code=202)
def create_agent(body: CourseCreationRequest, user: CurrentUser):
    require_teacher(user)
    if body.createdById and body.createdById != user.id:
        raise HTTPException(status_code=403, detail="Creator must match the signed-in account")
    try:
        job = require_material_job(f"materials-{body.sessionUuid}", user)
        if job.owner_id != user.id:
            raise HTTPException(status_code=403, detail="Draft owner access required")
        return course_creation.creation_status(course_creation.start_creation(job, body))
    except HTTPException:
        raise
    except Exception as error:
        raise creation_error(error) from None


@router.get("/creation-jobs/{job_id}", response_model=CourseCreationStatus)
def creation_status(job_id: str, user: CurrentUser):
    try:
        return course_creation.creation_status(require_material_job(job_id, user))
    except HTTPException:
        raise
    except Exception as error:
        raise creation_error(error) from None


@router.post("/creation-jobs/{job_id}/retry", response_model=CourseCreationStatus, status_code=202)
def retry_creation(job_id: str, user: CurrentUser):
    try:
        job = require_material_job(job_id, user)
        return course_creation.creation_status(course_creation.retry_creation(job))
    except HTTPException:
        raise
    except Exception as error:
        raise creation_error(error) from None