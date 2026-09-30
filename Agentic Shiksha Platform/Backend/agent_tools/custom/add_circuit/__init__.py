import json

from pydantic import ValidationError

from agent_tools.custom.base import CustomTool
from backend.schemas.circuit import CircuitBlock, CircuitSpec
from utils import circuit_simulation
from utils.tool_definitions import load_tool_definition


ADD_CIRCUIT_TOOL_DEFINITION = load_tool_definition("add_circuit")


class AddCircuitTool(CustomTool):
    name = "add_circuit"

    def execute(self, arguments: dict, **context) -> dict:
        try:
            circuit = CircuitSpec.model_validate(arguments)
        except ValidationError:
            raise ValueError("Invalid circuit. Use a title, supported components, bounded SI values, unique IDs, ground node 0, and connected probes.") from None
        result = circuit_simulation.simulate_circuit(circuit)
        return CircuitBlock(title=circuit.title, circuit=circuit, result=result).model_dump(mode="json")

    def output(self, result: dict, arguments: dict) -> str:
        block = CircuitBlock.model_validate(result)
        output = {
            "status": "simulated", "engine": block.result.engine, "mode": block.result.mode,
            "readings": [{"name": trace.name, "unit": trace.unit, "final": trace.values[-1], "min": min(trace.values), "max": max(trace.values)} for trace in block.result.traces],
            "duration_seconds": block.result.time_seconds[-1] if block.result.time_seconds else None,
            "instruments": [reading.model_dump(mode="json", exclude={"channels"}) for reading in block.result.measurements],
            "model_notices": block.result.notices,
            "message": "The interactive circuit is shown. Values are idealized simulation results, not hardware safety certification.",
        }
        return json.dumps(output)