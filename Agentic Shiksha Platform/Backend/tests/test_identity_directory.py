import ast
from copy import deepcopy
from http.cookies import SimpleCookie
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
from unittest.mock import Mock
from urllib.parse import parse_qs, urlsplit

from fastapi import APIRouter
from fastapi.testclient import TestClient
import pytest

from backend.app import create_app
from backend.integrations.directory import CosmosDirectoryRepository
from backend.routers.directory import create_directory_router
from backend.routers.identity import create_identity_router
from backend.services.directory import DirectoryService
from backend.services.identity import IdentityService


@pytest.fixture
def api():
    records = {
        "user@example.com": {"id": "student-1", "role": "student", "authProvider": "microsoft"},
        "admin@example.com": {"id": "admin-1", "role": "admin", "authProvider": "google"},
    }
    store = Mock(spec=CosmosDirectoryRepository)
    store.get_invite_by_email.return_value = None
    store.get_user_by_email.side_effect = lambda email: deepcopy(records.get(email))
    store.find_target.return_value = (None, False)
    store.list_directory_users.return_value = []
    entra, google = Mock(), Mock()
    entra.get_login_url.return_value = "https://identity.example.com/authorize?state=example&code_challenge=pkce"
    google.get_login_url.return_value = "https://google.example.com/authorize?state=example"
    entra.complete_login.return_value = {
        "id_token_claims": {"oid": "student-1", "name": "Example User", "preferred_username": "user@example.com"}
    }
    google.complete_login.return_value = {
        "user_id": "google-1", "display_name": "Example User", "email": "user@example.com",
    }
    claims = {
        name: {"sub": user_id, "name": name.title(), "email": email}
        for name, user_id, email in (
            ("student", "student-1", "user@example.com"),
            ("admin", "admin-1", "admin@example.com"),
            ("super", "super-1", "owner@example.com"),
        )
    }
    issuer = Mock(return_value="synthetic-session")
    verifier = Mock(side_effect=lambda token: deepcopy(claims.get(token)))
    identity = IdentityService(
        entra=entra, google=google, directory=store, issue_token=issuer,
        verify_token=verifier, super_admin_email="Owner@Example.com",
    )
    directory = DirectoryService(store, identity)
    router = APIRouter()
    router.include_router(create_identity_router(identity, "https://frontend.example.com"))
    router.include_router(create_directory_router(directory))
    app = create_app(router=router, allowed_origins=[])
    with TestClient(app, base_url="https://api.example.com", follow_redirects=False) as client:
        yield SimpleNamespace(
            client=client, store=store, records=records, identity=identity,
            directory=directory, entra=entra, google=google, issuer=issuer, verifier=verifier,
        )


def sign_in(api, role):
    api.client.cookies.set("session", role)


def redirect_error(response):
    assert response.status_code == 307
    assert "set-cookie" not in response.headers
    return parse_qs(urlsplit(response.headers["location"]).query)["error"][0]


def test_oauth_login_urls_and_root_redirect_are_unchanged(api):
    root = api.client.get("/")
    assert root.status_code == 302
    assert root.headers["location"] == "https://frontend.example.com"
    for path, provider in (("/auth/login", api.entra), ("/auth/google/login", api.google)):
        response = api.client.get(path)
        assert response.status_code == 307
        assert response.headers["location"] == provider.get_login_url.return_value


@pytest.mark.parametrize("provider", ["microsoft", "google"])
def test_oauth_preserves_callback_input_identity_and_cookie_contract(api, provider):
    api.records["user@example.com"]["authProvider"] = provider
    path = "/auth/callback" if provider == "microsoft" else "/auth/google/callback"
    response = api.client.get(path, params={"code": "example-code", "state": "example-state"})
    target = api.entra if provider == "microsoft" else api.google
    target.complete_login.assert_called_once_with({"code": "example-code", "state": "example-state"})
    user_id = "student-1" if provider == "microsoft" else "google-1"
    api.issuer.assert_called_once_with(user_id, "Example User", "user@example.com", provider=provider)
    assert response.status_code == 302
    assert response.headers["location"] == "https://frontend.example.com/auth/callback"
    cookie = SimpleCookie()
    cookie.load(response.headers["set-cookie"])
    session = cookie["session"]
    assert session.value == "synthetic-session"
    assert session["httponly"] is True
    assert session["secure"] is True
    assert session["samesite"] == "none"
    assert session["max-age"] == str(7 * 86400)
    assert session["path"] == "/"
    api.store.promote_invited_user.assert_not_called()


