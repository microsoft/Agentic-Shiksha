"""
Memory Store Manager - Per-agent memory with user-scoped isolation.

Each agent gets its own memory store; within a store, memories are partitioned
by user scope so multiple students sharing an agent never see each other's
memories.

See azure_services/README.md ("Memory Store Manager") for the architecture
overview and usage examples.
"""

import os
import logging
from typing import Optional, Dict, Any, List

from azure.identity import DefaultAzureCredential
from azure.ai.projects import AIProjectClient
from azure.ai.projects.models import (
    MemorySearchTool,
    MemoryStoreDefaultDefinition,
    MemoryStoreDefaultOptions,
    MemorySearchOptions,
    ResponsesUserMessageItemParam,
)
from utils.log_safe import scrub

logger = logging.getLogger(__name__)

# Default models for memory store
DEFAULT_CHAT_MODEL = os.getenv("MEMORY_CHAT_MODEL", "gpt-4.1")
DEFAULT_EMBEDDING_MODEL = os.getenv("MEMORY_EMBEDDING_MODEL", "text-embedding-3-large")

# Default memory update delay (seconds of inactivity before storing)
DEFAULT_UPDATE_DELAY = int(os.getenv("MEMORY_UPDATE_DELAY", "300"))  # 5 minutes


def _get_credential():
    """Get centralized credential (cached) to avoid Windows file locking."""
    try:
        from common_azure_auth import get_sync_credential
        return get_sync_credential()
    except ImportError:
        return DefaultAzureCredential()


