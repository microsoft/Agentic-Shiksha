import os

import pytest


# Collection imports the query layer before fixtures run. Never read local
# deployment files or inherit deployment identifiers for these offline tests.
OFFLINE_ENV = {
    "PYTHON_DOTENV_DISABLED": "1",
    "COSMOS_ENDPOINT": "https://example.documents.azure.com:443/",
    "COSMOS_DATABASE": "test-database",
    "PROJECT_ENDPOINT": "https://research.example.invalid/api/projects/test",
    "AZURE_AI_PROJECT_ENDPOINT": "https://chat.example.invalid/api/projects/test",
    "STORAGE_ACCOUNT_NAME": "teststorage",
    "INSTITUTE_RESEARCH_AGENT_NAME": "test-research-agent",
    "LOGGING_AGENT_NAME": "test-logging-agent",
    "ALLOWED_ORIGINS": "http://localhost:5174",
    "EVAL_ENABLED": "false",
    "EVAL_INTERVAL_SECONDS": "5",
    "EVAL_LOOKBACK_HOURS": "24",
    "EVAL_BATCH_LIMIT": "50",
    "AZURE_CLI_TIMEOUT": "60",
    "DASHBOARD_PORT": "8050",
}

for name, value in OFFLINE_ENV.items():
    os.environ[name] = value


@pytest.fixture(autouse=True)
def isolated_configuration(monkeypatch):
    from admin_backend.core.settings import clear_settings_cache

    for name, value in OFFLINE_ENV.items():
        monkeypatch.setenv(name, value)
    clear_settings_cache()
    yield
    clear_settings_cache()


@pytest.fixture
def admin_services():
    from unittest.mock import Mock

    from admin_backend.core.contracts import Attachment, DashboardRepository, EvaluationBackend, ResearchStorage
    from admin_backend.services.agents import AgentService
    from admin_backend.services.attachments import AttachmentService
    from admin_backend.services.container import AdminServices
    from admin_backend.services.directory import DirectoryService
    from admin_backend.services.evaluation import EvaluationService
    from admin_backend.services.research import ResearchService

    queries = Mock(spec=DashboardRepository)
    queries.list_agents.return_value = []
    queries.get_user_profile.return_value = None
    queries.get_invite_by_id.return_value = None
    queries.get_agent_metadata.return_value = None
    queries.list_directory_users.return_value = []
    storage = Mock(spec=ResearchStorage)
    storage.get_institute_research.return_value = None
    storage.get_department_research.return_value = None
    storage.save_institute_research.return_value = True
    storage.save_department_research.return_value = True
    evaluator = Mock(spec=EvaluationBackend)
    evaluator.evaluate_groundedness.return_value = {"groundedness_score": 4}
    evaluator.evaluate_rag_metrics.return_value = {"overall_score": 3}
    evaluator.evaluate_and_store_groundedness.return_value = {"id": "evaluation-test"}
    return AdminServices(
        queries=queries,
        agents=AgentService(queries),
        directory=DirectoryService(queries),
        evaluation=EvaluationService(queries, lambda: evaluator),
        research=ResearchService(storage, Mock(return_value='{"profile":{"name":"Example"}}')),
        attachments=AttachmentService(
            "teststorage", Mock(return_value=Attachment(b"offline-image", "image/png")),
        ),
        chat_stream=Mock(side_effect=lambda *_: iter([("done", "", "conversation-test")])),
        token_stats=Mock(return_value={}),
    )
