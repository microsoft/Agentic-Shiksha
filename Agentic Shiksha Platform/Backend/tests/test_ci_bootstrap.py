import socket
from urllib.parse import parse_qs, urlsplit

import msal
import pytest

from auth import EntraAuth


CI_TENANT = "00000000-0000-0000-0000-000000000000"


def test_placeholder_authority_initializes_real_msal_without_http(monkeypatch):
    def unexpected_http(*_args, **_kwargs):
        pytest.fail("OAuth discovery must not contact a real sign-in endpoint")

    monkeypatch.setattr("requests.sessions.Session.request", unexpected_http)
    auth = EntraAuth(
        client_id=CI_TENANT,
        tenant_id=CI_TENANT,
        redirect_uri="http://localhost:8000/auth/callback",
    )
    assert isinstance(auth.app, msal.PublicClientApplication)
    url = urlsplit(auth.get_login_url(state="synthetic-login-state"))
    query = parse_qs(url.query)
    assert url.hostname == "login.microsoftonline.com"
    assert url.path == f"/{CI_TENANT}/oauth2/v2.0/authorize"
    assert query["state"] == ["synthetic-login-state"]
    assert query["code_challenge_method"] == ["S256"]
    assert query["code_challenge"][0]


@pytest.mark.parametrize("endpoint", [
    "https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration",
    "https://example.com/discovery",
    "https://login.microsoftonline.com/another-tenant/v2.0/.well-known/openid-configuration",
])
def test_offline_discovery_rejects_nonfixture_authorities(offline_oidc_discovery, endpoint):
    with pytest.raises(AssertionError, match="synthetic CI tenant"):
        offline_oidc_discovery(endpoint, None)


def test_discovery_fixture_does_not_fabricate_access_tokens(offline_oidc_discovery):
    metadata = offline_oidc_discovery(
        f"https://login.microsoftonline.com/{CI_TENANT}/v2.0/.well-known/openid-configuration",
        None,
    )
    assert "access_token" not in metadata
    assert "id_token" not in metadata
    assert metadata["token_endpoint"].endswith("/oauth2/v2.0/token")


def test_unmocked_external_network_is_blocked_before_connecting():
    with socket.socket() as connection:
        with pytest.raises(AssertionError, match="External network is disabled"):
            connection.connect(("203.0.113.1", 443))


def test_local_socket_pair_remains_available_for_async_test_clients():
    first, second = socket.socketpair()
    with first, second:
        first.sendall(b"offline")
        assert second.recv(7) == b"offline"
