import math
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend.schemas.circuit_devices import CONTROLLERS, DEVICE_TERMINALS, DYNAMIC_DEVICES, EVENT_ACTIONS, LINKED_DEVICES, CircuitEvent, CircuitFault, CircuitKind, DeviceParameters, PLCRung


class CircuitComponent(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, allow_inf_nan=False)

    id: str = Field(pattern=r"^[A-Za-z][A-Za-z0-9_]{0,15}$")
    kind: CircuitKind
    positive: str = Field(pattern=r"^(0|[A-Za-z][A-Za-z0-9_]{0,15})$")
    negative: str = Field(pattern=r"^(0|[A-Za-z][A-Za-z0-9_]{0,15})$")
    value: float = 1
    waveform: Literal["dc", "step", "sine"] = "dc"
    frequency_hz: float = Field(default=100, ge=0.1, le=100000)
    closed: bool = True
    rated_voltage: float = Field(default=12, ge=0.1, le=48)
    connected: bool = True
    position: float = Field(default=0.5, ge=0, le=1)
    terminals: dict[str, str] = Field(default_factory=dict, max_length=8)
    parameters: DeviceParameters = Field(default_factory=DeviceParameters)
    link: str | None = Field(default=None, pattern=r"^[A-Za-z][A-Za-z0-9_]{0,15}$")
    interlock: str | None = Field(default=None, pattern=r"^[A-Za-z][A-Za-z0-9_]{0,15}$")
    rungs: list[PLCRung] = Field(default_factory=list, max_length=8)

    def nodes(self) -> list[str]:
        return [self.positive, self.negative, *self.terminals.values()]

    @model_validator(mode="after")
    def validate_component(self):
        if self.positive.lower() == self.negative.lower():
            raise ValueError("Component terminals must connect different nodes")
        limits = {
            "resistor": (0.1, 1e8), "bulb": (0.1, 1e8), "capacitor": (1e-12, 1), "inductor": (1e-9, 100),
            "voltage_source": (-48, 48), "diode": (1, 1), "switch": (1, 1),
        }
        limits.update({"wire": (1e-6, 1e6), "contactor_coil": (0.1, 1e7), "timer_relay": (0.1, 1e7), "indicator_lamp": (0.1, 1e8), "transformer": (0.01, 100), "three_phase_transformer": (0.01, 100), "analog_input": (0, 24)})
        minimum, maximum = limits.get(self.kind, (1, 1))
        if not minimum <= self.value <= maximum:
            raise ValueError(f"{self.kind} value must be between {minimum:g} and {maximum:g} in SI units")
        if self.kind != "voltage_source" and self.waveform != "dc":
            raise ValueError("Only voltage sources can have a waveform")
        if set(self.terminals) != set(DEVICE_TERMINALS.get(self.kind, ())):
            raise ValueError("Device terminals must match its named terminal contract")
        if any(not re.fullmatch(r"0|[A-Za-z][A-Za-z0-9_]{0,15}", node) for node in self.terminals.values()):
            raise ValueError("Invalid device terminal node")
        if self.kind in LINKED_DEVICES and self.link is None:
            raise ValueError("Linked contacts require a controller")
        if self.kind != "plc" and self.rungs:
            raise ValueError("Only a PLC accepts logic rungs")
        return self


