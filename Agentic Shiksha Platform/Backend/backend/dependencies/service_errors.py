from contextlib import contextmanager

from fastapi import HTTPException

from backend.services.errors import AccessDenied, InvalidInput, MissingResource, NotAuthenticated


@contextmanager
def service_errors():
    """Preserve the API's existing status/detail mapping for domain rejections."""
    try:
        yield
    except InvalidInput as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except NotAuthenticated as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except AccessDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except MissingResource as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
