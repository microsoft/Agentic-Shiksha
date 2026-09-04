"""
Agent Creation - Using AIProjectClient

This module uses the AIProjectClient.agents API which properly supports:
- Named agents with versions (instead of asst_xxx IDs)
- OpenAI conversations/responses API for chat

Reference: https://learn.microsoft.com/en-us/azure/search/agentic-retrieval-how-to-create-pipeline
"""

import os
import json
import asyncio
import logging
from typing import Optional, Dict, Any, Callable, List, Tuple
from tempfile import NamedTemporaryFile
from pathlib import Path

from azure.identity import DefaultAzureCredential
from azure.ai.projects import AIProjectClient
from azure.ai.projects.models import (
    PromptAgentDefinition,
    FunctionTool,
)

from agent_tools.hosted.bing_grounding.builder import build_bing_grounding_tool
from agent_tools.hosted.bing_custom_search.builder import build_bing_custom_search_tool
from agent_tools.hosted.memory_search.builder import build_memory_search_tool
from agent_tools.hosted.azure_ai_search.builder import build_azure_ai_search_tool
from utils.log_safe import scrub

logger = logging.getLogger(__name__)

# Bing Grounding connection ID for general web search
BING_CONNECTION_ID = os.environ["AZURE_BING_CONNECTION_ID"]

# Bing Custom Search connection ID for domain-specific search (teacher-curated sites)
BING_CUSTOM_SEARCH_CONNECTION_ID = os.environ["AZURE_BING_CUSTOM_SEARCH_CONNECTION_ID"]

# Default Bing Custom Search instance name
DEFAULT_CUSTOM_SEARCH_INSTANCE = os.getenv(
    "AZURE_BING_CUSTOM_SEARCH_INSTANCE",
    "agentic_shiksha_custom_websearch"
)


def get_credential():
    """Get centralized credential (cached) to avoid Windows file locking."""
    try:
        from common_azure_auth import get_sync_credential
        return get_sync_credential()
    except ImportError:
        return DefaultAzureCredential()


# ---------------------------------------------------------------------------
# FunctionTool definitions
# ---------------------------------------------------------------------------
# Ordered list of FunctionTool sources appended to every agent.
# - A dict entry is used directly as a tool definition.
# - A "module_path:ATTRIBUTE" string is lazily imported from `agent_tools` at
#   build time, so a missing optional tool module never blocks agent creation.
_FUNCTION_TOOL_SOURCES: List[Any] = [
    "agent_tools.custom.add_document:ADD_DOCUMENT_TOOL_DEFINITION",
    "agent_tools.custom.add_message:ADD_MESSAGE_TOOL_DEFINITION",
    "agent_tools.custom.add_quiz:ADD_QUIZ_TOOL_DEFINITION",
    "agent_tools.custom.add_flashcard:ADD_FLASHCARD_TOOL_DEFINITION",
    "agent_tools.custom.add_challenge:ADD_CHALLENGE_TOOL_DEFINITION",
    # add_tikz_diagram retired in favour of generate_image; agents created before
    # the switch still carry it, so its runtime dispatch stays wired up.
    "agent_tools.custom.generate_image:GENERATE_IMAGE_TOOL_DEFINITION",
    "agent_tools.custom.get_threshold_concepts:GET_THRESHOLD_CONCEPTS_TOOL_DEFINITION",
    "agent_tools.custom.update_topic_progress:UPDATE_TOPIC_PROGRESS_TOOL_DEFINITION",
    "agent_tools.custom.declare_plan:DECLARE_PLAN_TOOL_DEFINITION",
    "agent_tools.custom.ask_clarification:ASK_CLARIFICATION_TOOL_DEFINITION",
    "agent_tools.custom.suggest_next_queries:SUGGEST_NEXT_QUERIES_TOOL_DEFINITION",
]