@pytest.mark.parametrize("provider", ["", "temp", "microsoft", "azure-ad"])
def test_microsoft_keeps_existing_provider_aliases(api, provider):
    api.records["user@example.com"]["authProvider"] = provider
    assert api.client.get("/auth/callback").status_code == 302


@pytest.mark.parametrize("provider", ["", "temp", "google"])
def test_google_keeps_existing_provider_aliases_and_email_id_fallback(api, provider):
    api.records["user@example.com"]["authProvider"] = provider
    api.google.complete_login.return_value["user_id"] = ""
    assert api.client.get("/auth/google/callback").status_code == 302
    assert api.issuer.call_args.args[0] == "user@example.com"


@pytest.mark.parametrize("provider,path,friendly", [
    ("google", "/auth/callback", "Google"),
    ("azure-ad", "/auth/google/callback", "Microsoft"),
    ("custom", "/auth/callback", "custom"),
])
def test_provider_conflict_does_not_promote_or_issue_a_session(api, provider, path, friendly):
    api.records["user@example.com"]["authProvider"] = provider
    api.store.get_invite_by_email.return_value = {"id": "invite-1"}
    assert redirect_error(api.client.get(path)) == (
        f"This email is already registered with {friendly}. Please use that login method instead."
    )
    api.store.promote_invited_user.assert_not_called()
    api.issuer.assert_not_called()


@pytest.mark.parametrize("provider,path,user_id", [
    ("microsoft", "/auth/callback", "student-1"),
    ("google", "/auth/google/callback", "google-1"),
])
def test_invitation_is_promoted_before_session_creation(api, provider, path, user_id):
    api.records.clear()
    api.store.get_invite_by_email.return_value = {"id": "invite-1"}

    def issue(*_args, **_kwargs):
        api.store.promote_invited_user.assert_called_once_with(
            "user@example.com", user_id, auth_provider=provider, display_name="Example User"
        )
        return "synthetic-session"

    api.issuer.side_effect = issue
    assert api.client.get(path).status_code == 302


@pytest.mark.parametrize("path", ["/auth/callback", "/auth/google/callback"])
def test_unregistered_accounts_remain_denied(api, path):
    api.records.clear()
    assert redirect_error(api.client.get(path)) == (
        "Access denied. Your account is not registered in the platform. Please contact an administrator."
    )
    api.issuer.assert_not_called()


def test_microsoft_error_short_circuits_provider_and_missing_id_is_denied(api):
    assert redirect_error(api.client.get("/auth/callback?error=access_denied&error_description=No+access")) == "No access"
    api.entra.complete_login.assert_not_called()
    api.entra.complete_login.return_value = {"id_token_claims": {}}
    assert redirect_error(api.client.get("/auth/callback")) == "missing_user_id"
    api.store.get_user_by_email.assert_not_called()


@pytest.mark.parametrize("exception", [ValueError("Invalid state"), RuntimeError("Example provider failure")])
@pytest.mark.parametrize("path", ["/auth/callback", "/auth/google/callback"])
def test_callback_errors_keep_existing_redirect_mapping(api, exception, path):
    api.entra.complete_login.side_effect = exception
    api.google.complete_login.side_effect = exception
    assert redirect_error(api.client.get(path)) == str(exception)
    api.issuer.assert_not_called()


def test_disabled_google_auth_stays_explicit(api):
    api.identity.google = None
    assert api.client.get("/auth/google/status").json() == {"enabled": False}
    for path in ("/auth/google/login", "/auth/google/callback"):
        assert redirect_error(api.client.get(path)) == "google_auth_not_configured"
    api.google.complete_login.assert_not_called()


