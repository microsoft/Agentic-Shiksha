# base_agent_manager.py
import os
import json
import asyncio
from abc import ABC
from pathlib import Path
from typing import Optional, Callable, Dict, Any, List, Set

from azure.identity.aio import AzureCliCredential

from azure_services.agents.agent_creation import agent_creator
from azure_services.agents.agent_chat import AgentChat
from azure_services.agents.agent_deletion import agent_remover
from azure_services.agents.agent_info import AgentInfoTool


class BaseAgentManager(ABC):
    """
    Base class for managing Azure AI Foundry agents with duplicate protection.

    Ops:
      - create_agent(agent_name, instructions, model_deployment, if_exists="error"|"return")
      - chat_by_name(...), chat_by_id(...)
      - delete_agent(...)

    Utilities (via AgentInfoTool):
      - list_agents_selected(include/exclude, limit, depth)
      - list_agents_all_attrs(depth, limit)
      - get_agent_info(name, include/exclude, depth)
      - agent_exists(name)
    """

    def __init__(
        self,
        *,
        project_endpoint: str,
        config_path: Optional[str],
        credential_factory: Optional[Callable[[], AzureCliCredential]] = None,
    ) -> None:
        if not project_endpoint:
            raise ValueError("project_endpoint is required.")
        if not config_path:
            raise ValueError("config_path must be a valid path string.")

        self.project_endpoint = project_endpoint
        self.config_path = config_path
        self._config_file = Path(config_path)

        self.credential_factory: Callable[[], AzureCliCredential] = (
            credential_factory or self.build_credential_factory()
        )

        # Chat helper
        self._chat = self.build_agent_chat(
            project_endpoint=self.project_endpoint,
            config_path=self.config_path,
            credential_factory=self.credential_factory,
        )

        # NEW: Agent info tool (for listing/lookup/exists)
        self._info = AgentInfoTool(
            project_endpoint,
            credential_factory=self.credential_factory,
        )

    # -------- extension points --------
    def build_credential_factory(self) -> Callable[[], AzureCliCredential]:
        return lambda: AzureCliCredential()

    def build_agent_chat(
        self,
        *,
        project_endpoint: str,
        config_path: str,
        credential_factory: Callable[[], AzureCliCredential],
    ) -> AgentChat:
        return AgentChat(
            project_endpoint=project_endpoint,
            config_path=config_path,
            credential_factory=credential_factory,
        )

    async def before_create(self, *, agent_name: str, instructions: str, model_deployment: str) -> None: ...
    async def after_create(self, *, agent_name: str, agent_id: str, model_deployment: str) -> None: ...
    async def before_chat(self, *, agent_ref: str, message: str, by: str) -> None: ...
    async def after_chat(self, *, agent_ref: str, message: str, reply: str, by: str) -> None: ...
    async def before_delete(self, *, agent_name: Optional[str], agent_id: Optional[str]) -> None: ...
    async def after_delete(self, *, agent_name: Optional[str], agent_id: Optional[str]) -> None: ...

    # -------- config helpers --------
    def _load_config(self) -> Dict[str, Any]:
        if not self._config_file.exists():
            return {}
        try:
            return json.loads(self._config_file.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}

    def _get_agent_id_local(self, agent_name: str) -> Optional[str]:
        cfg = self._load_config()
        entry = cfg.get(agent_name)
        if not isinstance(entry, dict):
            return None
        return entry.get("agent_id")

    # -------- remote lookup (by exact name) via AgentInfoTool --------
    async def _find_agent_remote_by_name(self, agent_name: str) -> Optional[Dict[str, Any]]:
        """
        Uses AgentInfoTool to find an agent by name.
        Returns a normalized dict (including 'id' and 'name') or None.
        """
        info = await self._info.find_by_name(
            agent_name,
            include=None,   # return all normalized keys it can find
            exclude=None,
            depth=1,
        )
        return info  # either dict or None

    # -------- base ops --------
    async def create_agent(
        self,
        *,
        agent_name: str,
        instructions: str,
        model_deployment: str,
        save_to_config: bool = True,
        include_web_search: bool = False,
        include_custom_search: bool = False,
        custom_search_instance_name: Optional[str] = None,
        course_urls: Optional[List[str]] = None,
        search_index_name: Optional[str] = None,
        search_index_filter: Optional[str] = None,
        search_connection_id: Optional[str] = None,
        memory_store_name: Optional[str] = None,
        memory_scope: str = "{{$userId}}",
        memory_update_delay: int = 300,
        if_exists: str = "error",  # "error" | "return"
    ) -> str:
        """
        Create an agent unless one already exists with the same name.
        Order:
          1) Check local config
          2) Check Azure AI via AgentInfoTool
        Behavior:
          - if_exists="error": raise if found
          - if_exists="return": return the existing id
        
        Args:
            include_web_search: If True, adds BingGroundingTool for general web search (default: False)
            include_custom_search: If True, adds BingCustomSearchTool for domain-specific search (default: False)
            custom_search_instance_name: The Bing Custom Search configuration instance name.
                                         Teachers create this in Azure Portal with allowed domains.
            course_urls: Teacher-curated URLs for focused web search.
            memory_store_name: Name of memory store to attach for persistent per-user memory.
            memory_scope: Scope for memory isolation (default: auto user-based).
            memory_update_delay: Seconds of inactivity before storing memories.
        """
        if if_exists not in ("error", "return"):
            raise ValueError("if_exists must be 'error' or 'return'.")

        # 1) Local check
        local_id = self._get_agent_id_local(agent_name)
        if local_id:
            if if_exists == "return":
                print(f"[exists/local] '{agent_name}' already in config with id={local_id}. Returning existing id.")
                return local_id
            raise ValueError(f"Agent '{agent_name}' already exists locally with id={local_id}. Aborting create.")

        # 2) Remote check (via tool)
        remote_info = await self._find_agent_remote_by_name(agent_name)
        if remote_info:
            remote_id = remote_info.get("id")
            remote_name = remote_info.get("name") or agent_name
            if if_exists == "return":
                print(f"[exists/remote] '{agent_name}' exists in Azure AI (name={remote_name}, id={remote_id}). Returning existing id.")
                return str(remote_id)
            raise ValueError(f"Agent '{agent_name}' already exists in Azure AI (name={remote_name}, id={remote_id}). Aborting create.")

        # 3) Create
        await self.before_create(agent_name=agent_name, instructions=instructions, model_deployment=model_deployment)
        agent_id = await agent_creator(
            project_endpoint=self.project_endpoint,
            model_deployment=model_deployment,
            agent_name=agent_name,
            instructions=instructions,
            config_path=self.config_path,
            save_to_config=save_to_config,
            include_web_search=include_web_search,
            include_custom_search=include_custom_search,
            custom_search_instance_name=custom_search_instance_name,
            course_urls=course_urls,
            search_index_name=search_index_name,
            search_index_filter=search_index_filter,
            search_connection_id=search_connection_id,
            memory_store_name=memory_store_name,
            memory_scope=memory_scope,
            memory_update_delay=memory_update_delay,
            credential_factory=self.credential_factory,
        )
        await self.after_create(agent_name=agent_name, agent_id=agent_id, model_deployment=model_deployment)
        return agent_id

    async def chat_by_name(self, *, agent_name: str, message: str) -> str:
        await self.before_chat(agent_ref=agent_name, message=message, by="name")
        reply = await self._chat.chat_by_name(agent_name=agent_name, message=message)
        await self.after_chat(agent_ref=agent_name, message=message, reply=reply, by="name")
        return reply

    async def chat_by_id(self, *, agent_id: str, message: str) -> str:
        await self.before_chat(agent_ref=agent_id, message=message, by="id")
        reply = await self._chat.chat_by_id(agent_id=agent_id, message=message)
        await self.after_chat(agent_ref=agent_id, message=message, reply=reply, by="id")
        return reply

    async def delete_agent(
        self,
        *,
        agent_name: Optional[str] = None,
        agent_id: Optional[str] = None,
        also_delete_config: bool = True,
        ignore_missing: bool = True,
    ) -> None:
        await self.before_delete(agent_name=agent_name, agent_id=agent_id)
        await agent_remover(
            project_endpoint=self.project_endpoint,
            agent_name=agent_name,
            agent_id=agent_id,
            config_path=self.config_path,
            also_delete_config=also_delete_config,
            ignore_missing=ignore_missing,
            credential_factory=self.credential_factory,
        )
        await self.after_delete(agent_name=agent_name, agent_id=agent_id)

    # -------- NEW: pass-through utilities backed by AgentInfoTool --------
    async def list_agents_all_attrs(self, *, depth: int = 2, limit: int = 100) -> List[Dict[str, Any]]:
        """Dump ‘everything we can’ (depth-limited) for each agent."""
        return await self._info.list_agents_all_attrs(depth=depth, limit=limit)

    async def list_agents_selected(
        self,
        *,
        include: Optional[Set[str]] = None,
        exclude: Optional[Set[str]] = None,
        depth: int = 2,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        """Return only selected fields (or everything minus excluded fields)."""
        return await self._info.list_agents_selected(include=include, exclude=exclude, depth=depth, limit=limit)

    async def get_agent_info(
        self,
        name: str,
        *,
        include: Optional[Set[str]] = None,
        exclude: Optional[Set[str]] = None,
        depth: int = 2,
        limit: int = 100,
    ) -> Optional[Dict[str, Any]]:
        """Fetch a single agent’s info by name."""
        return await self._info.find_by_name(name, include=include, exclude=exclude, depth=depth, limit=limit)

    async def agent_exists(self, name: str, *, case_insensitive: bool = True, limit: int = 100) -> bool:
        """Boolean existence check (remote)."""
        return await self._info.exists(name, case_insensitive=case_insensitive, limit=limit)


# ---- optional: quick manual test scaffold ----
if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()

    class DemoAgentManager(BaseAgentManager):
        async def after_create(self, *, agent_name: str, agent_id: str, model_deployment: str) -> None:
            print(f"[after_create] {agent_name} -> {agent_id} (model={model_deployment})")

    PROJECT_ENDPOINT = os.getenv("AZURE_AI_PROJECT_ENDPOINT")
    CONFIG_PATH = os.getenv("AZURE_AGENTS_CONFIG_PATH", "agents_config.json")
    if not PROJECT_ENDPOINT:
        raise SystemExit("Set AZURE_AI_PROJECT_ENDPOINT before running.")

    cred_factory = lambda: AzureCliCredential(process_timeout=60)

    mgr = DemoAgentManager(
        project_endpoint=PROJECT_ENDPOINT,
        config_path=CONFIG_PATH,
        credential_factory=cred_factory,
    )

    async def demo():
        # print a compact table of selected columns
        rows = await mgr.list_agents_selected(include={"id", "name", "model_deployment_name", "status"})
        print(rows[:3])

        # existence check
        print("ExamAgent exists:", await mgr.agent_exists("ExamAgent"))

        # fetch one agent’s full info (depth-limited)
        info = await mgr.get_agent_info("ExamAgent", depth=2)
        print("ExamAgent info keys:", list(info.keys()) if info else None)

        # Duplicate-safe create (returns existing if present)
        # agent_id = await mgr.create_agent(
        #     agent_name="ExamAgent",
        #     instructions="You help a lot of people",
        #     model_deployment="gpt-5-mini",
        #     if_exists="return",
        # )
        # print("id:", agent_id)

    asyncio.run(demo())
