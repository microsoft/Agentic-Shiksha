"""Offline regression fixtures: only the inventory tool itself is imported."""

import ast
from collections import Counter
import json
from pathlib import Path
import textwrap
import unittest
from unittest.mock import patch

import inventory


NO_FRAMEWORK = 'FastAPI(openapi_url=None, docs_url=None, redoc_url=None)'


def build(main: str, **modules: str) -> dict:
    supplied = {"fixture/main.py": textwrap.dedent(main)}
    supplied.update({
        "fixture/" + (name if name.endswith(".py") else name.replace("__", "/") + ".py"): textwrap.dedent(source)
        for name, source in modules.items()
    })
    return inventory.build_inventory(
        Path(__file__).resolve().parent,
        supplied=supplied,
        specs=(("main", "fixture", "main", "app"),),
    )


class InventoryTests(unittest.TestCase):
    def test_imports_prefix_constants_multiple_methods_and_decorators(self):
        result = build(f"""
            from fastapi import FastAPI, Depends
            from child import router as mounted
            ROOT = "/v1"
            app = {NO_FRAMEWORK}
            app.include_router(mounted, prefix=ROOT, dependencies=[Depends(check_root)])
        """, child="""
            from fastapi import APIRouter as Routes, Depends
            BASE = "/items"
            router = Routes(prefix=BASE, dependencies=[Depends(check_router)])
            @router.get("/alias")
            @router.api_route(f"{BASE}/{{item_id}}", methods=["GET", "POST"])
            def fetch(user=Depends(check_user)):
                pass
        """)
        self.assertEqual(
            [(row["method"], row["path"]) for row in result["routes"]],
            [("GET", "/v1/items/items/{item_id}"), ("POST", "/v1/items/items/{item_id}"), ("GET", "/v1/items/alias")],
        )
        self.assertEqual(result["routes"][0]["dependencies"], [
            "Depends(check_root)", "Depends(check_router)", "Depends(check_user)",
        ])
        self.assertEqual(result["services"][0]["source_declarations"], 2)
        self.assertEqual(result["services"][0]["explicit_operations"], 3)
        self.assertFalse(result["unresolved"])

    def test_entry_rebinding_factory_and_nested_handler_identity(self):
        result = build("""
            from fastapi import APIRouter
            from factory import create_app
            router = APIRouter()
            app = router
            @app.get("/legacy")
            def legacy(): pass
            app = create_app(router=router)
        """, factory="""
            from fastapi import FastAPI
            def create_app(*, router):
                app = FastAPI(docs_url=None)
                @app.get("/factory")
                def endpoint(): pass
                app.include_router(router)
                return app
        """)
        self.assertEqual([row["path"] for row in result["routes"]], ["/factory", "/legacy"])
        self.assertEqual(result["routes"][0]["handler_id"], "fixture/factory.py::create_app.<locals>.endpoint")
        self.assertEqual({row["path"] for row in result["framework_routes"]}, {"/redoc", "/openapi.json"})
        self.assertEqual(len(result["framework_routes"]), 4)
        self.assertFalse(result["unresolved"])

    def test_add_route_preserves_handler_source_and_docs_are_explicit(self):
        result = build("""
            from fastapi import FastAPI
            from ui import show_docs as docs
            app = FastAPI(docs_url=None)
            app.add_api_route("/docs", docs, methods=["GET"], include_in_schema=False)
        """, ui="""
            def show_docs(): pass
        """)
        self.assertEqual(len(result["routes"]), 1)
        route = result["routes"][0]
        self.assertEqual(route["handler_id"], "fixture/ui.py::show_docs")
        self.assertEqual(route["declaration_source"], "fixture/main.py")
        self.assertFalse(route["include_in_schema"])
        self.assertNotIn("/docs", {row["path"] for row in result["framework_routes"]})

    def test_overwritten_functions_keep_registered_originals(self):
        result = build(f"""
            from fastapi import FastAPI
            app = {NO_FRAMEWORK}
            @app.get("/first")
            def endpoint(): pass
            original = endpoint
            @app.get("/second")
            def endpoint(): pass
            app.add_api_route("/third", original, methods=["POST"])
        """)
        self.assertEqual([row["path"] for row in result["routes"]], ["/first", "/second", "/third"])
        self.assertEqual([row["binding_overwritten"] for row in result["routes"]], [True, False, True])
        self.assertEqual(result["routes"][0]["definition_line"], result["routes"][2]["definition_line"])
        self.assertEqual(len({row["handler_id"] for row in result["routes"]}), 1)
        self.assertEqual(len({row["declaration_id"] for row in result["routes"]}), 3)

    def test_duplicate_path_patterns_are_preserved_and_shadowed_in_order(self):
        result = build(f"""
            from fastapi import FastAPI, APIRouter
            child = APIRouter(prefix="/v1")
            @child.get("/{{id}}")
            def typed(): pass
            app = {NO_FRAMEWORK}
            app.include_router(child)
            @app.get("/v1/{{other_id}}")
            def compatibility(): pass
            @app.post("/v1/{{id}}")
            def write(): pass
        """)
        self.assertEqual([row["registration"] for row in result["routes"]], ["mounted", "shadowed", "mounted"])
        self.assertEqual(result["routes"][1]["shadowed_by"], result["routes"][0]["route_id"])

    def test_route_order_parameter_shadows_later_literal(self):
        result = build(f"""
            from fastapi import FastAPI
            app = {NO_FRAMEWORK}
            @app.get("/evaluation/groundedness/{{message_group_id}}")
            def by_id(message_group_id: int, session_id: str): pass
            @app.get("/evaluation/groundedness/all")
            def all_results(): pass
            @app.get("/evaluation/groundedness/session/{{session_id}}")
            def session_results(): pass
            @app.post("/evaluation/groundedness/all")
            def write_results(): pass
        """)
        self.assertEqual([row["registration"] for row in result["routes"]], [
            "mounted", "shadowed", "mounted", "mounted",
        ])
        self.assertEqual(result["routes"][1]["shadowed_by"], result["routes"][0]["route_id"])

    def test_route_order_respects_explicit_converter_and_literal_precedence(self):
        result = build(f"""
            from fastapi import FastAPI
            app = {NO_FRAMEWORK}
            @app.get("/items/all")
            def all_items(): pass
            @app.get("/items/{{item_id:int}}")
            def item(): pass
            @app.get("/items/new")
            def new_item(): pass
            @app.get("/items/123")
            def numeric_item(): pass
            @app.get("/assets/{{filename:path}}")
            def asset(): pass
            @app.get("/assets/icons/logo.svg")
            def icon(): pass
        """)
        self.assertEqual([row["registration"] for row in result["routes"]], [
            "mounted", "mounted", "mounted", "shadowed", "mounted", "shadowed",
        ])

    def test_include_is_a_snapshot_and_unmounted_modules_remain_excluded(self):
        result = build(f"""
            from fastapi import FastAPI, APIRouter
            app = {NO_FRAMEWORK}
            child = APIRouter()
            app.include_router(child)
            @child.get("/too-late")
            def late(): pass
        """, unused="""
            from fastapi import APIRouter
            router = APIRouter()
            @router.get("/unused")
            def unused(): pass
        """)
        self.assertEqual(result["routes"], [])
        self.assertEqual(len(result["excluded_declarations"]), 2)
        self.assertIn("include snapshot", result["excluded_declarations"][0]["reason"])
        self.assertIn("Module is not reached", result["excluded_declarations"][1]["reason"])
        self.assertEqual(result["services"][0]["source_declarations"], 2)

    def test_rebound_router_and_uncalled_factory_are_not_reachable(self):
        result = build(f"""
            from fastapi import FastAPI, APIRouter
            app = APIRouter()
            @app.get("/discarded")
            def old(): pass
            app = {NO_FRAMEWORK}
            def never_called():
                @app.get("/not-called")
                def inner(): pass
        """)
        self.assertEqual(result["routes"], [])
        self.assertEqual(len(result["excluded_declarations"]), 2)

    def test_conditional_mount_is_not_treated_as_certain_shadowing(self):
        result = build(f"""
            from fastapi import FastAPI, APIRouter
            child = APIRouter()
            @child.get("/same")
            def optional(): pass
            app = {NO_FRAMEWORK}
            if FEATURE_ENABLED:
                app.include_router(child)
            @app.get("/same")
            def fallback(): pass
        """)
        self.assertEqual([row["registration"] for row in result["routes"]], ["conditional", "mounted"])
        self.assertEqual(result["routes"][0]["conditions"][0]["expression"], "FEATURE_ENABLED")
        self.assertEqual(result["unresolved"][0]["classification"], "conditional")

    def test_static_false_branch_is_excluded_and_try_mount_is_conditional(self):
        result = build(f"""
            from fastapi import FastAPI, APIRouter
            app = {NO_FRAMEWORK}
            if False:
                @app.get("/disabled")
                def disabled(): pass
            child = APIRouter()
            @child.get("/optional")
            def optional(): pass
            try:
                app.include_router(child)
            except ImportError:
                pass
        """)
        self.assertEqual(result["routes"][0]["registration"], "conditional")
        self.assertIn("Statically inactive branch", result["excluded_declarations"][0]["reason"])
        self.assertTrue(any(row["kind"] == "conditional-mount" for row in result["unresolved"]))

    def test_dynamic_path_methods_and_mount_are_classified(self):
        result = build(f"""
            from fastapi import FastAPI, APIRouter
            app = {NO_FRAMEWORK}
            @app.api_route(dynamic_path(), methods=dynamic_methods())
            def dynamic(): pass
            child = APIRouter()
            @child.get("/known")
            def known(): pass
            app.include_router(child, prefix=settings.prefix)
            app.include_router(plugin_router())
        """)
        self.assertEqual(len(result["routes"]), 2)
        self.assertTrue(all(row["registration"] == "unresolved" for row in result["routes"]))
        self.assertEqual({row["kind"] for row in result["unresolved"]}, {
            "dynamic-path", "dynamic-methods", "dynamic-mount-prefix", "unresolved-mount",
        })
        self.assertTrue(all(row["source"] and row["line"] and row["expression"] and row["classification"] for row in result["unresolved"]))

    def test_nested_dependency_aliases_and_dependency_list_constants(self):
        result = build(f"""
            from fastapi import FastAPI, Depends
            from auth import CurrentUser
            DEPS = [Depends(guard)]
            app = {NO_FRAMEWORK}
            @app.get("/", dependencies=DEPS)
            def read(user: CurrentUser): pass
        """, auth="""
            from fastapi import Depends as D
            from typing import Annotated
            def authenticate(): pass
            CurrentUser = Annotated[dict, D(authenticate)]
        """)
        self.assertEqual(result["routes"][0]["dependencies"], ["Depends(guard)", "D(authenticate)"])
        self.assertIn("fixture/auth.py", {row["path"] for row in result["source_files"]})

    def test_explicit_head_options_and_starlette_implicit_head(self):
        result = build(f"""
            from fastapi import FastAPI
            app = {NO_FRAMEWORK}
            @app.get("/api")
            def api(): pass
            @app.head("/head")
            def head(): pass
            @app.options("/options")
            def options(): pass
            @app.route("/starlette", methods=["GET"])
            def starlette(request): pass
            @app.websocket("/ws")
            def socket(): pass
        """)
        self.assertEqual([(row["method"], row["path"]) for row in result["routes"]], [
            ("GET", "/api"), ("HEAD", "/head"), ("OPTIONS", "/options"),
            ("GET", "/starlette"), ("HEAD", "/starlette"), ("WEBSOCKET", "/ws"),
        ])
        self.assertEqual(result["routes"][4]["method_origin"], "Starlette Route implicit HEAD")
        self.assertEqual(result["routes"][5]["protocol"], "websocket")

    def test_framework_redirect_default_does_not_follow_custom_docs_prefix(self):
        result = build("""
            from fastapi import FastAPI
            app = FastAPI(docs_url="/dashboard/docs", openapi_url="/dashboard/openapi.json")
        """)
        self.assertEqual({row["path"] for row in result["framework_routes"]}, {
            "/dashboard/docs", "/dashboard/openapi.json", "/docs/oauth2-redirect", "/redoc",
        })
        self.assertEqual(len(result["framework_routes"]), 8)
        self.assertFalse(result["routes"])

    def test_plain_dotted_import_and_applied_decorator(self):
        result = build(f"""
            from fastapi import FastAPI
            import package.routes
            app = {NO_FRAMEWORK}
            app.include_router(package.routes.router, prefix="/nested")
        """, package__routes="""
            from fastapi import APIRouter
            router = APIRouter()
            def handler(): pass
            router.get("/route")(handler)
        """)
        self.assertEqual(result["routes"][0]["path"], "/nested/route")
        self.assertEqual(result["routes"][0]["handler"], "handler")
        self.assertFalse(result["unresolved"])

    def test_package_forwarding_factory_preserves_router_tuple_order(self):
        result = build("""
            from admin_backend.app import create_app
            app = create_app()
        """, **{
            "admin_backend/__init__.py": "",
            "admin_backend/routers/__init__.py": "",
            "admin_backend__app": """
                from fastapi import FastAPI
                from admin_backend.routers import agents, feedback, health
                def create_app():
                    app = FastAPI(docs_url="/admin/docs", openapi_url="/admin/openapi.json")
                    for router in (health.router, agents.listing_router, feedback.router, agents.router):
                        app.include_router(router)
                    return app
            """,
            "admin_backend__routers__health": """
                from fastapi import APIRouter
                router = APIRouter()
                @router.get("/health")
                def health(): pass
            """,
            "admin_backend__routers__agents": """
                from fastapi import APIRouter
                router = APIRouter()
                listing_router = APIRouter()
                @listing_router.get("/agents")
                def list_agents(): pass
                @router.post("/transfer")
                def transfer_ownership(): pass
            """,
            "admin_backend__routers__feedback": """
                from fastapi import APIRouter
                router = APIRouter()
                @router.get("/feedback")
                def get_feedback(): pass
            """,
        })
        self.assertEqual([row["path"] for row in result["routes"]], [
            "/health", "/agents", "/feedback", "/transfer",
        ])
        self.assertEqual([row["handler_id"] for row in result["routes"]], [
            "fixture/admin_backend/routers/health.py::health",
            "fixture/admin_backend/routers/agents.py::list_agents",
            "fixture/admin_backend/routers/feedback.py::get_feedback",
            "fixture/admin_backend/routers/agents.py::transfer_ownership",
        ])
        self.assertTrue(all(
            row["mounts"][1]["source"] == "fixture/admin_backend/app.py"
            and row["mounts"][1]["kind"] == "include_router"
            for row in result["routes"]
        ))
        self.assertEqual(result["services"][0]["assembly_source"], "fixture/admin_backend/app.py")
        self.assertEqual(result["services"][0]["source_declarations"], 4)
        self.assertEqual(len(result["framework_routes"]), 8)
        self.assertFalse(result["unresolved"])
        self.assertFalse(result["excluded_declarations"])

    def test_literal_registration_loop_and_multi_mount_preserve_instances(self):
        result = build(f"""
            from fastapi import FastAPI, APIRouter
            app = {NO_FRAMEWORK}
            child = APIRouter()
            @child.get("/item")
            def item(): pass
            for prefix in ["/one", "/two"]:
                app.include_router(child, prefix=prefix)
        """)
        self.assertEqual([row["path"] for row in result["routes"]], ["/one/item", "/two/item"])
        self.assertEqual(result["services"][0]["source_declarations"], 1)
        self.assertEqual(result["services"][0]["reachable_declarations"], 1)

    def test_tests_and_data_excluded_but_explicitly_mounted_script_followed(self):
        result = build(f"""
            from fastapi import FastAPI
            from scripts.mounted import router
            app = {NO_FRAMEWORK}
            app.include_router(router)
        """, scripts__mounted="""
            from fastapi import APIRouter
            router = APIRouter()
            @router.get("/mounted-script")
            def mounted(): pass
        """, scripts__unused="raise RuntimeError('not parsed')",
            tests__test_ignored="this is not valid python",
            user_data__ignored="this is not valid python")
        self.assertEqual(result["routes"][0]["path"], "/mounted-script")
        self.assertEqual(result["services"][0]["scanned_python_files"], 2)
        self.assertFalse(result["unresolved"])

    def test_no_application_execution(self):
        result = build(f"""
            raise RuntimeError("importing this application would fail")
            from fastapi import FastAPI
            app = {NO_FRAMEWORK}
            @app.get("/static")
            def route():
                raise RuntimeError("running this endpoint would fail")
        """)
        self.assertEqual(result["routes"][0]["path"], "/static")


class ProductionInventoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(__file__).resolve().parents[3]
        cls.result = inventory.build_inventory(cls.root)

    def test_independent_raw_ast_declaration_counts_match_partition(self):
        for service, folder, _, _ in inventory.SERVICE_SPECS:
            census = 0
            for directory, names, files in __import__("os").walk(self.root.joinpath(*folder.split("/"))):
                names[:] = [
                    name for name in names
                    if name.lower() not in inventory.HARD_EXCLUDED | inventory.SOFT_EXCLUDED
                ]
                for name in files:
                    if not name.endswith(".py") or name.startswith("test_") or name.endswith("_test.py"):
                        continue
                    tree = ast.parse((Path(directory) / name).read_text(encoding="utf-8-sig"))
                    for node in ast.walk(tree):
                        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                            census += sum(
                                isinstance(decorator, ast.Call)
                                and isinstance(decorator.func, ast.Attribute)
                                and decorator.func.attr in inventory.DECORATORS
                                for decorator in node.decorator_list
                            )
                        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                            census += node.func.attr in inventory.ADD_ROUTES
            info = next(item for item in self.result["services"] if item["name"] == service)
            self.assertEqual(census, info["source_declarations"])
            ids = {row["declaration_id"] for row in self.result["routes"] if row["service"] == service}
            excluded = {row["declaration_id"] for row in self.result["excluded_declarations"] if row["service"] == service}
            self.assertFalse(ids & excluded)
            self.assertEqual(census, len(ids) + len(excluded))

    def test_source_functions_match_every_resolved_handler_id(self):
        sources = inventory.Sources(self.root)
        for row in self.result["routes"]:
            if row["registration"] == "unresolved":
                continue
            source = sources.get(row["source"])
            self.assertIn(row["handler"], source.names.values())
            self.assertEqual(row["handler_id"], row["source"] + "::" + row["handler"])
            self.assertTrue(any(
                source.names.get(id(node)) == row["handler"] and node.lineno == row["definition_line"]
                for node in ast.walk(source.tree)
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            ))

    def test_admin_entrypoint_resolves_to_canonical_package_handlers(self):
        service = next(item for item in self.result["services"] if item["name"] == "admin")
        self.assertEqual(service["entrypoint"], "main:app")
        self.assertEqual(service["assembly_source"], "Admin-Dashboard/backend/admin_backend/app.py")
        rows = [row for row in self.result["routes"] if row["service"] == "admin"]
        self.assertEqual(len(rows), 43)
        self.assertEqual(len({row["handler_id"] for row in rows}), 43)
        self.assertTrue(all(
            row["source"].startswith("Admin-Dashboard/backend/admin_backend/routers/")
            and row["handler_id"] == row["source"] + "::" + row["handler"]
            for row in rows
        ))
        self.assertTrue(all(
            any(mount["kind"] == "include_router" and mount["source"] == service["assembly_source"] for mount in row["mounts"])
            for row in rows
        ))

    def test_recorded_inventory_is_current_and_json_serializable(self):
        path = self.root / "docs" / "workflows" / "api-inventory.json"
        self.assertEqual(json.loads(path.read_text(encoding="utf-8")), self.result)
        json.dumps(self.result)

    def test_check_does_not_write(self):
        with patch.object(Path, "write_bytes", side_effect=AssertionError("--check wrote a file")):
            self.assertEqual(inventory.main(["--check"]), 0)

    def test_inventory_registration_counts_are_explicitly_partitioned(self):
        for service in self.result["services"]:
            rows = [row for row in self.result["routes"] if row["service"] == service["name"]]
            self.assertEqual(dict(Counter(row["registration"] for row in rows)), service["registration_counts"])
            self.assertEqual(len(rows), service["explicit_operations"])


if __name__ == "__main__":
    unittest.main()