class AgentConfigStore:
    """Persists agent metadata to a JSON config file using atomic writes.

    Single responsibility: reading/writing `agents_config.json`. Isolating this
    keeps :class:`AgentCreator` focused on agent orchestration.
    """

    def __init__(self, config_path: Path):
        self.config_path = Path(config_path)

    def load(self) -> Dict[str, Any]:
        if not self.config_path.exists():
            return {}
        try:
            with self.config_path.open("r", encoding="utf-8") as f:
                return json.load(f)
        except json.JSONDecodeError:
            return {}

    def _atomic_write(self, data: Dict[str, Any]) -> None:
        self.config_path.parent.mkdir(parents=True, exist_ok=True)
        with NamedTemporaryFile("w", delete=False, dir=str(self.config_path.parent), encoding="utf-8") as tmp:
            json.dump(data, tmp, indent=2, ensure_ascii=False)
            tmp_path = tmp.name
        os.replace(tmp_path, self.config_path)

    def upsert(self, *, agent_name: str, agent_version: str, model_deployment: str) -> None:
        cfg = self.load()
        cfg[agent_name] = {
            "agent_name": agent_name,
            "agent_version": agent_version,
            "model_deployment": model_deployment,
        }
        self._atomic_write(cfg)
        logger.info(f"Updated {self.config_path} with '{agent_name}' v{agent_version}")

    def remove(self, agent_name: str) -> bool:
        cfg = self.load()
        if agent_name in cfg:
            del cfg[agent_name]
            self._atomic_write(cfg)
            logger.info(f"Removed '{scrub(agent_name)}' from config")
            return True
        return False


class AgentToolBuilder:
    """Assembles the tool list for an agent from the requested capabilities.

    Each tool is added independently: a failure to construct one tool is logged
    and skipped so it never blocks agent creation. This mirrors the previous
    inline behaviour while making each capability individually testable.
    """

    def __init__(self, *, agent_name: str):
        self.agent_name = agent_name
        self._tools: List[Any] = []

    def build(
        self,
        *,
        include_web_search: bool,
        include_custom_search: bool,
        custom_search_instance_name: Optional[str],
        search_index_name: Optional[str],
        search_index_filter: Optional[str],
        search_connection_id: Optional[str],
        memory_store_name: Optional[str],
        memory_scope: str,
        memory_update_delay: int,
    ) -> List[Any]:
        """Return the ordered list of tools for the agent (may be empty)."""
        if include_web_search:
            self._add_bing_grounding()
        if include_custom_search:
            self._add_bing_custom_search(custom_search_instance_name)
        self._add_memory(memory_store_name, memory_scope, memory_update_delay)
        self._add_ai_search(search_index_name, search_index_filter, search_connection_id)
        self._add_function_tools()
        return self._tools

    def _add_bing_grounding(self) -> None:
        tool = build_bing_grounding_tool(BING_CONNECTION_ID)
        if tool is not None:
            self._tools.append(tool)
            logger.info(f"\u2713 Added BingGroundingTool to agent '{scrub(self.agent_name)}'")

    def _add_bing_custom_search(self, instance_name: Optional[str]) -> None:
        effective_instance = instance_name or DEFAULT_CUSTOM_SEARCH_INSTANCE
        tool = build_bing_custom_search_tool(BING_CUSTOM_SEARCH_CONNECTION_ID, effective_instance)
        if tool is not None:
            self._tools.append(tool)
            logger.info(f"\u2713 Added BingCustomSearchPreviewTool (instance='{scrub(effective_instance)}') to agent '{scrub(self.agent_name)}'")

    def _add_memory(self, memory_store_name: Optional[str], memory_scope: str, memory_update_delay: int) -> None:
        tool = build_memory_search_tool(memory_store_name, memory_scope, memory_update_delay)
        if tool is not None:
            self._tools.append(tool)
            logger.info(f"\u2713 Added MemorySearchPreviewTool (store='{scrub(memory_store_name)}', scope='{scrub(memory_scope)}', delay={scrub(memory_update_delay)}s) to agent '{scrub(self.agent_name)}'")

    def _add_ai_search(
        self,
        search_index_name: Optional[str],
        search_index_filter: Optional[str],
        search_connection_id: Optional[str],
    ) -> None:
        if not (search_index_name and search_connection_id):
            return
        try:
            ai_search_tool = build_azure_ai_search_tool(
                search_index_name,
                search_connection_id,
                query_type="vector_semantic_hybrid",
                filter=search_index_filter,
                top_k=20,  # Retrieve more chunks to capture full document content
            )
            self._tools.append(ai_search_tool)
            logger.info(f"\u2713 Added AzureAISearchTool (index='{scrub(search_index_name)}', filter='{scrub(search_index_filter)}', top_k=20) to agent '{scrub(self.agent_name)}'")
        except Exception as e:
            logger.warning(f"Failed to add AzureAISearchTool: {e}")

    def _add_function_tools(self) -> None:
        for source in _FUNCTION_TOOL_SOURCES:
            try:
                definition = source if isinstance(source, dict) else self._load_tool_definition(source)
                self._tools.append(
                    FunctionTool(
                        name=definition["name"],
                        description=definition["description"],
                        parameters=definition["parameters"],
                        strict=False,
                    )
                )
                logger.info(f"\u2713 Added {scrub(definition['name'])} FunctionTool to agent '{scrub(self.agent_name)}'")
            except Exception as e:
                label = source if isinstance(source, str) else source.get("name", "unknown")
                logger.warning(f"Failed to add FunctionTool '{label}': {e}")

    @staticmethod
    def _load_tool_definition(spec: str) -> Dict[str, Any]:
        """Lazily import a tool definition from a "module_path:ATTRIBUTE" spec."""
        import importlib

        module_path, attr = spec.split(":", 1)
        module = importlib.import_module(module_path)
        return getattr(module, attr)


