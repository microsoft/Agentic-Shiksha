from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


CircuitKind = Literal[
    "resistor", "bulb", "capacitor", "inductor", "voltage_source", "diode", "switch", "wire", "ammeter",
    "pushbutton_no", "pushbutton_nc", "emergency_stop", "contactor_coil", "contact_no", "contact_nc", "contactor",
    "timer_relay", "selector_switch", "indicator_lamp", "three_phase_source", "transformer", "three_phase_transformer",
    "bridge_rectifier", "induction_motor", "fuse", "mcb", "rccb", "overload_relay", "vfd", "plc",
    "limit_switch", "proximity_switch", "analog_input", "hmi",
]

DEVICE_TERMINALS = {
    "contactor": ("L2_IN", "L2_OUT", "L3_IN", "L3_OUT"),
    "selector_switch": ("B",),
    "three_phase_source": ("L2", "L3"),
    "transformer": ("S1", "S2"),
    "three_phase_transformer": ("L2", "L3", "S1", "S2", "S3", "SN"),
    "bridge_rectifier": ("DC_P", "DC_N"),
    "induction_motor": ("V1", "V2", "W1", "W2", "PE"),
    "rccb": ("N_IN", "N_OUT"),
    "overload_relay": ("L2_IN", "L2_OUT", "L3_IN", "L3_OUT"),
    "vfd": ("U", "V", "W", "N"),
    "plc": ("IN1", "IN2", "IN3", "IN4", "OUT1", "OUT2", "OUT3", "OUT4"),
}

LINKED_DEVICES = {"contact_no", "contact_nc", "contactor"}
CONTROLLERS = {"contactor_coil", "timer_relay", "overload_relay", "fuse", "mcb", "rccb"}
DYNAMIC_DEVICES = {"three_phase_source", "three_phase_transformer", "induction_motor", "timer_relay", "vfd", "plc", "fuse", "mcb", "rccb", "overload_relay"}
EVENT_ACTIONS = {
    "switch": {"open", "close"}, "pushbutton_no": {"press", "release"}, "pushbutton_nc": {"press", "release"},
    "emergency_stop": {"press", "release"}, "limit_switch": {"open", "close"}, "proximity_switch": {"open", "close"},
    "selector_switch": {"select_a", "select_b", "off"}, "analog_input": {"analog"},
    "mcb": {"reset"}, "rccb": {"reset"}, "overload_relay": {"reset"}, "vfd": {"open", "close", "reset"},
}


class DeviceParameters(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    line_voltage_rms: float = Field(default=400, ge=1, le=1000)
    phase_sequence: Literal["abc", "acb"] = "abc"
    phase_a_scale: float = Field(default=1, ge=0, le=1.5)
    phase_b_scale: float = Field(default=1, ge=0, le=1.5)
    phase_c_scale: float = Field(default=1, ge=0, le=1.5)
    phase_degrees: float = Field(default=0, ge=-360, le=360)
    primary_connection: Literal["star", "delta"] = "star"
    secondary_connection: Literal["star", "delta"] = "star"
    primary_inductance_h: float = Field(default=1, ge=0.001, le=100)
    coupling: float = Field(default=0.999, ge=0.5, le=0.999999)
    winding_resistance_ohm: float = Field(default=0.1, ge=0.001, le=100)
    coil_voltage: float = Field(default=24, ge=1, le=240)
    delay_seconds: float = Field(default=0.1, ge=0.001, le=10)
    timer_mode: Literal["on_delay", "off_delay"] = "on_delay"
    selector_position: Literal["off", "a", "b"] = "a"
    rated_current_a: float = Field(default=8, ge=0.01, le=1000)
    magnetic_multiple: float = Field(default=10, ge=3, le=20)
    thermal_time_seconds: float = Field(default=5, ge=0.01, le=3600)
    i2t_limit: float = Field(default=100, ge=0.001, le=1e8)
    residual_current_a: float = Field(default=0.03, ge=0.001, le=1)
    trip_delay_seconds: float = Field(default=0.03, ge=0.001, le=1)
    stator_resistance_ohm: float = Field(default=1.405, ge=0.01, le=100)
    rotor_resistance_ohm: float = Field(default=1.395, ge=0.01, le=100)
    stator_leakage_h: float = Field(default=0.005839, ge=0.0001, le=1)
    rotor_leakage_h: float = Field(default=0.005839, ge=0.0001, le=1)
    magnetizing_h: float = Field(default=0.1722, ge=0.001, le=10)
    winding_capacitance_nf: float = Field(default=10, ge=0.1, le=1000)
    pole_pairs: int = Field(default=2, ge=1, le=8)
    inertia_kg_m2: float = Field(default=0.02, ge=0.001, le=100)
    friction_nm_s: float = Field(default=0.001, ge=0, le=10)
    load_torque_nm: float = Field(default=5, ge=0, le=1000)
    thermal_capacity_j_k: float = Field(default=1200, ge=1, le=1e6)
    thermal_resistance_k_w: float = Field(default=0.3, ge=0.001, le=100)
    ambient_temperature_c: float = Field(default=25, ge=-20, le=60)
    luminous_efficacy_lm_w: float = Field(default=0, ge=0, le=300)
    scan_seconds: float = Field(default=0.01, ge=0.001, le=0.1)
    analog_threshold_v: float = Field(default=5, ge=0, le=24)
    drive_frequency_hz: float = Field(default=50, ge=1, le=100)
    drive_ramp_seconds: float = Field(default=0.1, ge=0.001, le=10)


class PLCInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    terminal: Literal["IN1", "IN2", "IN3", "IN4", "OUT1", "OUT2", "OUT3", "OUT4"]
    normally_closed: bool = False


class PLCRung(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    output: Literal["OUT1", "OUT2", "OUT3", "OUT4"]
    operation: Literal["and", "or", "set", "reset", "ton", "ctu"] = "and"
    inputs: list[PLCInput] = Field(min_length=1, max_length=8)
    preset: float = Field(default=1, ge=0.001, le=1000)


class CircuitEvent(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    component_id: str = Field(pattern=r"^[A-Za-z][A-Za-z0-9_]{0,15}$")
    time_seconds: float = Field(ge=0, le=10)
    action: Literal["press", "release", "close", "open", "reset", "select_a", "select_b", "off", "analog"]
    value: float = Field(default=0, ge=0, le=24)


FaultKind = Literal[
    "open_wire", "open_neutral", "loose_neutral", "burnt_contact", "stuck_contactor", "weak_capacitor", "phase_loss",
    "phase_reversal", "load_imbalance", "insulation_leakage", "earth_fault", "open_winding", "intermittent_contact",
    "overload", "bearing_load", "stalled_rotor",
]


class CircuitFault(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    component_id: str = Field(pattern=r"^[A-Za-z][A-Za-z0-9_]{0,15}$")
    kind: FaultKind
    terminal: str = Field(default="positive", pattern=r"^[A-Za-z][A-Za-z0-9_]{0,15}$")
    severity: float = Field(default=0.8, ge=0, le=1)
    resistance_ohm: float = Field(default=1000, ge=0.001, le=1e12)
    start_seconds: float = Field(default=0, ge=0, le=10)
    end_seconds: float | None = Field(default=None, ge=0, le=10)

    @model_validator(mode="after")
    def validate_interval(self):
        if self.end_seconds is not None and self.end_seconds <= self.start_seconds:
            raise ValueError("A fault must end after it starts")
        return self