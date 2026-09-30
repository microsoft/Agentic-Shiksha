# mcp (hosted) — deprecated

Builds an `MCPTool`, which lets an agent call tools exposed by a remote
[Model Context Protocol](https://modelcontextprotocol.io) server.

> **Not currently wired.** Kept as a reference implementation.

`PROJECT_RESOURCE_ID` — the ARM resource id used for MCP project connections — is still
required at import time by [backend/main.py](../../../backend/main.py), so the variable
must be set even though this tool is not attached to any agent.

The main conversation runtime is [harness/runtime.py](../../../harness/runtime.py)
and uses the project's conversations/responses API. That API choice does not mean
this reference builder is enabled; `build_mcp_tool` raises `NotImplementedError`.

## Before re-enabling

A remote MCP server is third-party code reached over the network, and its tool
descriptions are model-visible text. Treat both as untrusted input: pin the server,
review the tools it advertises, and scope its credentials to the minimum needed.
