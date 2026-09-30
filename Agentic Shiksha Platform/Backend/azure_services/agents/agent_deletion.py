import os
import json
import asyncio
from typing import Optional, Dict, Any, Callable
from tempfile import NamedTemporaryFile
from pathlib import Path

from azure.identity.aio import AzureCliCredential
from azure.core.exceptions import HttpResponseError
from azure.ai.agents.aio import AgentsClient


class AgentRemover:
    """
    Remove an Azure AI Foundry agent and (optionally)
    delete its entry {agent_name: {...}} from agents_config.json.

    Auth is pluggable via `credential_factory`, a zero-arg callable returning an async credential.
    """

    def __init__(
        self,
        project_endpoint: str,
        *,
        config_path: str,
        credential_factory: Optional[Callable[[], AzureCliCredential]] = None,
    ):
        if not project_endpoint:
            raise ValueError("project_endpoint is required.")
        self.project_endpoint = project_endpoint
        self.config_path = Path(config_path)
        self.credential_factory = credential_factory or (lambda: AzureCliCredential())

    # ---------- config helpers ----------
    def _load_config(self) -> Dict[str, Any]:
        if not self.config_path.exists():
            return {}
        try:
            with self.config_path.open("r", encoding="utf-8") as f:
                return json.load(f)
        except json.JSONDecodeError:
            # Corrupt/empty -> start fresh
            return {}

    def _atomic_write_json(self, data: Dict[str, Any]) -> None:
        self.config_path.parent.mkdir(parents=True, exist_ok=True)
        with NamedTemporaryFile("w", delete=False, dir=str(self.config_path.parent), encoding="utf-8") as tmp:
            json.dump(data, tmp, indent=2, ensure_ascii=False)
            tmp_path = tmp.name
        os.replace(tmp_path, self.config_path)

    def _remove_from_config_by_name(self, agent_name: str) -> bool:
        cfg = self._load_config()
        if agent_name in cfg:
            del cfg[agent_name]
            self._atomic_write_json(cfg)
            print(f"Removed '{agent_name}' from {self.config_path}.")
            return True
        return False

    def _get_agent_id_by_name(self, agent_name: str) -> Optional[str]:
        cfg = self._load_config()
        entry = cfg.get(agent_name)
        if not entry:
            return None
        return entry.get("agent_id")

    # ---------- main ops ----------
    async def remove_by_id(
        self,
        agent_id: str,
        *,
        remove_config_name: Optional[str] = None,
        ignore_missing: bool = True
    ) -> None:
        """
        Deletes the Foundry agent by id.
        Optionally removes a named entry from agents_config.json (if provided).
        """
        if not agent_id:
            raise ValueError("agent_id must be a non-empty string.")

        cred = self.credential_factory()
        agents_client = AgentsClient(endpoint=self.project_endpoint, credential=cred)
        
        try:
            await agents_client.delete_agent(agent_id)
            print(f"Deleted agent id: {agent_id}")
        except HttpResponseError as e:
            # If agent is already gone (404), optionally ignore
            if ignore_missing and getattr(e, "status_code", None) == 404:
                print(f"Agent id {agent_id} not found; treating as already deleted.")
            else:
                raise
        finally:
            await agents_client.close()
            await cred.close()

        if remove_config_name:
            self._remove_from_config_by_name(remove_config_name)

    async def remove_by_name(
        self,
        agent_name: str,
        *,
        also_delete_config: bool = True,
        ignore_missing: bool = True
    ) -> None:
        """
        Deletes the Foundry agent by looking up its id from agents_config.json by name.
        Also removes the JSON entry (default: True).
        """
        agent_id = self._get_agent_id_by_name(agent_name)
        if not agent_id:
            if also_delete_config:
                removed = self._remove_from_config_by_name(agent_name)
                if removed:
                    print(f"No agent id for '{agent_name}', but removed its config entry.")
            if ignore_missing:
                print(f"No agent id found for '{agent_name}'. Nothing to delete in Foundry.")
                return
            raise KeyError(f"Agent name '{agent_name}' not found in {self.config_path} or missing 'agent_id'.")

        await self.remove_by_id(
            agent_id,
            remove_config_name=agent_name if also_delete_config else None,
            ignore_missing=ignore_missing
        )


# ---------- convenience function ----------
async def agent_remover(
    *,
    project_endpoint: str,
    agent_name: Optional[str] = None,
    agent_id: Optional[str] = None,
    config_path: str,
    also_delete_config: bool = True,
    ignore_missing: bool = True,
    credential_factory: Optional[Callable[[], AzureCliCredential]] = None,
) -> None:
    """
    Removes an agent by name (from config) or by id.
    - If both name and id are passed, id wins and the name is used only for config cleanup.
    """
    remover = AgentRemover(
        project_endpoint,
        config_path=config_path,
        credential_factory=credential_factory,
    )
    if agent_id:
        await remover.remove_by_id(
            agent_id,
            remove_config_name=agent_name if also_delete_config else None,
            ignore_missing=ignore_missing
        )
    elif agent_name:
        await remover.remove_by_name(
            agent_name,
            also_delete_config=also_delete_config,
            ignore_missing=ignore_missing
        )
    else:
        raise ValueError("Provide either agent_name or agent_id.")


if __name__ == "__main__":
    # Minimal env-driven entrypoint
    PROJECT_ENDPOINT = os.getenv("AZURE_AI_PROJECT_ENDPOINT")
    CONFIG_PATH = os.getenv("AZURE_AGENTS_CONFIG_PATH", "agents_config.json")
    AGENT_NAME = os.getenv("AGENT_NAME")  # optional
    AGENT_ID = os.getenv("AGENT_ID")      # optional

    if not PROJECT_ENDPOINT:
        raise SystemExit("Set AZURE_AI_PROJECT_ENDPOINT before running.")

    # Example: override credential type if desired
    # from azure.identity.aio import InteractiveBrowserCredential
    # cred_factory = lambda: InteractiveBrowserCredential()

    asyncio.run(agent_remover(
        project_endpoint=PROJECT_ENDPOINT,
        agent_name=AGENT_NAME,
        agent_id=AGENT_ID,
        config_path=CONFIG_PATH,
        also_delete_config=True,
        ignore_missing=True,
        # credential_factory=cred_factory,
    ))