class AgentCreator:
    """
    Create Azure AI Foundry agents using AIProjectClient.
    
    This supports:
    - Named agents with versions
    - Full integration with OpenAI conversations/responses API
    """

    def __init__(
        self,
        project_endpoint: str,
        model_deployment: str,
        *,
        config_path: str = "agents_config.json",
    ):
        if not project_endpoint:
            raise ValueError("project_endpoint is required.")
        if not model_deployment:
            raise ValueError("model_deployment is required.")

        self.project_endpoint = project_endpoint
        self.model_deployment = model_deployment
        self.config_path = Path(config_path)
        self.config_store = AgentConfigStore(self.config_path)
        self.credential = get_credential()
        
        # Create AIProjectClient
        self.project_client = AIProjectClient(
            endpoint=self.project_endpoint,
            credential=self.credential,
        )

    def create_agent(
        self,
        name: str,
        instructions: str,
        *,
        include_web_search: bool = False,
        include_custom_search: bool = False,
        custom_search_instance_name: Optional[str] = None,
        search_index_name: Optional[str] = None,
        search_index_filter: Optional[str] = None,
        search_connection_id: Optional[str] = None,
        memory_store_name: Optional[str] = None,
        memory_scope: str = "{{$userId}}",
        memory_update_delay: int = 300,
        save_to_config: bool = True,
    ) -> Tuple[str, str]:
        """
        Create an agent using AIProjectClient.agents.create_version().
        
        Args:
            name: Agent name (used as identifier, not asst_xxx)
            instructions: Agent instructions/system prompt
            include_web_search: If True, adds BingGroundingTool (default: False)
            include_custom_search: If True, adds BingCustomSearchTool (default: False)
            custom_search_instance_name: Bing Custom Search instance name
            search_index_name: Common index name for AzureAISearchTool
            search_index_filter: OData filter (e.g. "session_id eq 'abc'")
            search_connection_id: Project connection ID for Azure AI Search
            memory_store_name: Name of memory store to attach (enables per-user persistent memory)
            memory_scope: Scope for memory isolation (default: "{{$userId}}" for auto user-based)
            memory_update_delay: Seconds of inactivity before storing memories (default: 300)
            save_to_config: If True, saves agent to config file
            
        Returns:
            Tuple of (agent_name, agent_version)
        """
        tools = AgentToolBuilder(agent_name=name).build(
            include_web_search=include_web_search,
            include_custom_search=include_custom_search,
            custom_search_instance_name=custom_search_instance_name,
            search_index_name=search_index_name,
            search_index_filter=search_index_filter,
            search_connection_id=search_connection_id,
            memory_store_name=memory_store_name,
            memory_scope=memory_scope,
            memory_update_delay=memory_update_delay,
        )
        
        # Create agent with create_version()
        agent = self.project_client.agents.create_version(
            agent_name=name,
            definition=PromptAgentDefinition(
                model=self.model_deployment,
                instructions=instructions,
                tools=tools if tools else None,
            )
        )
        
        logger.info(f"Created agent: {agent.name} v{agent.version}")
        
        if save_to_config:
            self.config_store.upsert(
                agent_name=agent.name,
                agent_version=agent.version,
                model_deployment=self.model_deployment,
            )
        
        return agent.name, agent.version

    def get_openai_client(self):
        """Get the OpenAI client for conversations/responses API."""
        return self.project_client.get_openai_client()

    def list_agents(self) -> List[Any]:
        """List all agents in the project."""
        return list(self.project_client.agents.list())

    def delete_agent(self, agent_name: str) -> bool:
        """
        Delete an agent by name.
        
        Args:
            agent_name: The agent name to delete
            
        Returns:
            True if deleted successfully, False otherwise
        """
        try:
            self.project_client.agents.delete(agent_name=agent_name)
            logger.info(f"Deleted agent: {scrub(agent_name)}")
            self.config_store.remove(agent_name)
            return True
        except Exception as e:
            logger.error(f"Failed to delete agent '{scrub(agent_name)}': {scrub(e)}")
            return False

    def get_agent(self, agent_name: str) -> Optional[Any]:
        """
        Get an agent by name.
        
        Returns the agent object or None if not found.
        """
        try:
            for agent in self.list_agents():
                if agent.name == agent_name:
                    return agent
            return None
        except Exception as e:
            logger.error(f"Failed to get agent '{agent_name}': {e}")
            return None


