"""HTTP application assembly, independent of cloud clients when a router is supplied."""

import logging
from collections.abc import Sequence

from azure.core.exceptions import HttpResponseError
from fastapi import APIRouter, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.responses import HTMLResponse, JSONResponse


logger = logging.getLogger("ekalaiva.api")

SWAGGER_UI_A11Y_CSS = """
/* Version stamp contrast fix - background from #7d8492 to #5a6270 */
small:first-child > pre.version {
    background-color: #5a6270 !important;
}

/* OAS version stamp contrast fix - background from #89bf04 to #5d8200 */
.version-stamp > pre.version {
    background-color: #5d8200 !important;
}

/* URL link contrast fix - color from #4990e2 to #3973b6 */
.info .url {
    color: #3973b6 !important;
}

/* GET method badge contrast fix - background from #61affe to #4177ae */
.opblock-get .opblock-summary-method {
    background-color: #4177ae !important;
}

/* POST method badge contrast fix - background from #49cc90 to #2d845c */
.opblock-post .opblock-summary-method {
    background-color: #2d845c !important;
}

/* DELETE method badge contrast fix - background from #f93e3e to #d43434 */
.opblock-delete .opblock-summary-method {
    background-color: #d43434 !important;
}

/* PUT method badge contrast fix */
.opblock-put .opblock-summary-method {
    background-color: #c07020 !important;
}

/* PATCH method badge contrast fix */
.opblock-patch .opblock-summary-method {
    background-color: #3a8a6b !important;
}

/* Expand all button contrast fix - color from #afaeae to #6b6b6b */
.json-schema-2020-12-expand-deep-button {
    color: #6b6b6b !important;
}
"""


async def custom_swagger_ui_html(request: Request):
    """Custom Swagger UI with accessibility fixes for color contrast."""
    return get_swagger_ui_html(
        openapi_url=request.app.openapi_url,
        title=request.app.title + " - API Docs",
        swagger_css_url="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css",
        swagger_ui_parameters={"syntaxHighlight.theme": "monokai"},
    )


async def inject_a11y_css(request: Request, call_next):
    response = await call_next(request)
    if request.url.path == "/docs" and response.status_code == 200:
        body = b""
        async for chunk in response.body_iterator:
            body += chunk
        body_str = body.decode("utf-8")
        body_str = body_str.replace("</head>", f"<style>{SWAGGER_UI_A11Y_CSS}</style></head>")
        headers = {k: v for k, v in response.headers.items() if k.lower() != "content-length"}
        return HTMLResponse(content=body_str, status_code=200, headers=headers)
    return response


async def azure_err_handler(request: Request, exc: HttpResponseError):
    logger.exception("Azure error on %s %s", request.method, request.url.path)
    detail = getattr(exc, "message", None) or str(exc)
    return JSONResponse(status_code=400, content={"detail": f"Azure Agents error: {detail}"})


async def unhandled_err_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": f"{type(exc).__name__}: {exc}"})


def create_app(
    *,
    router: APIRouter | None = None,
    allowed_origins: Sequence[str] | None = None,
) -> FastAPI:
    """Build an app, loading the production route registry only when needed."""
    if router is None or allowed_origins is None:
        from backend import main

        if router is None:
            router = main.router
        if allowed_origins is None:
            allowed_origins = main.origins

    app = FastAPI(title="Ekalaiva Backend", version="0.1.0", docs_url=None)
    app.add_api_route(
        "/docs", custom_swagger_ui_html, methods=["GET"], include_in_schema=False
    )
    app.middleware("http")(inject_a11y_css)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(allowed_origins),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        max_age=3600,
    )
    app.add_exception_handler(HttpResponseError, azure_err_handler)
    app.add_exception_handler(Exception, unhandled_err_handler)
    app.include_router(router)
    return app
