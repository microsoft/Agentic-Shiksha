from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from admin_backend.core.contracts import ChatStream, DashboardRepository
from admin_backend.services.agents import AgentService
from admin_backend.services.attachments import AttachmentService
from admin_backend.services.directory import DirectoryService
from admin_backend.services.evaluation import EvaluationService
from admin_backend.services.research import ResearchService


@dataclass(frozen=True)
class AdminServices:
    queries: DashboardRepository
    agents: AgentService
    directory: DirectoryService
    evaluation: EvaluationService
    research: ResearchService
    attachments: AttachmentService
    chat_stream: ChatStream
    token_stats: Callable[[], dict[str, Any]]