def test_session_cookie_precedes_bearer_and_logout_deletes_same_cookie(api):
    sign_in(api, "student")
    response = api.client.get("/auth/me", headers={"Authorization": "Bearer admin"})
    assert response.json() == {
        "id": "student-1", "displayName": "Student", "email": "user@example.com",
        "username": "user@example.com", "provider": "microsoft",
    }
    api.verifier.assert_called_once_with("student")
    logout = api.client.post("/auth/logout")
    assert logout.json() == {"status": "ok"}
    cookie = SimpleCookie()
    cookie.load(logout.headers["set-cookie"])
    assert cookie["session"]["path"] == "/"
    assert cookie["session"]["max-age"] == "0"
    assert cookie["session"]["samesite"] == "none"
    assert cookie["session"]["secure"] is True


@pytest.mark.parametrize("header,status,detail", [
    (None, 401, "Not authenticated"),
    ("bearer student", 401, "Not authenticated"),
    ("Bearer  student", 401, "Invalid or expired session"),
    ("Bearer invalid", 401, "Invalid or expired session"),
    ("Bearer student", 200, None),
])
def test_legacy_bearer_extraction_is_not_silently_widened(api, header, status, detail):
    headers = {"Authorization": header} if header is not None else {}
    response = api.client.get("/auth/me", headers=headers)
    assert response.status_code == status
    if detail:
        assert response.json() == {"detail": detail}


def test_directory_privacy_is_stable_and_does_not_mutate_records(api):
    sign_in(api, "student")
    users = [
        {"id": "admin-1", "fullName": "Admin", "email": "admin@example.com", "role": "admin"},
        {"id": "teacher-1", "fullName": "Teacher Name", "email": "teacher@example.com", "role": "teacher"},
        {"id": "student-1", "fullName": "Own Name", "email": "user@example.com", "role": "student"},
        {"id": "student-2", "fullName": "Other Name", "email": "other@example.com", "role": "student"},
    ]
    for user in users:
        user.update(authProvider="microsoft", affiliations=[{"institute": "Example"}], activeAffiliation=1)
    before = deepcopy(users)
    api.store.list_directory_users.return_value = users
    first = api.client.get("/api/directory?role=student&status=active")
    assert first.json() == api.client.get("/api/directory?role=student&status=active").json()
    api.store.list_directory_users.assert_called_with(role="student", status="active")
    rows = {user["id"]: user for user in first.json()}
    assert rows["admin-1"]["name"] == "Admin"
    assert rows["admin-1"]["email"] == "admin@example.com"
    assert rows["admin-1"]["authProvider"] == ""
    assert rows["student-1"]["name"] == "Own Name"
    assert rows["student-1"]["affiliations"] == [{"institute": "Example"}]
    assert rows["student-1"]["activeAffiliation"] == 1
    assert rows["teacher-1"]["name"] == "Teacher 1"
    assert rows["teacher-1"]["email"] == "\u2014"
    assert rows["student-2"]["name"].startswith("Student ")
    assert rows["student-2"]["authProvider"] == ""
    assert rows["student-2"]["affiliations"] == []
    assert users == before


def test_super_admin_directory_view_retains_all_fields(api):
    sign_in(api, "super")
    api.store.list_directory_users.return_value = [{
        "id": "one", "userId": "one", "fullName": "Example", "email": "user@example.com",
        "role": "teacher", "status": "invited", "college": "College", "department": "Department",
        "authProvider": "google", "affiliations": [{"institute": "College"}], "activeAffiliation": 1,
    }]
    assert api.client.get("/api/directory").json() == [{
        "id": "one", "userId": "one", "name": "Example", "email": "user@example.com",
        "role": "teacher", "status": "invited", "institute": "College", "department": "Department",
        "authProvider": "google", "affiliations": [{"institute": "College"}], "activeAffiliation": 1,
    }]
    api.store.get_user_by_email.assert_not_called()


