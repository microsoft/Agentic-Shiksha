import json
import shutil
import subprocess
from pathlib import Path
from unittest.mock import Mock

import pytest
from pydantic import ValidationError

from backend.schemas.circuit import CircuitSpec
from utils import circuit_simulation


def divider():
    return {
        "title": "Voltage divider", "components": [
            {"id": "Supply", "kind": "voltage_source", "positive": "vin", "negative": "0", "value": 10},
            {"id": "R1", "kind": "resistor", "positive": "vin", "negative": "out", "value": 1000},
            {"id": "R2", "kind": "resistor", "positive": "out", "negative": "0", "value": 1000},
        ], "analysis": {"mode": "dc", "probes": ["out"]},
    }


def test_circuit_schema_excludes_retired_trainer_and_preserves_simulation_limits():
    from agent_tools.a2ui.catalog import COMPONENT_PROPERTIES
    from utils.tool_definitions import load_tool_definition

    definition = load_tool_definition("add_circuit")
    parameters = definition["parameters"]
    assert parameters["required"] == ["title", "components", "analysis"]
    assert parameters["additionalProperties"] is False
    assert "trainer" not in parameters["properties"]
    assert "trainer" not in definition["description"].lower()
    assert parameters["properties"]["components"]["minItems"] == 2
    assert parameters["properties"]["components"]["maxItems"] == 48
    assert COMPONENT_PROPERTIES["Circuit"] == ["title", "circuit", "result"]


@pytest.mark.parametrize("include_circuit", [False, True])
def test_circuit_tool_rejects_retired_trainer_input_before_solving(monkeypatch, include_circuit):
    from agent_tools.custom.add_circuit import AddCircuitTool

    arguments = divider() if include_circuit else {"title": "Retired exercise"}
    arguments["trainer"] = {"exercise": "control_fault", "guided": True}
    solve = Mock()
    monkeypatch.setattr(circuit_simulation, "simulate_circuit", solve)
    with pytest.raises(ValueError, match="Invalid circuit"):
        AddCircuitTool().execute(arguments)
    solve.assert_not_called()


def test_retired_trainer_routes_are_absent_while_circuit_routes_remain():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.routers import circuit as routes

    app = FastAPI()
    app.include_router(routes.router)
    paths = app.openapi()["paths"]
    assert set(paths) == {
        "/api/agents/{agent_name}/circuit/tool",
        "/api/agents/{agent_name}/circuit/simulate",
    }
    api = TestClient(app)
    address = "/api/agents/course-example/industrial-trainer"
    assert api.get(address).status_code == 404
    assert api.post(address, json={}).status_code == 404
    assert api.post(f"{address}/action", json={}).status_code == 404


def test_industrial_contract_preserves_legacy_limits_and_checks_named_terminals():
    data = divider()
    assert CircuitSpec.model_validate(data).format_version == 1
    data["format_version"] = 2
    data["analysis"] = {"mode": "transient", "duration_seconds": 0.1}
    data["components"][0].update(kind="three_phase_source", value=1, frequency_hz=50, terminals={"L2": "phase_b", "L3": "phase_c"})
    circuit = CircuitSpec.model_validate(data)
    assert circuit.components[0].nodes() == ["vin", "0", "phase_b", "phase_c"]
    data["format_version"] = 1
    with pytest.raises(ValidationError, match="format version 2"):
        CircuitSpec.model_validate(data)
    data["format_version"] = 2
    data["components"][0]["terminals"]["unexpected"] = "extra"
    with pytest.raises(ValidationError, match="terminal contract"):
        CircuitSpec.model_validate(data)


def test_industrial_contract_rejects_incompatible_faults_events_and_links():
    data = divider()
    data["format_version"] = 2
    data["faults"] = [{"component_id": "R1", "kind": "weak_capacitor"}]
    with pytest.raises(ValidationError, match="incompatible"):
        CircuitSpec.model_validate(data)
    data["faults"] = []
    data["components"][1].update(kind="contact_no", value=1, link="R2")
    with pytest.raises(ValidationError, match="link to"):
        CircuitSpec.model_validate(data)
    data = divider()
    data.update(format_version=2, analysis={"mode": "transient", "duration_seconds": 0.1}, events=[{"component_id": "R1", "time_seconds": 0, "action": "press"}])
    with pytest.raises(ValidationError, match="not supported"):
        CircuitSpec.model_validate(data)


@pytest.mark.skipif(not shutil.which("ngspice"), reason="ngspice is required for industrial electrical models")
def test_industrial_three_phase_meter_and_series_ammeter():
    data = {"title": "Three phase", "format_version": 2, "components": [
        {"id": "Grid", "kind": "three_phase_source", "positive": "a", "negative": "0", "terminals": {"L2": "b", "L3": "c"}, "frequency_hz": 50},
        {"id": "Ammeter", "kind": "ammeter", "positive": "a", "negative": "load"},
        {"id": "Load", "kind": "resistor", "positive": "load", "negative": "0", "value": 100},
    ], "analysis": {"mode": "transient", "duration_seconds": 0.1}, "instruments": [
        {"id": "Line", "kind": "voltmeter", "positive": "a", "negative": "b", "mode": "ac"},
        {"id": "Phase", "kind": "voltmeter", "positive": "b", "mode": "ac"},
        {"id": "Clamp", "kind": "clamp_meter", "mode": "ac", "conductors": [{"component_id": "Ammeter"}]},
    ]}
    result = circuit_simulation.simulate_circuit(CircuitSpec.model_validate(data))
    values = {reading.instrument_id: reading.quantities[0].value for reading in result.measurements}
    assert values["Line"] == pytest.approx(400, rel=0.003)
    assert values["Phase"] == pytest.approx(400 / 3 ** 0.5, rel=0.003)
    assert values["Clamp"] == pytest.approx(400 / 3 ** 0.5 / 100, rel=0.003)


