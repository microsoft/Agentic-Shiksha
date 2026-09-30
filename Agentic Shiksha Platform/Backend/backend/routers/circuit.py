import hashlib
import logging
import shutil
from contextlib import contextmanager

from azure.ai.projects.models import FunctionTool, PromptAgentDefinition
from azure.core.exceptions import ResourceExistsError
from fastapi import APIRouter, HTTPException

from backend.routers.course_materials import CurrentUser, require_course
from backend.schemas.circuit import CircuitResult, CircuitSimulationRequest, CircuitToolStatus, EnableCircuitToolRequest
from utils import circuit_simulation
from utils.tool_definitions import load_tool_definition


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/agents", tags=["Circuit simulation"])


def project_client():
    from utils.course_creation import get_creation_client

    return get_creation_client()


def require_tool_owner(agent_name: str, user: CurrentUser) -> None:
    course, _session = require_course(agent_name, user, edit=True)
    if course.get("createdById") != user.id and user.role not in {"admin", "superadmin"}:
        raise HTTPException(status_code=403, detail="Course owner access required")


def tool_status(version) -> CircuitToolStatus:
    tools = [tool for tool in version.definition.tools or [] if tool.type == "function" and tool.name == "add_circuit"]
    current = load_tool_definition("add_circuit")
    return CircuitToolStatus(
        enabled=bool(tools),
        update_available=any(
            getattr(tool, "parameters", None) != current["parameters"]
            or getattr(tool, "description", None) != current["description"]
            for tool in tools
        ),
        engine_available=shutil.which("ngspice") is not None,
        agent_version=str(version.version),
    )


@contextmanager
def tool_update_lock(agent_name: str):
    from azure_services.persistence.cosmos_db import _AGENT_SETUPS_CONTAINER, _get_blob_service_client

    identity = hashlib.sha256(agent_name.encode()).hexdigest()
    blob = _get_blob_service_client().get_blob_client(_AGENT_SETUPS_CONTAINER, f"tool-updates/{identity}.lock")
    try:
        blob.upload_blob(b"", overwrite=False)
    except ResourceExistsError:
        pass
    lease = blob.acquire_lease(lease_duration=60)
    try:
        yield
    finally:
        try:
            lease.release()
        except Exception:
            logger.warning("Circuit tool update lease will expire")


@router.get("/{agent_name}/circuit/tool", response_model=CircuitToolStatus)
def get_circuit_tool(agent_name: str, user: CurrentUser):
    try:
        require_tool_owner(agent_name, user)
        version = project_client().agents.get(agent_name=agent_name, read_timeout=10).versions.latest
        return tool_status(version)
    except HTTPException:
        raise
    except Exception as error:
        logger.warning("Circuit tool status failed (%s)", type(error).__name__)
        raise HTTPException(status_code=503, detail="Circuit tool status could not be checked. Please retry.") from None


@router.post("/{agent_name}/circuit/tool", response_model=CircuitToolStatus)
def enable_circuit_tool(agent_name: str, body: EnableCircuitToolRequest, user: CurrentUser):
    try:
        require_tool_owner(agent_name, user)
        if not shutil.which("ngspice"):
            raise HTTPException(status_code=503, detail="Install the circuit simulator on the backend before enabling this tool.")
        with tool_update_lock(agent_name):
            client = project_client()
            version = client.agents.get(agent_name=agent_name, read_timeout=10).versions.latest
            status = tool_status(version)
            if status.enabled and not status.update_available:
                return status
            if status.agent_version != body.expected_version:
                raise HTTPException(status_code=409, detail="The TA changed. Reload its tool status before enabling or updating the simulator.")
            if version.definition.kind != "prompt":
                raise HTTPException(status_code=409, detail="Circuit tools require a prompt-based TA.")
            definition = PromptAgentDefinition(version.definition.as_dict())
            tool = load_tool_definition("add_circuit")
            replacement = FunctionTool(
                name=tool["name"], description=tool["description"], parameters=tool["parameters"], strict=False,
            )
            definition.tools = [
                replacement if existing.type == "function" and existing.name == "add_circuit" else existing
                for existing in definition.tools or []
            ]
            if not status.enabled:
                definition.tools = [*definition.tools, replacement]
            updated = client.agents.create_version(
                agent_name=agent_name, definition=definition,
                metadata=dict(version.metadata or {}), description=version.description,
                retry_total=0, read_timeout=30,
            )
            from utils.metadata_cache import invalidate_agent_metadata

            invalidate_agent_metadata(agent_name)
            return tool_status(updated)
    except HTTPException:
        raise
    except Exception as error:
        logger.warning("Circuit tool enable failed (%s)", type(error).__name__)
        if getattr(error, "status_code", None) in {409, 412}:
            raise HTTPException(status_code=409, detail="A tool update is already in progress. Recheck the status.") from None
        raise HTTPException(status_code=503, detail="The tool update could not be confirmed. Recheck its status before retrying.") from None


@router.post("/{agent_name}/circuit/simulate", response_model=CircuitResult)
def simulate_course_circuit(agent_name: str, body: CircuitSimulationRequest, user: CurrentUser):
    try:
        require_course(agent_name, user)
        return circuit_simulation.simulate_circuit(body.circuit)
    except HTTPException:
        raise
    except circuit_simulation.CircuitSimulationError as error:
        raise HTTPException(status_code=422, detail=str(error)) from None
    except circuit_simulation.CircuitSimulatorUnavailable as error:
        raise HTTPException(status_code=503, detail=str(error)) from None
    except Exception as error:
        logger.warning("Circuit simulation unavailable (%s)", type(error).__name__)
        raise HTTPException(status_code=503, detail="Circuit simulation is unavailable. Please retry.") from None