@pytest.mark.parametrize("new,affiliation,status", [(True, False, 201), (False, False, 200), (False, True, 200)])
def test_invitation_preserves_status_and_permissive_schema(api, new, affiliation, status):
    sign_in(api, "admin")
    api.store.invite_user.return_value = ({"id": "one", "name": "Stored"}, new, affiliation)
    response = api.client.post("/api/directory", json={
        "email": "legacy-value", "role": "custom-role", "futureField": "ignored",
    })
    assert response.status_code == status
    assert response.json()["affiliationAdded"] is affiliation
    assert response.json()["alreadyExists"] is (not new and not affiliation)
    api.store.invite_user.assert_called_once_with(
        email="legacy-value", name="", role="custom-role", institute="", department=""
    )


@pytest.mark.parametrize("role,status,detail", [
    (None, 401, "Sign in required"), ("invalid", 401, "Sign in required"),
    ("student", 403, "Admin access required"),
])
def test_directory_writes_still_require_admin_before_storage(api, role, status, detail):
    if role:
        sign_in(api, role)
    response = api.client.post("/api/directory", json={"email": "user@example.com"})
    assert response.status_code == status
    assert response.json() == {"detail": detail}
    api.store.invite_user.assert_not_called()


def test_directory_invited_and_active_updates_preserve_existing_empty_field_behavior(api):
    sign_in(api, "admin")
    target = {"id": "invite-1", "name": "Invited", "role": "student", "department": "Keep"}
    api.store.find_target.return_value = (target, True)
    invited = api.client.patch("/api/directory/invite-1", json={"name": "", "department": None, "future": 1})
    assert invited.status_code == 200
    assert invited.json()["name"] == "Invited"
    assert target["department"] == "Keep"
    assert target["updatedAt"].endswith("Z")
    api.store.save_invitation.assert_called_once_with(target)
    api.store.upsert_user_profile.assert_not_called()
    api.store.find_target.return_value = ({"id": "student-1"}, False)
    api.store.upsert_user_profile.return_value = {"id": "student-1"}
    assert api.client.patch("/api/directory/student-1", json={"name": None}).status_code == 200
    api.store.upsert_user_profile.assert_called_once_with(
        user_id="student-1", full_name="", display_name="", role="", institute="", department=""
    )


def test_directory_admin_grant_and_removal_restrictions_remain_unchanged(api):
    sign_in(api, "admin")
    response = api.client.patch("/api/directory/one", json={"role": "ADMIN"})
    assert response.status_code == 403
    assert response.json()["detail"] == "Only the super-admin can grant the admin role"
    api.store.find_target.assert_not_called()
    api.store.find_target.return_value = ({"email": "OWNER@example.com", "role": "admin"}, False)
    assert api.client.delete("/api/directory/one").json()["detail"] == "The super-admin account cannot be removed"
    api.store.find_target.return_value = ({"email": "another@example.com", "role": "admin"}, False)
    assert api.client.delete("/api/directory/one").json()["detail"] == "Only the super-admin can remove other admins"
    api.store.remove_directory_user.assert_not_called()
    sign_in(api, "super")
    api.store.remove_directory_user.return_value = True
    assert api.client.delete("/api/directory/one").json() == {"status": "ok", "deleted": "one"}


def test_switch_affiliation_uses_session_email_not_claimed_path_identity(api):
    sign_in(api, "student")
    assert api.client.post("/api/directory/other/switch-affiliation", json={"index": 0}).status_code == 403
    api.store.switch_active_affiliation.assert_not_called()
    api.store.switch_active_affiliation.return_value = {"id": "student-1", "activeAffiliation": 2}
    response = api.client.post("/api/directory/student-1/switch-affiliation", json={"index": "2", "extra": True})
    assert response.status_code == 200
    assert response.json()["activeAffiliation"] == 2
    api.store.switch_active_affiliation.assert_called_once_with("student-1", 2)
    api.store.switch_active_affiliation.return_value = None
    assert api.client.post("/api/directory/student-1/switch-affiliation", json={"index": -1}).status_code == 400


