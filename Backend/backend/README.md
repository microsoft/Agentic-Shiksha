# Backend API Directory

This directory contains the main FastAPI application entry point.

## Files

| File | Description |
|------|-------------|
| `main.py` | FastAPI application with REST API endpoints |

## Overview

The `main.py` file serves as the gateway for all frontend-backend communication. It defines REST endpoints for:

- **Agent Management** - CRUD operations for AI agents
- **Chat** - Message handling with Azure AI Agents
- **File Operations** - Document upload and management
- **Thread Management** - Conversation thread handling
- **Vector Store** - Knowledge base operations

## API Endpoints

### Agents
- `GET /agents` - List all agents
- `POST /agent/create` - Create a new agent
- `GET /agent/{agent_id}` - Get agent details
- `PUT /agent/{agent_id}` - Update agent configuration
- `DELETE /agent/{agent_id}` - Delete an agent

### Chat
- `POST /chat/{agent_id}` - Send message to agent
- `GET /chat/history/{thread_id}` - Get conversation history

### Files
- `POST /files/upload` - Upload documents
- `DELETE /files/{file_id}` - Delete a file

### Threads
- `GET /threads/{agent_id}` - List threads for an agent
- `POST /threads/create` - Create new thread
- `DELETE /threads/{thread_id}` - Delete a thread

## Running the Server

```bash
# From the Backend directory
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

## Dependencies

The API integrates with:
- `azure_services/` - Azure AI Foundry operations
- `workflows/` - Agent creation workflows
- `base_agents/` - Core agent management
- `custom_agents/` - Specialized agent logic
