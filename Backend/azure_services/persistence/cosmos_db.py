"""
Cosmos DB Service for Chat Persistence
--------------------------------------
Handles storing and retrieving chat threads and messages using Azure Cosmos DB.
Uses Entra ID (DefaultAzureCredential) for authentication.
"""

import hashlib
import os
import json
import uuid
import string
import secrets
import logging
import threading
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from utils.log_safe import scrub
from azure.cosmos import CosmosClient, PartitionKey
from azure.cosmos.exceptions import (
    CosmosHttpResponseError,
    CosmosResourceExistsError,
    CosmosResourceNotFoundError,
)
from azure.core import MatchConditions
from azure.core.exceptions import ResourceNotFoundError
from azure.core.pipeline.transport import RequestsTransport
from azure.identity import DefaultAzureCredential, AzureCliCredential
from requests import Session
from requests.adapters import HTTPAdapter

logger = logging.getLogger(__name__)

# Configuration
COSMOS_ENDPOINT = os.environ["COSMOS_ENDPOINT"]
COSMOS_DATABASE = os.getenv("COSMOS_DATABASE", "ekalaiva")
COSMOS_CONNECTION_POOL_SIZE = max(10, int(os.getenv("COSMOS_CONNECTION_POOL_SIZE", "64")))

# Frozen Phase 1 study data, archived to the phase1-archive blob container.
# The default above means a missing COSMOS_DATABASE silently targets it, which
# is how 487 documents were once written into it from a local run.
FROZEN_DATABASES = {"ekalaiva"}
THREADS_CONTAINER = "chat_threads_v1"
MESSAGES_CONTAINER = "chat_messages_v1"
USERS_CONTAINER = "users_v1"
AGENTS_CONTAINER = "agents_v1"
COURSES_CONTAINER = "courses_v2"  # V2 API courses
FEEDBACK_CONTAINER = "feedback_v1"
GROUNDEDNESS_CONTAINER = "groundedness_evaluations_v1"
ASSETS_CONTAINER = "assets_v1"  # User-generated assets/artifacts
LEARNING_STATES_CONTAINER = "learning_states_v1"  # Per-user per-agent learning progress
INVITED_USERS_CONTAINER = "invited_users_v1"  # C1: transient invite list (partition /email)
DEPARTMENTS_CONTAINER = "departments_v1"  # Department grouping (partition /id)

# Singleton client
_cosmos_client: Optional[CosmosClient] = None
_database = None
_threads_container = None
_messages_container = None
_users_container = None
_agents_container = None
_courses_container = None
_feedback_container = None
_groundedness_container = None
_assets_container = None
_learning_states_container = None
_invited_users_container = None
_departments_container = None
_init_lock = threading.Lock()


def get_cosmos_client() -> CosmosClient:
    """Get or create the process-wide Cosmos DB client using Entra ID auth."""
    global _cosmos_client, _database, _threads_container, _messages_container, _users_container, _agents_container, _courses_container, _feedback_container, _groundedness_container, _assets_container, _learning_states_container, _invited_users_container, _departments_container

    if _cosmos_client is not None:
        return _cosmos_client

    with _init_lock:
        if _cosmos_client is not None:
            return _cosmos_client

        if COSMOS_DATABASE in FROZEN_DATABASES and os.getenv(
            "ALLOW_FROZEN_DATABASE", ""
        ).lower() not in ("1", "true", "yes"):
            raise RuntimeError(
                f"COSMOS_DATABASE is '{COSMOS_DATABASE}', which holds frozen Phase 1 study "
                "data. Set COSMOS_DATABASE to the live database. For "
                "read-only analysis of Phase 1, set ALLOW_FROZEN_DATABASE=true."
            )

        logger.info(f"Initializing Cosmos DB client for {COSMOS_ENDPOINT}")

        # Use centralized auth with retry logic to avoid Windows file locking issues
        try:
            from common_azure_auth import get_sync_credential
            credential = get_sync_credential()
            logger.info("Using centralized credential from common_azure_auth")
        except ImportError:
            # Fallback if common_azure_auth not available
            try:
                credential = AzureCliCredential()
                credential.get_token("https://cosmos.azure.com/.default")
                logger.info("Using AzureCliCredential for Cosmos DB")
            except Exception:
                logger.info("AzureCliCredential not available, using DefaultAzureCredential")
                credential = DefaultAzureCredential()

        session = Session()
        adapter = HTTPAdapter(
            pool_connections=COSMOS_CONNECTION_POOL_SIZE,
            pool_maxsize=COSMOS_CONNECTION_POOL_SIZE,
            pool_block=True,
        )
        session.mount("https://", adapter)
        session.mount("http://", adapter)
        transport = RequestsTransport(session=session, session_owner=True)
        client = CosmosClient(
            url=COSMOS_ENDPOINT,
            credential=credential,
            transport=transport,
        )
        database = client.get_database_client(COSMOS_DATABASE)
        _threads_container = database.get_container_client(THREADS_CONTAINER)
        _messages_container = database.get_container_client(MESSAGES_CONTAINER)
        _users_container = database.get_container_client(USERS_CONTAINER)
        _agents_container = database.get_container_client(AGENTS_CONTAINER)
        _courses_container = database.get_container_client(COURSES_CONTAINER)
        _feedback_container = database.get_container_client(FEEDBACK_CONTAINER)
        _groundedness_container = database.get_container_client(GROUNDEDNESS_CONTAINER)
        _assets_container = database.get_container_client(ASSETS_CONTAINER)
        _learning_states_container = database.get_container_client(LEARNING_STATES_CONTAINER)
        _invited_users_container = database.get_container_client(INVITED_USERS_CONTAINER)
        _departments_container = database.get_container_client(DEPARTMENTS_CONTAINER)
        _database = database
        _cosmos_client = client
        logger.info(
            "Cosmos DB client initialized successfully (HTTP pool size=%s)",
            COSMOS_CONNECTION_POOL_SIZE,
        )

    return _cosmos_client


def _get_containers():
    """Get database containers, initializing if needed."""
    get_cosmos_client()
    return _threads_container, _messages_container


def _get_agents_container():
    """Get agents container, initializing the client if needed."""
    get_cosmos_client()
    return _agents_container


def _get_departments_container():
    """Get departments container, initializing the client if needed."""
    get_cosmos_client()
    return _departments_container


def get_courses_container():
    """Get courses container for V2 API courses, initializing if needed."""
    get_cosmos_client()
    return _courses_container


def _get_feedback_container():
    """Get feedback container, initializing the client if needed."""
    get_cosmos_client()
    return _feedback_container


# ============================================================================
# Thread Operations
# ============================================================================

def create_thread(
    thread_id: str,
    user_id: str,
    agent_id: str,
    title: str = "New Chat",
) -> Dict[str, Any]:
    """Create a new chat thread."""
    threads_container, _ = _get_containers()
    
    thread = {
        "id": thread_id,
        "userId": user_id,
        "agentId": agent_id,
        "title": title,
        "createdAt": datetime.utcnow().isoformat() + "Z",
        "updatedAt": datetime.utcnow().isoformat() + "Z",
    }
    
    threads_container.create_item(body=thread)
    logger.info(f"Created thread {thread_id} for user {user_id}")
    return thread


def get_thread(thread_id: str, user_id: str) -> Optional[Dict[str, Any]]:
    """Get a thread by ID."""
    threads_container, _ = _get_containers()
    
    try:
        thread = threads_container.read_item(item=thread_id, partition_key=user_id)
        return thread
    except CosmosResourceNotFoundError:
        return None


