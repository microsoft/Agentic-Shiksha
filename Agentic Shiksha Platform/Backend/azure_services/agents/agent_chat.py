import os
import json
import asyncio
from pathlib import Path
from typing import Callable, Optional, Dict, Any

from azure.identity.aio import AzureCliCredential
from azure.ai.agents.aio import AgentsClient


class AgentChat:
    """
    Simple chat helper for Azure AI Foundry agents.
    
    Updated to use the official azure-ai-agents SDK (AgentsClient) instead of
    the internal agent_framework package.

    - Initialize with project endpoint and (optionally) a config path.
    - Chat using an agent *name* stored in agents_config.json or directly via agent_id.
    - Credential is pluggable: pass a factory returning an async credential.
    """

    def __init__(
        self,
        *,
        project_endpoint: str,
        config_path: str = "agents_config.json",
        credential_factory: Optional[Callable[[], AzureCliCredential]] = None,
    ) -> None:
        if not project_endpoint:
            raise ValueError("project_endpoint is required.")
        self.project_endpoint = project_endpoint
        self.config_path = Path(config_path)
        self.credential_factory = credential_factory or (lambda: AzureCliCredential())

    # ----------------- config helpers -----------------
    def _load_config(self) -> Dict[str, Any]:
        if not self.config_path.exists():
            raise FileNotFoundError(f"{self.config_path} not found. Create an agent first.")
        try:
            with self.config_path.open("r", encoding="utf-8") as f:
                return json.load(f)
        except json.JSONDecodeError as e:
            raise ValueError(f"{self.config_path} is not valid JSON.") from e

    def get_agent_id_from_config(self, agent_name: str) -> str:
        data = self._load_config()
        if agent_name not in data:
            raise KeyError(f"Agent name '{agent_name}' not found in {self.config_path}.")
        agent_id = data[agent_name].get("agent_id")
        if not agent_id:
            raise KeyError(f"No 'agent_id' stored for '{agent_name}' in {self.config_path}.")
        return agent_id

    # ----------------- chat methods -----------------
    async def chat_by_id(self, *, agent_id: str, message: str) -> str:
        """
        Chat with an agent using the official azure-ai-agents SDK.
        Creates a thread, sends a message, runs the agent, and returns the response.
        """
        if not agent_id:
            raise ValueError("agent_id must be a non-empty string.")
        
        cred = self.credential_factory()
        agents_client = AgentsClient(
            endpoint=self.project_endpoint,
            credential=cred,
        )
        
        try:
            # Create a new thread
            thread = await agents_client.threads.create()
            
            # Send user message
            await agents_client.messages.create(
                thread_id=thread.id,
                role="user",
                content=message,
            )
            
            # Run the agent and wait for completion
            run = await agents_client.runs.create_and_process(
                thread_id=thread.id,
                agent_id=agent_id,
            )
            
            # Get the assistant's response
            messages = agents_client.messages.list(thread_id=thread.id)
            async for msg in messages:
                if msg.role == "assistant" and msg.text_messages:
                    reply_text = msg.text_messages[-1].text.value
                    print(reply_text)
                    return reply_text
            
            return "(No response from agent)"
        finally:
            await agents_client.close()
            await cred.close()

    async def chat_by_name(self, *, agent_name: str, message: str) -> str:
        agent_id = self.get_agent_id_from_config(agent_name)
        return await self.chat_by_id(agent_id=agent_id, message=message)


# --------------- CLI-style entrypoint (optional) ---------------
if __name__ == "__main__":
    PROJECT_ENDPOINT = os.getenv("AZURE_AI_PROJECT_ENDPOINT")
    CONFIG_PATH = os.getenv("AZURE_AGENTS_CONFIG_PATH", "agents_config.json")
    AGENT_NAME = os.getenv("AGENT_NAME", "HelperAgent")
    MESSAGE = os.getenv("CHAT_MESSAGE", "Hello!")

    if not PROJECT_ENDPOINT:
        raise SystemExit("Set AZURE_AI_PROJECT_ENDPOINT before running.")

    chat = AgentChat(project_endpoint=PROJECT_ENDPOINT, config_path=CONFIG_PATH)

    asyncio.run(chat.chat_by_name(agent_name=AGENT_NAME, message=MESSAGE))