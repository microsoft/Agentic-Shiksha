"""Explicit Azure ML workspace setup helper, not an application startup step."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from azure.ai.ml import MLClient
    from azure.ai.ml.entities import WorkspaceConnection


def create_search_connection(
    ml_client: MLClient,
    *,
    name: str,
    endpoint: str,
) -> WorkspaceConnection:
    """Create an Entra-authenticated connection using the caller's management client.

    The optional ``azure-ai-ml`` SDK is needed only when invoking this setup helper.
    Importing the module neither reads deployment settings nor contacts Azure.
    """
    from azure.ai.ml.entities import AzureAISearchConnection

    connection = AzureAISearchConnection(name=name, endpoint=endpoint, api_key=None)
    return ml_client.connections.create_or_update(connection)