def update_thread(
    thread_id: str,
    user_id: str,
    updates: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """Update a thread's metadata.
    
    Args:
        thread_id: The thread ID
        user_id: The user ID (partition key)
        updates: Dictionary of fields to update (e.g., {"title": "New Title"})
    """
    threads_container, _ = _get_containers()
    
    try:
        thread = threads_container.read_item(item=thread_id, partition_key=user_id)
        
        # Apply updates
        if updates:
            if "title" in updates:
                thread["title"] = updates["title"]
        
        thread["updatedAt"] = datetime.utcnow().isoformat() + "Z"
        
        threads_container.replace_item(item=thread_id, body=thread)
        logger.info(f"Updated thread {thread_id}")
        return thread
    except CosmosResourceNotFoundError:
        logger.warning(f"Thread {thread_id} not found for update")
        return None


def delete_thread(thread_id: str, user_id: str) -> bool:
    """Delete a thread, its messages, and associated non-assessment assets."""
    threads_container, messages_container = _get_containers()
    
    try:
        # Delete all messages in the thread
        query = "SELECT * FROM c WHERE c.threadId = @threadId"
        params = [{"name": "@threadId", "value": thread_id}]
        messages = list(messages_container.query_items(
            query=query,
            parameters=params,
            partition_key=user_id
        ))
        
        for msg in messages:
            messages_container.delete_item(item=msg["id"], partition_key=user_id)
        
        # Delete all assets associated with this thread
        deleted_assets = 0
        try:
            assets_container = _get_assets_container()
            assets_query = "SELECT c.id, c.immutable FROM c WHERE c.threadId = @threadId"
            assets = list(assets_container.query_items(
                query=assets_query,
                parameters=[{"name": "@threadId", "value": thread_id}],
                partition_key=user_id
            ))
            for asset in assets:
                if asset.get("immutable"):
                    continue
                try:
                    assets_container.delete_item(item=asset["id"], partition_key=user_id)
                    deleted_assets += 1
                except Exception as e:
                    logger.warning(f"Failed to delete asset {asset['id']}: {e}")
        except Exception as e:
            logger.warning(f"Failed to delete assets for thread {thread_id}: {e}")
        
        # Delete the thread
        threads_container.delete_item(item=thread_id, partition_key=user_id)
        logger.info(f"Deleted thread {thread_id}, {len(messages)} messages, and {deleted_assets} assets")
        return True
    except CosmosResourceNotFoundError:
        logger.warning(f"Thread {thread_id} not found for deletion")
        return False


def delete_all_user_data(user_id: str) -> Dict[str, int]:
    """Delete ALL threads, messages, and assets for a user. Use with caution!"""
    threads_container, messages_container = _get_containers()
    
    deleted_threads = 0
    deleted_messages = 0
    deleted_assets = 0
    
    # Delete all messages for this user
    try:
        messages_query = "SELECT c.id FROM c WHERE c.userId = @userId"
        messages = list(messages_container.query_items(
            query=messages_query,
            parameters=[{"name": "@userId", "value": user_id}],
            partition_key=user_id
        ))
        
        for msg in messages:
            try:
                messages_container.delete_item(item=msg["id"], partition_key=user_id)
                deleted_messages += 1
            except Exception as e:
                logger.warning(f"Failed to delete message {msg['id']}: {e}")
    except Exception as e:
        logger.error(f"Failed to query messages for deletion: {e}")
    
    # Delete all assets for this user
    try:
        assets_container = _get_assets_container()
        assets_query = "SELECT c.id FROM c WHERE c.userId = @userId"
        assets = list(assets_container.query_items(
            query=assets_query,
            parameters=[{"name": "@userId", "value": user_id}],
            partition_key=user_id
        ))
        
        for asset in assets:
            try:
                assets_container.delete_item(item=asset["id"], partition_key=user_id)
                deleted_assets += 1
            except Exception as e:
                logger.warning(f"Failed to delete asset {asset['id']}: {e}")
    except Exception as e:
        logger.error(f"Failed to query assets for deletion: {e}")
    
    # Delete all threads for this user
    try:
        threads_query = "SELECT c.id FROM c WHERE c.userId = @userId"
        threads = list(threads_container.query_items(
            query=threads_query,
            parameters=[{"name": "@userId", "value": user_id}],
            partition_key=user_id
        ))
        
        for thread in threads:
            try:
                threads_container.delete_item(item=thread["id"], partition_key=user_id)
                deleted_threads += 1
            except Exception as e:
                logger.warning(f"Failed to delete thread {thread['id']}: {e}")
    except Exception as e:
        logger.error(f"Failed to query threads for deletion: {e}")
    
    logger.info(f"Deleted {deleted_threads} threads, {deleted_messages} messages, and {deleted_assets} assets for user {user_id}")
    return {"deleted_threads": deleted_threads, "deleted_messages": deleted_messages, "deleted_assets": deleted_assets}


def list_threads_for_user(user_id: str, agent_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """List all threads for a user, optionally filtered by agent."""
    threads_container, _ = _get_containers()
    
    if agent_id:
        query = "SELECT * FROM c WHERE c.userId = @userId AND c.agentId = @agentId ORDER BY c.updatedAt DESC"
        params = [
            {"name": "@userId", "value": user_id},
            {"name": "@agentId", "value": agent_id}
        ]
    else:
        query = "SELECT * FROM c WHERE c.userId = @userId ORDER BY c.updatedAt DESC"
        params = [{"name": "@userId", "value": user_id}]
    
    threads = list(threads_container.query_items(
        query=query,
        parameters=params,
        partition_key=user_id
    ))
    
    return threads


# ============================================================================
# Thread Sharing Operations
# ============================================================================

def create_share_token_for_thread(thread_id: str, user_id: str) -> Optional[str]:
    """
    Create a share token for a thread, enabling public read-only access.
    If the thread already has a share token, return the existing one.
    
    Returns the share token or None if thread not found.
    """
    import secrets
    threads_container, _ = _get_containers()
    
    try:
        thread = threads_container.read_item(item=thread_id, partition_key=user_id)
        
        # Return existing token if already shared
        if thread.get("shareToken"):
            return thread["shareToken"]
        
        # Generate a new share token (URL-safe, 16 bytes = 22 chars)
        share_token = secrets.token_urlsafe(16)
        thread["shareToken"] = share_token
        thread["sharedAt"] = datetime.utcnow().isoformat() + "Z"
        thread["updatedAt"] = datetime.utcnow().isoformat() + "Z"
        
        threads_container.replace_item(item=thread_id, body=thread)
        logger.info(f"Created share token for thread {thread_id}")
        return share_token
    except CosmosResourceNotFoundError:
        logger.warning(f"Thread {thread_id} not found for sharing")
        return None


def revoke_share_token(thread_id: str, user_id: str) -> bool:
    """
    Revoke the share token for a thread, disabling public access.
    
    Returns True if successful, False if thread not found.
    """
    threads_container, _ = _get_containers()
    
    try:
        thread = threads_container.read_item(item=thread_id, partition_key=user_id)
        
        if "shareToken" in thread:
            del thread["shareToken"]
        if "sharedAt" in thread:
            del thread["sharedAt"]
        thread["updatedAt"] = datetime.utcnow().isoformat() + "Z"
        
        threads_container.replace_item(item=thread_id, body=thread)
        logger.info(f"Revoked share token for thread {thread_id}")
        return True
    except CosmosResourceNotFoundError:
        logger.warning(f"Thread {thread_id} not found for unsharing")
        return False


def get_thread_by_share_token(share_token: str) -> Optional[Dict[str, Any]]:
    """
    Get a thread by its share token (cross-partition query).
    Used for public access to shared chats.
    
    Returns the thread data or None if not found.
    """
    threads_container, _ = _get_containers()
    
    query = "SELECT * FROM c WHERE c.shareToken = @shareToken"
    params = [{"name": "@shareToken", "value": share_token}]
    
    # Cross-partition query — must explicitly enable
    results = list(threads_container.query_items(
        query=query,
        parameters=params,
        enable_cross_partition_query=True
    ))
    
    if results:
        return results[0]
    return None


def get_messages_for_shared_thread(thread_id: str, user_id: str) -> List[Dict[str, Any]]:
    """
    Get all messages for a shared thread.
    Requires the user_id (from the thread) for the partition key.
    
    Returns list of messages sorted by createdAt ASC.
    """
    _, messages_container = _get_containers()
    
    query = (
        "SELECT * FROM c WHERE c.threadId = @threadId "
        "AND (NOT IS_DEFINED(c.isLatest) OR c.isLatest = true) "
        "ORDER BY c.createdAt ASC"
    )
    params = [{"name": "@threadId", "value": thread_id}]
    
    messages = list(messages_container.query_items(
        query=query,
        parameters=params,
        partition_key=user_id
    ))
    
    return messages


def get_recent_messages_for_user(
    user_id: str, 
    limit_per_thread: int = 10,
    max_total: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """
    Get recent messages for ALL threads belonging to a user in a SINGLE query.
    This avoids the N+1 query problem when loading initial chat data.
    
    Args:
        user_id: The user ID (partition key)
        limit_per_thread: Max messages per thread (default 10, matches localStorage limit)
        max_total: Maximum messages Cosmos may return before per-thread trimming
    
    Returns:
        List of messages across all threads, sorted by createdAt DESC
    """
    _, messages_container = _get_containers()

    if max_total is None:
        try:
            max_total = int(os.getenv("CHAT_INITIAL_MESSAGE_LIMIT", "200"))
        except ValueError:
            max_total = 200
    max_total = max(limit_per_thread, max_total)

    # Get all messages for this user, ordered by time (most recent first)
    # Filter out stale messages (isLatest=false) from edits/retries
    # We'll filter per-thread in Python since Cosmos doesn't support LIMIT per GROUP
    query = (
        f"SELECT TOP {max_total} * FROM c WHERE c.userId = @userId "
        "AND (NOT IS_DEFINED(c.isLatest) OR c.isLatest = true) "
        "ORDER BY c.createdAt DESC"
    )
    params = [{"name": "@userId", "value": user_id}]
    
    all_messages = list(messages_container.query_items(
        query=query,
        parameters=params,
        partition_key=user_id
    ))
    
    # Group by thread and limit per thread
    messages_by_thread: Dict[str, List[Dict]] = {}
    for msg in all_messages:
        thread_id = msg.get("threadId")
        if thread_id not in messages_by_thread:
            messages_by_thread[thread_id] = []
        if len(messages_by_thread[thread_id]) < limit_per_thread:
            messages_by_thread[thread_id].append(msg)
    
    # Flatten and return
    result = []
    for msgs in messages_by_thread.values():
        result.extend(msgs)
    
    logger.debug(f"Loaded {len(result)} recent messages for user {user_id} across {len(messages_by_thread)} threads")
    return result


# ============================================================================
# Message Operations
# ============================================================================

def add_message(
    message_id: str,
    thread_id: str,
    user_id: str,
    role: str,  # "user" or "assistant"
    content: str,
    metadata: Optional[Dict[str, Any]] = None,
    message_group_id: Optional[str] = None,  # Groups user message with its assistant responses
    retry_number: int = 0,  # 0 = original, 1+ = retry attempts
) -> Dict[str, Any]:
    """Add a message to a thread.
    
    Args:
        message_id: Unique message ID
        thread_id: Thread ID this message belongs to
        user_id: User ID (partition key)
        role: "user" or "assistant"
        content: Message content
        metadata: Optional metadata dict
        message_group_id: Groups a user message with its response(s). 
                          For user messages, this is their own ID.
                          For assistant messages, this is the user message ID they respond to.
        retry_number: 0 for original message, 1+ for retry attempts
    """
    _, messages_container = _get_containers()
    
    message = {
        "id": message_id,
        "threadId": thread_id,
        "userId": user_id,
        "role": role,
        "content": content,
        "createdAt": datetime.utcnow().isoformat() + "Z",
        "metadata": metadata or {},
        "messageGroupId": message_group_id or message_id,  # Default to own ID for user messages
        "retryNumber": retry_number,
    }
    
    messages_container.create_item(body=message)
    
    # Update thread's updatedAt timestamp
    update_thread(thread_id, user_id)
    
    logger.debug(f"Added {role} message to thread {thread_id} (group={message_group_id}, retry={retry_number})")
    return message


def get_messages_for_thread(
    thread_id: str, 
    user_id: str,
    limit: Optional[int] = None,
    offset: int = 0,
    before_timestamp: Optional[str] = None
) -> Dict[str, Any]:
    """
    Get messages for a thread with pagination support.
    Only returns the latest retry for each message group (user message + its response).
    
    Grouping strategy:
    - If messages have messageGroupId, group by that (user + assistant share same group)
    - If no messageGroupId (legacy), use timestamp-based sequential grouping
    
    Args:
        thread_id: The thread ID
        user_id: The user ID (partition key)
        limit: Max messages to return (None = all)
        offset: Number of messages to skip (for pagination)
        before_timestamp: Only get messages before this ISO timestamp (for scroll-up loading)
    
    Returns:
        Dict with 'messages' list, 'total' count, and 'hasMore' boolean
    """
    _, messages_container = _get_containers()
    
    # Build query - get all messages, we'll filter retries in Python
    if before_timestamp:
        query = "SELECT * FROM c WHERE c.threadId = @threadId AND c.createdAt < @beforeTs ORDER BY c.createdAt DESC"
        params = [
            {"name": "@threadId", "value": thread_id},
            {"name": "@beforeTs", "value": before_timestamp}
        ]
    else:
        query = "SELECT * FROM c WHERE c.threadId = @threadId ORDER BY c.createdAt DESC"
        params = [{"name": "@threadId", "value": thread_id}]
    
    all_messages = list(messages_container.query_items(
        query=query,
        parameters=params,
        partition_key=user_id
    ))
    
    # Filter out messages that are not latest (isLatest = False means replaced by edit)
    # Default to True for backward compatibility with old messages
    all_messages = [m for m in all_messages if m.get("isLatest", True) is not False]
    
    logger.info(f"[RETRY DEBUG] Thread {thread_id}: Found {len(all_messages)} total messages (after isLatest filter)")
    for m in all_messages:
        logger.info(f"  - {m.get('role')}: groupId={m.get('messageGroupId')}, retryNum={m.get('retryNumber')}, content={m.get('content', '')[:50]}...")
    
    # Separate messages with and without messageGroupId
    messages_with_group = [m for m in all_messages if m.get("messageGroupId")]
    messages_without_group = [m for m in all_messages if not m.get("messageGroupId")]
    
    logger.info(f"[RETRY DEBUG] With messageGroupId: {len(messages_with_group)}, Without: {len(messages_without_group)}")
    
    filtered_messages = []
    
    # Handle messages WITH messageGroupId (new format)
    # Group by messageGroupId and keep only highest retryNumber per role per group
    if messages_with_group:
        # Group by messageGroupId
        groups: Dict[str, List[Dict]] = {}
        for msg in messages_with_group:
            group_id = msg.get("messageGroupId")
            if group_id not in groups:
                groups[group_id] = []
            groups[group_id].append(msg)
        
        # For each group, keep user message and highest retryNumber assistant
        for group_id, group_msgs in groups.items():
            users = [m for m in group_msgs if m.get("role") == "user"]
            assistants = [m for m in group_msgs if m.get("role") == "assistant"]

            # A group is meant to hold one turn plus its retries. When an id is
            # reused across turns, keeping only users[0] and a single assistant
            # deleted the rest of the conversation from the reply — the shared
            # view showed them because it applies no grouping at all.
            filtered_messages.extend(users)

            if assistants:
                best_retry = max(m.get("retryNumber", 0) or 0 for m in assistants)
                filtered_messages.extend(
                    m for m in assistants if (m.get("retryNumber", 0) or 0) == best_retry
                )
    
    # Handle messages WITHOUT messageGroupId (legacy format)
    # Use timestamp-based sequential grouping
    if messages_without_group:
        # Sort by createdAt for sequential processing
        messages_without_group.sort(key=lambda m: m.get("createdAt", ""))
        
        current_turn = None
        legacy_turns = []
        
        for msg in messages_without_group:
            role = msg.get("role")
            
            if role == "user":
                current_turn = {"user": msg, "assistants": []}
                legacy_turns.append(current_turn)
            elif role == "assistant":
                if current_turn is not None:
                    current_turn["assistants"].append(msg)
                else:
                    # Orphan assistant message
                    legacy_turns.append({"user": None, "assistants": [msg]})
        
        # Filter each turn to keep best assistant
        for turn in legacy_turns:
            if turn["user"]:
                filtered_messages.append(turn["user"])
            if turn["assistants"]:
                best = max(turn["assistants"], key=lambda m: m.get("retryNumber", 0))
                filtered_messages.append(best)
    
    # Sort all filtered messages by createdAt
    filtered_messages.sort(key=lambda m: m.get("createdAt", ""))
    
    logger.info(f"[RETRY DEBUG] After filtering: {len(filtered_messages)} messages")
    for m in filtered_messages:
        logger.info(f"  - KEPT: {m.get('role')}: retryNum={m.get('retryNumber')}, content={m.get('content', '')[:50]}...")
    
    total = len(filtered_messages)
    
    # Apply pagination
    if limit:
        filtered_messages = filtered_messages[offset:offset + limit]
    
    has_more = (offset + len(filtered_messages)) < total
    
    return {
        "messages": filtered_messages,
        "total": total,
        "hasMore": has_more
    }


def get_messages_count(thread_id: str, user_id: str) -> int:
    """Get total message count for a thread."""
    _, messages_container = _get_containers()
    
    query = "SELECT VALUE COUNT(1) FROM c WHERE c.threadId = @threadId"
    params = [{"name": "@threadId", "value": thread_id}]
    
    result = list(messages_container.query_items(
        query=query,
        parameters=params,
        partition_key=user_id
    ))
    
    return result[0] if result else 0


def delete_message(message_id: str, user_id: str) -> bool:
    """Delete a specific message."""
    _, messages_container = _get_containers()
    
    try:
        messages_container.delete_item(item=message_id, partition_key=user_id)
        logger.info(f"Deleted message {message_id}")
        return True
    except CosmosResourceNotFoundError:
        return False


# ============================================================================
# Batch Operations (for syncing from frontend)
# ============================================================================

def sync_threads_batch(threads: List[Dict[str, Any]], user_id: str) -> Dict[str, Any]:
    """Sync multiple threads from frontend to Cosmos DB."""
    threads_container, _ = _get_containers()
    synced = 0
    
    for thread_data in threads:
        # Handle both API format (camelCase) and direct format
        thread = {
            "id": thread_data.get("id", ""),
            "userId": user_id,
            "agentId": thread_data.get("agentId", thread_data.get("agent_id", "")),
            "title": thread_data.get("name", thread_data.get("title", "New Chat")),
            "createdAt": thread_data.get("createdAt", datetime.utcnow().isoformat() + "Z"),
            "updatedAt": thread_data.get("lastMessageAt", thread_data.get("updatedAt", datetime.utcnow().isoformat() + "Z")),
        }
        
        if not thread["id"]:
            logger.warning(f"Skipping thread with no ID")
            continue
        
        try:
            # Preserve server-side fields (shareToken, sharedAt) that frontend doesn't track
            try:
                existing = threads_container.read_item(item=thread["id"], partition_key=user_id)
                for key in ("shareToken", "sharedAt"):
                    if key in existing:
                        thread[key] = existing[key]
            except CosmosResourceNotFoundError:
                pass  # New thread, nothing to preserve
            
            threads_container.upsert_item(body=thread)
            synced += 1
        except Exception as e:
            logger.error(f"Failed to sync thread {thread['id']}: {e}")
    
    logger.info(f"Synced {synced}/{len(threads)} threads for user {user_id}")
    return {"upserted": synced}


def sync_messages_batch(messages: List[Dict[str, Any]], user_id: str) -> Dict[str, Any]:
    """Sync multiple messages from frontend to Cosmos DB."""
    _, messages_container = _get_containers()
    synced = 0
    
    for msg_data in messages:
        # Handle both API format (camelCase) and direct format
        msg_id = msg_data.get("id", "")
        thread_id = msg_data.get("threadId", msg_data.get("thread_id", ""))
        
        if not msg_id or not thread_id:
            logger.warning(f"Skipping message with missing ID ({msg_id!r}) or threadId ({thread_id!r}). Keys: {list(msg_data.keys())}")
            continue
        
        # Get messageGroupId - use message ID as fallback if not provided
        message_group_id = msg_data.get("messageGroupId")
        if not message_group_id:
            message_group_id = msg_id  # Fallback to own ID
        
        # Get imageUrls if present
        image_urls = msg_data.get("imageUrls", [])
        
        message = {
            "id": msg_id,
            "threadId": thread_id,
            "userId": user_id,
            "role": msg_data.get("role", "user"),
            "content": msg_data.get("content", ""),
            "createdAt": msg_data.get("timestamp", msg_data.get("createdAt", datetime.utcnow().isoformat() + "Z")),
            "metadata": msg_data.get("metadata", {}),
            "messageGroupId": message_group_id,  # For retry grouping
            "retryNumber": msg_data.get("retryNumber", 0),  # 0 = original, 1+ = retry
            "isLatest": msg_data.get("isLatest", True),  # True = current version, False = replaced by edit
        }
        
        # Only add imageUrls if present (avoid empty arrays in DB)
        if image_urls:
            message["imageUrls"] = image_urls
        
        try:
            messages_container.upsert_item(body=message)
            synced += 1
        except Exception as e:
            logger.error(f"Failed to sync message {message['id']}: {e}")
    
    logger.info(f"Synced {synced}/{len(messages)} messages for user {user_id}")
    return {"upserted": synced}


# ============================================================================
# Health Check
# ============================================================================

def check_cosmos_connection() -> bool:
    """Check if Cosmos DB connection is working."""
    try:
        get_cosmos_client()
        # Try to read database properties
        _database.read()
        return True
    except Exception as e:
        logger.error(f"Cosmos DB connection check failed: {e}")
        return False


# ============================================================================
# User Profile Operations
# ============================================================================

def get_user_profile(user_id: str) -> Optional[Dict[str, Any]]:
    """Get user profile by ID."""
    get_cosmos_client()
    
    try:
        profile = _users_container.read_item(item=user_id, partition_key=user_id)
        return profile
    except CosmosResourceNotFoundError:
        return None
    except Exception as e:
        logger.error(f"Error getting user profile {scrub(user_id)}: {scrub(e)}")
        return None


def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    """Look up a user profile by email address (case-insensitive). Returns the first match or None."""
    get_cosmos_client()
    try:
        normalized = email.lower().strip()
        query = "SELECT * FROM c WHERE c.email = @email"
        params: list = [{"name": "@email", "value": normalized}]
        items = list(_users_container.query_items(query=query, parameters=params, enable_cross_partition_query=True))
        return items[0] if items else None
    except Exception as e:
        logger.error(f"Error querying user by email {scrub(email)}: {scrub(e)}")
        return None


def upsert_user_profile(
    user_id: str,
    full_name: str = "",
    display_name: str = "",
    nickname: str = "",
    email: str = "",
    work_function: str = "",
    preferences: str = "",
    custom_instructions: str = "",
    auth_provider: str = "temp",
    learning_profile: str = "",
    department: str = "",
    college: str = "",
    role: str = "",
    status: str = "",
    institute: str = "",
    language: str = "",
    current_location: str = "",
    interests: str = "",
    passionate_about: str = "",
    onboarding_completed: bool = False,
) -> Dict[str, Any]:
    """Create or update a user profile."""
    get_cosmos_client()
    
    # Get existing profile to preserve fields not being updated
    existing = get_user_profile(user_id)
    
    profile = {
        "id": user_id,
        "userId": user_id,  # Partition key
        "fullName": full_name or (existing.get("fullName", "") if existing else ""),
        "displayName": display_name or (existing.get("displayName", "") if existing else ""),
        "nickname": nickname or (existing.get("nickname", "") if existing else ""),
        "email": email or (existing.get("email", "") if existing else ""),
        "workFunction": work_function or (existing.get("workFunction", "") if existing else ""),
        "preferences": preferences or (existing.get("preferences", "") if existing else ""),
        "customInstructions": custom_instructions or (existing.get("customInstructions", "") if existing else ""),
        "learningProfile": learning_profile or (existing.get("learningProfile", "") if existing else ""),
        "department": department or (existing.get("department", "") if existing else ""),
        "college": college or (existing.get("college", "") if existing else ""),
        "role": role or (existing.get("role", "student") if existing else "student"),
        "status": status or (existing.get("status", "active") if existing else "active"),
        "institute": institute or (existing.get("institute", "") if existing else ""),
        "language": language or (existing.get("language", "") if existing else ""),
        "currentLocation": current_location or (existing.get("currentLocation", "") if existing else ""),
        "interests": interests or (existing.get("interests", "") if existing else ""),
        "passionateAbout": passionate_about or (existing.get("passionateAbout", "") if existing else ""),
        "onboardingCompleted": onboarding_completed if onboarding_completed else (existing.get("onboardingCompleted", False) if existing else False),
        # Preserve existing authProvider if new value is default 'temp', otherwise use new value
        "authProvider": auth_provider if auth_provider != "temp" else (existing.get("authProvider", "temp") if existing else "temp"),
    }

    # Auto-promote "invited" -> "active" once onboarding is completed
    if profile["onboardingCompleted"] and profile.get("status") == "invited":
        profile["status"] = "active"
        logger.info(f"Auto-promoted user {scrub(user_id)} from 'invited' to 'active' (onboarding completed)")

    # Privacy: don't persist student names in Cosmos DB — names stay in browser only
    if profile.get("role") == "student":
        profile["fullName"] = "student_name"
        profile["displayName"] = "student_name"
        profile["nickname"] = "student_name"

    profile["createdAt"] = existing.get("createdAt", datetime.utcnow().isoformat() + "Z") if existing else datetime.utcnow().isoformat() + "Z"
    profile["updatedAt"] = datetime.utcnow().isoformat() + "Z"

    # Preserve affiliations from existing doc
    profile["affiliations"] = existing.get("affiliations", []) if existing else []
    profile["activeAffiliation"] = existing.get("activeAffiliation", 0) if existing else 0
    
    _users_container.upsert_item(body=profile)
    logger.info(f"Upserted user profile for {scrub(user_id)}")
    return profile


def delete_user_profile(user_id: str) -> bool:
    """Delete a user profile."""
    get_cosmos_client()
    
    try:
        _users_container.delete_item(item=user_id, partition_key=user_id)
        logger.info(f"Deleted user profile {scrub(user_id)}")
        return True
    except CosmosResourceNotFoundError:
        logger.warning(f"User profile {scrub(user_id)} not found for deletion")
        return False


# ============================================================================
# User Directory Operations (invited + active users in users_v1)
# ============================================================================
# User Directory Operations
# C1 = invited_users_v1  (invite/allowlist records, partition /email)
# C2 = users_v1          (active user profiles, partition /userId)
# ============================================================================

def get_invite_by_email(email: str) -> Optional[Dict[str, Any]]:
    """Look up an invite record in invited_users_v1 by email (partition key)."""
    get_cosmos_client()
    normalized = email.lower().strip()
    try:
        items = list(_invited_users_container.query_items(
            query="SELECT * FROM c WHERE c.email = @email",
            parameters=[{"name": "@email", "value": normalized}],
            partition_key=normalized,
        ))
        return items[0] if items else None
    except Exception as e:
        logger.error(f"Error querying invite by email {scrub(email)}: {scrub(e)}")
        return None


def check_invite(email: str) -> bool:
    """Return True if the email has an active (non-promoted) invite in C1."""
    doc = get_invite_by_email(email)
    if not doc:
        return False
    return doc.get("status") != "promoted"


def invite_user(
    email: str,
    name: str = "",
    role: str = "student",
    institute: str = "",
    department: str = "",
) -> tuple:
    """
    Add an *invited* (allowlisted but not yet authenticated) user to
    invited_users_v1 (C1).  The document is partitioned by email.

    If the email already exists in C1, a new affiliation
    (institute+department+role) is appended.

    Returns (doc, is_new_user, affiliation_added).
    """
    get_cosmos_client()

    existing = get_invite_by_email(email)
    if existing:
        # Update name if provided and currently missing
        if name and not existing.get("name"):
            existing["name"] = name
            existing["updatedAt"] = datetime.utcnow().isoformat() + "Z"
            _invited_users_container.upsert_item(body=existing)
        # Try to add a new affiliation
        affiliations = existing.get("affiliations", [])
        if not affiliations and existing.get("institute"):
            affiliations.append({
                "institute": existing.get("institute", ""),
                "department": existing.get("department", ""),
                "role": existing.get("role", "student"),
            })
        new_aff = {"institute": institute, "department": department, "role": role}
        dup = any(
            a.get("institute") == institute and a.get("department") == department
            for a in affiliations
        )
        if dup:
            logger.info(f"invite_user: {scrub(email)} already has affiliation {scrub(institute)}/{scrub(department)}")
            return (existing, False, False)
        affiliations.append(new_aff)
        existing["affiliations"] = affiliations
        existing["updatedAt"] = datetime.utcnow().isoformat() + "Z"
        _invited_users_container.upsert_item(body=existing)
        logger.info(f"invite_user: appended affiliation {scrub(institute)}/{scrub(department)}/{scrub(role)} for {scrub(email)}")
        return (existing, False, True)

    # Also check users_v1 in case user already active — add affiliation there
    active = get_user_by_email(email)
    if active:
        affiliations = active.get("affiliations", [])
        if not affiliations and active.get("institute"):
            affiliations.append({
                "institute": active.get("institute", ""),
                "department": active.get("department", ""),
                "role": active.get("role", "student"),
            })
        new_aff = {"institute": institute, "department": department, "role": role}
        dup = any(
            a.get("institute") == institute and a.get("department") == department
            for a in affiliations
        )
        if dup:
            logger.info(f"invite_user: active {scrub(email)} already has affiliation {scrub(institute)}/{scrub(department)}")
            return (active, False, False)
        affiliations.append(new_aff)
        active["affiliations"] = affiliations
        active["updatedAt"] = datetime.utcnow().isoformat() + "Z"
        _users_container.upsert_item(body=active)
        logger.info(f"invite_user: appended affiliation {scrub(institute)}/{scrub(department)}/{scrub(role)} for active user {scrub(email)}")
        return (active, False, True)

    dir_id = f"dir-{uuid.uuid4().hex[:8]}"
    normalized_email = email.lower().strip()
    now = datetime.utcnow().isoformat() + "Z"

    doc = {
        "id": dir_id,
        "email": normalized_email,        # partition key
        "name": name,                     # display name (teacher real name / "student_name")
        "role": role,
        "status": "invited",
        "institute": institute,
        "department": department,
        "affiliations": [{"institute": institute, "department": department, "role": role}],
        "activeAffiliation": 0,
        "createdAt": now,
        "updatedAt": now,
    }
    _invited_users_container.upsert_item(body=doc)
    logger.info(f"Invited user {scrub(normalized_email)} as {scrub(role)} (id={scrub(dir_id)})")
    return (doc, True, False)


def list_directory_users(
    role: Optional[str] = None,
    status: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    List users from both containers, optionally filtered by role and/or status.
    - status="invited"  → only C1 (invited_users_v1, non-promoted)
    - status="active"   → only C2 (users_v1)
    - status=None       → both, merged
    """
    get_cosmos_client()
    results: List[Dict[str, Any]] = []

    # ── C1: invited_users_v1 ──
    if status in (None, "invited"):
        conditions = ["c.status != 'promoted'"]
        params: list = []
        if role:
            conditions.append("c.role = @role")
            params.append({"name": "@role", "value": role})
        where = " WHERE " + " AND ".join(conditions)
        query = f"SELECT * FROM c{where}"
        try:
            items = list(_invited_users_container.query_items(
                query=query, parameters=params, enable_cross_partition_query=True,
            ))
            # Normalise shape: C1 docs have no fullName/displayName/userId
            for it in items:
                it.setdefault("userId", it["id"])
                it.setdefault("fullName", it.get("name", ""))
                it.setdefault("displayName", it.get("name", ""))
                it.setdefault("status", "invited")
            results.extend(items)
        except Exception as e:
            logger.error(f"Error listing invited users: {e}")

    # ── C2: users_v1 ──
    if status in (None, "active"):
        conditions2 = []
        params2: list = []
        if role:
            conditions2.append("c.role = @role")
            params2.append({"name": "@role", "value": role})
        if status == "active":
            conditions2.append("c.status = 'active'")
        where2 = (" WHERE " + " AND ".join(conditions2)) if conditions2 else ""
        query2 = f"SELECT * FROM c{where2}"
        try:
            items2 = list(_users_container.query_items(
                query=query2, parameters=params2, enable_cross_partition_query=True,
            ))
            results.extend(items2)
        except Exception as e:
            logger.error(f"Error listing active users: {e}")

    return results


def promote_invited_user(
    email: str,
    oauth_user_id: str,
    auth_provider: str,
    display_name: str = "",
) -> Optional[Dict[str, Any]]:
    """
    When an invited user logs in for the first time via OAuth:
    1. Read their invite record from C1 (invited_users_v1).
    2. Create their profile in C2 (users_v1) with the real OAuth user ID.
    3. Mark the C1 record as status="promoted" (kept for audit).
    Status in C2 stays 'invited' until onboarding completes (then auto→active).
    """
    get_cosmos_client()

    # Check C2 first — user may already be active
    existing_active = get_user_by_email(email)
    if existing_active and existing_active.get("status") == "active":
        if auth_provider and existing_active.get("authProvider") in ("", "temp"):
            existing_active["authProvider"] = auth_provider
            existing_active["updatedAt"] = datetime.utcnow().isoformat() + "Z"
            _users_container.upsert_item(body=existing_active)
        return existing_active

    # Read invite from C1
    invite = get_invite_by_email(email)
    if not invite:
        return None

    now = datetime.utcnow().isoformat() + "Z"

    # Create profile in C2
    invited_role = invite.get("role", "student")
    # Privacy: don't persist student names in Cosmos DB
    stored_name = display_name if invited_role != "student" else "student_name"
    stored_nick = (display_name.split(" ")[0] if display_name else "") if invited_role != "student" else "student_name"
    new_doc = {
        "id": oauth_user_id,
        "userId": oauth_user_id,
        "fullName": stored_name,
        "displayName": stored_name,
        "nickname": stored_nick,
        "email": invite["email"],
        "role": invited_role,
        "status": "invited",  # stays "invited" until onboarding completes
        "onboardingCompleted": False,
        "institute": invite.get("institute", ""),
        "department": invite.get("department", ""),
        "affiliations": invite.get("affiliations", []),
        "activeAffiliation": invite.get("activeAffiliation", 0),
        "authProvider": auth_provider,
        "workFunction": "",
        "preferences": "",
        "customInstructions": "",
        "learningProfile": "",
        "college": invite.get("institute", ""),
        "createdAt": invite.get("createdAt", now),
        "updatedAt": now,
    }
    _users_container.upsert_item(body=new_doc)

    # Mark C1 record as promoted (keep for audit / department completion check)
    invite["status"] = "promoted"
    invite["promotedAt"] = now
    invite["oauthUserId"] = oauth_user_id
    _invited_users_container.upsert_item(body=invite)

    logger.info(f"Promoted invited user {email} → C2 (userId={oauth_user_id}), C1 marked promoted")
    return new_doc


def get_department_onboarding_progress(institute: str, department: str) -> Dict[str, Any]:
    """
    Compare C1 vs C2 counts for a given institute+department.
    Returns { invited: int, active: int, total: int, done: bool }.
    """
    get_cosmos_client()
    query = "SELECT VALUE COUNT(1) FROM c WHERE c.institute = @inst AND c.department = @dept"
    params: list = [
        {"name": "@inst", "value": institute},
        {"name": "@dept", "value": department},
    ]
    try:
        # C1 count (non-promoted invites)
        c1_query = "SELECT VALUE COUNT(1) FROM c WHERE c.institute = @inst AND c.department = @dept AND c.status != 'promoted'"
        c1_count = list(_invited_users_container.query_items(
            query=c1_query, parameters=params, enable_cross_partition_query=True,
        ))[0]
        # C2 active count
        c2_query = "SELECT VALUE COUNT(1) FROM c WHERE c.institute = @inst AND c.department = @dept AND c.status = 'active'"
        c2_count = list(_users_container.query_items(
            query=c2_query, parameters=params, enable_cross_partition_query=True,
        ))[0]
        total = c1_count + c2_count
        done = c1_count == 0 and c2_count > 0
        return {"invited": c1_count, "active": c2_count, "total": total, "done": done}
    except Exception as e:
        logger.error(f"Error getting onboarding progress: {e}")
        return {"invited": 0, "active": 0, "total": 0, "done": False}


def switch_active_affiliation(user_id: str, index: int) -> Optional[Dict[str, Any]]:
    """
    Switch the user's active affiliation by index.
    Updates the top-level institute/department/role to match the selected affiliation.
    Returns the updated profile or None if not found.
    """
    get_cosmos_client()

    profile = get_user_profile(user_id)
    if not profile:
        return None

    affiliations = profile.get("affiliations", [])
    if not affiliations or index < 0 or index >= len(affiliations):
        logger.warning(f"switch_active_affiliation: invalid index {scrub(index)} for user {scrub(user_id)} (has {scrub(len(affiliations))} affiliations)")
        return None

    aff = affiliations[index]
    profile["activeAffiliation"] = index
    profile["institute"] = aff.get("institute", "")
    profile["department"] = aff.get("department", "")
    profile["role"] = aff.get("role", profile.get("role", "student"))
    profile["college"] = aff.get("institute", "")  # legacy alias
    profile["updatedAt"] = datetime.utcnow().isoformat() + "Z"

    _users_container.upsert_item(body=profile)
    logger.info(f"Switched user {scrub(user_id)} to affiliation {scrub(index)}: {scrub(aff)}")
    return profile


def remove_directory_user(user_id: str) -> bool:
    """
    Remove a user from C2 (users_v1) or C1 (invited_users_v1).
    Tries C2 first; if not found, queries C1 by id and deletes there.
    Returns True if the user was deleted from either container.
    """
    # Try C2 first
    if delete_user_profile(user_id):
        return True

    # Fall back to C1: query by id (partition key is email, so cross-partition)
    get_cosmos_client()
    try:
        items = list(_invited_users_container.query_items(
            query="SELECT * FROM c WHERE c.id = @id",
            parameters=[{"name": "@id", "value": user_id}],
            enable_cross_partition_query=True,
        ))
        if items:
            doc = items[0]
            _invited_users_container.delete_item(
                item=doc["id"], partition_key=doc["email"],
            )
            logger.info(f"Deleted invite {scrub(user_id)} from invited_users_v1")
            return True
    except Exception as e:
        logger.error(f"Error deleting invite {scrub(user_id)} from C1: {scrub(e)}")
    return False


# ── Institution / Department bulk operations ──────────────────────────────

def rename_institute(old_name: str, new_name: str) -> int:
    """
    Rename an institution across both C1 and C2 user documents.
    Returns the number of documents updated.
    """
    get_cosmos_client()
    query = "SELECT * FROM c WHERE c.institute = @old"
    params: list = [{"name": "@old", "value": old_name}]
    count = 0
    try:
        # C2: users_v1
        items = list(_users_container.query_items(
            query=query, parameters=params, enable_cross_partition_query=True,
        ))
        for doc in items:
            doc["institute"] = new_name
            if "college" in doc:
                doc["college"] = new_name
            doc["updatedAt"] = datetime.utcnow().isoformat() + "Z"
            _users_container.upsert_item(body=doc)
            count += 1
        # C1: invited_users_v1
        items_c1 = list(_invited_users_container.query_items(
            query=query, parameters=params, enable_cross_partition_query=True,
        ))
        for doc in items_c1:
            doc["institute"] = new_name
            doc["updatedAt"] = datetime.utcnow().isoformat() + "Z"
            _invited_users_container.upsert_item(body=doc)
            count += 1
        logger.info(f"Renamed institute '{scrub(old_name)}' -> '{scrub(new_name)}' for {scrub(count)} docs")
        return count
    except Exception as e:
        logger.error(f"Error renaming institute: {e}")
        raise


def delete_institute(name: str) -> int:
    """
    Clear the institute (and department) field on all users belonging to this
    institution across both C1 and C2.  Returns the number of docs updated.
    """
    get_cosmos_client()
    query = "SELECT * FROM c WHERE c.institute = @name"
    params: list = [{"name": "@name", "value": name}]
    count = 0
    try:
        # C2
        items = list(_users_container.query_items(
            query=query, parameters=params, enable_cross_partition_query=True,
        ))
        for doc in items:
            doc["institute"] = ""
            doc["department"] = ""
            if "college" in doc:
                doc["college"] = ""
            doc["updatedAt"] = datetime.utcnow().isoformat() + "Z"
            _users_container.upsert_item(body=doc)
            count += 1
        # C1
        items_c1 = list(_invited_users_container.query_items(
            query=query, parameters=params, enable_cross_partition_query=True,
        ))
        for doc in items_c1:
            doc["institute"] = ""
            doc["department"] = ""
            doc["updatedAt"] = datetime.utcnow().isoformat() + "Z"
            _invited_users_container.upsert_item(body=doc)
            count += 1
        logger.info(f"Deleted institute '{scrub(name)}', cleared {scrub(count)} docs")
        return count
    except Exception as e:
        logger.error(f"Error deleting institute: {e}")
        raise


def rename_department(institute: str, old_name: str, new_name: str) -> int:
    """
    Rename a department within an institute across both C1 and C2.
    Returns the number of docs updated.
    """
    get_cosmos_client()
    query = "SELECT * FROM c WHERE c.institute = @inst AND c.department = @old"
    params: list = [
        {"name": "@inst", "value": institute},
        {"name": "@old", "value": old_name},
    ]
    count = 0
    try:
        # C2
        for doc in list(_users_container.query_items(query=query, parameters=params, enable_cross_partition_query=True)):
            doc["department"] = new_name
            doc["updatedAt"] = datetime.utcnow().isoformat() + "Z"
            _users_container.upsert_item(body=doc)
            count += 1
        # C1
        for doc in list(_invited_users_container.query_items(query=query, parameters=params, enable_cross_partition_query=True)):
            doc["department"] = new_name
            doc["updatedAt"] = datetime.utcnow().isoformat() + "Z"
            _invited_users_container.upsert_item(body=doc)
            count += 1
        logger.info(f"Renamed department '{scrub(old_name)}' -> '{scrub(new_name)}' under '{scrub(institute)}' for {scrub(count)} docs")
        return count
    except Exception as e:
        logger.error(f"Error renaming department: {e}")
        raise


def delete_department(institute: str, department: str) -> int:
    """
    Clear the department field across both C1 and C2.
    Returns the number of docs updated.
    """
    get_cosmos_client()
    query = "SELECT * FROM c WHERE c.institute = @inst AND c.department = @dept"
    params: list = [
        {"name": "@inst", "value": institute},
        {"name": "@dept", "value": department},
    ]
    count = 0
    try:
        # C2
        for doc in list(_users_container.query_items(query=query, parameters=params, enable_cross_partition_query=True)):
            doc["department"] = ""
            doc["updatedAt"] = datetime.utcnow().isoformat() + "Z"
            _users_container.upsert_item(body=doc)
            count += 1
        # C1
        for doc in list(_invited_users_container.query_items(query=query, parameters=params, enable_cross_partition_query=True)):
            doc["department"] = ""
            doc["updatedAt"] = datetime.utcnow().isoformat() + "Z"
            _invited_users_container.upsert_item(body=doc)
            count += 1
        logger.info(f"Deleted department '{department}' under '{institute}', cleared {count} docs")
        return count
    except Exception as e:
        logger.error(f"Error deleting department: {e}")
        raise


# ============================================================================
# Agent Metadata Operations
# ============================================================================

def create_agent_metadata(
    agent_id: str,
    name: str,
    created_by: str,
    created_by_name: str = "",
    description: str = "",
    model: str = "",
    course_name: str = "",
    course_code: str = "",
    course_level: str = "",
    course_duration: str = "",
    agent_kind: str = "learning",
    conversation_starters: Optional[List] = None,
    additional_context: str = "",
    agent_image_url: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    session_uuid: Optional[str] = None,
    manage_code: Optional[str] = None,
    department_id: str = "",
) -> Dict[str, Any]:
    """
    Create agent metadata in Cosmos DB.
    
    Args:
        agent_id: The Azure AI Foundry agent ID
        name: Agent display name
        created_by: Creator userId (NOT username - for normalized design)
        description: Agent description
        model: Model deployment name
        course_name: Course name (for educational agents)
        course_code: Course code (e.g., CS101)
        course_level: Course level (beginner/intermediate/advanced)
        course_duration: Course duration
        agent_kind: Type of agent (learning/exam/course)
        conversation_starters: List of conversation starters [{title, prompt}] or legacy [str]
        additional_context: Any additional context
        agent_image_url: URL to agent profile image in blob storage
        metadata: Additional metadata dictionary
    """
    agent_doc = {
        "id": agent_id,
        "agentId": agent_id,  # Partition key
        "name": name,
        "createdById": created_by,  # Store userId, not username (normalized design)
        "createdByName": created_by_name,  # Creator display name (for quick lookup)
        "description": description,
        "model": model,
        "courseName": course_name,
        "courseCode": course_code,
        "courseLevel": course_level,
        "courseDuration": course_duration,
        "agentKind": agent_kind,
        "conversationStarters": conversation_starters or [],
        "additionalContext": additional_context,
        "agentImageUrl": agent_image_url,  # Blob storage URL for agent profile image
        "metadata": metadata or {},
        "sessionUuid": session_uuid,  # Session UUID for knowledge base context retrieval
        "manageCode": manage_code or _generate_manage_code(),  # 6-char code for teacher edit/delete access
        "departmentId": department_id,  # Department this agent belongs to
        "teacherIds": [created_by] if created_by else [],  # Creator is auto-added as teacher
        "studentIds": [],
        "status": "active",
        "createdAt": datetime.utcnow().isoformat() + "Z",
        "updatedAt": datetime.utcnow().isoformat() + "Z",
    }
    
    container = _get_agents_container()
    container.create_item(body=agent_doc)
    logger.info(f"Created agent metadata for {scrub(agent_id)} ({scrub(name)})")
    return agent_doc


def _generate_manage_code(length: int = 6) -> str:
    """Generate a random 6-character alphanumeric manage code."""
    alphabet = string.ascii_uppercase + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(length))


def verify_agent_manage_code(agent_id: str, code: str) -> bool:
    """Verify a manage code against the stored code for an agent."""
    agent = get_agent_metadata(agent_id)
    if not agent:
        return False
    stored_code = agent.get("manageCode", "")
    return secrets.compare_digest(stored_code, code.upper())


def get_agent_manage_code(agent_id: str) -> Optional[str]:
    """Get the manage code for an agent (only for creator/admin use)."""
    agent = get_agent_metadata(agent_id)
    if not agent:
        return None
    return agent.get("manageCode")


def find_agent_by_manage_code(code: str) -> Optional[Dict[str, Any]]:
    """Find an agent by its manage code. Returns agent metadata or None."""
    container = _get_agents_container()
    code_upper = code.upper()
    try:
        items = list(container.query_items(
            query="SELECT * FROM c WHERE c.manageCode = @code",
            parameters=[{"name": "@code", "value": code_upper}],
            enable_cross_partition_query=True,
            max_item_count=1,
        ))
        return items[0] if items else None
    except Exception as e:
        logger.error(f"Error finding agent by manage code: {e}")
        return None


def get_agent_metadata(agent_id: str) -> Optional[Dict[str, Any]]:
    """Get agent metadata by ID."""
    container = _get_agents_container()
    
    try:
        agent = container.read_item(item=agent_id, partition_key=agent_id)
        return agent
    except CosmosResourceNotFoundError:
        return None
    except Exception as e:
        logger.error(f"Error getting agent metadata {scrub(agent_id)}: {scrub(e)}")
        return None


def update_agent_metadata(
    agent_id: str,
    name: Optional[str] = None,
    description: Optional[str] = None,
    conversation_starters: Optional[List] = None,
    additional_context: Optional[str] = None,
    agent_image_url: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """Update agent metadata."""
    existing = get_agent_metadata(agent_id)
    if not existing:
        logger.warning(f"Agent {scrub(agent_id)} not found for update")
        return None
    
    # Update only provided fields
    if name is not None:
        existing["name"] = name
    if description is not None:
        existing["description"] = description
    if conversation_starters is not None:
        existing["conversationStarters"] = conversation_starters
    if additional_context is not None:
        existing["additionalContext"] = additional_context
    if agent_image_url is not None:
        existing["agentImageUrl"] = agent_image_url
    if metadata is not None:
        existing["metadata"] = {**existing.get("metadata", {}), **metadata}
    
    existing["updatedAt"] = datetime.utcnow().isoformat() + "Z"
    
    container = _get_agents_container()
    container.upsert_item(body=existing)
    logger.info(f"Updated agent metadata for {scrub(agent_id)}")
    return existing


def delete_agent_metadata(agent_id: str) -> bool:
    """Delete agent metadata from Cosmos DB."""
    container = _get_agents_container()
    
    try:
        container.delete_item(item=agent_id, partition_key=agent_id)
        # Clean up course curriculum blob + cache
        try:
            delete_course_curriculum(agent_id)
        except Exception:
            pass
        logger.info(f"Deleted agent metadata {scrub(agent_id)}")
        return True
    except CosmosResourceNotFoundError:
        logger.warning(f"Agent metadata {scrub(agent_id)} not found for deletion")
        return False
    except Exception as e:
        logger.error(f"Error deleting agent metadata {scrub(agent_id)}: {scrub(e)}")
        return False


# ============================================================================
# Course Curriculum Operations
# - Full JSON stored in Azure Blob Storage
# - Blob URL reference stored on agent metadata document in Cosmos DB
# - In-memory cache for fast access during chat sessions
# ============================================================================

# In-memory cache: agent_id -> course curriculum dict
try:
    _COURSE_CURRICULUM_CACHE_MAX_ENTRIES = max(
        1,
        int(os.getenv("COURSE_CURRICULUM_CACHE_MAX_ENTRIES", "64")),
    )
except ValueError:
    _COURSE_CURRICULUM_CACHE_MAX_ENTRIES = 64

_course_curriculum_cache: OrderedDict[str, Dict[str, Any]] = OrderedDict()
_course_curriculum_cache_lock = threading.RLock()
_course_curriculum_load_locks: Dict[str, threading.Lock] = {}
_course_curriculum_blob_service = None
_course_curriculum_blob_service_lock = threading.Lock()


def _get_course_curriculum_load_lock(agent_id: str) -> threading.Lock:
    with _course_curriculum_cache_lock:
        return _course_curriculum_load_locks.setdefault(agent_id, threading.Lock())


def _get_cached_course_curriculum(agent_id: str) -> Optional[Dict[str, Any]]:
    with _course_curriculum_cache_lock:
        curriculum = _course_curriculum_cache.get(agent_id)
        if curriculum is not None:
            _course_curriculum_cache.move_to_end(agent_id)
        return curriculum


def _cache_course_curriculum(agent_id: str, curriculum: Dict[str, Any]) -> None:
    with _course_curriculum_cache_lock:
        _course_curriculum_cache[agent_id] = curriculum
        _course_curriculum_cache.move_to_end(agent_id)
        while len(_course_curriculum_cache) > _COURSE_CURRICULUM_CACHE_MAX_ENTRIES:
            _course_curriculum_cache.popitem(last=False)


def _curriculum_is_complete(curriculum: Optional[Dict[str, Any]]) -> bool:
    """False while threshold-concept generation is still running."""
    if not curriculum:
        return False
    if curriculum.get("_status") == "syllabus_ready":
        return False
    return bool(curriculum.get("all_threshold_concepts"))

# Blob storage config
_COURSE_CURRICULUM_STORAGE_ACCOUNT = os.environ["STORAGE_ACCOUNT_NAME"]
_COURSE_CURRICULUM_CONTAINER = "course-curriculum-v2"


def _get_blob_service_client():
    """Get the process-wide BlobServiceClient for course curriculum storage."""
    global _course_curriculum_blob_service

    if _course_curriculum_blob_service is not None:
        return _course_curriculum_blob_service

    from azure.storage.blob import BlobServiceClient

    with _course_curriculum_blob_service_lock:
        if _course_curriculum_blob_service is None:
            try:
                from common_azure_auth import get_sync_credential
                credential = get_sync_credential()
            except ImportError:
                from azure.identity import DefaultAzureCredential
                credential = DefaultAzureCredential()
            account_url = f"https://{_COURSE_CURRICULUM_STORAGE_ACCOUNT}.blob.core.windows.net"
            _course_curriculum_blob_service = BlobServiceClient(
                account_url=account_url,
                credential=credential,
            )

    return _course_curriculum_blob_service


def _ensure_course_curriculum_container():
    """Ensure the course-curriculum blob container exists."""
    try:
        blob_service = _get_blob_service_client()
        container_client = blob_service.get_container_client(_COURSE_CURRICULUM_CONTAINER)
        if not container_client.exists():
            container_client.create_container()
            logger.info(f"Created blob container: {_COURSE_CURRICULUM_CONTAINER}")
    except Exception as e:
        logger.warning(f"Could not ensure course curriculum container: {e}")


def save_course_curriculum(agent_id: str, course_curriculum: Dict[str, Any]) -> bool:
    """
    Save a course curriculum:
    1. Upload full JSON to Azure Blob Storage
    2. Store blob URL reference on agent metadata in Cosmos DB
    3. Update in-memory cache

    Args:
        agent_id: The agent ID
        course_curriculum: The full course curriculum dict (syllabus, threshold_concepts, etc.)

    Returns:
        True if saved successfully
    """
    curriculum_json = json.dumps(course_curriculum, indent=2, ensure_ascii=False)
    curriculum_size = len(curriculum_json)
    blob_name = f"{agent_id}/course_curriculum.json"

    # Step 1: Upload to Blob Storage
    try:
        from azure.storage.blob import ContentSettings
        _ensure_course_curriculum_container()
        blob_service = _get_blob_service_client()
        blob_client = blob_service.get_blob_client(container=_COURSE_CURRICULUM_CONTAINER, blob=blob_name)
        blob_client.upload_blob(curriculum_json.encode("utf-8"), overwrite=True, content_settings=ContentSettings(content_type="application/json"))
        blob_url = f"https://{_COURSE_CURRICULUM_STORAGE_ACCOUNT}.blob.core.windows.net/{_COURSE_CURRICULUM_CONTAINER}/{blob_name}"
        logger.info(f"Uploaded course curriculum for '{scrub(agent_id)}' to blob ({scrub(curriculum_size)} chars)")
    except Exception as e:
        logger.error(f"Failed to upload course curriculum to blob for '{scrub(agent_id)}': {scrub(e)}")
        return False

    # Step 2: Store reference in Cosmos DB agent metadata
    try:
        container = _get_agents_container()
        agent = container.read_item(item=agent_id, partition_key=agent_id)
        agent["courseCurriculumBlobUrl"] = blob_url
        agent["courseCurriculumUpdatedAt"] = datetime.utcnow().isoformat() + "Z"
        agent["updatedAt"] = datetime.utcnow().isoformat() + "Z"
        container.upsert_item(body=agent)
        logger.info(f"Saved course curriculum blob reference for '{scrub(agent_id)}' to Cosmos DB")
    except Exception as e:
        logger.warning(f"Failed to save blob reference to Cosmos DB for '{scrub(agent_id)}': {scrub(e)}")
        # Blob is still saved — reference can be reconstructed from convention

    # Step 3: Update cache (partial saves stay uncached so later reads see the finished version)
    with _course_curriculum_cache_lock:
        if _curriculum_is_complete(course_curriculum):
            _cache_course_curriculum(agent_id, course_curriculum)
            logger.info(f"Course curriculum for '{scrub(agent_id)}' saved to blob + cached ({scrub(curriculum_size)} chars)")
        else:
            _course_curriculum_cache.pop(agent_id, None)
            logger.info(f"Course curriculum for '{scrub(agent_id)}' saved to blob, not cached — still generating ({scrub(curriculum_size)} chars)")
    return True


def save_course_curriculum_version(agent_id: str, course_curriculum: Dict[str, Any], commit_message: str, user_id: str = "unknown") -> Optional[str]:
    """
    Commit a new version of the course curriculum to the agent's git repo
    (bare repo stored as tarball in Azure Blob Storage).
    Returns the commit SHA as version_id, or None on failure.
    """
    from azure_services.persistence.curriculum_git import save_course_curriculum_version as _git_save
    return _git_save(agent_id, course_curriculum, commit_message, user_id)


def list_course_curriculum_versions(agent_id: str) -> list:
    """
    List all git commits (versions) of the course curriculum.
    Returns list of version metadata dicts sorted newest first.
    """
    from azure_services.persistence.curriculum_git import list_course_curriculum_versions as _git_list
    return _git_list(agent_id)


def get_course_curriculum_version(agent_id: str, version_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve the course curriculum at a specific git commit."""
    from azure_services.persistence.curriculum_git import get_course_curriculum_version as _git_get
    return _git_get(agent_id, version_id)


def _legacy_get_course_curriculum_version(agent_id: str, version_id: str) -> Optional[Dict[str, Any]]:
    """Legacy: retrieve from old blob-per-version storage (for migration)."""
    try:
        blob_name = f"{agent_id}/versions/{version_id}.json"
        blob_service = _get_blob_service_client()
        blob_client = blob_service.get_blob_client(container=_COURSE_CURRICULUM_CONTAINER, blob=blob_name)
        data = json.loads(blob_client.download_blob().readall().decode("utf-8"))
        return data
    except Exception as e:
        logger.error(f"Failed to get curriculum version '{scrub(version_id)}' for '{scrub(agent_id)}': {scrub(e)}")
        return None


def get_course_curriculum(agent_id: str) -> Optional[Dict[str, Any]]:
    """
    Get a course curriculum: cache -> blob storage -> None.

    Args:
        agent_id: The agent ID

    Returns:
        The course curriculum dict, or None if not found
    """
    cached = _get_cached_course_curriculum(agent_id)
    if cached is not None:
        logger.debug(f"Course curriculum cache HIT for '{scrub(agent_id)}'")
        return cached

    # Only callers for the same course wait; unrelated curricula still load in parallel.
    with _get_course_curriculum_load_lock(agent_id):
        cached = _get_cached_course_curriculum(agent_id)
        if cached is not None:
            logger.debug(f"Course curriculum cache HIT for '{scrub(agent_id)}'")
            return cached
        return _load_course_curriculum_uncached(agent_id)


def _load_course_curriculum_uncached(agent_id: str) -> Optional[Dict[str, Any]]:
    """Load one curriculum from Blob Storage after the caller wins single-flight."""

    # Cache miss — download from Blob Storage
    blob_name = f"{agent_id}/course_curriculum.json"
    try:
        blob_service = _get_blob_service_client()
        blob_client = blob_service.get_blob_client(container=_COURSE_CURRICULUM_CONTAINER, blob=blob_name)
        download = blob_client.download_blob()
        curriculum_json = download.readall().decode("utf-8")
        curriculum = json.loads(curriculum_json)
        # Only cache finished curricula: generation may complete in another
        # process, and a cached partial would otherwise never refresh.
        if _curriculum_is_complete(curriculum):
            _cache_course_curriculum(agent_id, curriculum)
            logger.info(f"Course curriculum cache MISS for '{scrub(agent_id)}' — loaded from blob and cached ({scrub(len(curriculum_json))} chars)")
        else:
            logger.info(f"Course curriculum for '{scrub(agent_id)}' still generating — loaded from blob, not cached")
        return curriculum
    except ResourceNotFoundError:
        pass
    except Exception as e:
        # A read failure (for example missing Storage Blob Data Reader) is not the
        # same as an absent curriculum; surface it instead of reporting an empty plan.
        logger.error(f"Could not read course curriculum for '{scrub(agent_id)}': {scrub(type(e).__name__)}: {scrub(e)}")
        return None

    # Migration fallback: check old "learning-plans" container with old blob name
    old_blob_name = f"{agent_id}/learning_plan.json"
    try:
        blob_service = _get_blob_service_client()
        blob_client = blob_service.get_blob_client(container="learning-plans", blob=old_blob_name)
        download = blob_client.download_blob()
        curriculum_json = download.readall().decode("utf-8")
        curriculum = json.loads(curriculum_json)
        logger.info(f"Found curriculum in old 'learning-plans' container for '{scrub(agent_id)}' — migrating to new container")
        # Migrate to new container
        try:
            save_course_curriculum(agent_id, curriculum)
            logger.info(f"Migrated curriculum for '{scrub(agent_id)}' from learning-plans → course-curriculum")
        except Exception as me:
            logger.warning(f"Migration save failed for '{scrub(agent_id)}': {scrub(me)}")
            _cache_course_curriculum(agent_id, curriculum)
        return curriculum
    except Exception:
        pass

    logger.debug(f"No course curriculum found in any blob container for '{scrub(agent_id)}'")
    return None


def delete_course_curriculum(agent_id: str) -> bool:
    """
    Delete a course curriculum from blob storage and remove Cosmos reference.

    Args:
        agent_id: The agent ID

    Returns:
        True if deleted successfully
    """
    blob_name = f"{agent_id}/course_curriculum.json"
    try:
        blob_service = _get_blob_service_client()
        blob_client = blob_service.get_blob_client(container=_COURSE_CURRICULUM_CONTAINER, blob=blob_name)
        blob_client.delete_blob()
        logger.info(f"Deleted course curriculum blob for '{scrub(agent_id)}'")
    except Exception as e:
        logger.warning(f"Could not delete course curriculum blob for '{scrub(agent_id)}': {scrub(e)}")

    # Remove reference from Cosmos DB
    try:
        container = _get_agents_container()
        agent = container.read_item(item=agent_id, partition_key=agent_id)
        agent.pop("courseCurriculumBlobUrl", None)
        agent.pop("courseCurriculumUpdatedAt", None)
        agent["updatedAt"] = datetime.utcnow().isoformat() + "Z"
        container.upsert_item(body=agent)
    except Exception:
        pass

    invalidate_course_curriculum_cache(agent_id)
    return True


def invalidate_course_curriculum_cache(agent_id: Optional[str] = None):
    """
    Invalidate course curriculum cache for a specific agent, or all agents.

    Args:
        agent_id: If provided, invalidate only this agent. Otherwise clear all.
    """
    if agent_id:
        with _course_curriculum_cache_lock:
            _course_curriculum_cache.pop(agent_id, None)
        logger.debug(f"Invalidated course curriculum cache for '{scrub(agent_id)}'")
    else:
        with _course_curriculum_cache_lock:
            _course_curriculum_cache.clear()
        logger.debug("Invalidated all course curriculum caches")


# ============================================================================
# Institute / Department Research Operations
# - Full JSON stored in Azure Blob Storage (same account as course curriculum)
# - In-memory cache for fast access
# - Status tracking: researching → completed / failed
# - Separate from textbook research — triggered via Deep Research buttons
# ============================================================================

_INST_RESEARCH_CONTAINER = "institute-research-v2"

# In-memory caches
_institute_research_cache: Dict[str, Dict[str, Any]] = {}
_department_research_cache: Dict[str, Dict[str, Any]] = {}


def _sanitize_blob_key(name: str) -> str:
    """Sanitize a name for use as a blob path segment."""
    import re
    return re.sub(r'[^a-zA-Z0-9_-]', '_', name.strip().lower())


def _ensure_inst_research_container():
    """Ensure the institute-research blob container exists."""
    try:
        blob_service = _get_blob_service_client()
        container_client = blob_service.get_container_client(_INST_RESEARCH_CONTAINER)
        if not container_client.exists():
            container_client.create_container()
            logger.info(f"Created blob container: {_INST_RESEARCH_CONTAINER}")
    except Exception as e:
        logger.warning(f"Could not ensure institute research container: {e}")


def save_institute_research(institute_name: str, data: Dict[str, Any]) -> bool:
    """
    Save institute research results to blob storage + cache.

    Args:
        institute_name: The institute name
        data: The research data dict (must include 'status' key: researching/completed/failed)

    Returns:
        True if saved successfully
    """
    key = _sanitize_blob_key(institute_name)
    blob_name = f"institutes/{key}.json"
    data_json = json.dumps(data, indent=2, ensure_ascii=False)

    try:
        from azure.storage.blob import ContentSettings
        _ensure_inst_research_container()
        blob_service = _get_blob_service_client()
        blob_client = blob_service.get_blob_client(container=_INST_RESEARCH_CONTAINER, blob=blob_name)
        blob_client.upload_blob(
            data_json.encode("utf-8"), overwrite=True,
            content_settings=ContentSettings(content_type="application/json"),
        )
        _institute_research_cache[key] = data
        logger.info(f"Saved institute research for '{institute_name}' ({len(data_json)} chars, status={data.get('status')})")
        return True
    except Exception as e:
        logger.error(f"Failed to save institute research for '{institute_name}': {e}")
        return False


def get_institute_research(institute_name: str) -> Optional[Dict[str, Any]]:
    """
    Get institute research: cache → blob storage → None.

    Args:
        institute_name: The institute name

    Returns:
        The research data dict (includes 'status' key), or None if not found
    """
    key = _sanitize_blob_key(institute_name)
    if key in _institute_research_cache:
        return _institute_research_cache[key]

    blob_name = f"institutes/{key}.json"
    try:
        blob_service = _get_blob_service_client()
        blob_client = blob_service.get_blob_client(container=_INST_RESEARCH_CONTAINER, blob=blob_name)
        download = blob_client.download_blob()
        data = json.loads(download.readall().decode("utf-8"))
        _institute_research_cache[key] = data
        logger.info(f"Loaded institute research for '{scrub(institute_name)}' from blob (status={scrub(data.get('status'))})")
        return data
    except Exception:
        return None


def delete_institute_research(institute_name: str) -> bool:
    """Delete institute research from blob + cache."""
    key = _sanitize_blob_key(institute_name)
    blob_name = f"institutes/{key}.json"
    try:
        blob_service = _get_blob_service_client()
        blob_client = blob_service.get_blob_client(container=_INST_RESEARCH_CONTAINER, blob=blob_name)
        blob_client.delete_blob()
    except Exception:
        pass
    _institute_research_cache.pop(key, None)
    logger.info(f"Deleted institute research for '{institute_name}'")
    return True


def save_department_research(institute_name: str, department_name: str, data: Dict[str, Any]) -> bool:
    """
    Save department research results to blob storage + cache.

    Args:
        institute_name: The institute name
        department_name: The department name
        data: The research data dict (must include 'status' key)

    Returns:
        True if saved successfully
    """
    inst_key = _sanitize_blob_key(institute_name)
    dept_key = _sanitize_blob_key(department_name)
    cache_key = f"{inst_key}/{dept_key}"
    blob_name = f"departments/{inst_key}/{dept_key}.json"
    data_json = json.dumps(data, indent=2, ensure_ascii=False)

    try:
        from azure.storage.blob import ContentSettings
        _ensure_inst_research_container()
        blob_service = _get_blob_service_client()
        blob_client = blob_service.get_blob_client(container=_INST_RESEARCH_CONTAINER, blob=blob_name)
        blob_client.upload_blob(
            data_json.encode("utf-8"), overwrite=True,
            content_settings=ContentSettings(content_type="application/json"),
        )
        _department_research_cache[cache_key] = data
        logger.info(f"Saved department research for '{department_name}@{institute_name}' ({len(data_json)} chars, status={data.get('status')})")
        return True
    except Exception as e:
        logger.error(f"Failed to save department research for '{department_name}@{institute_name}': {e}")
        return False


def get_department_research(institute_name: str, department_name: str) -> Optional[Dict[str, Any]]:
    """
    Get department research: cache → blob storage → None.

    Args:
        institute_name: The institute name
        department_name: The department name

    Returns:
        The research data dict (includes 'status' key), or None if not found
    """
    inst_key = _sanitize_blob_key(institute_name)
    dept_key = _sanitize_blob_key(department_name)
    cache_key = f"{inst_key}/{dept_key}"

    if cache_key in _department_research_cache:
        return _department_research_cache[cache_key]

    blob_name = f"departments/{inst_key}/{dept_key}.json"
    try:
        blob_service = _get_blob_service_client()
        blob_client = blob_service.get_blob_client(container=_INST_RESEARCH_CONTAINER, blob=blob_name)
        download = blob_client.download_blob()
        data = json.loads(download.readall().decode("utf-8"))
        _department_research_cache[cache_key] = data
        logger.info(f"Loaded department research for '{scrub(department_name)}@{scrub(institute_name)}' from blob (status={scrub(data.get('status'))})")
        return data
    except Exception:
        return None


def delete_department_research(institute_name: str, department_name: str) -> bool:
    """Delete department research from blob + cache."""
    inst_key = _sanitize_blob_key(institute_name)
    dept_key = _sanitize_blob_key(department_name)
    cache_key = f"{inst_key}/{dept_key}"
    blob_name = f"departments/{inst_key}/{dept_key}.json"
    try:
        blob_service = _get_blob_service_client()
        blob_client = blob_service.get_blob_client(container=_INST_RESEARCH_CONTAINER, blob=blob_name)
        blob_client.delete_blob()
    except Exception:
        pass
    _department_research_cache.pop(cache_key, None)
    logger.info(f"Deleted department research for '{department_name}@{institute_name}'")
    return True


def list_all_institute_research() -> List[Dict[str, Any]]:
    """List all institute research results (name + status only, not full data)."""
    results = []
    try:
        blob_service = _get_blob_service_client()
        container_client = blob_service.get_container_client(_INST_RESEARCH_CONTAINER)
        for blob in container_client.list_blobs(name_starts_with="institutes/"):
            try:
                blob_client = container_client.get_blob_client(blob.name)
                download = blob_client.download_blob()
                data = json.loads(download.readall().decode("utf-8"))
                results.append({
                    "name": data.get("institute_name", blob.name),
                    "status": data.get("status", "unknown"),
                    "research_type": "institute",
                })
            except Exception:
                continue
    except Exception as e:
        logger.warning(f"Could not list institute research: {e}")
    return results


# ============================================================================
# Agent Setup Storage (Blob Storage)
# - Stores setup.json in Azure Blob Storage instead of local filesystem
# - Container: agent-setups, Blob: {agent_id}/setup.json
# ============================================================================

_AGENT_SETUPS_CONTAINER = "agent-setups-v2"


def _ensure_agent_setups_container():
    """Ensure the agent-setups blob container exists."""
    try:
        blob_service = _get_blob_service_client()
        container_client = blob_service.get_container_client(_AGENT_SETUPS_CONTAINER)
        if not container_client.exists():
            container_client.create_container()
            logger.info(f"Created blob container: {_AGENT_SETUPS_CONTAINER}")
    except Exception as e:
        logger.warning(f"Could not ensure agent setups container: {e}")


def save_agent_setup(agent_id: str, setup_data: Dict[str, Any]) -> bool:
    """Save agent setup.json to blob storage."""
    blob_name = f"{agent_id}/setup.json"
    data_json = json.dumps(setup_data, indent=2, ensure_ascii=False)
    try:
        from azure.storage.blob import ContentSettings
        _ensure_agent_setups_container()
        blob_service = _get_blob_service_client()
        blob_client = blob_service.get_blob_client(container=_AGENT_SETUPS_CONTAINER, blob=blob_name)
        blob_client.upload_blob(
            data_json.encode("utf-8"), overwrite=True,
            content_settings=ContentSettings(content_type="application/json"),
        )
        logger.info(f"Saved agent setup for '{scrub(agent_id)}' to blob storage ({scrub(len(data_json))} chars)")
        return True
    except Exception as e:
        logger.error(f"Failed to save agent setup for '{scrub(agent_id)}': {scrub(e)}")
        return False


def load_agent_setup(agent_id: str) -> Optional[Dict[str, Any]]:
    """Load agent setup.json from blob storage. Returns None if not found."""
    blob_name = f"{agent_id}/setup.json"
    try:
        blob_service = _get_blob_service_client()
        blob_client = blob_service.get_blob_client(container=_AGENT_SETUPS_CONTAINER, blob=blob_name)
        download = blob_client.download_blob()
        data = json.loads(download.readall().decode("utf-8"))
        logger.info(f"Loaded agent setup for '{scrub(agent_id)}' from blob storage")
        return data
    except Exception:
        return None


def delete_agent_setup(agent_id: str) -> bool:
    """Delete agent setup.json from blob storage."""
    blob_name = f"{agent_id}/setup.json"
    try:
        blob_service = _get_blob_service_client()
        blob_client = blob_service.get_blob_client(container=_AGENT_SETUPS_CONTAINER, blob=blob_name)
        blob_client.delete_blob()
        logger.info(f"Deleted agent setup for '{agent_id}' from blob storage")
        return True
    except Exception:
        return False


# ============================================================================
# Learning State Operations
# - Active Context (topic map with latest_summary) stored in Cosmos DB
# - Tracks per-topic status, summaries, and overall progress
# - In-memory cache for fast access during chat sessions
# - Stored in dedicated learning_states_v1 container (partitioned by userId)
# ============================================================================

# In-memory cache: "{user_id}_{agent_id}" -> learning state dict
_learning_state_cache: Dict[str, Dict[str, Any]] = {}


def _get_learning_states_container():
    """Get learning states container, initializing the client if needed."""
    get_cosmos_client()
    return _learning_states_container


def _learning_state_key(user_id: str, agent_id: str) -> str:
    """Build the cache key / document ID for a learning state."""
    return f"{user_id}_{agent_id}_state"


def get_learning_state(user_id: str, agent_id: str) -> Optional[Dict[str, Any]]:
    """
    Get the learning state for a user+agent pair.
    Checks in-memory cache first, then Cosmos DB.

    Args:
        user_id: The user ID
        agent_id: The agent ID

    Returns:
        The learning state dict, or None if not found
    """
    key = _learning_state_key(user_id, agent_id)

    # Check cache
    if key in _learning_state_cache:
        logger.debug(f"Learning state cache HIT for '{scrub(key)}'")
        return _learning_state_cache[key]

    # Cache miss — read from Cosmos DB (learning_states container, partitioned by userId)
    try:
        container = _get_learning_states_container()
        doc = container.read_item(item=key, partition_key=user_id)
        _learning_state_cache[key] = doc
        logger.info(f"Learning state cache MISS for '{scrub(key)}' — loaded from Cosmos")
        return doc
    except CosmosResourceNotFoundError:
        logger.debug(f"No learning state found for '{scrub(key)}'")
        return None
    except Exception as e:
        logger.error(f"Error reading learning state for '{scrub(key)}': {scrub(e)}")
        return None


def save_learning_state(user_id: str, agent_id: str, state: Dict[str, Any]) -> bool:
    """
    Save/update a learning state document to Cosmos DB and update cache.

    Args:
        user_id: The user ID
        agent_id: The agent ID
        state: The full learning state dict

    Returns:
        True if saved successfully
    """
    key = _learning_state_key(user_id, agent_id)
    state["id"] = key
    state["partitionKey"] = user_id
    state["type"] = "learning_state"
    state["agent_id"] = agent_id
    state["updatedAt"] = datetime.utcnow().isoformat() + "Z"

    try:
        container = _get_learning_states_container()
        container.upsert_item(body=state)
        _learning_state_cache[key] = state
        logger.info(f"Saved learning state for '{scrub(key)}'")
        return True
    except Exception as e:
        logger.error(f"Failed to save learning state for '{scrub(key)}': {scrub(e)}")
        return False


def init_learning_state(user_id: str, agent_id: str, course_curriculum: Dict[str, Any]) -> Dict[str, Any]:
    """
    Initialize the learning state from a full course curriculum.
    Extracts every topic from every module, every objective, and every
    threshold concept, creating a flat topic map with all items set to not_started.

    Args:
        user_id: The user ID
        agent_id: The agent ID
        course_curriculum: The full course curriculum dict (from blob storage)

    Returns:
        The initialized learning state dict
    """
    now = datetime.utcnow().isoformat() + "Z"
    topics = {}

    # Walk every module, extract every topic
    for module in course_curriculum.get("syllabus", []):
        module_title = module.get("title") or module.get("module") or module.get("name") or "Unknown"
        for topic in module.get("topics", []):
            topic_name = topic if isinstance(topic, str) else (
                topic.get("title") or topic.get("name") or str(topic)
            )
            topics[topic_name] = {
                "module": module_title,
                "status": "not_started",
                "latest_summary": None,
                "last_touched": None,
            }

    # Extract learning objectives
    objectives = {}
    for module in course_curriculum.get("syllabus", []):
        for obj in module.get("learning_objectives", []):
            obj_text = obj if isinstance(obj, str) else (
                obj.get("description") or obj.get("objective") or str(obj)
            )
            objectives[obj_text] = {"status": "not_started", "evidence": None}

    # Extract threshold concepts (new dict-keyed format with all_threshold_concepts list)
    threshold_concepts = {}
    tc_names = course_curriculum.get("all_threshold_concepts", [])
    if tc_names:
        # New format: all_threshold_concepts lists names, each name is a top-level key
        for tc_name in tc_names:
            threshold_concepts[tc_name] = {
                "status": "not_started",
                "misconceptions_addressed": [],
            }
    else:
        # Legacy format fallback: threshold_concepts as array of objects
        for tc in course_curriculum.get("threshold_concepts", []):
            tc_name = tc.get("name") or tc.get("concept") or tc.get("title") or str(tc)
            threshold_concepts[tc_name] = {
                "status": "not_started",
                "misconceptions_addressed": [],
            }

    state = {
        "topics": topics,
        "objectives": objectives,
        "threshold_concepts": threshold_concepts,
        "overall": {
            "total_topics": len(topics),
            "learned": 0,
            "in_progress": 0,
            "not_started": len(topics),
            "percent": 0,
            "last_active": now,
        },
        "createdAt": now,
    }

    save_learning_state(user_id, agent_id, state)
    logger.info(f"Initialized learning state for user='{scrub(user_id)}', agent='{scrub(agent_id)}': "
                f"{len(topics)} topics, {len(objectives)} objectives, {len(threshold_concepts)} threshold concepts")
    return state


def ensure_learning_state(user_id: str, agent_id: str) -> Optional[Dict[str, Any]]:
    """
    Return the learning state, creating it from the curriculum when absent.

    Progress used to appear only once the tutor happened to call a progress tool,
    so students who chatted for weeks still saw an empty panel. Callers on the
    read path use this so the syllabus is visible from the first visit.
    """
    if not user_id or not agent_id:
        return None

    state = get_learning_state(user_id, agent_id)
    if state:
        return state

    try:
        from agent_tools.custom.get_threshold_concepts import _get_full_course_curriculum

        curriculum = _get_full_course_curriculum(agent_id)
    except Exception as e:
        logger.error(f"Could not load curriculum to initialise learning state for '{scrub(agent_id)}': {scrub(e)}")
        return None

    if not curriculum:
        logger.warning(
            f"No curriculum available for agent='{scrub(agent_id)}' — cannot initialise learning state "
            f"for user='{user_id}'"
        )
        return None

    try:
        return init_learning_state(user_id, agent_id, curriculum)
    except Exception as e:
        logger.error(f"Failed to initialise learning state for user='{scrub(user_id)}', agent='{scrub(agent_id)}': {scrub(e)}")
        return None


def _match_threshold_concept(name: str, concepts: Dict[str, Any]) -> Optional[str]:
    """
    Resolve a topic name to a threshold-concept key.

    Concept names are long phrases, so an exact match is rare; fall back to
    case-insensitive equality and then to one name containing the other.
    """
    if not name or not concepts:
        return None
    if name in concepts:
        return name

    target = name.strip().lower()
    if not target:
        return None

    for key in concepts:
        if key.strip().lower() == target:
            return key

    # Substring match, preferring the most specific (longest) concept.
    candidates = [
        key for key in concepts
        if target in key.strip().lower() or key.strip().lower() in target
    ]
    return max(candidates, key=len) if candidates else None


def _resolve_concept_key(name: str, concepts: Dict[str, Any]) -> Optional[str]:
    """Resolve an explicitly named threshold concept to its state key."""
    return _match_threshold_concept(name, concepts)


def _record_misconceptions(
    entry: Dict[str, Any],
    misconceptions: Optional[List[Dict[str, Any]]],
    now: str,
) -> List[str]:
    """
    Mark misconceptions resolved on a concept entry and keep the tutor's note.

    `misconceptions_addressed` stays a plain string list because the teacher
    dashboard already reads it; the notes live alongside in `misconception_notes`.
    """
    if not misconceptions:
        return []

    addressed = entry.get("misconceptions_addressed")
    if not isinstance(addressed, list):
        addressed = []
    notes = entry.get("misconception_notes")
    if not isinstance(notes, dict):
        notes = {}

    seen = {str(item).strip().lower() for item in addressed}
    recorded: List[str] = []
    for item in misconceptions:
        if isinstance(item, str):
            text, note = item.strip(), ""
        elif isinstance(item, dict):
            text = str(item.get("misconception") or "").strip()
            note = str(item.get("note") or "").strip()
        else:
            continue
        if not text:
            continue
        if text.strip().lower() not in seen:
            addressed.append(text)
            seen.add(text.strip().lower())
        notes[text] = {"note": note, "recorded_at": now}
        recorded.append(text)

    entry["misconceptions_addressed"] = addressed
    entry["misconception_notes"] = notes
    return recorded


def update_topic_in_state(
    user_id: str,
    agent_id: str,
    topic: str,
    status: str,
    summary: Optional[str] = None,
    threshold_concept: Optional[str] = None,
    misconceptions: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Update a single topic's status and summary in the learning state.
    If the topic doesn't exist (student explored beyond the plan), it's created.
    Recomputes overall counts after the update.

    Args:
        user_id: The user ID
        agent_id: The agent ID
        topic: The topic name
        status: The new status ("not_started", "in_progress", "learned")
        summary: Optional new summary of what the user understood
        threshold_concept: Optional explicit concept name, used when the caller
            knows it (e.g. after a concept inventory) instead of relying on
            fuzzy matching against the topic name
        misconceptions: Optional list of {"misconception", "note"} dicts to mark
            as resolved on the concept

    Returns:
        Dict with result: the updated topic entry and overall stats
    """
    now = datetime.utcnow().isoformat() + "Z"

    state = get_learning_state(user_id, agent_id)
    if not state:
        return {"error": "No learning state found. Call get_threshold_concepts first to initialize."}

    topics = state.get("topics", {})

    # If topic doesn't exist (student explored off-plan), create it
    if topic not in topics:
        topics[topic] = {
            "module": "Explored",
            "status": "not_started",
            "latest_summary": None,
            "last_touched": None,
        }
        logger.info(f"Created new off-plan topic '{scrub(topic)}' for user='{scrub(user_id)}', agent='{scrub(agent_id)}'")

    # Update the topic
    old_status = topics[topic]["status"]
    topics[topic]["status"] = status
    if summary:
        topics[topic]["latest_summary"] = summary
    topics[topic]["last_touched"] = now

    state["topics"] = topics

    # Recompute overall counts
    learned = sum(1 for t in topics.values() if t["status"] == "learned")
    in_progress = sum(1 for t in topics.values() if t["status"] == "in_progress")
    not_started = sum(1 for t in topics.values() if t["status"] == "not_started")
    total = len(topics)

    state["overall"] = {
        "total_topics": total,
        "learned": learned,
        "in_progress": in_progress,
        "not_started": not_started,
        "percent": round((learned / total) * 100) if total > 0 else 0,
        "last_active": now,
    }

    # Mirror the update onto the matching threshold concept, if any.
    concepts = state.get("threshold_concepts", {})
    concept_key = _resolve_concept_key(threshold_concept, concepts) if threshold_concept else None
    if not concept_key:
        concept_key = _match_threshold_concept(topic, concepts)
    recorded_misconceptions: List[str] = []
    if concept_key:
        entry = concepts[concept_key]
        recorded_misconceptions = _record_misconceptions(entry, misconceptions, now)
        # Crossing a threshold concept requires assessment evidence. Without this,
        # teaching a topic whose name merely fuzzy-matches a concept marks it
        # crossed, so counts drift upward with no inventory ever submitted.
        has_evidence = bool(entry.get("misconceptions_addressed"))
        concept_status = "in_progress" if (status == "learned" and not has_evidence) else status
        entry["status"] = concept_status
        entry["last_updated"] = now
        if summary:
            entry["latest_summary"] = summary
        state["threshold_concepts"] = concepts
        if concept_status != status:
            logger.info(
                f"Threshold concept '{scrub(concept_key)}' held at in_progress for user='{scrub(user_id)}', "
                f"agent='{agent_id}': topic marked learned but no misconception evidence recorded"
            )
        else:
            logger.info(
                f"Threshold concept '{scrub(concept_key)}' -> {scrub(concept_status)} for user='{scrub(user_id)}', agent='{scrub(agent_id)}'"
            )
    elif misconceptions:
        logger.warning(
            f"Misconceptions supplied for topic '{scrub(topic)}' but no threshold concept matched "
            f"(user='{user_id}', agent='{agent_id}')"
        )

    save_learning_state(user_id, agent_id, state)

    status_change = f"{old_status} → {status}" if old_status != status else f"{status} (summary updated)"
    logger.info(f"Updated topic '{scrub(topic)}' for user='{scrub(user_id)}': {scrub(status_change)}")

    concepts_learned = sum(1 for c in concepts.values() if c.get("status") == "learned")
    return {
        "status": "updated",
        "topic": topic,
        "old_status": old_status,
        "new_status": status,
        "summary": topics[topic]["latest_summary"],
        "overall": state["overall"],
        "threshold_concept": concept_key,
        "misconceptions_recorded": recorded_misconceptions,
        "threshold_concepts_learned": concepts_learned,
        "threshold_concepts_total": len(concepts),
    }


def get_progress_summary(user_id: str, agent_id: str) -> Dict[str, Any]:
    """
    Get a compact progress summary for the agent to read.
    Returns overall stats plus recently active and in-progress topics.

    Args:
        user_id: The user ID
        agent_id: The agent ID

    Returns:
        Compact progress summary dict
    """
    state = get_learning_state(user_id, agent_id)
    if not state:
        return {"status": "no_state", "message": "No learning state found."}

    topics = state.get("topics", {})
    overall = state.get("overall", {})

    # Recently active topics (sorted by last_touched, top 5)
    active_topics = [
        {"topic": name, "module": t["module"], "status": t["status"], "latest_summary": t["latest_summary"]}
        for name, t in topics.items()
        if t.get("last_touched")
    ]
    active_topics.sort(key=lambda x: x.get("latest_summary") or "", reverse=True)
    active_topics = active_topics[:5]

    # In-progress topics (where the student is currently)
    in_progress = [
        {"topic": name, "module": t["module"], "latest_summary": t["latest_summary"]}
        for name, t in topics.items()
        if t["status"] == "in_progress"
    ]

    # Struggle areas: in_progress for a long time or with confused/stuck in summary
    struggle_keywords = ["confused", "stuck", "doesn't understand", "incorrect", "wrong", "struggling"]
    struggles = [
        {"topic": name, "summary": t["latest_summary"]}
        for name, t in topics.items()
        if t["latest_summary"] and any(kw in t["latest_summary"].lower() for kw in struggle_keywords)
    ]

    return {
        "overall": overall,
        "in_progress": in_progress,
        "recently_active": active_topics,
        "struggle_areas": struggles,
        "threshold_concepts": {
            name: tc
            for name, tc in state.get("threshold_concepts", {}).items()
        },
    }


def delete_learning_state(user_id: str, agent_id: str) -> bool:
    """
    Delete the learning state document for a user+agent pair.

    Args:
        user_id: The user ID
        agent_id: The agent ID

    Returns:
        True if deleted successfully
    """
    key = _learning_state_key(user_id, agent_id)
    try:
        container = _get_learning_states_container()
        container.delete_item(item=key, partition_key=user_id)
        _learning_state_cache.pop(key, None)
        logger.info(f"Deleted learning state for '{scrub(key)}'")
        return True
    except CosmosResourceNotFoundError:
        logger.debug(f"Learning state '{scrub(key)}' not found for deletion")
        _learning_state_cache.pop(key, None)
        return True
    except Exception as e:
        logger.error(f"Failed to delete learning state for '{scrub(key)}': {scrub(e)}")
        return False


def delete_all_learning_states_for_agent(agent_id: str) -> int:
    """
    Delete ALL learning states for a given agent (across all users).
    Used when an agent is deleted.

    Args:
        agent_id: The agent ID

    Returns:
        Number of states deleted
    """
    count = 0
    try:
        container = _get_learning_states_container()
        query = "SELECT c.id, c.partitionKey FROM c WHERE c.type = 'learning_state' AND c.agent_id = @agent_id"
        items = list(container.query_items(
            query=query,
            parameters=[{"name": "@agent_id", "value": agent_id}],
            enable_cross_partition_query=True,
        ))
        for item in items:
            try:
                container.delete_item(item=item["id"], partition_key=item["partitionKey"])
                _learning_state_cache.pop(item["id"], None)
                count += 1
            except Exception as e:
                logger.warning(f"Failed to delete learning state {item['id']}: {e}")
        logger.info(f"Deleted {scrub(count)} learning states for agent '{scrub(agent_id)}'")
    except Exception as e:
        logger.error(f"Failed to query learning states for agent '{scrub(agent_id)}': {scrub(e)}")
    return count


def invalidate_learning_state_cache(user_id: Optional[str] = None, agent_id: Optional[str] = None):
    """
    Invalidate learning state cache.

    Args:
        user_id: If provided with agent_id, invalidate that specific state.
                 If None, clear all.
        agent_id: The agent ID (used with user_id).
    """
    if user_id and agent_id:
        key = _learning_state_key(user_id, agent_id)
        _learning_state_cache.pop(key, None)
        logger.debug(f"Invalidated learning state cache for '{key}'")
    else:
        _learning_state_cache.clear()
        logger.debug("Invalidated all learning state caches")


def delete_agent_chats(agent_id: str) -> Dict[str, int]:
    """
    Delete ALL chat threads and messages associated with an agent.
    
    Args:
        agent_id: The agent ID whose chats should be deleted
        
    Returns:
        Dict with counts of deleted threads and messages
    """
    threads_container, messages_container = _get_containers()
    
    deleted_threads = 0
    deleted_messages = 0
    
    try:
        # Find all threads for this agent (cross-partition query)
        threads_query = "SELECT c.id, c.userId FROM c WHERE c.agentId = @agentId"
        threads = list(threads_container.query_items(
            query=threads_query,
            parameters=[{"name": "@agentId", "value": agent_id}],
            enable_cross_partition_query=True
        ))
        
        logger.info(f"Found {scrub(len(threads))} threads to delete for agent {scrub(agent_id)}")
        
        for thread in threads:
            thread_id = thread["id"]
            user_id = thread["userId"]
            
            # Delete all messages in this thread
            try:
                messages_query = "SELECT c.id FROM c WHERE c.threadId = @threadId"
                messages = list(messages_container.query_items(
                    query=messages_query,
                    parameters=[{"name": "@threadId", "value": thread_id}],
                    partition_key=user_id
                ))
                
                for msg in messages:
                    try:
                        messages_container.delete_item(item=msg["id"], partition_key=user_id)
                        deleted_messages += 1
                    except Exception as e:
                        logger.warning(f"Failed to delete message {msg['id']}: {e}")
            except Exception as e:
                logger.warning(f"Failed to query messages for thread {thread_id}: {e}")
            
            # Delete the thread
            try:
                threads_container.delete_item(item=thread_id, partition_key=user_id)
                deleted_threads += 1
            except Exception as e:
                logger.warning(f"Failed to delete thread {thread_id}: {e}")
        
        logger.info(f"Deleted {scrub(deleted_threads)} threads and {scrub(deleted_messages)} messages for agent {scrub(agent_id)}")
        
    except Exception as e:
        logger.error(f"Error deleting chats for agent {scrub(agent_id)}: {scrub(e)}")
    
    return {"threads": deleted_threads, "messages": deleted_messages}


def list_agents_metadata(
    created_by_id: Optional[str] = None,
    agent_kind: Optional[str] = None,
    limit: int = 100,
) -> List[Dict[str, Any]]:
    """
    List all agent metadata from Cosmos DB.
    
    Args:
        created_by_id: Filter by creator userId (optional)
        agent_kind: Filter by agent kind (optional)
        limit: Maximum number of agents to return
    
    Returns:
        List of agent metadata documents
    """
    # Build query based on filters
    conditions = ["c.status = 'active'"]
    params = []
    
    if created_by_id:
        conditions.append("c.createdById = @createdById")
        params.append({"name": "@createdById", "value": created_by_id})
    
    if agent_kind:
        conditions.append("c.agentKind = @agentKind")
        params.append({"name": "@agentKind", "value": agent_kind})
    
    where_clause = " AND ".join(conditions)
    query = f"SELECT * FROM c WHERE {where_clause} ORDER BY c.createdAt DESC"
    
    container = _get_agents_container()
    agents = list(container.query_items(
        query=query,
        parameters=params if params else None,
        max_item_count=limit,
        enable_cross_partition_query=True,  # Enable cross-partition query for listing all agents
    ))
    
    logger.debug(f"Listed {len(agents)} agents from Cosmos DB")
    return agents


def upsert_agent_metadata(agent_doc: Dict[str, Any]) -> Dict[str, Any]:
    """Upsert agent metadata (for migrations or bulk updates)."""
    container = _get_agents_container()
    
    agent_doc["updatedAt"] = datetime.utcnow().isoformat() + "Z"
    container.upsert_item(body=agent_doc)
    logger.info(f"Upserted agent metadata for {agent_doc.get('id')}")
    return agent_doc


def list_agents_for_user(
    user_id: str,
    user_role: str,
    agent_kind: Optional[str] = None,
    limit: int = 100,
) -> List[Dict[str, Any]]:
    """
    List agents scoped by the caller's role and per-agent membership.

    - admin / superadmin: all active agents
    - teacher: agents where createdById == user_id OR user_id in teacherIds
    - student: agents where user_id in studentIds

    Visibility is per-agent via teacherIds/studentIds arrays.
    Teachers are added to teacherIds when they connect via manage code.
    Students are added to studentIds when they connect via manage code.
    """
    conditions = ["c.status = 'active'"]
    params: list = []

    if user_role in ("admin", "superadmin"):
        pass  # no extra filter — see everything
    elif user_role == "teacher":
        conditions.append(
            "(c.createdById = @uid OR ARRAY_CONTAINS(c.teacherIds, @uid))"
        )
        params.append({"name": "@uid", "value": user_id})
    else:
        # student (or unknown role) — only agents they are enrolled in
        conditions.append("ARRAY_CONTAINS(c.studentIds, @uid)")
        params.append({"name": "@uid", "value": user_id})

    if agent_kind:
        conditions.append("c.agentKind = @agentKind")
        params.append({"name": "@agentKind", "value": agent_kind})

    where_clause = " AND ".join(conditions)
    query = f"SELECT * FROM c WHERE {where_clause} ORDER BY c.createdAt DESC"

    container = _get_agents_container()
    agents = list(container.query_items(
        query=query,
        parameters=params if params else None,
        max_item_count=limit,
        enable_cross_partition_query=True,
    ))
    logger.debug(f"list_agents_for_user({scrub(user_id)}, {scrub(user_role)}) → {scrub(len(agents))} agents")
    return agents


def add_agent_member(
    agent_id: str,
    user_id: str,
    member_type: str = "student",
) -> Optional[Dict[str, Any]]:
    """
    Add a user to an agent's studentIds or teacherIds list.
    Returns the updated doc, or None if agent not found.
    """
    field = "teacherIds" if member_type == "teacher" else "studentIds"
    agent = get_agent_metadata(agent_id)
    if not agent:
        return None
    members = agent.get(field, [])
    if user_id in members:
        return agent  # already a member
    members.append(user_id)
    agent[field] = members
    agent["updatedAt"] = datetime.utcnow().isoformat() + "Z"
    container = _get_agents_container()
    # Use ETag for optimistic concurrency to prevent lost updates
    etag = agent.get("_etag")
    if etag:
        container.upsert_item(body=agent, etag=etag, match_condition=MatchConditions.IfNotModified)
    else:
        container.upsert_item(body=agent)
    logger.info(f"Added {scrub(member_type)} {scrub(user_id)} to agent {scrub(agent_id)}")
    return agent


def remove_agent_member(
    agent_id: str,
    user_id: str,
    member_type: str = "student",
) -> Optional[Dict[str, Any]]:
    """
    Remove a user from an agent's studentIds or teacherIds list.
    Returns the updated doc, or None if agent not found.
    """
    field = "teacherIds" if member_type == "teacher" else "studentIds"
    agent = get_agent_metadata(agent_id)
    if not agent:
        return None
    members = agent.get(field, [])
    if user_id not in members:
        return agent  # not a member
    members.remove(user_id)
    agent[field] = members
    agent["updatedAt"] = datetime.utcnow().isoformat() + "Z"
    container = _get_agents_container()
    container.upsert_item(body=agent)
    logger.info(f"Removed {scrub(member_type)} {scrub(user_id)} from agent {scrub(agent_id)}")
    return agent


def get_agent_members(agent_id: str) -> Optional[Dict[str, List[str]]]:
    """Return the teacherIds and studentIds for an agent."""
    agent = get_agent_metadata(agent_id)
    if not agent:
        return None
    return {
        "teacherIds": agent.get("teacherIds", []),
        "studentIds": agent.get("studentIds", []),
    }


def get_users_batch(user_ids: List[str]) -> Dict[str, Dict[str, Any]]:
    """
    Get multiple user profiles by their IDs for efficient batch lookups.
    Used to join user data when listing agents.
    
    Args:
        user_ids: List of user IDs to fetch
    
    Returns:
        Dict mapping userId to user profile data
    """
    if not user_ids:
        return {}
    
    get_cosmos_client()  # Initialize if needed
    
    # Deduplicate and filter empty IDs
    unique_ids = list(set(uid for uid in user_ids if uid))
    if not unique_ids:
        return {}
    
    try:
        # Build IN clause for batch query
        placeholders = ", ".join([f"@id{i}" for i in range(len(unique_ids))])
        query = f"SELECT * FROM c WHERE c.userId IN ({placeholders})"
        params = [{"name": f"@id{i}", "value": uid} for i, uid in enumerate(unique_ids)]
        
        users = list(_users_container.query_items(
            query=query,
            parameters=params,
            enable_cross_partition_query=True,
        ))
        
        # Build lookup dict
        return {user["userId"]: user for user in users}
    except Exception as e:
        logger.error(f"Error fetching users batch: {e}")
        return {}


def get_invited_users_batch(user_ids: List[str]) -> Dict[str, Dict[str, Any]]:
    """
    Batch-fetch invite records (C1) for users who have not signed in yet.
    Complements get_users_batch, which only covers activated users in C2.

    Returns:
        Dict mapping invite id to the invite record
    """
    if not user_ids:
        return {}

    get_cosmos_client()  # Initialize if needed

    unique_ids = list(set(uid for uid in user_ids if uid))
    if not unique_ids:
        return {}

    try:
        placeholders = ", ".join([f"@id{i}" for i in range(len(unique_ids))])
        query = f"SELECT * FROM c WHERE c.id IN ({placeholders})"
        params = [{"name": f"@id{i}", "value": uid} for i, uid in enumerate(unique_ids)]

        invites = list(_invited_users_container.query_items(
            query=query,
            parameters=params,
            enable_cross_partition_query=True,
        ))
        return {invite["id"]: invite for invite in invites}
    except Exception as e:
        logger.error(f"Error fetching invited users batch: {e}")
        return {}


# ============================================================================
# Feedback Operations
# ============================================================================

def submit_feedback(
    feedback_id: str,
    user_id: str,
    sentiment: Optional[str] = None,
    category: str = "General",
    text: str = "",
    user_name: str = "",
    user_email: str = "",
    image_url: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Submit user feedback to Cosmos DB."""
    container = _get_feedback_container()

    item = {
        "id": feedback_id,
        "userId": user_id,  # Partition key
        "sentiment": sentiment,
        "category": category,
        "text": text,
        "userName": user_name,
        "userEmail": user_email,
        "imageUrls": image_url or [],
        "createdAt": datetime.utcnow().isoformat() + "Z",
    }

    container.create_item(body=item)
    logger.info(f"Feedback {feedback_id} submitted by user {user_id}")
    return item


def list_feedback(user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """List feedback, optionally filtered by user."""
    container = _get_feedback_container()

    try:
        if user_id:
            query = "SELECT * FROM c WHERE c.userId = @uid ORDER BY c.createdAt DESC"
            items = list(container.query_items(
                query=query,
                parameters=[{"name": "@uid", "value": user_id}],
                enable_cross_partition_query=False,
            ))
        else:
            query = "SELECT * FROM c ORDER BY c.createdAt DESC"
            items = list(container.query_items(
                query=query,
                enable_cross_partition_query=True,
            ))
        return items
    except Exception as e:
        logger.error(f"Error listing feedback: {e}")
        return []


# ============================================================================
# Groundedness Evaluation Operations
# ============================================================================

def _get_groundedness_container():
    """Get groundedness evaluations container, initializing if needed."""
    get_cosmos_client()
    return _groundedness_container


def save_groundedness_evaluation(evaluation: Dict[str, Any]) -> Dict[str, Any]:
    """
    Save a groundedness evaluation result to Cosmos DB.

    The document schema:
    {
        "id": "<messageGroupId>",           # unique per conversation turn
        "sessionId": "<session_uuid>",       # partition key
        "messageGroupId": "<messageGroupId>",
        "threadId": "<thread_id>",
        "userId": "<user_id>",
        "query": "<user question>",
        "response": "<agent full response>",
        "context": "<retrieved context used for evaluation>",
        "groundednessScore": 1-5,
        "groundednessReason": "<judge reasoning>",
        "supportedClaims": [...],
        "unsupportedClaims": [...],
        "method": "llm_judge" | "azure_ai_evaluation_sdk",
        "evaluatedAt": "<ISO timestamp>",
        "maxScore": 5,
    }
    """
    container = _get_groundedness_container()

    # Ensure required fields
    if "id" not in evaluation:
        evaluation["id"] = evaluation.get("messageGroupId", "")
    if "evaluatedAt" not in evaluation:
        evaluation["evaluatedAt"] = datetime.utcnow().isoformat() + "Z"

    try:
        result = container.upsert_item(body=evaluation)
        logger.info(
            f"Saved groundedness evaluation for messageGroupId={evaluation.get('messageGroupId')}, "
            f"score={evaluation.get('groundednessScore')}"
        )
        return result
    except Exception as e:
        logger.error(f"Failed to save groundedness evaluation: {e}")
        raise


def get_groundedness_evaluation(message_group_id: str, session_id: str) -> Optional[Dict[str, Any]]:
    """
    Get groundedness evaluation by messageGroupId.

    Args:
        message_group_id: The messageGroupId (also the document id)
        session_id: The session UUID (partition key)

    Returns:
        Evaluation document or None
    """
    container = _get_groundedness_container()

    try:
        item = container.read_item(item=message_group_id, partition_key=session_id)
        return item
    except CosmosResourceNotFoundError:
        return None
    except Exception as e:
        logger.error(f"Error reading groundedness evaluation: {e}")
        return None


def get_groundedness_evaluations_for_session(session_id: str) -> List[Dict[str, Any]]:
    """
    Get all groundedness evaluations for a session.

    Args:
        session_id: The session UUID (partition key)

    Returns:
        List of evaluation documents ordered by evaluatedAt
    """
    container = _get_groundedness_container()

    try:
        query = "SELECT * FROM c WHERE c.sessionId = @sid ORDER BY c.evaluatedAt DESC"
        items = list(container.query_items(
            query=query,
            parameters=[{"name": "@sid", "value": session_id}],
            partition_key=session_id,
        ))
        return items
    except Exception as e:
        logger.error(f"Error listing groundedness evaluations for session {session_id}: {e}")
        return []


def get_groundedness_evaluations_for_thread(thread_id: str, session_id: str) -> List[Dict[str, Any]]:
    """
    Get all groundedness evaluations for a specific chat thread.

    Args:
        thread_id: The thread/conversation ID
        session_id: The session UUID (partition key)

    Returns:
        List of evaluation documents for this thread
    """
    container = _get_groundedness_container()

    try:
        query = "SELECT * FROM c WHERE c.sessionId = @sid AND c.threadId = @tid ORDER BY c.evaluatedAt DESC"
        items = list(container.query_items(
            query=query,
            parameters=[
                {"name": "@sid", "value": session_id},
                {"name": "@tid", "value": thread_id},
            ],
            partition_key=session_id,
        ))
        return items
    except Exception as e:
        logger.error(f"Error listing groundedness evaluations for thread {thread_id}: {e}")
        return []


def get_messages_by_group_id(message_group_id: str, user_id: str) -> List[Dict[str, Any]]:
    """
    Get all messages belonging to a messageGroupId (user question + assistant response).

    Args:
        message_group_id: The messageGroupId
        user_id: The user ID (partition key for messages container)

    Returns:
        List of messages (user + assistant) sorted by createdAt
    """
    _, messages_container = _get_containers()

    try:
        query = "SELECT * FROM c WHERE c.messageGroupId = @gid ORDER BY c.createdAt ASC"
        items = list(messages_container.query_items(
            query=query,
            parameters=[{"name": "@gid", "value": message_group_id}],
            partition_key=user_id,
        ))
        return items
    except Exception as e:
        logger.error(f"Error fetching messages for group {message_group_id}: {e}")
        return []


# ==============================================================================
# Assets / Artifacts Functions
# ==============================================================================

QUIZ_RECORD_TYPE = "quiz_learning_record"
QUIZ_FIRST_ATTEMPT_RECORD_TYPE = "concept_inventory_first_attempt"

def _get_assets_container():
    """Get the assets container client."""
    global _assets_container
    if _assets_container is None:
        get_cosmos_client()
    return _assets_container


def _quiz_asset_id(agent_id: str, quiz_id: str) -> str:
    """Return a stable quiz asset id within a student's Cosmos partition."""
    digest = hashlib.sha256(f"{agent_id}\0{quiz_id}".encode("utf-8")).hexdigest()
    return f"quiz-first-{digest[:48]}"


def _quiz_content(asset: Dict[str, Any]) -> Dict[str, Any]:
    try:
        content = json.loads(asset.get("content") or "{}")
        return content if isinstance(content, dict) else {}
    except (TypeError, json.JSONDecodeError):
        return {}


def _has_first_attempt(asset: Dict[str, Any]) -> bool:
    content = _quiz_content(asset)
    return bool(
        content.get("firstAttempt")
        or content.get("recordType") == QUIZ_FIRST_ATTEMPT_RECORD_TYPE
        or asset.get("recordType") == QUIZ_FIRST_ATTEMPT_RECORD_TYPE
    )


def _replace_quiz_asset(container, asset: Dict[str, Any]) -> Dict[str, Any]:
    """Replace with ETag protection when the stored document supplies one."""
    etag = asset.get("_etag")
    if etag:
        return container.replace_item(
            item=asset["id"],
            body=asset,
            etag=etag,
            match_condition=MatchConditions.IfNotModified,
        )
    return container.replace_item(item=asset["id"], body=asset)


def upsert_quiz_asset(
    user_id: str,
    agent_id: str,
    quiz_id: str,
    title: str,
    questions: List[Dict[str, Any]],
    thread_id: Optional[str] = None,
    tags: Optional[List[str]] = None,
    assessment_type: str = "practice_quiz",
    threshold_concept: Optional[str] = None,
) -> Dict[str, Any]:
    """Create or enrich the single asset that owns a quiz's full lifecycle."""
    container = _get_assets_container()
    asset_id = _quiz_asset_id(agent_id, quiz_id)
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    quiz = {
        "quizId": quiz_id,
        "title": title or "Quiz",
        "assessmentType": assessment_type,
        **({"thresholdConcept": threshold_concept} if threshold_concept else {}),
        "questions": questions,
    }

    try:
        existing = container.read_item(item=asset_id, partition_key=user_id)
    except CosmosResourceNotFoundError:
        asset = {
            "id": asset_id,
            "userId": user_id,
            "title": title or "Quiz",
            "category": "quiz",
            "type": "json",
            "content": json.dumps({
                "schemaVersion": 2,
                "recordType": QUIZ_RECORD_TYPE,
                "quiz": quiz,
            }, ensure_ascii=False, indent=2),
            "agentId": agent_id,
            "threadId": thread_id,
            "messageId": None,
            "description": f"Quiz with {len(questions)} question{'s' if len(questions) != 1 else ''}",
            "previewImageUrl": None,
            "isPublic": False,
            "tags": list(dict.fromkeys([*(tags or []), "quiz"])),
            "recordType": QUIZ_RECORD_TYPE,
            "quizId": quiz_id,
            "immutable": False,
            "createdAt": now,
            "updatedAt": now,
        }
        try:
            container.create_item(body=asset)
            return asset
        except CosmosResourceExistsError:
            existing = container.read_item(item=asset_id, partition_key=user_id)

    content = _quiz_content(existing)
    if (
        content.get("recordType") == QUIZ_FIRST_ATTEMPT_RECORD_TYPE
        and not content.get("firstAttempt")
    ):
        content["firstAttempt"] = {
            key: content.get(key)
            for key in (
                "schemaVersion",
                "recordType",
                "quizId",
                "title",
                "agentId",
                "threadId",
                "submittedAt",
                "score",
                "totalQuestions",
                "percentage",
                "answers",
            )
            if key in content
        }
    content.update({"schemaVersion": 2, "quiz": quiz})
    content.setdefault("recordType", QUIZ_RECORD_TYPE)
    existing.update({
        "title": title or existing.get("title") or "Quiz",
        "content": json.dumps(content, ensure_ascii=False, indent=2),
        "threadId": existing.get("threadId") or thread_id,
        "quizId": quiz_id,
        "updatedAt": now,
    })
    if tags:
        existing["tags"] = list(dict.fromkeys([*(existing.get("tags") or []), *tags, "quiz"]))
    return _replace_quiz_asset(container, existing)


def get_first_quiz_attempt(
    user_id: str,
    agent_id: str,
    quiz_id: str,
) -> Optional[Dict[str, Any]]:
    """Read a student's immutable first attempt for one course quiz."""
    container = _get_assets_container()
    asset_id = _quiz_asset_id(agent_id, quiz_id)
    try:
        asset = container.read_item(item=asset_id, partition_key=user_id)
        if not _has_first_attempt(asset):
            return None
        return asset
    except CosmosResourceNotFoundError:
        return None


def create_first_quiz_attempt(
    user_id: str,
    agent_id: str,
    quiz_id: str,
    title: str,
    attempt: Dict[str, Any],
    thread_id: Optional[str] = None,
) -> tuple[Dict[str, Any], bool]:
    """
    Create the first concept-inventory attempt exactly once.

    ETag-protected replacement is the concurrency boundary when the generated
    quiz asset already exists. Simultaneous submits cannot overwrite the first.
    """
    container = _get_assets_container()
    asset_id = _quiz_asset_id(agent_id, quiz_id)
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    score = int(attempt.get("score", 0))
    total = int(attempt.get("totalQuestions", 0))
    for _ in range(3):
        try:
            existing = container.read_item(item=asset_id, partition_key=user_id)
        except CosmosResourceNotFoundError:
            existing = None

        if existing and _has_first_attempt(existing):
            logger.info("First quiz attempt %s already exists for user %s", quiz_id, user_id)
            return existing, False

        questions = [
            {
                "question": answer.get("question", ""),
                "options": answer.get("options") or [],
                "correct": answer.get("correct") or [],
                "explanation": answer.get("explanation", ""),
                "targetsMisconception": answer.get("targetsMisconception", ""),
            }
            for answer in (attempt.get("answers") or [])
        ]
        content = _quiz_content(existing or {})
        content.update(attempt)
        content.update({
            "schemaVersion": 2,
            "recordType": QUIZ_FIRST_ATTEMPT_RECORD_TYPE,
            "quiz": content.get("quiz") or {
                "quizId": quiz_id,
                "title": title,
                "assessmentType": attempt.get("assessmentType", "practice_quiz"),
                **(
                    {"thresholdConcept": attempt.get("thresholdConcept")}
                    if attempt.get("thresholdConcept")
                    else {}
                ),
                "questions": questions,
            },
            "firstAttempt": attempt,
        })
        asset = existing or {
            "id": asset_id,
            "userId": user_id,
            "category": "quiz",
            "type": "json",
            "messageId": None,
            "previewImageUrl": None,
            "isPublic": False,
            "createdAt": now,
        }
        asset.update({
            "title": title,
            "content": json.dumps(content, ensure_ascii=False, indent=2),
            "agentId": agent_id,
            "threadId": asset.get("threadId") or thread_id,
            "description": f"First concept inventory attempt - {score}/{total} correct",
            "tags": list(dict.fromkeys([*(asset.get("tags") or []), "quiz", "concept-inventory", "first-attempt", "assessment"])),
            "recordType": QUIZ_FIRST_ATTEMPT_RECORD_TYPE,
            "quizId": quiz_id,
            "attemptNumber": 1,
            "immutable": True,
            "updatedAt": now,
        })

        try:
            if existing:
                stored = _replace_quiz_asset(container, asset)
            else:
                container.create_item(body=asset)
                stored = asset
            logger.info("Stored first quiz attempt %s for user %s", quiz_id, user_id)
            return stored, True
        except CosmosResourceExistsError:
            continue
        except CosmosHttpResponseError as error:
            if error.status_code == 412:
                continue
            raise

    existing = container.read_item(item=asset_id, partition_key=user_id)
    return existing, False


def append_quiz_agent_feedback(
    user_id: str,
    agent_id: str,
    quiz_id: str,
    feedback: str,
) -> Optional[Dict[str, Any]]:
    """Append the automatic tutor feedback to the same immutable quiz asset."""
    container = _get_assets_container()
    asset_id = _quiz_asset_id(agent_id, quiz_id)
    for _ in range(3):
        try:
            asset = container.read_item(item=asset_id, partition_key=user_id)
        except CosmosResourceNotFoundError:
            return None
        if not _has_first_attempt(asset):
            return None
        content = _quiz_content(asset)
        if content.get("agentFeedback"):
            return asset
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        content["agentFeedback"] = {"content": feedback.strip(), "createdAt": now}
        asset["content"] = json.dumps(content, ensure_ascii=False, indent=2)
        asset["updatedAt"] = now
        try:
            return _replace_quiz_asset(container, asset)
        except CosmosHttpResponseError as error:
            if error.status_code == 412:
                continue
            raise
    return container.read_item(item=asset_id, partition_key=user_id)


def create_asset(
    user_id: str,
    title: str,
    category: str,
    asset_type: str,
    content: str,
    agent_id: Optional[str] = None,
    thread_id: Optional[str] = None,
    message_id: Optional[str] = None,
    description: Optional[str] = None,
    preview_image_url: Optional[str] = None,
    is_public: bool = False,
    tags: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Create a new asset/artifact.

    Args:
        user_id: The user ID (partition key)
        title: Asset title
        category: Category (quiz, flashcard, diagram, summary, code, visualization, other)
        asset_type: Content type (html, markdown, code, mermaid, svg, json, text)
        content: The asset content
        agent_id: Optional associated agent ID
        thread_id: Optional associated thread ID
        message_id: Optional associated message ID (where asset was generated)
        description: Optional description
        preview_image_url: Optional preview image URL
        is_public: Whether the asset is publicly visible
        tags: Optional list of tags

    Returns:
        The created asset document
    """
    container = _get_assets_container()
    
    now = datetime.utcnow().isoformat() + "Z"
    asset_id = str(uuid.uuid4())
    
    asset = {
        "id": asset_id,
        "userId": user_id,
        "title": title,
        "category": category,
        "type": asset_type,
        "content": content,
        "agentId": agent_id,
        "threadId": thread_id,
        "messageId": message_id,
        "description": description,
        "previewImageUrl": preview_image_url,
        "isPublic": is_public,
        "tags": tags or [],
        "createdAt": now,
        "updatedAt": now,
    }
    
    try:
        container.create_item(body=asset)
        logger.info(f"Created asset {asset_id} for user {user_id}")
        return asset
    except Exception as e:
        logger.error(f"Error creating asset: {e}")
        raise


def get_asset(asset_id: str, user_id: str) -> Optional[Dict[str, Any]]:
    """
    Get an asset by ID.

    Args:
        asset_id: The asset ID
        user_id: The user ID (partition key)

    Returns:
        The asset document or None if not found
    """
    container = _get_assets_container()
    
    try:
        asset = container.read_item(item=asset_id, partition_key=user_id)
        return asset
    except CosmosResourceNotFoundError:
        return None
    except Exception as e:
        logger.error(f"Error fetching asset {scrub(asset_id)}: {scrub(e)}")
        return None


def update_asset(
    asset_id: str,
    user_id: str,
    updates: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    """
    Update an existing asset.

    Args:
        asset_id: The asset ID
        user_id: The user ID (partition key)
        updates: Dictionary of fields to update

    Returns:
        The updated asset document or None if not found
    """
    container = _get_assets_container()
    
    try:
        existing = container.read_item(item=asset_id, partition_key=user_id)
        if existing.get("immutable"):
            logger.warning("Refused update of immutable asset %s", asset_id)
            return None
        
        # Update allowed fields
        allowed_fields = ["title", "description", "content", "category", "type", 
                         "previewImageUrl", "isPublic", "tags"]
        for field in allowed_fields:
            if field in updates:
                existing[field] = updates[field]
        
        existing["updatedAt"] = datetime.utcnow().isoformat() + "Z"
        
        updated = container.replace_item(item=asset_id, body=existing)
        logger.info(f"Updated asset {asset_id}")
        return updated
    except CosmosResourceNotFoundError:
        return None
    except Exception as e:
        logger.error(f"Error updating asset {asset_id}: {e}")
        raise


def delete_asset(asset_id: str, user_id: str) -> bool:
    """
    Delete an asset.

    Args:
        asset_id: The asset ID
        user_id: The user ID (partition key)

    Returns:
        True if deleted, False if not found
    """
    container = _get_assets_container()
    
    try:
        existing = container.read_item(item=asset_id, partition_key=user_id)
        if existing.get("immutable"):
            logger.warning("Refused deletion of immutable asset %s", asset_id)
            return False
        container.delete_item(item=asset_id, partition_key=user_id)
        logger.info(f"Deleted asset {asset_id}")
        return True
    except CosmosResourceNotFoundError:
        return False
    except Exception as e:
        logger.error(f"Error deleting asset {asset_id}: {e}")
        raise


def list_user_assets(
    user_id: str,
    category: Optional[str] = None,
    agent_id: Optional[str] = None,
    thread_id: Optional[str] = None,
    limit: int = 50
) -> List[Dict[str, Any]]:
    """
    List assets for a user with optional filters.

    Args:
        user_id: The user ID (partition key)
        category: Optional category filter
        agent_id: Optional agent ID filter
        thread_id: Optional thread ID filter
        limit: Maximum number of assets to return

    Returns:
        List of asset documents
    """
    container = _get_assets_container()
    
    try:
        conditions = ["c.userId = @userId"]
        params = [{"name": "@userId", "value": user_id}]
        
        if category and category != "all":
            conditions.append("c.category = @category")
            params.append({"name": "@category", "value": category})
        
        if agent_id:
            conditions.append("c.agentId = @agentId")
            params.append({"name": "@agentId", "value": agent_id})
        
        if thread_id:
            conditions.append("c.threadId = @threadId")
            params.append({"name": "@threadId", "value": thread_id})
        
        query = f"SELECT TOP {limit} * FROM c WHERE {' AND '.join(conditions)} ORDER BY c.createdAt DESC"
        
        items = list(container.query_items(
            query=query,
            parameters=params,
            partition_key=user_id,
        ))
        return items
    except Exception as e:
        logger.error(f"Error listing assets for user {scrub(user_id)}: {scrub(e)}")
        return []


def list_public_assets(
    category: Optional[str] = None,
    tags: Optional[List[str]] = None,
    limit: int = 50
) -> List[Dict[str, Any]]:
    """
    List public assets (inspiration/examples) with optional filters.

    Args:
        category: Optional category filter
        tags: Optional tags filter (matches any)
        limit: Maximum number of assets to return

    Returns:
        List of public asset documents
    """
    container = _get_assets_container()
    
    try:
        conditions = ["c.isPublic = true"]
        params = []
        
        if category and category != "all":
            conditions.append("c.category = @category")
            params.append({"name": "@category", "value": category})
        
        # Note: Tag filtering with ARRAY_CONTAINS requires cross-partition query
        query = f"SELECT TOP {limit} * FROM c WHERE {' AND '.join(conditions)} ORDER BY c.createdAt DESC"
        
        items = list(container.query_items(
            query=query,
            parameters=params,
            enable_cross_partition_query=True,
        ))
        
        # Filter by tags in Python if specified (more flexible than SQL)
        if tags:
            items = [item for item in items if any(t in item.get("tags", []) for t in tags)]
        
        return items
    except Exception as e:
        logger.error(f"Error listing public assets: {e}")
        return []


def get_public_asset(asset_id: str) -> Optional[Dict[str, Any]]:
    """
    Get a public asset by ID (cross-partition query).

    Args:
        asset_id: The asset ID

    Returns:
        The asset document if found and public, else None
    """
    container = _get_assets_container()
    
    try:
        query = "SELECT * FROM c WHERE c.id = @id AND c.isPublic = true"
        items = list(container.query_items(
            query=query,
            parameters=[{"name": "@id", "value": asset_id}],
            enable_cross_partition_query=True,
        ))
        return items[0] if items else None
    except Exception as e:
        logger.error(f"Error fetching public asset {asset_id}: {e}")
        return None


# ══════════════════════════════════════════════════════════════════
# Department CRUD
# ══════════════════════════════════════════════════════════════════

def create_department(
    dept_id: str,
    name: str,
    institution_id: str = "",
    institution_name: str = "",
) -> Dict[str, Any]:
    """Create a new department."""
    container = _get_departments_container()
    doc = {
        "id": dept_id,
        "name": name,
        "institutionId": institution_id,
        "institutionName": institution_name,
        "status": "active",
        "createdAt": datetime.utcnow().isoformat() + "Z",
        "updatedAt": datetime.utcnow().isoformat() + "Z",
    }
    container.create_item(body=doc)
    logger.info(f"Created department {scrub(dept_id)} ({scrub(name)})")
    return doc


def get_department(dept_id: str) -> Optional[Dict[str, Any]]:
    """Get a department by ID."""
    container = _get_departments_container()
    try:
        return container.read_item(item=dept_id, partition_key=dept_id)
    except CosmosResourceNotFoundError:
        return None


def list_departments(status: str = "active") -> List[Dict[str, Any]]:
    """List all departments, optionally filtered by status."""
    container = _get_departments_container()
    query = "SELECT * FROM c WHERE c.status = @status ORDER BY c.name ASC"
    items = list(container.query_items(
        query=query,
        parameters=[{"name": "@status", "value": status}],
        enable_cross_partition_query=True,
    ))
    return items


def update_department(dept_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Update a department's fields (name, institutionId, institutionName, status)."""
    dept = get_department(dept_id)
    if not dept:
        return None
    allowed = {"name", "institutionId", "institutionName", "status"}
    for k, v in updates.items():
        if k in allowed:
            dept[k] = v
    dept["updatedAt"] = datetime.utcnow().isoformat() + "Z"
    container = _get_departments_container()
    container.upsert_item(body=dept)
    logger.info(f"Updated department {scrub(dept_id)}")
    return dept


def delete_department(dept_id: str) -> bool:
    """Soft-delete a department by setting status to 'inactive'."""
    dept = get_department(dept_id)
    if not dept:
        return False
    dept["status"] = "inactive"
    dept["updatedAt"] = datetime.utcnow().isoformat() + "Z"
    container = _get_departments_container()
    container.upsert_item(body=dept)
    logger.info(f"Soft-deleted department {scrub(dept_id)}")
    return True


def add_user_to_department(user_id: str, dept_id: str) -> Optional[Dict[str, Any]]:
    """Add a department ID to a user's departments list. Returns updated profile."""
    profile = get_user_profile(user_id)
    if not profile:
        return None
    depts = profile.get("departments", []) or []
    if dept_id in depts:
        return profile  # already a member
    depts.append(dept_id)
    profile["departments"] = depts
    profile["updatedAt"] = datetime.utcnow().isoformat() + "Z"
    get_cosmos_client()
    _users_container.upsert_item(body=profile)
    logger.info(f"Added user {scrub(user_id)} to department {scrub(dept_id)}")
    return profile


def remove_user_from_department(user_id: str, dept_id: str) -> Optional[Dict[str, Any]]:
    """Remove a department ID from a user's departments list. Returns updated profile."""
    profile = get_user_profile(user_id)
    if not profile:
        return None
    depts = profile.get("departments", []) or []
    if dept_id not in depts:
        return profile  # not a member
    depts.remove(dept_id)
    profile["departments"] = depts
    profile["updatedAt"] = datetime.utcnow().isoformat() + "Z"
    get_cosmos_client()
    _users_container.upsert_item(body=profile)
    logger.info(f"Removed user {scrub(user_id)} from department {scrub(dept_id)}")
    return profile


def list_department_members(dept_id: str) -> List[Dict[str, Any]]:
    """List all users who belong to a given department."""
    get_cosmos_client()
    query = "SELECT c.id, c.userId, c.fullName, c.displayName, c.email, c.role, c.departments FROM c WHERE ARRAY_CONTAINS(c.departments, @deptId)"
    items = list(_users_container.query_items(
        query=query,
        parameters=[{"name": "@deptId", "value": dept_id}],
        enable_cross_partition_query=True,
    ))
    return items


def get_user_departments(user_id: str) -> List[Dict[str, Any]]:
    """Get full department docs for all departments a user belongs to."""
    profile = get_user_profile(user_id)
    if not profile:
        return []
    dept_ids = profile.get("departments", []) or []
    if not dept_ids:
        return []
    result = []
    for did in dept_ids:
        dept = get_department(did)
        if dept and dept.get("status") == "active":
            result.append(dept)
    return result