@pytest.mark.parametrize("path,body,operation,arguments,result", [
    ("/api/directory/institutes/rename", {"old_name": " Old ", "new_name": " New "}, "rename_institute", ("Old", "New"), {"status": "ok", "updated": 3}),
    ("/api/directory/institutes/delete", {"name": " Old "}, "delete_institute", ("Old",), {"status": "ok", "cleared": 3}),
    ("/api/directory/departments/rename", {"institute": " I ", "old_name": " Old ", "new_name": " New "}, "rename_department", ("I", "Old", "New"), {"status": "ok", "updated": 3}),
    ("/api/directory/departments/delete", {"institute": " I ", "department": " D "}, "delete_department", ("I", "D"), {"status": "ok", "cleared": 3}),
])
def test_institution_changes_keep_superadmin_gate_trimming_and_result(api, path, body, operation, arguments, result):
    method = getattr(api.store, operation)
    method.return_value = 3
    sign_in(api, "admin")
    assert api.client.post(path, json=body).status_code == 403
    method.assert_not_called()
    sign_in(api, "super")
    response = api.client.post(path, json=body)
    assert response.json() == result
    method.assert_called_once_with(*arguments)
    empty = {key: " " for key in body}
    assert api.client.post(path, json=empty).status_code == 400


def test_onboarding_progress_remains_reachable_after_parameterized_routes(api):
    sign_in(api, "super")
    api.store.get_department_onboarding_progress.return_value = {"invited": 3, "active": 2}
    response = api.client.get("/api/directory/onboarding-progress", params={"institute": " I ", "department": " D "})
    assert response.json() == {"invited": 3, "active": 2}
    api.store.get_department_onboarding_progress.assert_called_once_with("I", "D")


def test_directory_repository_reads_initialized_invitation_container(monkeypatch):
    from azure_services.persistence import cosmos_db

    container = Mock()
    target = {"id": "invite-1"}
    container.query_items.return_value = [target]
    monkeypatch.setattr(cosmos_db, "get_user_profile", lambda _user_id: None)
    monkeypatch.setattr(cosmos_db, "_invited_users_container", None)
    monkeypatch.setattr(cosmos_db, "get_cosmos_client", lambda: setattr(cosmos_db, "_invited_users_container", container))
    repository = CosmosDirectoryRepository()
    assert repository.find_target("invite-1") == (target, True)
    container.query_items.assert_called_once_with(
        query="SELECT * FROM c WHERE c.id = @id",
        parameters=[{"name": "@id", "value": "invite-1"}], enable_cross_partition_query=True,
    )
    repository.save_invitation(target)
    container.upsert_item.assert_called_once_with(body=target)


def test_extracted_services_and_schemas_have_no_upward_imports():
    backend = Path(__file__).resolve().parents[1] / "backend"
    for relative in ("services/identity.py", "services/directory.py", "schemas/directory.py"):
        tree = ast.parse((backend / relative).read_text(encoding="utf-8"))
        imports = []
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                imports.append(node.module or "")
            elif isinstance(node, ast.Import):
                imports.extend(alias.name for alias in node.names)
        assert not any(name.startswith(("backend.main", "backend.app", "backend.routers", "fastapi", "starlette")) for name in imports)


def test_extracted_domains_import_without_application_or_cloud_initialization():
    script = """
import socket
def no_network(*args, **kwargs):
    raise AssertionError("Network access during a domain import")
socket.socket.connect = no_network
socket.getaddrinfo = no_network
import backend.routers.identity
import backend.routers.directory
import backend.core.identity
import backend.integrations.directory
import sys
assert "backend.main" not in sys.modules
assert "auth" not in sys.modules
assert "azure_services.persistence.cosmos_db" not in sys.modules
"""
    result = subprocess.run(
        [sys.executable, "-c", script], cwd=Path(__file__).resolve().parents[1],
        capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 0, result.stderr
