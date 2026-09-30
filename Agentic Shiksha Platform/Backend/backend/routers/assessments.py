"""Assessment compatibility routes backed by frozen, server-graded instances."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from backend.dependencies import agent_access
from backend.dependencies.auth import ActiveUser, get_current_active_user
from backend.dependencies.learner_access import course_memory_mode, memory_enabled, resolve_learner_access
from backend.schemas.learner_memory import ProcessingReceipt
from learner_memory.integration import memory_api_errors

router = APIRouter(prefix="/api", tags=["Assessments"])
CurrentUser = Annotated[ActiveUser, Depends(get_current_active_user)]


class StrictAssessmentModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class QuizQuestion(StrictAssessmentModel):
    question: str = ""
    options: list[str] = Field(default_factory=list)
    correct: list[int] | int | None = None
    explanation: str | None = None
    targetsMisconception: str | None = None
    problemId: str | None = None
    optionKeys: list[str] | None = None
    multiple: bool | None = None


class QuizAttemptAnswerRequest(QuizQuestion):
    selected: list[int]
    reason: str = Field(min_length=1, max_length=60000)


class QuizAssetRequest(StrictAssessmentModel):
    userId: str | None = None
    quizId: str = Field(min_length=1, max_length=256)
    title: str
    agentId: str = Field(min_length=1, max_length=256)
    threadId: str | None = None
    assessmentType: str = "practice_quiz"
    thresholdConcept: str | None = None
    questions: list[QuizQuestion] = Field(min_length=1, max_length=50)
    tags: list[str] | None = None
    assessmentInstanceId: str | None = None
    curriculumVersion: str | None = None
    serverGraded: bool | None = None


class FirstQuizAttemptRequest(StrictAssessmentModel):
    userId: str | None = None
    quizId: str = Field(min_length=1, max_length=256)
    title: str
    agentId: str = Field(min_length=1, max_length=256)
    threadId: str | None = None
    assessmentType: str = "practice_quiz"
    thresholdConcept: str | None = None
    answers: list[QuizAttemptAnswerRequest] = Field(min_length=1, max_length=50)
    assessmentInstanceId: str | None = None
    curriculumVersion: str | None = None
    event_id: str | None = Field(default=None, min_length=1, max_length=256)


class QuizAgentFeedbackRequest(StrictAssessmentModel):
    userId: str | None = None
    agentId: str
    feedback: str = Field(min_length=1, max_length=60000)
    assessmentInstanceId: str | None = None


class QuizAssetResponse(StrictAssessmentModel):
    assetId: str
    createdAt: str | None = None


class QuizStatusResponse(StrictAssessmentModel):
    exists: bool
    assetId: str | None = None
    submittedAt: str | None = None
    score: int | None = None
    totalQuestions: int | None = None
    answers: list["GradedAnswer"] | None = None
    receipt: ProcessingReceipt | None = None


class GradedAnswer(StrictAssessmentModel):
    problemId: str
    question: str
    options: list[str]
    selected: list[int]
    selectedKeys: list[str]
    correct: list[int]
    reason: str
    isCorrect: bool
    explanation: str


class QuizSubmissionResponse(StrictAssessmentModel):
    created: bool
    assetId: str
    submittedAt: str | None = None
    score: int
    totalQuestions: int
    answers: list[GradedAnswer] | None = None
    receipt: ProcessingReceipt | None = None
    assessmentInstanceId: str | None = None
    curriculumVersion: str | None = None


class QuizFeedbackResponse(StrictAssessmentModel):
    assetId: str
    updatedAt: str | None = None


def _service():
    from learner_memory.service import get_service

    return get_service()


def _access(agent_id: str, user_id: str | None, request: Request, user: ActiveUser):
    if user_id and user_id != user.id:
        raise HTTPException(status_code=403, detail="Quiz account must match the signed-in account")
    agent = agent_access.load_agent(agent_id)
    agent_access.check_agent_access(agent, user)
    request.state.agent_user = user
    if not memory_enabled() or course_memory_mode(agent) == "off":
        return None
    return resolve_learner_access(agent_id, user.id, user, agent=agent)


def _instance_id(quiz_id: str, instance_id: str | None) -> str:
    if not instance_id or instance_id != quiz_id:
        raise HTTPException(status_code=422, detail="Use the server-issued assessmentInstanceId as quizId")
    return instance_id


@router.post("/quiz-assets", response_model=QuizAssetResponse)
async def upsert_quiz_asset_endpoint(body: QuizAssetRequest, request: Request, user: CurrentUser):
    with memory_api_errors():
        access = _access(body.agentId, body.userId, request, user)
        if access is None:
            from backend import main

            legacy = main.QuizAssetRequest.model_validate(body.model_dump(exclude_none=True))
            return await main.upsert_quiz_asset_endpoint(legacy, request)
        instance_id = _instance_id(body.quizId, body.assessmentInstanceId)
        if body.curriculumVersion != access.scope.curriculum_version:
            raise HTTPException(status_code=409, detail="The assessment curriculum version changed")
        public = _service().public_assessment(access.scope, instance_id)
        from azure_services.persistence.cosmos_db import upsert_quiz_asset

        asset = upsert_quiz_asset(
            user_id=user.id, agent_id=body.agentId, quiz_id=instance_id,
            title=public["title"], questions=public["questions"], thread_id=body.threadId,
            tags=body.tags, assessment_type=public["assessmentType"],
            assessment_instance_id=instance_id, curriculum_version=access.scope.curriculum_version,
        )
        return QuizAssetResponse(assetId=asset["id"], createdAt=asset.get("createdAt"))


@router.get("/quiz-attempts/{quiz_id}/first", response_model=QuizStatusResponse, response_model_exclude_none=True)
async def get_first_quiz_attempt_status(
    quiz_id: str, request: Request, user: CurrentUser,
    agentId: str = Query(...), userId: str | None = None,
):
    with memory_api_errors():
        access = _access(agentId, userId, request, user)
        if access is None:
            from backend import main

            return await main.get_first_quiz_attempt_status(quiz_id, request, agentId, userId)
        return _service().assessment_status(access.scope, quiz_id)


@router.post("/quiz-attempts/first", response_model=QuizSubmissionResponse, response_model_exclude_none=True)
async def submit_first_quiz_attempt(body: FirstQuizAttemptRequest, request: Request, user: CurrentUser):
    with memory_api_errors():
        access = _access(body.agentId, body.userId, request, user)
        if access is None:
            from backend import main

            legacy = main.FirstQuizAttemptRequest.model_validate(body.model_dump(exclude_none=True))
            return await main.submit_first_quiz_attempt(legacy, request)
        instance_id = _instance_id(body.quizId, body.assessmentInstanceId)
        if body.curriculumVersion != access.scope.curriculum_version:
            raise HTTPException(status_code=409, detail="The assessment curriculum version changed")
        if not body.event_id:
            raise HTTPException(status_code=422, detail="A stable submission event_id is required")
        if body.event_id.startswith("operation_"):
            raise HTTPException(status_code=422, detail="This event namespace is reserved for server operations")
        # Correct answers, question text, scores and misconception mappings supplied
        # by a browser never enter the authoritative grading request.
        answers = [
            {"problemId": answer.problemId, "selected": answer.selected, "reason": answer.reason}
            for answer in body.answers
        ]
        graded = _service().submit_assessment(access.scope, instance_id, answers, body.event_id)
        public = _service().public_assessment(access.scope, instance_id)
        from azure_services.persistence.cosmos_db import create_first_quiz_attempt

        attempt = {
            **{key: value for key, value in graded.items() if key != "receipt"},
            "quizId": instance_id, "assessmentInstanceId": instance_id,
            "curriculumVersion": access.scope.curriculum_version, "serverGraded": True,
            "title": public["title"], "agentId": body.agentId, "threadId": body.threadId,
            "assessmentType": public["assessmentType"],
        }
        # This cache is repaired by retrying the same ledger submission if it fails;
        # it is deliberately not an authority for grading or learner state.
        asset, _created = create_first_quiz_attempt(
            user_id=user.id, agent_id=body.agentId, quiz_id=instance_id,
            title=public["title"], attempt=attempt, thread_id=body.threadId,
        )
        return {
            **graded, "assetId": asset["id"], "assessmentInstanceId": instance_id,
            "curriculumVersion": access.scope.curriculum_version,
        }


@router.post("/quiz-attempts/{quiz_id}/feedback", response_model=QuizFeedbackResponse)
async def append_quiz_feedback_endpoint(
    quiz_id: str, body: QuizAgentFeedbackRequest, request: Request, user: CurrentUser,
):
    with memory_api_errors():
        access = _access(body.agentId, body.userId, request, user)
        if access is not None and not _service().assessment_status(access.scope, quiz_id)["exists"]:
            raise HTTPException(status_code=409, detail="Submit the frozen assessment before saving feedback")
        from backend import main

        legacy = main.QuizAgentFeedbackRequest.model_validate(body.model_dump(exclude_none=True))
        return await main.append_quiz_feedback_endpoint(quiz_id, legacy, request)