class ConversationManager:
    """
    Manage conversations with agents using the OpenAI conversations/responses API.
    
    This replaces the threads/runs API used by AgentsClient.
    """
    
    def __init__(self, project_endpoint: str):
        self.project_endpoint = project_endpoint
        self.credential = get_credential()
        self.project_client = AIProjectClient(
            endpoint=project_endpoint,
            credential=self.credential,
        )
        self.openai_client = self.project_client.get_openai_client()
    
    def create_conversation(self) -> str:
        """Create a new conversation and return its ID."""
        conversation = self.openai_client.conversations.create()
        logger.info(f"Created conversation: {conversation.id}")
        return conversation.id
    
    def send_message(
        self,
        agent_name: str,
        message: str,
        conversation_id: Optional[str] = None,
        tool_choice: str = "auto",
        stream: bool = False,
    ):
        """
        Send a message to an agent.
        
        Args:
            agent_name: The agent name (not asst_xxx ID)
            message: The user's message
            conversation_id: Optional existing conversation ID
            tool_choice: Tool choice mode ("auto", "required", "none")
            stream: If True, return streaming response
            
        Returns:
            Response from the agent (or streaming generator if stream=True)
        """
        # Create conversation if not provided
        if not conversation_id:
            conversation = self.openai_client.conversations.create()
            conversation_id = conversation.id
        
        # Build extra_body with agent reference
        extra_body = {
            "agent": {
                "name": agent_name,
                "type": "agent_reference"
            }
        }
        
        # Send request using responses API
        response = self.openai_client.responses.create(
            conversation=conversation_id,
            tool_choice=tool_choice,
            input=message,
            stream=stream,
            extra_body=extra_body,
        )
        
        if stream:
            return self._stream_response(response, conversation_id)
        else:
            return {
                "conversation_id": conversation_id,
                "output_text": response.output_text,
                "response": response,
            }
    
    def _stream_response(self, response, conversation_id: str):
        """Generator that yields streaming response chunks."""
        for chunk in response:
            if hasattr(chunk, 'output_text') and chunk.output_text:
                yield {
                    "type": "delta",
                    "text": chunk.output_text,
                    "conversation_id": conversation_id,
                }
        yield {
            "type": "done",
            "conversation_id": conversation_id,
        }
    
    def get_conversation_items(self, conversation_id: str) -> List[Any]:
        """Get all items (messages) in a conversation."""
        return list(self.openai_client.conversations.items.list(conversation_id))