@pytest.mark.skipif(not shutil.which("ngspice"), reason="ngspice is required for linked controls")
def test_industrial_linked_contacts_hold_after_start_and_open_on_stop():
    data = {"title": "Linked control", "format_version": 2, "components": [
        {"id": "Supply", "kind": "voltage_source", "positive": "supply", "negative": "0", "value": 24},
        {"id": "Stop", "kind": "pushbutton_nc", "positive": "supply", "negative": "after_stop", "closed": False},
        {"id": "Start", "kind": "pushbutton_no", "positive": "after_stop", "negative": "coil", "closed": False},
        {"id": "KM1", "kind": "contactor_coil", "positive": "coil", "negative": "0", "value": 240},
        {"id": "Holding", "kind": "contact_no", "positive": "after_stop", "negative": "coil", "link": "KM1"},
    ], "analysis": {"mode": "transient", "duration_seconds": 0.1}, "events": [
        {"component_id": "Start", "time_seconds": 0.01, "action": "press"},
        {"component_id": "Start", "time_seconds": 0.03, "action": "release"},
        {"component_id": "Stop", "time_seconds": 0.07, "action": "press"},
    ]}
    result = circuit_simulation.simulate_circuit(CircuitSpec.model_validate(data))
    current = next(trace.values for trace in result.traces if trace.name == "KM1" and trace.unit == "A")
    middle = min(range(len(result.time_seconds)), key=lambda index: abs(result.time_seconds[index] - 0.05))
    assert current[middle] == pytest.approx(0.1, rel=0.001)
    assert abs(current[-1]) < 1e-8


@pytest.mark.skipif(not shutil.which("ngspice"), reason="ngspice is required for transformer models")
def test_industrial_transformer_ratio_and_bridge_rectification():
    data = {"title": "Transformer bridge", "format_version": 2, "components": [
        {"id": "Supply", "kind": "voltage_source", "positive": "primary", "negative": "0", "value": 24, "waveform": "sine", "frequency_hz": 50},
        {"id": "Transformer", "kind": "transformer", "positive": "primary", "negative": "0", "value": 2, "terminals": {"S1": "secondary", "S2": "return"}},
        {"id": "Bridge", "kind": "bridge_rectifier", "positive": "secondary", "negative": "return", "terminals": {"DC_P": "dc", "DC_N": "0"}},
        {"id": "Load", "kind": "resistor", "positive": "dc", "negative": "0", "value": 1000},
    ], "analysis": {"mode": "transient", "duration_seconds": 0.1}, "instruments": [
        {"id": "Secondary", "kind": "voltmeter", "positive": "secondary", "negative": "return", "mode": "ac", "window_start_seconds": 0.04},
        {"id": "Rectified", "kind": "voltmeter", "positive": "dc", "mode": "dc", "window_start_seconds": 0.04},
    ]}
    result = circuit_simulation.simulate_circuit(CircuitSpec.model_validate(data))
    assert result.measurements[0].quantities[0].value == pytest.approx(12 / 2 ** 0.5, rel=0.02)
    assert 6 < result.measurements[1].quantities[0].value < 8


def motor_circuit():
    return {"title": "Motor model", "format_version": 2, "components": [
        {"id": "Grid", "kind": "three_phase_source", "positive": "a", "negative": "0", "terminals": {"L2": "b", "L3": "c"}, "frequency_hz": 50},
        {"id": "Motor", "kind": "induction_motor", "positive": "a", "negative": "0", "terminals": {"V1": "b", "V2": "0", "W1": "c", "W2": "0", "PE": "0"}, "parameters": {"load_torque_nm": 2}},
    ], "analysis": {"mode": "transient", "duration_seconds": 0.4}, "instruments": [{"id": "Speed", "kind": "rpm_meter", "target": "Motor"}]}


