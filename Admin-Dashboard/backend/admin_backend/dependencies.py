from typing import Annotated

from fastapi import Depends, Request

from admin_backend.services.container import AdminServices


def get_services(request: Request) -> AdminServices:
    return request.app.state.services


Services = Annotated[AdminServices, Depends(get_services)]