# Convenience function
def create_agent_v2(
    project_endpoint: str,
    model_deployment: str,
    name: str,
    instructions: str,
    *,
    include_web_search: bool = False,
    include_custom_search: bool = False,
    custom_search_instance_name: Optional[str] = None,
    memory_store_name: Optional[str] = None,
    memory_scope: str = "{{$userId}}",
    memory_update_delay: int = 300,
    config_path: str = "agents_config.json",
) -> Tuple[str, str]:
    """
    Convenience function to create an agent using AIProjectClient.
    
    Returns:
        Tuple of (agent_name, agent_version)
    """
    creator = AgentCreator(
        project_endpoint=project_endpoint,
        model_deployment=model_deployment,
        config_path=config_path,
    )
    return creator.create_agent(
        name=name,
        instructions=instructions,
        include_web_search=include_web_search,
        include_custom_search=include_custom_search,
        custom_search_instance_name=custom_search_instance_name,
        memory_store_name=memory_store_name,
        memory_scope=memory_scope,
        memory_update_delay=memory_update_delay,
    )


# Backward compatibility: async wrapper for agent_manager.py
async def agent_creator(
    *,
    project_endpoint: str,
    model_deployment: str,
    agent_name: str,
    instructions: str,
    config_path: str = "agents_config.json",
    save_to_config: bool = True,
    include_web_search: bool = False,
    include_custom_search: bool = False,
    custom_search_instance_name: Optional[str] = None,
    course_urls: Optional[List[str]] = None,
    credential_factory: Optional[Callable] = None,
    search_index_name: Optional[str] = None,
    search_index_filter: Optional[str] = None,
    search_connection_id: Optional[str] = None,
    memory_store_name: Optional[str] = None,
    memory_scope: str = "{{$userId}}",
    memory_update_delay: int = 300,
) -> str:
    """
    Async convenience function to create an agent (backward compatible).
    
    Returns:
        The agent name (which is the agent ID in the new API)
    """
    import asyncio
    
    def _create():
        creator = AgentCreator(
            project_endpoint=project_endpoint,
            model_deployment=model_deployment,
            config_path=config_path,
        )
        name, version = creator.create_agent(
            name=agent_name,
            instructions=instructions,
            save_to_config=save_to_config,
            include_web_search=include_web_search,
            include_custom_search=include_custom_search,
            custom_search_instance_name=custom_search_instance_name,
            search_index_name=search_index_name,
            search_index_filter=search_index_filter,
            search_connection_id=search_connection_id,
            memory_store_name=memory_store_name,
            memory_scope=memory_scope,
            memory_update_delay=memory_update_delay,
        )
        return name
    
    # Run in thread pool to avoid blocking
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _create)


if __name__ == "__main__":
    import asyncio
    
    PROJECT_ENDPOINT = os.environ["AZURE_AI_PROJECT_ENDPOINT"]
    MODEL_DEPLOYMENT = os.getenv("AZURE_AI_AGENT_MODEL_DEPLOYMENT", "gpt-5.2")
    
    # Test agent creation
    creator = AgentCreator(
        project_endpoint=PROJECT_ENDPOINT,
        model_deployment=MODEL_DEPLOYMENT,
    )
    
    # List existing agents
    print("Existing agents:")
    for agent in creator.list_agents():
        print(f"  - {agent.name}")
