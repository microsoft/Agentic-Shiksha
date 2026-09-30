import os
import socket
from unittest.mock import patch

import pytest


CI_TENANT = "00000000-0000-0000-0000-000000000000"
CI_AUTHORITY = f"https://login.microsoftonline.com/{CI_TENANT}"


def offline_tenant_discovery(tenant_discovery_endpoint, _http_client, **_kwargs):
    expected = f"{CI_AUTHORITY}/v2.0/.well-known/openid-configuration"
    if tenant_discovery_endpoint != expected:
        raise AssertionError("Unit tests must use the synthetic CI tenant for OAuth discovery")
    return {
        "authorization_endpoint": f"{CI_AUTHORITY}/oauth2/v2.0/authorize",
        "token_endpoint": f"{CI_AUTHORITY}/oauth2/v2.0/token",
        "device_authorization_endpoint": f"{CI_AUTHORITY}/oauth2/v2.0/devicecode",
        "issuer": f"{CI_AUTHORITY}/v2.0",
    }


def pytest_configure(config):
    # Fixtures run too late: several test modules import the application during collection.
    discovery = patch("msal.authority.tenant_discovery", side_effect=offline_tenant_discovery)
    discovery.start()
    config.add_cleanup(discovery.stop)
    dotenv = patch.dict(os.environ, {"PYTHON_DOTENV_DISABLED": "1"})
    dotenv.start()
    config.add_cleanup(dotenv.stop)
    original_connect = socket.socket.connect

    def local_connect(connection, address):
        # Windows asyncio builds its self-pipe with a loopback socket pair.
        if connection.family == getattr(socket, "AF_UNIX", None) or (
            isinstance(address, tuple) and address[0] in {"127.0.0.1", "::1", "localhost"}
        ):
            return original_connect(connection, address)
        raise AssertionError("External network is disabled in unit tests; mock the service boundary")

    network = patch.object(socket.socket, "connect", local_connect)
    network.start()
    config.add_cleanup(network.stop)


@pytest.fixture
def offline_oidc_discovery():
    return offline_tenant_discovery
