"""Compatible Uvicorn entry point for the independent admin service."""

import logging

from admin_backend.app import create_app
from admin_backend.core.settings import get_runtime_settings

app = create_app()


if __name__ == "__main__":
    import uvicorn

    port = get_runtime_settings().dashboard_port
    logging.getLogger(__name__).info("Starting Dashboard server on port %s", port)
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
