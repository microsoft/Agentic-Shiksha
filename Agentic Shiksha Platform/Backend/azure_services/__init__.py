# Azure Services Module
from .persistence.cosmos_db import (
    create_thread,
    get_thread,
    update_thread,
    delete_thread,
    list_threads_for_user,
    add_message,
    get_messages_for_thread,
    delete_message,
    sync_threads_batch,
    sync_messages_batch,
    check_cosmos_connection,
    # User profile operations
    get_user_profile,
    upsert_user_profile,
    delete_user_profile,
    get_users_batch,  # Batch user lookup for joining agent data
    # Agent metadata operations
    create_agent_metadata,
    get_agent_metadata,
    update_agent_metadata,
    delete_agent_metadata,
    list_agents_metadata,
    upsert_agent_metadata,
)
