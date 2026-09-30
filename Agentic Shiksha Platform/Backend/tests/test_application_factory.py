import unittest
from contextlib import asynccontextmanager

from azure.core.exceptions import HttpResponseError
from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient
from starlette.middleware.base import BaseHTTPMiddleware

from backend.app import SWAGGER_UI_A11Y_CSS, create_app
from backend.routers.system import PublicConfiguration, create_system_router


class ApplicationFactoryTests(unittest.TestCase):
    def setUp(self):
        self.configuration = PublicConfiguration(
            version="test-version",
            default_model="test-default",
            agent_model="test-agent",
            allowed_models={"z-model", "a-model"},
        )

    def make_app(self) -> FastAPI:
        return create_app(
            router=create_system_router(self.configuration),
            allowed_origins=["https://frontend.example.com"],
        )

    def test_factories_return_independent_complete_applications(self):
        first, second = self.make_app(), self.make_app()
        self.assertIsNot(first, second)
        self.assertIsNot(first.state, second.state)
        self.assertIsNot(first.dependency_overrides, second.dependency_overrides)
        first.title = "First app"
        with TestClient(first) as client:
            self.assertIn("First app - API Docs", client.get("/docs").text)
        with TestClient(second) as client:
            self.assertIn("Ekalaiva Backend - API Docs", client.get("/docs").text)

    def test_health_and_configuration_contracts(self):
        with TestClient(self.make_app()) as client:
            health = client.get("/api/health")
            self.assertEqual(health.status_code, 200)
            self.assertEqual(
                health.json(), {"status": "healthy", "service": "ekalaiva-backend"}
            )
            healthz = client.get("/api/healthz")
            self.assertEqual(healthz.status_code, 200)
            self.assertEqual(
                healthz.json(),
                {
                    "status": "ok",
                    "version": "test-version",
                    "allowed_models": ["a-model", "z-model"],
                },
            )
            config = client.get("/api/config")
            self.assertEqual(config.status_code, 200)
            self.assertEqual(
                config.json(),
                {
                    "default_model": "test-default",
                    "agent_model": "test-agent",
                    "allowed_models": ["a-model", "z-model"],
                    "version": "test-version",
                },
            )
            self.assertEqual(config.headers["cache-control"], "public, max-age=300")

    def test_openapi_keeps_existing_public_contracts(self):
        schema = self.make_app().openapi()
        self.assertNotIn("/api/health", schema["paths"])
        self.assertNotIn("/docs", schema["paths"])
        for path, operation_id in (
            ("/api/healthz", "healthz_api_healthz_get"),
            ("/api/config", "get_config_api_config_get"),
        ):
            operation = schema["paths"][path]["get"]
            self.assertEqual(operation["operationId"], operation_id)
            self.assertEqual(
                operation["responses"]["200"]["content"]["application/json"]["schema"],
                {},
            )
        self.assertEqual(
            schema["paths"]["/api/config"]["get"]["description"],
            "Return frontend configuration from backend.\n"
            "Frontend should fetch this instead of hardcoding values.",
        )

    def test_cors_middleware_order_and_preflight_contract(self):
        app = self.make_app()
        self.assertEqual(
            [middleware.cls for middleware in app.user_middleware],
            [CORSMiddleware, BaseHTTPMiddleware],
        )
        with TestClient(app) as client:
            response = client.options(
                "/api/config",
                headers={
                    "Origin": "https://frontend.example.com",
                    "Access-Control-Request-Method": "GET",
                    "Access-Control-Request-Headers": "authorization",
                },
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(
                response.headers["access-control-allow-origin"],
                "https://frontend.example.com",
            )
            self.assertEqual(response.headers["access-control-allow-credentials"], "true")
            self.assertEqual(response.headers["access-control-max-age"], "3600")
            denied = client.options(
                "/api/config",
                headers={
                    "Origin": "https://untrusted.example.com",
                    "Access-Control-Request-Method": "GET",
                },
            )
            self.assertEqual(denied.status_code, 400)
            self.assertNotIn("access-control-allow-origin", denied.headers)

    def test_swagger_accessibility_and_content_length_are_preserved(self):
        with TestClient(self.make_app()) as client:
            response = client.get("/docs")
            self.assertEqual(response.status_code, 200)
            self.assertIn(f"<style>{SWAGGER_UI_A11Y_CSS}</style></head>", response.text)
            self.assertEqual(int(response.headers["content-length"]), len(response.content))
            self.assertEqual(client.get("/api/health").headers["content-type"], "application/json")

    def test_nested_lifespans_run_once_in_order_and_receive_serving_app(self):
        events = []
        applications = []

        @asynccontextmanager
        async def root_lifespan(app):
            applications.append(app)
            events.append("root:start")
            yield
            events.append("root:stop")

        @asynccontextmanager
        async def worker_lifespan(app):
            applications.append(app)
            events.append("worker:start")
            yield
            events.append("worker:stop")

        root = APIRouter(lifespan=root_lifespan)
        root.include_router(APIRouter(lifespan=worker_lifespan))
        root.include_router(create_system_router(self.configuration))
        app = create_app(router=root, allowed_origins=[])
        with TestClient(app) as client:
            self.assertEqual(events, ["root:start", "worker:start"])
            self.assertEqual(client.get("/api/health").status_code, 200)
        self.assertEqual(events, ["root:start", "worker:start", "worker:stop", "root:stop"])
        self.assertEqual(applications, [app, app])

    def test_static_and_dynamic_route_order_is_preserved(self):
        router = APIRouter()

        @router.get("/api/items/special")
        def special():
            return {"route": "special"}

        @router.get("/api/items/{item_id}")
        def item(item_id: str):
            return {"route": "item", "id": item_id}

        with TestClient(create_app(router=router, allowed_origins=[])) as client:
            self.assertEqual(client.get("/api/items/special").json(), {"route": "special"})
            self.assertEqual(
                client.get("/api/items/one").json(), {"route": "item", "id": "one"}
            )

    def test_existing_exception_status_and_payload_mapping_is_preserved(self):
        router = APIRouter()

        @router.get("/synthetic/azure-error")
        def azure_error():
            raise HttpResponseError(message="Synthetic Azure failure")

        @router.get("/synthetic/application-error")
        def application_error():
            raise ValueError("Synthetic application failure")

        app = create_app(router=router, allowed_origins=[])
        with TestClient(app, raise_server_exceptions=False) as client:
            azure = client.get("/synthetic/azure-error")
            self.assertEqual(azure.status_code, 400)
            self.assertEqual(
                azure.json(), {"detail": "Azure Agents error: Synthetic Azure failure"}
            )
            application = client.get("/synthetic/application-error")
            self.assertEqual(application.status_code, 500)
            self.assertEqual(
                application.json(), {"detail": "ValueError: Synthetic application failure"}
            )
