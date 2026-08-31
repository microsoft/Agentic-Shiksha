# mcp (hosted) — deprecated

Builds an `MCPTool`, which lets an agent call tools exposed by a remote
[Model Context Protocol](https://modelcontextprotocol.io) server.

> **Not currently wired.** Kept as a reference implementation.

`PROJECT_RESOURCE_ID` — the ARM resource id used for MCP project connections — is still
required at import time by [backend/main.py](../../../backend/main.py), so the variable
must be set even though this tool is not attached to any agent.

MCP is also why [base_agents/general_agent.py](../../../base_agents/general_agent.py) uses
the `AIProjectClient` conversations/responses API rather than the older threads API: that
surface is the one that supports MCP tool authentication.

## Before re-enabling

A remote MCP server is third-party code reached over the network, and its tool
descriptions are model-visible text. Treat both as untrusted input: pin the server,
review the tools it advertises, and scope its credentials to the minimum needed.
