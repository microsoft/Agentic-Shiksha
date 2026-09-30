import asyncio
import logging
from contextlib import asynccontextmanager
from functools import partial

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from admin_backend.core.contracts import EvaluationBackend
from admin_backend.core.errors import InvalidOperation, ResourceNotFound
from admin_backend.core.settings import (
    get_cors_settings,
    get_runtime_settings,
    get_storage_settings,
    validate_startup_settings,
)
from admin_backend.routers import (
    agents, chat, directory, evaluation, feedback, health, overview, progress, quota, research,
)
from admin_backend.services.agents import AgentService
from admin_backend.services.attachments import AttachmentService
from admin_backend.services.container import AdminServices
from admin_backend.services.directory import DirectoryService
from admin_backend.services.evaluation import EvaluationService
from admin_backend.services.research import ResearchService

logger = logging.getLogger(__name__)


def _evaluation_backend() -> EvaluationBackend:
    from admin_backend.integrations import groundedness_evaluator

    return groundedness_evaluator


def _chat_stream(text: str, conversation_id: str | None):
    from admin_backend.integrations.logging_agent_chat import chat_stream

    return chat_stream(text, conversation_id)


def _token_stats():
    from admin_backend.integrations.token_stats import get_token_stats

    return get_token_stats()


def build_services() -> AdminServices:
    from admin_backend.integrations import cosmos_queries, research_storage
    from admin_backend.integrations.attachments import download_attachment
    from admin_backend.integrations.research_agent import research_response

    account_name = get_storage_settings().storage_account_name
    return AdminServices(
        queries=cosmos_queries,
        agents=AgentService(cosmos_queries),
        directory=DirectoryService(cosmos_queries),
        evaluation=EvaluationService(cosmos_queries, _evaluation_backend),
        research=ResearchService(research_storage, research_response),
        attachments=AttachmentService(account_name, partial(download_attachment, account_name)),
        chat_stream=_chat_stream,
        token_stats=_token_stats,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    validate_startup_settings()
    runtime = get_runtime_settings()
    services: AdminServices = app.state.services
    task = None
    if runtime.eval_enabled:
        task = asyncio.create_task(services.evaluation.run_periodic(runtime))
        logger.info("[Lifespan] Periodic groundedness evaluator started")
    else:
        logger.info("[Lifespan] Periodic groundedness evaluator DISABLED (set EVAL_ENABLED=true to enable)")
    try:
        yield
    finally:
        if task is not None:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            logger.info("[Lifespan] Periodic groundedness evaluator stopped")


async def _invalid_operation(_request: Request, error: Exception) -> JSONResponse:
    return JSONResponse(status_code=400, content={"detail": str(error)})


async def _not_found(_request: Request, error: Exception) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": str(error)})


def create_app(services: AdminServices | None = None) -> FastAPI:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    logging.getLogger("azure").setLevel(logging.WARNING)
    app = FastAPI(
        title="Ekalaiva Dashboard",
        description="Instructor / Admin analytics server for student learning progress",
        version="0.1.0",
        docs_url="/api/dashboard/docs",
        openapi_url="/api/dashboard/openapi.json",
        lifespan=lifespan,
    )
    app.state.services = services if services is not None else build_services()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=get_cors_settings().allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_exception_handler(InvalidOperation, _invalid_operation)
    app.add_exception_handler(ResourceNotFound, _not_found)
    # The two agents routers preserve the original position of feedback routes.
    for router in (
        health.router, quota.router, agents.listing_router, feedback.router, agents.router,
        overview.router, progress.router, evaluation.router, chat.router, directory.router,
        research.router,
    ):
        app.include_router(router)
    return app
