import ast
import os
from pathlib import Path
import subprocess
import sys
import textwrap

import pytest


ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "admin_backend"
FLAT_MODULES = {
    "settings", "cosmos_queries", "dashboard_cache", "groundedness_evaluator",
    "logging_agent_chat", "logging_agent_tools", "research_storage", "research_json",
    "token_stats", "log_safe", "common_azure_auth", "backend", "azure_services",
}


def imports(tree):
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            yield from (alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            yield node.module or ""


def test_package_import_direction_and_no_ambiguous_flat_imports():
    for path in PACKAGE.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        imported = list(imports(tree))
        assert not any(name.split(".")[0] in FLAT_MODULES for name in imported), path
        layer = path.relative_to(PACKAGE).parts[0]
        if layer in {"core", "schemas", "services", "integrations"}:
            assert not any(name in {"main", "admin_backend.app", "admin_backend.dependencies"}
                           or name.startswith("admin_backend.routers") for name in imported), path
        if layer in {"services", "schemas"}:
            assert not any(name.split(".")[0] in {"fastapi", "starlette", "azure", "openai"}
                           or name.startswith("admin_backend.integrations") for name in imported), path
        if layer == "routers":
            assert not any(name.startswith("admin_backend.integrations") for name in imported), path
        assert not any(
            isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in {"exec", "globals"}
            for node in ast.walk(tree)
        ), path
        assert not any(
            isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name)
            and node.value.id == "sys" and node.attr in {"modules", "path"}
            for node in ast.walk(tree)
        ), path
    assert not any((ROOT / f"{name}.py").exists() for name in FLAT_MODULES)


@pytest.mark.parametrize("path", sorted(PACKAGE.rglob("*.py")) + [ROOT / "main.py"], ids=lambda path: str(path.relative_to(ROOT)))
def test_production_sources_parse_with_python_311_grammar(path):
    ast.parse(path.read_text(encoding="utf-8"), filename=str(path), feature_version=(3, 11))


def test_independent_entry_and_factory_import_from_an_unrelated_working_directory(tmp_path):
    code = textwrap.dedent("""
        import importlib.abc
        import socket
        import sys
        from unittest.mock import patch

        sys.dont_write_bytecode = True
        sys.path.insert(0, sys.argv[1])
        blocked = {
            "settings", "cosmos_queries", "dashboard_cache", "groundedness_evaluator",
            "logging_agent_chat", "logging_agent_tools", "research_storage", "research_json",
            "token_stats", "log_safe", "common_azure_auth", "backend", "azure_services",
        }
        class RejectForeignService(importlib.abc.MetaPathFinder):
            def find_spec(self, fullname, path=None, target=None):
                if fullname.split(".")[0] in blocked:
                    raise AssertionError("Ambiguous or cross-service import: " + fullname)
        sys.meta_path.insert(0, RejectForeignService())
        def blocked_network(*args, **kwargs):
            raise AssertionError("No live network during the entry-point test")
        with (
            patch.object(socket.socket, "connect", blocked_network),
            patch.object(socket.socket, "connect_ex", blocked_network),
            patch.object(socket, "getaddrinfo", blocked_network),
        ):
            import admin_backend
            from admin_backend.app import create_app
            assert "admin_backend.integrations.cosmos_queries" not in sys.modules
            assert "admin_backend.integrations.groundedness_evaluator" not in sys.modules
            from uvicorn.importer import import_from_string
            app = import_from_string("main:app")
            assert len(app.routes) == 47
            assert callable(import_from_string("admin_backend.app:create_app"))
            from admin_backend.core.settings import BACKEND_ROOT
            from pathlib import Path
            assert BACKEND_ROOT == Path(sys.argv[1])
            from admin_backend.integrations import cosmos_queries, research_storage
            assert cosmos_queries._client is None
            assert research_storage._blob_service_client is None
            with patch.object(cosmos_queries, "_init", side_effect=AssertionError("No live maintenance read")):
                import admin_backend.scripts.check_coverage
            assert "admin_backend.integrations.groundedness_evaluator" not in sys.modules
        print("Independent factory, main:app, anchored settings and inert maintenance import passed")
    """)
    environment = {**os.environ, "PYTHON_DOTENV_DISABLED": "1", "PYTHONDONTWRITEBYTECODE": "1"}
    result = subprocess.run(
        [sys.executable, "-I", "-c", code, str(ROOT)],
        cwd=tmp_path, env=environment, capture_output=True, text=True, timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "Independent factory" in result.stdout
