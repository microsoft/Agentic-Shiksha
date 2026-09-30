import logging
from typing import Any, Dict

from fastapi import APIRouter, BackgroundTasks, Body, HTTPException

from admin_backend.core.log_safe import scrub
from admin_backend.dependencies import Services
from admin_backend.schemas.research import InstituteResearchRequest, DepartmentResearchRequest

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/api/dashboard/directory/research/bulk-status", tags=["Research"])
def api_bulk_research_status(payload: Dict[str, Any]=Body(...), *, services: Services):
    """
    Get research statuses for multiple institutes and departments in one call.

    Request body:
        items: [{ type: "institute"|"department", institute: str, department?: str }]

    Returns:
        statuses: { key: ResearchStatus }
    """
    return services.research.bulk_status(payload)


@router.post("/api/dashboard/directory/institutes/research", tags=["Research"])
def api_trigger_institute_research(body: InstituteResearchRequest, background_tasks: BackgroundTasks, *, services: Services):
    """Trigger research on an institute. Runs in background."""
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")

    existing = services.research.storage.get_institute_research(name)
    if existing and existing.get("status") == "researching":
        return {"status": "already_researching", "institute": name}

    background_tasks.add_task(services.research.run_institute, institute_name=name, instructions=body.instructions or "")
    logger.info(f"Background task scheduled: institute research for '{scrub(name)}'")
    return {"status": "researching", "institute": name}


@router.get("/api/dashboard/directory/institutes/research", tags=["Research"])
def api_get_institute_research(name: str, *, services: Services):
    """Get institute research status/results."""
    return services.research.get_institute(name)


@router.post("/api/dashboard/directory/departments/research", tags=["Research"])
def api_trigger_department_research(body: DepartmentResearchRequest, background_tasks: BackgroundTasks, *, services: Services):
    """Trigger research on a department. Runs in background."""
    institute = body.institute.strip()
    department = body.department.strip()
    if not institute or not department:
        raise HTTPException(status_code=400, detail="institute and department are required")

    existing = services.research.storage.get_department_research(institute, department)
    if existing and existing.get("status") == "researching":
        return {"status": "already_researching", "institute": institute, "department": department}

    background_tasks.add_task(
        services.research.run_department,
        institute_name=institute,
        department_name=department,
        instructions=body.instructions or "",
    )
    logger.info(f"Background task scheduled: department research for '{scrub(department)}@{scrub(institute)}'")
    return {"status": "researching", "institute": institute, "department": department}


@router.get("/api/dashboard/directory/departments/research", tags=["Research"])
def api_get_department_research(institute: str, department: str, *, services: Services):
    """Get department research status/results."""
    return services.research.get_department(institute, department)


@router.delete("/api/dashboard/directory/institutes/research", tags=["Research"])
def api_cancel_institute_research(name: str, *, services: Services):
    """Cancel an in-progress institute research."""
    return services.research.cancel_institute(name)


@router.delete("/api/dashboard/directory/departments/research", tags=["Research"])
def api_cancel_department_research(institute: str, department: str, *, services: Services):
    """Cancel an in-progress department research."""
    return services.research.cancel_department(institute, department)