class MemoryStoreManager:
    """
    Manages per-agent memory stores with user-scoped isolation.
    
    Each agent gets a dedicated memory store named "{agent_name}-memory".
    Within each store, the `scope` parameter isolates memories per user.
    """

    def __init__(
        self,
        project_endpoint: str,
        *,
        chat_model: str = DEFAULT_CHAT_MODEL,
        embedding_model: str = DEFAULT_EMBEDDING_MODEL,
    ):
        self.project_endpoint = project_endpoint
        self.chat_model = chat_model
        self.embedding_model = embedding_model
        self.credential = _get_credential()
        self.project_client = AIProjectClient(
            endpoint=self.project_endpoint,
            credential=self.credential,
        )

    @staticmethod
    def memory_store_name_for_agent(agent_name: str) -> str:
        """
        Derive a deterministic memory store name from agent name.
        
        Naming convention: "{agent_name}-memory"
        This ensures 1:1 mapping between agent and memory store.
        """
        # Sanitize: memory store names only allow alphanumeric, hyphens, underscores
        sanitized = agent_name.replace(" ", "-").strip("-_")
        return f"{sanitized}-memory"

    # ==================== Memory Store CRUD ====================

    def create_memory_store_for_agent(
        self,
        agent_name: str,
        *,
        description: Optional[str] = None,
        user_profile_details: str = "Store learning preferences, course progress, "
                                     "topics of interest, and study habits. "
                                     "Avoid irrelevant or sensitive data such as age, "
                                     "financials, precise location, and credentials.",
        chat_summary_enabled: bool = True,
        user_profile_enabled: bool = True,
    ) -> Dict[str, Any]:
        """
        Create a dedicated memory store for an agent.
        
        If a store with this name already exists, returns the existing one.
        
        Args:
            agent_name: The agent's name (used to derive memory store name)
            description: Human-readable description
            user_profile_details: Controls what info the memory system extracts
            chat_summary_enabled: Enable chat summary memories
            user_profile_enabled: Enable user profile memories
            
        Returns:
            Dict with memory store info (name, id, etc.)
        """
        store_name = self.memory_store_name_for_agent(agent_name)
        
        # Check if already exists
        existing = self.get_memory_store(store_name)
        if existing:
            logger.info(f"Memory store '{scrub(store_name)}' already exists for agent '{scrub(agent_name)}'")
            return existing

        # Create memory store options
        options = MemoryStoreDefaultOptions(
            chat_summary_enabled=chat_summary_enabled,
            user_profile_enabled=user_profile_enabled,
            user_profile_details=user_profile_details,
        )

        # Create memory store definition
        definition = MemoryStoreDefaultDefinition(
            chat_model=self.chat_model,
            embedding_model=self.embedding_model,
            options=options,
        )

        # Create it
        desc = description or f"Memory store for agent: {agent_name}"
        memory_store = self.project_client.memory_stores.create(
            name=store_name,
            definition=definition,
            description=desc,
        )

        logger.info(f"Created memory store '{scrub(store_name)}' (id={scrub(memory_store.id)}) for agent '{scrub(agent_name)}'")
        
        return {
            "name": memory_store.name,
            "id": memory_store.id,
            "description": memory_store.description,
            "created_at": str(memory_store.created_at),
            "definition": dict(memory_store.definition) if memory_store.definition else {},
        }

    def get_memory_store(self, store_name: str) -> Optional[Dict[str, Any]]:
        """
        Get a memory store by name. Returns None if not found.
        """
        try:
            stores = list(self.project_client.memory_stores.list())
            for store in stores:
                if store.name == store_name:
                    return {
                        "name": store.name,
                        "id": store.id,
                        "description": store.description,
                        "created_at": str(store.created_at),
                        "definition": dict(store.definition) if store.definition else {},
                    }
            return None
        except Exception as e:
            logger.error(f"Error getting memory store '{scrub(store_name)}': {scrub(e)}")
            return None

    def list_memory_stores(self) -> List[Dict[str, Any]]:
        """List all memory stores in the project."""
        try:
            stores = list(self.project_client.memory_stores.list())
            return [
                {
                    "name": s.name,
                    "id": s.id,
                    "description": s.description,
                    "created_at": str(s.created_at),
                }
                for s in stores
            ]
        except Exception as e:
            logger.error(f"Error listing memory stores: {e}")
            return []

    def delete_memory_store(self, store_name: str) -> bool:
        """
        Delete a memory store and ALL its memories across all scopes.
        This is irreversible!
        """
        try:
            self.project_client.memory_stores.delete(store_name)
            logger.info(f"Deleted memory store '{scrub(store_name)}'")
            return True
        except Exception as e:
            logger.error(f"Error deleting memory store '{scrub(store_name)}': {scrub(e)}")
            return False

    def delete_memory_store_for_agent(self, agent_name: str) -> bool:
        """Delete the memory store associated with an agent."""
        store_name = self.memory_store_name_for_agent(agent_name)
        return self.delete_memory_store(store_name)

    # ==================== Memory Search Tool ====================

    def get_memory_search_tool(
        self,
        memory_store_name: str,
        *,
        scope: str = "{{$userId}}",
        update_delay: int = DEFAULT_UPDATE_DELAY,
    ) -> MemorySearchTool:
        """
        Create a MemorySearchTool that can be attached to an agent.
        
        Args:
            memory_store_name: Name of the memory store
            scope: User scope for memory isolation.
                   - "{{$userId}}" = auto-extract from auth token (TID+OID)
                   - Or pass a custom user identifier string
            update_delay: Seconds of inactivity before updating memories (default: 300)
            
        Returns:
            MemorySearchTool instance ready to be added to agent tools list
        """
        tool = MemorySearchTool(
            memory_store_name=memory_store_name,
            scope=scope,
            update_delay=update_delay,
        )
        logger.info(f"Created MemorySearchTool for store '{memory_store_name}' (scope={scope}, delay={update_delay}s)")
        return tool

    def get_memory_search_tool_for_agent(
        self,
        agent_name: str,
        *,
        scope: str = "{{$userId}}",
        update_delay: int = DEFAULT_UPDATE_DELAY,
    ) -> MemorySearchTool:
        """
        Convenience: Get a MemorySearchTool for an agent's memory store.
        """
        store_name = self.memory_store_name_for_agent(agent_name)
        return self.get_memory_search_tool(
            store_name,
            scope=scope,
            update_delay=update_delay,
        )

    # ==================== Memory Operations ====================

    def search_memories(
        self,
        store_name: str,
        scope: str,
        query: str,
        *,
        max_memories: int = 10,
    ) -> List[Dict[str, Any]]:
        """
        Search memories for a specific user within a memory store.
        
        Args:
            store_name: Memory store name
            scope: User scope (e.g., "user_123" or the TID_OID)
            query: Search query
            max_memories: Maximum number of memories to return
            
        Returns:
            List of matching memory items
        """
        try:
            query_message = ResponsesUserMessageItemParam(content=query)
            
            search_response = self.project_client.memory_stores.search_memories(
                name=store_name,
                scope=scope,
                items=[query_message],
                options=MemorySearchOptions(max_memories=max_memories),
            )
            
            results = []
            for memory in search_response.memories:
                results.append({
                    "memory_id": memory.memory_item.memory_id,
                    "content": memory.memory_item.content,
                })
            
            logger.info(f"Found {scrub(len(results))} memories in '{scrub(store_name)}' for scope '{scrub(scope)}'")
            return results
        except Exception as e:
            logger.error(f"Error searching memories in '{scrub(store_name)}': {scrub(e)}")
            return []

    def get_static_memories(
        self,
        store_name: str,
        scope: str,
    ) -> List[Dict[str, Any]]:
        """
        Retrieve static (user profile) memories for a scope.
        These are injected at the start of each conversation.
        """
        try:
            search_response = self.project_client.memory_stores.search_memories(
                name=store_name,
                scope=scope,
            )
            
            results = []
            for memory in search_response.memories:
                results.append({
                    "memory_id": memory.memory_item.memory_id,
                    "content": memory.memory_item.content,
                })
            return results
        except Exception as e:
            logger.error(f"Error getting static memories: {e}")
            return []

    def add_memories(
        self,
        store_name: str,
        scope: str,
        messages: List[str],
        *,
        update_delay: int = 0,
        previous_update_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Manually add memories from conversation content.
        
        Args:
            store_name: Memory store name
            scope: User scope
            messages: List of message strings to extract memories from
            update_delay: 0 for immediate, or seconds to wait
            previous_update_id: Chain from a previous update
            
        Returns:
            Update result with memory operations
        """
        try:
            items = [ResponsesUserMessageItemParam(content=msg) for msg in messages]
            
            kwargs = {
                "name": store_name,
                "scope": scope,
                "items": items,
                "update_delay": update_delay,
            }
            if previous_update_id:
                kwargs["previous_update_id"] = previous_update_id
            
            poller = self.project_client.memory_stores.begin_update_memories(**kwargs)
            result = poller.result()
            
            operations = []
            for op in result.memory_operations:
                operations.append({
                    "kind": op.kind,
                    "memory_id": op.memory_item.memory_id,
                    "content": op.memory_item.content,
                })
            
            logger.info(f"Added {len(operations)} memory operations to '{store_name}' for scope '{scope}'")
            return {
                "update_id": poller.update_id if hasattr(poller, 'update_id') else None,
                "operations": operations,
            }
        except Exception as e:
            logger.error(f"Error adding memories to '{store_name}': {e}")
            return {"update_id": None, "operations": [], "error": str(e)}

    def delete_user_memories(self, store_name: str, scope: str) -> bool:
        """
        Delete all memories for a specific user within a memory store.
        Useful for: user data deletion requests, resetting user memory.
        """
        try:
            self.project_client.memory_stores.delete_scope(
                name=store_name,
                scope=scope,
            )
            logger.info(f"Deleted memories for scope '{scrub(scope)}' in store '{scrub(store_name)}'")
            return True
        except Exception as e:
            logger.error(f"Error deleting scope memories: {e}")
            return False

    def delete_user_memories_for_agent(self, agent_name: str, scope: str) -> bool:
        """Convenience: Delete a user's memories for a specific agent."""
        store_name = self.memory_store_name_for_agent(agent_name)
        return self.delete_user_memories(store_name, scope)


# ==================== Module-level convenience functions ====================

_default_manager: Optional[MemoryStoreManager] = None


def get_memory_store_manager(project_endpoint: Optional[str] = None) -> MemoryStoreManager:
    """Get or create a singleton MemoryStoreManager."""
    global _default_manager
    if _default_manager is None:
        endpoint = project_endpoint or os.environ["AZURE_AI_PROJECT_ENDPOINT"]
        _default_manager = MemoryStoreManager(project_endpoint=endpoint)
    return _default_manager


def create_memory_store_for_agent(agent_name: str, **kwargs) -> Dict[str, Any]:
    """Convenience: Create a memory store for an agent."""
    return get_memory_store_manager().create_memory_store_for_agent(agent_name, **kwargs)


def get_memory_search_tool_for_agent(
    agent_name: str,
    *,
    scope: str = "{{$userId}}",
    update_delay: int = DEFAULT_UPDATE_DELAY,
) -> MemorySearchTool:
    """Convenience: Get MemorySearchTool for an agent."""
    return get_memory_store_manager().get_memory_search_tool_for_agent(
        agent_name, scope=scope, update_delay=update_delay,
    )


def delete_memory_store_for_agent(agent_name: str) -> bool:
    """Convenience: Delete memory store for an agent."""
    return get_memory_store_manager().delete_memory_store_for_agent(agent_name)
