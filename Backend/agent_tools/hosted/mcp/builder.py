"""
MCP hosted tool builder (DEPRECATED / not currently wired).

``MCPTool`` lets an agent call tools exposed by a remote Model Context Protocol
(MCP) server. This project does not currently attach an MCP tool to any agent.
This module is kept as a reference stub so the hosted-tool inventory is
complete.

To enable, construct and attach the tool at agent-creation time, e.g.::

    from azure.ai.projects.models import MCPTool
    tool = MCPTool(server_label="my_server", server_url="https://...")
"""

import logging

logger = logging.getLogger(__name__)


def build_mcp_tool(*args, **kwargs):  # pragma: no cover - deprecated stub
    """Not implemented: MCP tools are not currently used in this project."""
    raise NotImplementedError(
        "MCPTool is not wired in this project."
    )
