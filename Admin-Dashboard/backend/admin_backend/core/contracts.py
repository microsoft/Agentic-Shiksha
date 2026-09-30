from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Protocol


ChatStream = Callable[[str, Optional[str]], Iterator[tuple[str, str, Optional[str]]]]


@dataclass(frozen=True)
class Attachment:
    content: bytes
    content_type: str


class DashboardRepository(Protocol):
    def get_agent_session_uuid(self, agent_id: str) -> Optional[str]:
        ...

    def get_thread(self, thread_id: str, user_id: str) -> Optional[Dict[str, Any]]:
        ...

    def get_recent_assistant_messages(self, limit: int=100, since_hours: int=24) -> List[Dict[str, Any]]:
        ...

    def get_evaluated_message_group_ids(self) -> set:
        ...

    def list_agents(self) -> List[Dict[str, Any]]:
        ...

    def get_image_quota_config(self) -> Dict[str, int]:
        ...

    def set_image_quota_config(self, limits: Dict[str, int]) -> Dict[str, int]:
        ...

    def agent_overview(self, agent_id: str) -> Dict[str, Any]:
        ...

    def agent_usage_stats(self, agent_id: str) -> Dict[str, Any]:
        ...

    def courses_overview(self) -> tuple[List[Dict[str, Any]], int]:
        ...

    def today_stats(self, start_date: Optional[str]=None, end_date: Optional[str]=None) -> Dict[str, Any]:
        ...

    def per_student_token_usage(self, agent_id: Optional[str]=None) -> List[Dict[str, Any]]:
        ...

    def student_detail(self, user_id: str, agent_id: str) -> Optional[Dict[str, Any]]:
        ...

    def get_groundedness_evaluation(self, message_group_id: str, session_id: str) -> Optional[Dict[str, Any]]:
        ...

    def get_groundedness_evaluations_for_session(self, session_id: str) -> List[Dict[str, Any]]:
        ...

    def get_all_groundedness_evaluations(self, limit: int=200) -> List[Dict[str, Any]]:
        ...

    def get_groundedness_evaluations_for_thread(self, thread_id: str, session_id: str) -> List[Dict[str, Any]]:
        ...

    def get_agent_metadata(self, agent_id: str) -> Optional[Dict[str, Any]]:
        ...

    def transfer_agent_ownership(self, agent_id: str, new_owner_id: str) -> Optional[Dict[str, Any]]:
        ...

    def set_agent_teachers(self, agent_id: str, teacher_ids: List[str]) -> Optional[Dict[str, Any]]:
        ...

    def get_user_profile(self, user_id: str) -> Optional[Dict[str, Any]]:
        ...

    def get_invite_by_id(self, invite_id: str) -> Optional[Dict[str, Any]]:
        ...

    def save_directory_record(self, document: Dict[str, Any], *, invited: bool) -> None:
        ...

    def invite_user(self, email: str, name: str='', role: str='student', institute: str='', department: str='') -> tuple:
        ...

    def list_directory_users(self, role: Optional[str]=None, status: Optional[str]=None) -> List[Dict[str, Any]]:
        ...

    def remove_directory_user(self, user_id: str) -> bool:
        ...

    def upsert_user_profile(self, user_id: str, **kwargs) -> Dict[str, Any]:
        ...

    def rename_institute(self, old_name: str, new_name: str) -> int:
        ...

    def delete_institute(self, name: str) -> int:
        ...

    def rename_department(self, institute: str, old_name: str, new_name: str) -> int:
        ...

    def delete_department_users(self, institute: str, department: str) -> int:
        ...

    def get_department_onboarding_progress(self, institute: str, department: str) -> Dict[str, Any]:
        ...

    def switch_active_affiliation(self, user_id: str, index: int) -> Optional[Dict[str, Any]]:
        ...

    def list_feedback(self, limit: int=200) -> List[Dict[str, Any]]:
        ...

    def get_feedback_stats(self) -> Dict[str, Any]:
        ...


class ResearchStorage(Protocol):
    def save_institute_research(self, institute_name: str, data: Dict[str, Any]) -> bool:
        ...

    def get_institute_research(self, institute_name: str) -> Optional[Dict[str, Any]]:
        ...

    def save_department_research(self, institute_name: str, department_name: str, data: Dict[str, Any]) -> bool:
        ...

    def get_department_research(self, institute_name: str, department_name: str) -> Optional[Dict[str, Any]]:
        ...


class EvaluationBackend(Protocol):
    def _retrieve_context_from_search(self, query: str, session_uuid: str, top_k: int=10) -> str:
        ...

    def evaluate_rag_metrics(self, query: str, response: str, context: str) -> Dict[str, Any]:
        ...

    def evaluate_groundedness(self, query: str, response: str, session_uuid: Optional[str]=None, context: Optional[str]=None, method: str='auto') -> Dict[str, Any]:
        ...

    def evaluate_and_store_groundedness(self, message_group_id: str, session_id: Optional[str], thread_id: str, user_id: str, method: str='auto') -> Optional[Dict[str, Any]]:
        ...