class CircuitAnalysis(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    mode: Literal["dc", "transient"] = "dc"
    duration_seconds: float = Field(default=0.05, ge=0.000001, le=10)
    probes: list[str] = Field(default_factory=list, max_length=8)


class CircuitConductor(BaseModel):
    model_config = ConfigDict(extra="forbid")

    component_id: str = Field(pattern=r"^[A-Za-z][A-Za-z0-9_]{0,15}$")
    direction: Literal[-1, 1] = 1
    terminal: str = Field(default="positive", pattern=r"^[A-Za-z][A-Za-z0-9_]{0,15}$")


class CircuitInstrument(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    id: str = Field(pattern=r"^[A-Za-z][A-Za-z0-9_]{0,15}$")
    kind: Literal["voltmeter", "clamp_meter", "wattmeter", "energy_meter", "pf_meter", "frequency_meter", "oscilloscope", "rpm_meter", "lux_meter"]
    positive: str = Field(default="0", pattern=r"^(0|[A-Za-z][A-Za-z0-9_]{0,15})$")
    negative: str = Field(default="0", pattern=r"^(0|[A-Za-z][A-Za-z0-9_]{0,15})$")
    reference_positive: str = Field(default="0", pattern=r"^(0|[A-Za-z][A-Za-z0-9_]{0,15})$")
    reference_negative: str = Field(default="0", pattern=r"^(0|[A-Za-z][A-Za-z0-9_]{0,15})$")
    mode: Literal["dc", "ac", "ac_dc"] = "dc"
    conductors: list[CircuitConductor] = Field(default_factory=list, max_length=4)
    target: str | None = Field(default=None, pattern=r"^[A-Za-z][A-Za-z0-9_]{0,15}$")
    input_resistance_ohm: float = Field(default=1e7, ge=1000, le=1e12)
    window_start_seconds: float = Field(default=0, ge=0, le=10)
    distance_m: float = Field(default=1, ge=0.05, le=100)
    angle_degrees: float = Field(default=0, ge=0, le=90)
    ambient_lux: float = Field(default=0, ge=0, le=100000)


class CircuitSpec(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: str = Field(min_length=1, max_length=120)
    format_version: Literal[1, 2] = 1
    components: list[CircuitComponent] = Field(min_length=2, max_length=48)
    analysis: CircuitAnalysis = Field(default_factory=CircuitAnalysis)
    grounds: list[str] = Field(default_factory=list, max_length=16)
    instruments: list[CircuitInstrument] = Field(default_factory=list, max_length=8)
    node_roles: dict[str, Literal["L1", "L2", "L3", "N", "PE", "DC+", "DC-"]] = Field(default_factory=dict, max_length=64)
    events: list[CircuitEvent] = Field(default_factory=list, max_length=64)
    faults: list[CircuitFault] = Field(default_factory=list, max_length=16)

    @model_validator(mode="after")
    def validate_circuit(self):
        identities = [component.id.lower() for component in self.components]
        if len(set(identities)) != len(identities):
            raise ValueError("Component IDs must be unique")
        all_nodes = {terminal.lower() for component in self.components for terminal in component.nodes()}
        ground_names = [node.lower() for node in self.grounds]
        if len(set(ground_names)) != len(ground_names) or any(node not in all_nodes or node == "0" for node in ground_names):
            raise ValueError("Ground references must be unique existing non-zero nodes")
        ground_nodes = {"0", *ground_names}
        active = [component for component in self.components if component.connected]
        canonical = lambda node: "0" if node.lower() in ground_nodes else node.lower()
        nodes = {canonical(terminal) for component in active for terminal in component.nodes()}
        maximum_nodes = 17 if self.format_version == 1 else 64
        if "0" not in nodes or len(all_nodes) > maximum_nodes:
            raise ValueError(f"Circuits require ground node 0 and at most {maximum_nodes - 1} other nodes")
        if self.format_version == 1 and (len(self.components) > 24 or self.events or self.faults or any(component.terminals for component in self.components)):
            raise ValueError("Industrial circuits require format version 2; version 1 supports 24 two-terminal components")
        if any(canonical(component.positive) == canonical(component.negative) for component in active):
            raise ValueError("Ground references would short a component. Disconnect or reconnect that component first.")
        if not any(component.kind in {"voltage_source", "three_phase_source", "analog_input"} for component in active):
            raise ValueError("Add a voltage source")
        if not any(component.kind in {"resistor", "bulb", "diode", "switch", "indicator_lamp", "contactor_coil", "timer_relay", "induction_motor"} for component in active):
            raise ValueError("Add a resistive load")
        reached = {"0"}
        for _step in range(len(nodes)):
            for component in active:
                terminals = {canonical(terminal) for terminal in component.nodes()}
                if terminals & reached:
                    reached.update(terminals)
        if reached != nodes:
            raise ValueError("Every component must have a connected path to ground")
        probes = [probe.lower() for probe in self.analysis.probes]
        if len(set(probes)) != len(probes) or any(probe in ground_nodes or probe not in nodes for probe in probes):
            raise ValueError("Probes must be unique non-ground circuit nodes")
        if self.analysis.mode == "dc" and any(component.waveform != "dc" for component in active):
            raise ValueError("Step and sine sources require transient analysis")
        if self.analysis.mode == "transient":
            for component in active:
                if (component.waveform == "sine" or component.kind == "three_phase_source") and component.frequency_hz * self.analysis.duration_seconds > (50 if self.format_version == 1 else 200):
                    raise ValueError("Limit a transient run to 50 sine-wave periods (200 for industrial circuits)")
        if self.analysis.mode == "dc" and any(component.kind in DYNAMIC_DEVICES for component in active):
            raise ValueError("Dynamic industrial devices require transient analysis")
        if any(node.lower() not in all_nodes for node in self.node_roles):
            raise ValueError("Node roles must refer to existing circuit nodes")
        by_id = {component.id.lower(): component for component in self.components}
        for component in self.components:
            if component.link is not None and (component.link.lower() not in by_id or by_id[component.link.lower()].kind not in CONTROLLERS):
                raise ValueError("Contacts must link to a coil, timer or protection device")
            if component.interlock is not None and (component.interlock.lower() == component.id.lower() or component.interlock.lower() not in by_id or by_id[component.interlock.lower()].kind not in CONTROLLERS):
                raise ValueError("Interlocks require a different controller")
        event_keys = [(event.component_id.lower(), event.time_seconds) for event in self.events]
        if len(set(event_keys)) != len(event_keys):
            raise ValueError("A component can have only one event at a given time")
        for event in self.events:
            if event.component_id.lower() not in by_id or event.time_seconds >= self.analysis.duration_seconds or self.analysis.mode != "transient":
                raise ValueError("Events require an existing component and a time inside the transient run")
            if event.action not in EVENT_ACTIONS.get(by_id[event.component_id.lower()].kind, set()):
                raise ValueError("This event is not supported by its target device")
        for fault in self.faults:
            target = by_id.get(fault.component_id.lower())
            if target is None or fault.terminal not in {"positive", "negative", *target.terminals}:
                raise ValueError("Faults require an existing component terminal")
            if self.analysis.mode == "dc" and (fault.start_seconds or fault.end_seconds is not None):
                raise ValueError("Timed faults require transient analysis")
            if self.analysis.mode == "transient" and fault.start_seconds >= self.analysis.duration_seconds:
                raise ValueError("Fault onset must be inside the simulation")
            allowed = {
                "weak_capacitor": {"capacitor"}, "phase_reversal": {"three_phase_source", "vfd"},
                "stuck_contactor": {"switch", "contactor", "contact_no", "contact_nc", "selector_switch"},
                "overload": {"induction_motor"}, "bearing_load": {"induction_motor"}, "stalled_rotor": {"induction_motor"},
                "load_imbalance": {"resistor", "bulb", "indicator_lamp"},
                "insulation_leakage": {"induction_motor"}, "earth_fault": {"induction_motor"},
            }
            if fault.kind in allowed and target.kind not in allowed[fault.kind]:
                raise ValueError("This fault is incompatible with its target model")
            if target.kind == "induction_motor" and fault.kind in {"open_wire", "phase_loss", "open_winding", "intermittent_contact"}:
                if fault.terminal == "PE":
                    raise ValueError("Use a separate protective-earth wire to model an open earth conductor")
        instrument_ids = [instrument.id.lower() for instrument in self.instruments]
        if len(set(instrument_ids)) != len(instrument_ids):
            raise ValueError("Instrument IDs must be unique")
        active_ids = {component.id.lower() for component in active}
        for instrument in self.instruments:
            terminals = [instrument.positive, instrument.negative, instrument.reference_positive, instrument.reference_negative]
            if any(canonical(node) not in nodes for node in terminals):
                raise ValueError("Instruments must connect to active circuit nodes")
            conductors = [(conductor.component_id.lower(), conductor.terminal) for conductor in instrument.conductors]
            if len(set(conductors)) != len(conductors) or any(identity not in active_ids or terminal not in {"positive", "negative", *by_id[identity].terminals} for identity, terminal in conductors):
                raise ValueError("Meter conductors must be unique connected components")
            if instrument.kind in {"clamp_meter", "wattmeter", "energy_meter", "pf_meter"} and not conductors:
                raise ValueError("This instrument requires a current conductor")
            if instrument.target is not None and instrument.target.lower() not in active_ids:
                raise ValueError("Instrument target must be a connected component")
            if self.analysis.mode == "transient" and instrument.window_start_seconds >= self.analysis.duration_seconds:
                raise ValueError("Instrument window must start before the simulation ends")
        return self


class CircuitTrace(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    name: str = Field(pattern=r"^[A-Za-z][A-Za-z0-9_]{0,31}$")
    unit: Literal["V", "A", "rpm", "Nm", "degC", "state"]
    values: list[float] = Field(min_length=1, max_length=1001)


class CircuitQuantity(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    label: str = Field(min_length=1, max_length=48)
    value: float
    unit: Literal["V", "A", "W", "VA", "kWh", "Hz", "deg", "rpm", "lx", "PF", "s", "%"]


class CircuitMeasurement(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    instrument_id: str = Field(pattern=r"^[A-Za-z][A-Za-z0-9_]{0,15}$")
    status: Literal["available", "unavailable"]
    reason: str = Field(default="", max_length=240)
    quantities: list[CircuitQuantity] = Field(default_factory=list, max_length=12)
    channels: list[CircuitTrace] = Field(default_factory=list, max_length=2)

    @model_validator(mode="after")
    def validate_reading(self):
        if self.status == "unavailable" and (self.quantities or self.channels or not self.reason):
            raise ValueError("Unavailable instruments must explain why and must not contain readings")
        if self.status == "available" and not self.quantities:
            raise ValueError("Available instruments require a reading")
        return self


class CircuitResult(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    engine: Literal["ngspice"] = "ngspice"
    mode: Literal["dc", "transient"]
    time_seconds: list[float] = Field(default_factory=list, max_length=1001)
    traces: list[CircuitTrace] = Field(min_length=1, max_length=256)
    measurements: list[CircuitMeasurement] = Field(default_factory=list, max_length=8)
    notices: list[str] = Field(default_factory=list, max_length=12)

    @model_validator(mode="after")
    def validate_samples(self):
        count = len(self.time_seconds) if self.mode == "transient" else 1
        if not count or any(len(trace.values) != count for trace in self.traces):
            raise ValueError("Simulation samples are incomplete")
        if self.mode == "dc" and self.time_seconds:
            raise ValueError("DC results must not contain a time axis")
        if self.mode == "transient" and (
            any(not math.isfinite(value) or value < 0 for value in self.time_seconds)
            or any(later <= earlier for earlier, later in zip(self.time_seconds, self.time_seconds[1:]))
        ):
            raise ValueError("Simulation time must be finite and increasing")
        if len({(trace.name.lower(), trace.unit) for trace in self.traces}) != len(self.traces):
            raise ValueError("Simulation signals must be unique")
        if any(not math.isfinite(value) for trace in self.traces for value in trace.values):
            raise ValueError("Simulation produced nonfinite values")
        if len({reading.instrument_id.lower() for reading in self.measurements}) != len(self.measurements):
            raise ValueError("Instrument readings must be unique")
        if any(len(channel.values) != count for reading in self.measurements for channel in reading.channels):
            raise ValueError("Instrument channels must share the simulation time axis")
        return self


class CircuitSimulationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    circuit: CircuitSpec


class CircuitBlock(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["circuit"] = "circuit"
    title: str
    circuit: CircuitSpec
    result: CircuitResult


class CircuitToolStatus(BaseModel):
    enabled: bool
    update_available: bool = False
    engine_available: bool
    agent_version: str


class EnableCircuitToolRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_version: str = Field(pattern=r"^[A-Za-z0-9._-]{1,64}$")