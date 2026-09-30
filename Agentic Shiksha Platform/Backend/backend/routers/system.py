"""Public health and client-configuration routes with no external dependencies."""

from collections.abc import Collection
from dataclasses import dataclass

from fastapi import APIRouter
from fastapi.responses import JSONResponse


@dataclass(frozen=True)
class PublicConfiguration:
    version: str
    default_model: str
    agent_model: str
    allowed_models: Collection[str]


def create_system_router(configuration: PublicConfiguration) -> APIRouter:
    router = APIRouter()

    @router.get("/api/health", include_in_schema=False, response_model=None)
    def health() -> dict[str, str]:
        """Health check endpoint for Azure - returns 200 OK"""
        return {"status": "healthy", "service": "ekalaiva-backend"}

    @router.get("/api/healthz", response_model=None)
    def healthz() -> JSONResponse:
        return JSONResponse(
            {
                "status": "ok",
                "version": configuration.version,
                "allowed_models": sorted(configuration.allowed_models),
            }
        )

    @router.get("/api/config", response_model=None)
    def get_config() -> JSONResponse:
        """
        Return frontend configuration from backend.
        Frontend should fetch this instead of hardcoding values.
        """
        return JSONResponse(
            {
                "default_model": configuration.default_model,
                "agent_model": configuration.agent_model,
                "allowed_models": sorted(configuration.allowed_models),
                "version": configuration.version,
            },
            headers={"Cache-Control": "public, max-age=300"},
        )

    return router