@pytest.mark.skipif(not shutil.which("ngspice"), reason="ngspice is required for machine dynamics")
def test_industrial_motor_accelerates_below_sync_and_reverses_with_phase_sequence():
    data = motor_circuit()
    result = circuit_simulation.simulate_circuit(CircuitSpec.model_validate(data))
    speed = result.measurements[0].quantities[0].value
    assert 1300 < speed < 1500
    temperature = next(trace.values[-1] for trace in result.traces if trace.unit == "degC")
    assert temperature > 25
    current = next(trace.values for trace in result.traces if trace.name == "Motor" and trace.unit == "A")
    assert max(abs(value) for value in current[:len(current) // 4]) > max(abs(value) for value in current[-len(current) // 4:]) * 2
    data["components"][0]["parameters"] = {"phase_sequence": "acb"}
    reversed_result = circuit_simulation.simulate_circuit(CircuitSpec.model_validate(data))
    assert reversed_result.measurements[0].quantities[0].value == pytest.approx(-speed, rel=0.02)


@pytest.mark.skipif(not shutil.which("ngspice"), reason="ngspice is required for motor equivalent-circuit comparison")
def test_industrial_motor_matches_steady_state_equivalent_circuit_and_slip():
    import math

    data = motor_circuit()
    data["instruments"][0]["window_start_seconds"] = 0.3
    data["instruments"].append({"id": "Current", "kind": "clamp_meter", "mode": "ac", "conductors": [{"component_id": "Motor"}], "window_start_seconds": 0.3})
    circuit = CircuitSpec.model_validate(data)
    result = circuit_simulation.simulate_circuit(circuit)
    speed_values = {quantity.label: quantity.value for quantity in result.measurements[0].quantities}
    assert speed_values["Synchronous speed"] == pytest.approx(1500, rel=0.001)
    slip = speed_values["Slip"] / 100
    assert 0 < slip < 0.05
    parameters = circuit.components[1].parameters
    angular_frequency = 2 * math.pi * 50
    stator_impedance = complex(parameters.stator_resistance_ohm, angular_frequency * parameters.stator_leakage_h)
    rotor_impedance = complex(parameters.rotor_resistance_ohm / slip, angular_frequency * parameters.rotor_leakage_h)
    magnetizing_impedance = complex(0, angular_frequency * parameters.magnetizing_h)
    input_impedance = stator_impedance + rotor_impedance * magnetizing_impedance / (rotor_impedance + magnetizing_impedance)
    reference_current = 400 / math.sqrt(3) / abs(input_impedance)
    assert result.measurements[1].quantities[0].value == pytest.approx(reference_current, rel=0.03)


@pytest.mark.skipif(not shutil.which("ngspice"), reason="ngspice is required for protection")
@pytest.mark.parametrize("kind", ["fuse", "mcb", "overload_relay"])
def test_industrial_protection_interrupts_an_overloaded_branch(kind):
    data = {"title": "Protection", "format_version": 2, "components": [
        {"id": "Supply", "kind": "voltage_source", "positive": "supply", "negative": "0", "value": 24},
        {"id": "Protection", "kind": kind, "positive": "supply", "negative": "load", "parameters": {"rated_current_a": 1, "i2t_limit": 0.1, "thermal_time_seconds": 0.01}, **({"terminals": {"L2_IN": "supply", "L2_OUT": "load", "L3_IN": "supply", "L3_OUT": "load"}} if kind == "overload_relay" else {})},
        {"id": "Load", "kind": "resistor", "positive": "load", "negative": "0", "value": 1},
    ], "analysis": {"mode": "transient", "duration_seconds": 0.05}}
    result = circuit_simulation.simulate_circuit(CircuitSpec.model_validate(data))
    assert next(trace.values[-1] for trace in result.traces if trace.name == "Protection" and trace.unit == "state") == 1
    assert abs(next(trace.values[-1] for trace in result.traces if trace.name == "Load" and trace.unit == "A")) < 1e-7


@pytest.mark.skipif(not shutil.which("ngspice"), reason="ngspice is required for optical power")
def test_industrial_lux_uses_explicit_efficacy_and_inverse_square_distance():
    data = divider()
    data["components"][2].update(kind="bulb", parameters={"luminous_efficacy_lm_w": 100})
    data["instruments"] = [{"id": "Lux", "kind": "lux_meter", "target": "R2", "distance_m": 2, "ambient_lux": 10}]
    result = circuit_simulation.simulate_circuit(CircuitSpec.model_validate(data))
    import math
    assert result.measurements[0].quantities[0].value == pytest.approx(10 + 0.025 * 100 / (4 * math.pi * 4))


@pytest.mark.skipif(not shutil.which("ngspice"), reason="ngspice is required for PLC scans")
def test_industrial_plc_uses_input_image_timer_counter_and_power_loss():
    terminals = {**{f"IN{index}": "sensor" if index == 1 else "0" for index in range(1, 5)}, **{f"OUT{index}": f"out{index}" for index in range(1, 5)}}
    data = {"title": "PLC sequence", "format_version": 2, "components": [
        {"id": "Supply", "kind": "voltage_source", "positive": "supply", "negative": "0", "value": 24},
        {"id": "Sensor", "kind": "analog_input", "positive": "sensor", "negative": "0", "value": 0},
        {"id": "PLC", "kind": "plc", "positive": "supply", "negative": "0", "terminals": terminals, "rungs": [
            {"output": "OUT1", "operation": "and", "inputs": [{"terminal": "IN1"}]},
            {"output": "OUT2", "operation": "ton", "inputs": [{"terminal": "IN1"}], "preset": 0.02},
            {"output": "OUT3", "operation": "ctu", "inputs": [{"terminal": "IN1"}], "preset": 2},
        ]},
        {"id": "Load", "kind": "indicator_lamp", "positive": "out1", "negative": "0", "value": 2400},
    ], "analysis": {"mode": "transient", "duration_seconds": 0.12, "probes": ["out1", "out2", "out3"]}, "events": [
        {"component_id": "Sensor", "time_seconds": 0.015, "action": "analog", "value": 24},
        {"component_id": "Sensor", "time_seconds": 0.055, "action": "analog", "value": 0},
        {"component_id": "Sensor", "time_seconds": 0.085, "action": "analog", "value": 24},
    ]}
    result = circuit_simulation.simulate_circuit(CircuitSpec.model_validate(data))
    readings = {trace.name: trace.values for trace in result.traces if trace.unit == "V"}
    at = lambda time: min(range(len(result.time_seconds)), key=lambda index: abs(result.time_seconds[index] - time))
    assert readings["out1"][at(0.018)] < 1
    assert readings["out1"][at(0.028)] > 23
    assert readings["out2"][at(0.03)] < 1
    assert readings["out2"][at(0.05)] > 23
    assert readings["out1"][at(0.075)] < 1
    assert readings["out3"][at(0.05)] < 1
    assert readings["out3"][-1] > 23


@pytest.mark.skipif(not shutil.which("ngspice"), reason="ngspice is required for leakage protection")
@pytest.mark.parametrize("leakage", [False, True])
def test_industrial_rccb_measures_residual_not_load_current(leakage):
    data = {"title": "Residual current", "format_version": 2, "components": [
        {"id": "Supply", "kind": "voltage_source", "positive": "supply", "negative": "0", "value": 24},
        {"id": "RCCB", "kind": "rccb", "positive": "supply", "negative": "line", "terminals": {"N_IN": "0", "N_OUT": "neutral"}, "parameters": {"trip_delay_seconds": 0.01}},
        {"id": "Load", "kind": "resistor", "positive": "line", "negative": "neutral", "value": 100},
        {"id": "Leakage", "kind": "resistor", "positive": "line", "negative": "0", "value": 100 if leakage else 1e8},
    ], "analysis": {"mode": "transient", "duration_seconds": 0.05}}
    result = circuit_simulation.simulate_circuit(CircuitSpec.model_validate(data))
    tripped = next(trace.values[-1] for trace in result.traces if trace.name == "RCCB" and trace.unit == "state")
    assert bool(tripped) is leakage


@pytest.mark.skipif(not shutil.which("ngspice"), reason="ngspice is required for fault models")
def test_industrial_faults_change_real_currents_and_restore_after_interval():
    data = divider()
    data.update(format_version=2, analysis={"mode": "transient", "duration_seconds": 0.1, "probes": ["out"]}, faults=[{"component_id": "R1", "kind": "burnt_contact", "resistance_ohm": 2000, "start_seconds": 0.02, "end_seconds": 0.06}])
    result = circuit_simulation.simulate_circuit(CircuitSpec.model_validate(data))
    output = next(trace.values for trace in result.traces if trace.name == "out" and trace.unit == "V")
    at = lambda time: min(range(len(result.time_seconds)), key=lambda index: abs(result.time_seconds[index] - time))
    assert output[at(0.01)] == pytest.approx(5, abs=0.001)
    assert output[at(0.04)] == pytest.approx(2.5, abs=0.001)
    assert output[-1] == pytest.approx(5, abs=0.001)


@pytest.mark.skipif(not shutil.which("ngspice"), reason="ngspice is required for stalled motor")
def test_industrial_stalled_motor_has_zero_rpm_and_real_heating():
    data = motor_circuit()
    data["faults"] = [{"component_id": "Motor", "kind": "stalled_rotor"}]
    result = circuit_simulation.simulate_circuit(CircuitSpec.model_validate(data))
    assert abs(result.measurements[0].quantities[0].value) < 1
    assert next(trace.values[-1] for trace in result.traces if trace.unit == "degC") > 25.05


@pytest.mark.skipif(not shutil.which("ngspice"), reason="ngspice is required for averaged drive")
def test_industrial_vfd_conserves_average_power_and_reports_fault_codes():
    data = {"title": "Averaged drive", "format_version": 2, "components": [
        {"id": "Bus", "kind": "voltage_source", "positive": "bus", "negative": "0", "value": 48},
        {"id": "Drive", "kind": "vfd", "positive": "bus", "negative": "0", "terminals": {"U": "a", "V": "b", "W": "c", "N": "neutral"}, "parameters": {"drive_ramp_seconds": 0.01}},
        *[{"id": f"Load{phase}", "kind": "resistor", "positive": node, "negative": "neutral", "value": 100} for phase, node in enumerate(["a", "b", "c"])],
    ], "analysis": {"mode": "transient", "duration_seconds": 0.1}, "instruments": [{"id": "Power", "kind": "wattmeter", "positive": "bus", "conductors": [{"component_id": "Drive"}], "window_start_seconds": 0.04}]}
    result = circuit_simulation.simulate_circuit(CircuitSpec.model_validate(data))
    assert result.measurements[0].quantities[0].value == pytest.approx(48 ** 2 / 2 / 100, rel=0.02)
    assert next(trace.values[-1] for trace in result.traces if trace.name == "Drive_code") == 0
    data["components"][0]["value"] = 5
    result = circuit_simulation.simulate_circuit(CircuitSpec.model_validate(data))
    assert next(trace.values[-1] for trace in result.traces if trace.name == "Drive_code") == 1








def test_netlist_uses_allowlisted_elements_and_internal_identifiers():
    data = divider()
    data["title"] = ".control\nshell forbidden\n.endc"
    netlist, signals = circuit_simulation.circuit_netlist(CircuitSpec.model_validate(data))
    assert "shell" not in netlist and ".control" not in netlist
    assert "V1 n2 0 DC 10" in netlist
    assert "Vsense2 n2 sense2 DC 0" in netlist
    assert "R2 sense2 n1 1000" in netlist
    assert signals == {
        "v(n1)": ("out", "V"), "i(v1)": ("Supply", "A"),
        "i(vsense2)": ("R1", "A"), "i(vsense3)": ("R2", "A"),
    }


@pytest.mark.skipif(not shutil.which("ngspice"), reason="ngspice is required for instrument loading")
def test_instruments_save_both_differential_nodes_and_load_the_circuit():
    data = divider()
    data["instruments"] = [{"id": "Meter1", "kind": "voltmeter", "positive": "vin", "negative": "out", "input_resistance_ohm": 1000}]
    circuit = CircuitSpec.model_validate(data)
    result = circuit_simulation.simulate_circuit(circuit)
    readings = {(trace.name, trace.unit): trace.values[0] for trace in result.traces}
    assert readings["vin", "V"] - readings["out", "V"] == pytest.approx(10 / 3, rel=1e-5)
    assert readings["R2", "A"] == pytest.approx(1 / 150, rel=1e-5)
    data["instruments"][0]["positive"] = "unknown"
    with pytest.raises(ValidationError, match="active circuit nodes"):
        CircuitSpec.model_validate(data)


def test_instruments_reject_duplicate_or_disconnected_conductors():
    data = divider()
    data["instruments"] = [{"id": "Clamp1", "kind": "clamp_meter", "conductors": [{"component_id": "R1"}, {"component_id": "r1"}]}]
    with pytest.raises(ValidationError, match="unique connected"):
        CircuitSpec.model_validate(data)
    data["instruments"][0]["conductors"] = [{"component_id": "missing"}]
    with pytest.raises(ValidationError, match="unique connected"):
        CircuitSpec.model_validate(data)


def test_instruments_weight_nonuniform_samples_and_do_not_invent_dc_frequency():
    from utils.circuit_measurements import instrument_measurements

    data = divider()
    data["analysis"] = {"mode": "transient", "duration_seconds": 1}
    data["instruments"] = [
        {"id": "Energy", "kind": "energy_meter", "positive": "vin", "conductors": [{"component_id": "R1"}]},
        {"id": "Clamp", "kind": "clamp_meter", "conductors": [{"component_id": "R1"}, {"component_id": "R2", "direction": -1}]},
        {"id": "Frequency", "kind": "frequency_meter", "positive": "vin"},
    ]
    readings = instrument_measurements(CircuitSpec.model_validate(data), {("vin", "V"): [10, 10, 10], ("R1", "A"): [0, 0.001, 0.01], ("R2", "A"): [0, 0.001, 0.01]}, [0, 0.1, 1], [0, 1, 2])
    values = {quantity.label: quantity.value for quantity in readings[0].quantities}
    assert values["Real power"] == pytest.approx(0.05)
    assert values["Net energy"] == pytest.approx(0.05 / 3600000)
    assert readings[1].quantities[0].value == 0
    assert readings[2].status == "unavailable" and not readings[2].quantities


@pytest.mark.skipif(not shutil.which("ngspice"), reason="ngspice is required for AC instruments")
def test_instruments_ac_rms_power_frequency_scope_and_window_energy():
    data = divider()
    data["components"][0].update(waveform="sine", frequency_hz=50)
    data["analysis"] = {"mode": "transient", "duration_seconds": 0.1}
    data["instruments"] = [
        {"id": "Voltage", "kind": "voltmeter", "positive": "vin", "mode": "ac"},
        {"id": "Power", "kind": "energy_meter", "positive": "vin", "conductors": [{"component_id": "R1"}], "window_start_seconds": 0.02},
        {"id": "Frequency", "kind": "frequency_meter", "positive": "vin"},
        {"id": "Scope", "kind": "oscilloscope", "positive": "vin", "reference_positive": "out"},
    ]
    result = circuit_simulation.simulate_circuit(CircuitSpec.model_validate(data))
    readings = {reading.instrument_id: {quantity.label: quantity.value for quantity in reading.quantities} for reading in result.measurements}
    assert readings["Voltage"]["AC RMS"] == pytest.approx(10 / 2 ** 0.5, rel=0.002)
    assert readings["Power"]["Real power"] == pytest.approx(0.025, rel=0.002)
    assert readings["Power"]["True power factor"] == pytest.approx(1, abs=0.001)
    assert readings["Power"]["Net energy"] == pytest.approx(0.025 * 0.08 / 3600000, rel=0.002)
    assert readings["Frequency"]["Frequency"] == pytest.approx(50, rel=0.001)
    assert readings["Scope"]["B rising-edge phase relative to A"] == pytest.approx(0, abs=0.1)
    assert len(result.measurements[3].channels[0].values) == len(result.time_seconds)


@pytest.mark.skipif(not shutil.which("ngspice"), reason="ngspice is required for the editor topology test")
def test_editor_disconnection_and_ground_references_affect_the_solve_not_layout():
    data = divider()
    data["components"][2]["connected"] = False
    data["components"][1]["position"] = 0.25
    data["components"].append({"id": "Parked", "kind": "resistor", "positive": "unused1", "negative": "unused2", "value": 100, "connected": False})
    circuit = CircuitSpec.model_validate(data)
    netlist, signals = circuit_simulation.circuit_netlist(circuit)
    assert "R3 " not in netlist and "R4 " not in netlist
    assert ("R2", "A") not in signals.values()
    result = circuit_simulation.simulate_circuit(circuit)
    readings = {trace.name: trace.values[0] for trace in result.traces}
    assert readings["out"] == pytest.approx(10, abs=1e-6)
    assert readings["R1"] == pytest.approx(0, abs=1e-9)
    data = divider()
    for part in data["components"]:
        if part["negative"] == "0":
            part["negative"] = "return_node"
    data["grounds"] = ["return_node"]
    result = circuit_simulation.simulate_circuit(CircuitSpec.model_validate(data))
    assert next(trace.values[0] for trace in result.traces if trace.name == "out") == pytest.approx(5, abs=1e-6)
    original = circuit_simulation.circuit_netlist(CircuitSpec.model_validate(data))
    data["components"][1]["position"] = 0.8
    assert circuit_simulation.circuit_netlist(CircuitSpec.model_validate(data)) == original


@pytest.mark.parametrize("grounds", [["missing"], ["out", "OUT"], ["vin"], ["0"]])
def test_editor_rejects_invalid_or_shorting_ground_references(grounds):
    data = divider()
    data["grounds"] = grounds
    with pytest.raises(ValidationError):
        CircuitSpec.model_validate(data)


def test_bulb_tool_schema_matches_runtime_component_kinds():
    from backend.schemas.circuit import CircuitComponent

    definition = json.loads((Path(__file__).resolve().parents[1] / "agent_tools/custom/add_circuit/definition.json").read_text(encoding="utf-8"))
    properties = definition["parameters"]["properties"]["components"]["items"]["properties"]
    runtime = CircuitComponent.model_json_schema()["properties"]
    assert properties["kind"]["enum"] == runtime["kind"]["enum"]
    assert properties["rated_voltage"]["minimum"] == runtime["rated_voltage"]["minimum"]
    assert properties["rated_voltage"]["maximum"] == runtime["rated_voltage"]["maximum"]
    from backend.schemas.circuit_devices import DeviceParameters
    assert set(properties["parameters"]["properties"]) == set(DeviceParameters.model_fields)
    for name, field in DeviceParameters.model_json_schema()["properties"].items():
        for constraint in ("minimum", "maximum", "enum"):
            if constraint in field:
                assert properties["parameters"]["properties"][name][constraint] == field[constraint]








@pytest.mark.parametrize("rating", [0, -12, 49, float("nan"), float("inf")])
def test_bulb_rejects_invalid_rated_voltage(rating):
    data = divider()
    data["components"][2].update(kind="bulb", rated_voltage=rating)
    with pytest.raises(ValidationError):
        CircuitSpec.model_validate(data)








@pytest.mark.skipif(not shutil.which("ngspice"), reason="ngspice is required for the numerical engine test")
@pytest.mark.parametrize("voltage", [12, 6, 0, -12])
def test_ngspice_bulb_is_a_measured_resistive_load(voltage):
    data = divider()
    data["components"][0]["value"] = voltage
    data["components"] = [data["components"][0], {
        "id": "Lamp", "kind": "bulb", "positive": "vin", "negative": "0", "value": 120,
    }]
    data["analysis"]["probes"] = ["vin"]
    circuit = CircuitSpec.model_validate(data)
    assert circuit.components[1].rated_voltage == 12
    netlist, signals = circuit_simulation.circuit_netlist(circuit)
    assert "R2 sense2 0 120" in netlist
    assert signals["i(vsense2)"] == ("Lamp", "A")
    result = circuit_simulation.simulate_circuit(circuit)
    traces = {trace.name: trace.values[0] for trace in result.traces}
    assert traces["vin"] == pytest.approx(voltage, abs=1e-9)
    assert traces["Lamp"] == pytest.approx(voltage / 120, abs=1e-9)
    assert traces["Supply"] == pytest.approx(-voltage / 120, abs=1e-9)


@pytest.mark.parametrize("change", [
    {"value": float("nan")}, {"value": 1e99}, {"positive": "out\n.include secret"},
    {"negative": "vin"}, {"kind": "behavioral_source"}, {"model": ".include secret"},
])
def test_unsafe_or_unsupported_components_are_rejected(change):
    data = divider()
    data["components"][0].update(change)
    with pytest.raises(ValidationError):
        CircuitSpec.model_validate(data)


def test_disconnected_nodes_and_unknown_probes_are_rejected():
    data = divider()
    data["components"].append({"id": "R3", "kind": "resistor", "positive": "floating1", "negative": "floating2", "value": 100})
    with pytest.raises(ValidationError, match="ground"):
        CircuitSpec.model_validate(data)
    data = divider()
    data["analysis"]["probes"] = ["unknown"]
    with pytest.raises(ValidationError, match="Probes"):
        CircuitSpec.model_validate(data)


def test_missing_engine_and_timeout_are_actionable(monkeypatch):
    monkeypatch.setattr(circuit_simulation.shutil, "which", lambda _name: None)
    circuit = CircuitSpec.model_validate(divider())
    with pytest.raises(circuit_simulation.CircuitSimulatorUnavailable, match="not installed"):
        circuit_simulation.simulate_circuit(circuit)
    monkeypatch.setattr(circuit_simulation.shutil, "which", lambda _name: "/usr/bin/ngspice")
    run = Mock(side_effect=subprocess.TimeoutExpired(cmd="ngspice", timeout=8))
    monkeypatch.setattr(circuit_simulation.subprocess, "run", run)
    with pytest.raises(circuit_simulation.CircuitSimulationError, match="time limit"):
        circuit_simulation.simulate_circuit(circuit)
    assert run.call_args.kwargs["timeout"] == 8
    assert "shell" not in run.call_args.kwargs


def test_linux_simulation_limits_memory_cpu_and_output(monkeypatch):
    monkeypatch.setattr(circuit_simulation.shutil, "which", lambda name: f"/usr/bin/{name}")
    run = Mock(side_effect=subprocess.TimeoutExpired(cmd="ngspice", timeout=8))
    monkeypatch.setattr(circuit_simulation.subprocess, "run", run)
    with pytest.raises(circuit_simulation.CircuitSimulationError):
        circuit_simulation.simulate_circuit(CircuitSpec.model_validate(divider()))
    command = run.call_args.args[0]
    assert command[:4] == ["/usr/bin/prlimit", "--as=536870912", "--cpu=8", "--fsize=8388608"]


@pytest.mark.parametrize("times", [[0, 0], [0, -1], [0, float("nan")], [0, float("inf")]])
def test_simulation_rejects_invalid_time_axis(times):
    from backend.schemas.circuit import CircuitResult

    with pytest.raises(ValidationError):
        CircuitResult(mode="transient", time_seconds=times, traces=[{"name": "out", "unit": "V", "values": [0, 5]}])


@pytest.mark.skipif(not shutil.which("ngspice"), reason="ngspice is required for the numerical engine test")
@pytest.mark.parametrize("short_outputs", [False, True])
def test_ngspice_distinguishes_common_ground_from_parallel_incompatible_sources(short_outputs):
    circuit = CircuitSpec.model_validate({
        "title": "Separate source rails", "components": [
            {"id": "VDC", "kind": "voltage_source", "positive": "vdc_out", "negative": "0", "value": 12},
            {"id": "VAC", "kind": "voltage_source", "positive": "vdc_out" if short_outputs else "vac_out", "negative": "0", "value": 8, "waveform": "sine", "frequency_hz": 50},
            {"id": "SW1", "kind": "switch", "positive": "vdc_out", "negative": "load", "value": 1, "closed": True},
            {"id": "RDC", "kind": "resistor", "positive": "load", "negative": "0", "value": 100},
            {"id": "RAC", "kind": "resistor", "positive": "vac_out", "negative": "0", "value": 150},
        ], "analysis": {"mode": "transient", "duration_seconds": 0.02, "probes": ["load", "vac_out", "vdc_out"]},
    })
    if short_outputs:
        with pytest.raises(circuit_simulation.CircuitSimulationError):
            circuit_simulation.simulate_circuit(circuit)
        return
    netlist, _signals = circuit_simulation.circuit_netlist(circuit)
    assert "V1 n3 0 DC 12" in netlist
    assert "V2 n2 0 SIN(0 8 50)" in netlist
    result = circuit_simulation.simulate_circuit(circuit)
    traces = {trace.name: trace.values for trace in result.traces}
    assert traces["vdc_out"] == pytest.approx([12] * len(result.time_seconds), abs=1e-9)
    assert max(traces["vac_out"]) == pytest.approx(8, abs=0.002)
    assert min(traces["vac_out"]) == pytest.approx(-8, abs=0.002)
    assert traces["RDC"] == pytest.approx([12 / 100.01] * len(result.time_seconds), abs=1e-9)
    assert traces["RAC"] == pytest.approx([voltage / 150 for voltage in traces["vac_out"]], abs=1e-9)


@pytest.mark.skipif(not shutil.which("ngspice"), reason="ngspice is required for the numerical engine test")
@pytest.mark.parametrize("lead", ["positive", "negative"])
def test_ngspice_series_insertion_changes_only_target_branch(lead):
    data = {
        "title": "Series and parallel", "components": [
            {"id": "Supply", "kind": "voltage_source", "positive": "vin", "negative": "0", "value": 12},
            {"id": "R1", "kind": "resistor", "positive": "vin", "negative": "0", "value": 1000},
            {"id": "R2", "kind": "resistor", "positive": "vin", "negative": "0", "value": 2000},
        ], "analysis": {"mode": "dc", "probes": ["vin"]},
    }
    baseline = circuit_simulation.simulate_circuit(CircuitSpec.model_validate(data))
    before = {trace.name: trace.values[0] for trace in baseline.traces}
    data["components"][1][lead] = "series1"
    data["components"].append({
        "id": "R3", "kind": "resistor", "positive": "vin" if lead == "positive" else "series1",
        "negative": "series1" if lead == "positive" else "0", "value": 1000,
    })
    data["analysis"]["probes"].append("series1")
    result = circuit_simulation.simulate_circuit(CircuitSpec.model_validate(data))
    after = {trace.name: trace.values[0] for trace in result.traces}
    assert before["R1"] == pytest.approx(0.012, abs=1e-9)
    assert after["R1"] == pytest.approx(0.006, abs=1e-9)
    assert after["R3"] == pytest.approx(after["R1"], abs=1e-9)
    assert after["R2"] == pytest.approx(before["R2"], abs=1e-9)
    assert after["series1"] == pytest.approx(6, abs=1e-6)
    assert after["Supply"] == pytest.approx(-0.012, abs=1e-9)
    data["components"][-1]["connected"] = False
    disconnected = circuit_simulation.simulate_circuit(CircuitSpec.model_validate(data))
    readings = {trace.name: trace.values[0] for trace in disconnected.traces}
    assert "R3" not in readings
    assert readings["R1"] == pytest.approx(0, abs=1e-9)
    assert readings["R2"] == pytest.approx(before["R2"], abs=1e-9)


@pytest.mark.skipif(not shutil.which("ngspice"), reason="ngspice is required for the numerical engine test")
def test_ngspice_voltage_divider_has_correct_voltage_and_current():
    result = circuit_simulation.simulate_circuit(CircuitSpec.model_validate(divider()))
    traces = {trace.name: trace for trace in result.traces}
    assert traces["out"].values == pytest.approx([5], abs=1e-6)
    assert traces["Supply"].values == pytest.approx([-0.005], abs=1e-9)
    assert traces["R1"].values == pytest.approx([0.005], abs=1e-9)
    assert traces["R2"].values == pytest.approx([0.005], abs=1e-9)


@pytest.mark.skipif(not shutil.which("ngspice"), reason="ngspice is required for the numerical engine test")
@pytest.mark.parametrize("voltage", [10, -10, 0])
def test_ngspice_parallel_branch_currents_keep_their_magnitude_and_sign(voltage):
    data = divider()
    data["components"][0]["value"] = voltage
    data["components"][1].update(positive="vin", negative="0")
    data["components"][2].update(positive="vin", negative="0", value=2000)
    data["analysis"]["probes"] = ["vin"]
    result = circuit_simulation.simulate_circuit(CircuitSpec.model_validate(data))
    currents = {trace.name: trace.values[0] for trace in result.traces if trace.unit == "A"}
    assert currents == pytest.approx({"Supply": -voltage / 1000 - voltage / 2000, "R1": voltage / 1000, "R2": voltage / 2000}, abs=1e-9)


@pytest.mark.skipif(not shutil.which("ngspice"), reason="ngspice is required for the numerical engine test")
@pytest.mark.parametrize("closed", [True, False])
def test_ngspice_switch_current_stops_when_open(closed):
    data = divider()
    data["components"][2].update(id="S1", kind="switch", value=1, closed=closed)
    result = circuit_simulation.simulate_circuit(CircuitSpec.model_validate(data))
    currents = {trace.name: trace.values[0] for trace in result.traces if trace.unit == "A"}
    expected = 10 / (1000 + (0.01 if closed else 1e12))
    assert currents["S1"] == pytest.approx(expected, abs=1e-12)
    assert currents["R1"] == pytest.approx(expected, abs=1e-12)


@pytest.mark.skipif(not shutil.which("ngspice"), reason="ngspice is required for the numerical engine test")
@pytest.mark.parametrize("kind,value", [("capacitor", 1e-6), ("inductor", 0.01), ("diode", 1)])
def test_ngspice_measures_reactive_and_diode_branch_currents(kind, value):
    data = divider()
    data["components"][2].update(id="Part", kind=kind, value=value)
    result = circuit_simulation.simulate_circuit(CircuitSpec.model_validate(data))
    traces = {trace.name: trace.values[0] for trace in result.traces}
    assert traces["Part"] == pytest.approx(traces["R1"], abs=1e-9)
    assert traces["Supply"] == pytest.approx(-traces["Part"], abs=1e-9)
    if kind == "capacitor":
        assert traces["Part"] == pytest.approx(0, abs=1e-9)
    elif kind == "inductor":
        assert traces["Part"] == pytest.approx(0.01, abs=1e-9)
    else:
        assert 0 < traces["out"] < 1
        assert traces["Part"] > 0


@pytest.mark.skipif(not shutil.which("ngspice"), reason="ngspice is required for the numerical engine test")
def test_ngspice_rc_step_reaches_one_time_constant():
    data = divider()
    data["components"][0].update(value=5, waveform="step")
    data["components"][2].update(id="C1", kind="capacitor", value=1e-6)
    data["analysis"] = {"mode": "transient", "duration_seconds": 0.005, "probes": ["out"]}
    result = circuit_simulation.simulate_circuit(CircuitSpec.model_validate(data))
    output = next(trace for trace in result.traces if trace.name == "out")
    sample = min(range(len(result.time_seconds)), key=lambda position: abs(result.time_seconds[position] - 0.001))
    assert output.values[sample] == pytest.approx(3.16, abs=0.04)
    assert output.values[-1] == pytest.approx(4.966, abs=0.01)
    assert len(output.values) <= 1001
    currents = {trace.name: trace.values for trace in result.traces if trace.unit == "A"}
    assert currents["C1"][sample] == pytest.approx((5 - output.values[sample]) / 1000, abs=1e-8)
    assert currents["C1"] == pytest.approx(currents["R1"], abs=1e-9)
    assert currents["Supply"] == pytest.approx([-value for value in currents["C1"]], abs=1e-9)


@pytest.mark.parametrize("kind", ["resistor", "bulb"])
def test_circuit_tool_uses_verified_results_and_emits_a_structured_block(monkeypatch, kind):
    import json
    from agent_tools.custom.add_circuit import AddCircuitTool
    from backend.schemas.circuit import CircuitResult, CircuitTrace

    result = CircuitResult(mode="dc", traces=[CircuitTrace(name="out", unit="V", values=[5])])
    run = Mock(return_value=result)
    monkeypatch.setattr(circuit_simulation, "simulate_circuit", run)
    tool = AddCircuitTool()
    data = divider()
    data["components"][2].update(kind=kind, rated_voltage=6)
    block = tool.execute(data)
    assert block["type"] == "circuit"
    assert block["result"]["engine"] == "ngspice"
    assert block["circuit"]["components"][2]["kind"] == kind
    assert block["circuit"]["components"][2]["rated_voltage"] == 6
    assert json.loads(tool.output(block, data))["readings"][0]["final"] == 5
    assert run.call_args.args[0] == CircuitSpec.model_validate(data)


def test_circuit_endpoint_requires_course_access_and_redacts_unknown_failure(monkeypatch):
    from fastapi import FastAPI, HTTPException
    from fastapi.testclient import TestClient
    from backend.dependencies.auth import ActiveUser, get_current_active_user
    from backend.routers import circuit as routes
    from backend.schemas.circuit import CircuitResult, CircuitTrace

    app = FastAPI()
    app.include_router(routes.router)
    client = TestClient(app)
    assert client.post("/api/agents/course-example/circuit/simulate", json={"circuit": divider()}).status_code == 401
    app.dependency_overrides[get_current_active_user] = lambda: ActiveUser(id="student-1", role="student", status="active")
    access = Mock(side_effect=HTTPException(status_code=403, detail="Course access required"))
    monkeypatch.setattr(routes, "require_course", access)
    run = Mock(return_value=CircuitResult(mode="dc", traces=[CircuitTrace(name="out", unit="V", values=[5])]))
    monkeypatch.setattr(circuit_simulation, "simulate_circuit", run)
    assert client.post("/api/agents/course-example/circuit/simulate", json={"circuit": divider()}).status_code == 403
    run.assert_not_called()
    access.side_effect = None
    assert client.post("/api/agents/course-example/circuit/simulate", json={"circuit": divider()}).status_code == 200
    run.side_effect = RuntimeError("private internal path")
    response = client.post("/api/agents/course-example/circuit/simulate", json={"circuit": divider()})
    assert response.status_code == 503
    assert "private" not in response.text


def test_circuit_agui_transport_preserves_nested_numeric_results():
    import json
    from backend.agui import AGUITranslator

    payload = {"title": "Voltage divider", "circuit": divider(), "result": {
        "engine": "ngspice", "mode": "dc", "time_seconds": [],
        "traces": [{"name": "out", "unit": "V", "values": [5.0]}],
    }}
    events = list(AGUITranslator().run([
        ("circuit_start", "{}", "example-thread"), ("circuit", json.dumps(payload), "example-thread"),
        ("done", "", "example-thread"),
    ]))
    assert any(event.get("stepName") == "circuit" and event["type"] == "STEP_STARTED" for event in events)
    components = [event["value"]["updateComponents"] for event in events if "updateComponents" in event.get("value", {})]
    assert components and "Circuit" in json.dumps(components)
    models = [event["value"]["updateDataModel"] for event in events if "updateDataModel" in event.get("value", {})]
    assert models and '"valueNumber": 5.0' in json.dumps(models)
    assert '"valueNumber": 1000' in json.dumps(models)


def test_circuit_stream_dispatch_cancels_failed_blocks(monkeypatch):
    from base_agents import general_agent

    agent = general_agent.GeneralAgent.__new__(general_agent.GeneralAgent)
    agent.agent_name = "course-example"
    monkeypatch.setattr(general_agent.add_circuit_tool, "execute", Mock(side_effect=circuit_simulation.CircuitSimulationError("Circuit could not be solved.")))
    result = agent._dispatch_tool_call("add_circuit", divider(), "example-call", "example-thread", "student-1")
    assert any(event[0] == "block_cancel" for event in result["yield_events"])
    assert "Circuit could not be solved" in result["output"]
    assert general_agent.BLOCK_START_EVENTS["add_circuit"] == "circuit_start"


@pytest.mark.parametrize("fails", [False, True])
def test_serialized_circuit_call_uses_verified_dispatch(monkeypatch, fails):
    import json
    from base_agents import general_agent
    from backend.schemas.circuit import CircuitResult, CircuitTrace

    agent = general_agent.GeneralAgent.__new__(general_agent.GeneralAgent)
    agent.agent_name = "course-example"
    run = Mock(return_value=CircuitResult(mode="dc", traces=[CircuitTrace(name="out", unit="V", values=[5])]))
    if fails:
        run.side_effect = circuit_simulation.CircuitSimulationError("Circuit could not be solved.")
    monkeypatch.setattr(circuit_simulation, "simulate_circuit", run)
    events = list(agent._handle_plain_text_fallback(
        "example-thread", json.dumps({"name": "add_circuit", "arguments": divider()}),
    ))
    assert any(kind == "circuit_start" for kind, _data, _thread in events)
    assert any(kind == ("block_cancel" if fails else "circuit") for kind, _data, _thread in events)
    assert not any(kind == "message_block" for kind, _data, _thread in events)
    run.assert_called_once()


@pytest.mark.parametrize("legacy", [False, True])
def test_enabling_circuit_tool_preserves_existing_definition_and_requires_owner(monkeypatch, legacy):
    from contextlib import nullcontext
    from types import SimpleNamespace
    from azure.ai.projects.models import FunctionTool, PromptAgentDefinition
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.dependencies.auth import ActiveUser, get_current_active_user
    from backend.routers import circuit as routes

    original = PromptAgentDefinition(model="example-model", instructions="Keep these course instructions.", tools=[FunctionTool(name="existing_tool", description="Existing", parameters={"type": "object", "properties": {}})])
    if legacy:
        original.tools.append(FunctionTool(name="add_circuit", description="Obsolete trainer schema", parameters={
            "type": "object", "properties": {"trainer": {"type": "object"}},
        }))
    version = SimpleNamespace(version="3", definition=original, metadata={"course_job_id": "example-job"}, description="Original description")
    client = Mock()
    client.agents.get.return_value = SimpleNamespace(versions=SimpleNamespace(latest=version))
    client.agents.create_version.side_effect = lambda **kwargs: SimpleNamespace(version="4", **{key: kwargs[key] for key in ["definition", "metadata", "description"]})
    monkeypatch.setattr(routes, "project_client", lambda: client)
    monkeypatch.setattr(routes, "tool_update_lock", lambda _name: nullcontext())
    monkeypatch.setattr(routes, "require_course", lambda *_args, **_kwargs: ({"createdById": "owner-1"}, "example-session"))
    monkeypatch.setattr(routes.shutil, "which", lambda _name: "/usr/bin/ngspice")
    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[get_current_active_user] = lambda: ActiveUser(id="other-teacher", role="teacher", status="active")
    api = TestClient(app)
    address = "/api/agents/course-example/circuit/tool"
    assert api.post(address, json={"expected_version": "3"}).status_code == 403
    client.agents.create_version.assert_not_called()
    app.dependency_overrides[get_current_active_user] = lambda: ActiveUser(id="owner-1", role="teacher", status="active")
    status = api.get(address)
    assert status.status_code == 200
    assert status.json()["enabled"] is legacy
    assert status.json()["update_available"] is legacy
    assert "trainer_available" not in status.json()
    client.agents.create_version.assert_not_called()
    assert api.post(address, json={"expected_version": "2"}).status_code == 409
    response = api.post(address, json={"expected_version": "3"})
    assert response.status_code == 200
    assert response.json()["enabled"] is True
    assert response.json()["update_available"] is False
    call = client.agents.create_version.call_args.kwargs
    assert call["definition"].model == original.model
    assert call["definition"].instructions == original.instructions
    assert [tool.name for tool in call["definition"].tools] == ["existing_tool", "add_circuit"]
    assert call["metadata"] == version.metadata
    assert call["retry_total"] == 0
    assert len(original.tools) == 1 + int(legacy)
    client.agents.get.return_value.versions.latest = SimpleNamespace(version="4", definition=call["definition"])
    assert api.post(address, json={"expected_version": "3"}).json()["agent_version"] == "4"
    assert client.agents.create_version.call_count == 1