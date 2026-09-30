export const INDUSTRIAL_PARTS = {
  wire: { label: "Wire / neutral / PE conductor", unit: "ohm", min: 1e-6, max: 1e6, initial: 0.01, prefix: "W" },
  ammeter: { label: "Ammeter (series)", unit: "", min: 1, max: 1, initial: 1, prefix: "A" },
  pushbutton_no: { label: "Pushbutton NO", unit: "", min: 1, max: 1, initial: 1, prefix: "PB" },
  pushbutton_nc: { label: "Pushbutton NC", unit: "", min: 1, max: 1, initial: 1, prefix: "PB" },
  emergency_stop: { label: "Emergency stop", unit: "", min: 1, max: 1, initial: 1, prefix: "ES" },
  contactor_coil: { label: "Contactor coil", unit: "ohm", min: 0.1, max: 1e7, initial: 240, prefix: "KM" },
  contact_no: { label: "Auxiliary contact NO", unit: "", min: 1, max: 1, initial: 1, prefix: "NO" },
  contact_nc: { label: "Auxiliary contact NC", unit: "", min: 1, max: 1, initial: 1, prefix: "NC" },
  contactor: { label: "Contactor (3 pole)", unit: "", min: 1, max: 1, initial: 1, prefix: "K" },
  timer_relay: { label: "Timer relay", unit: "ohm", min: 0.1, max: 1e7, initial: 240, prefix: "T" },
  selector_switch: { label: "Selector switch (SPDT)", unit: "", min: 1, max: 1, initial: 1, prefix: "SEL" },
  indicator_lamp: { label: "Indicator lamp", unit: "ohm", min: 0.1, max: 1e8, initial: 2400, prefix: "HL" },
  three_phase_source: { label: "Three-phase supply", unit: "", min: 1, max: 1, initial: 1, prefix: "GRID" },
  transformer: { label: "Transformer", unit: "Np/Ns", min: 0.01, max: 100, initial: 2, prefix: "TX" },
  three_phase_transformer: { label: "Three-phase transformer", unit: "Np/Ns", min: 0.01, max: 100, initial: 1, prefix: "TX" },
  bridge_rectifier: { label: "Bridge rectifier", unit: "", min: 1, max: 1, initial: 1, prefix: "BR" },
  induction_motor: { label: "Induction motor (6 leads)", unit: "", min: 1, max: 1, initial: 1, prefix: "M" },
  fuse: { label: "Fuse", unit: "", min: 1, max: 1, initial: 1, prefix: "FU" },
  mcb: { label: "MCB", unit: "", min: 1, max: 1, initial: 1, prefix: "QF" },
  rccb: { label: "RCCB (2 pole)", unit: "", min: 1, max: 1, initial: 1, prefix: "RC" },
  overload_relay: { label: "Overload relay (3 pole)", unit: "", min: 1, max: 1, initial: 1, prefix: "OL" },
  vfd: { label: "VFD (averaged DC-fed)", unit: "", min: 1, max: 1, initial: 1, prefix: "VFD" },
  plc: { label: "PLC (4 inputs / 4 outputs)", unit: "", min: 1, max: 1, initial: 1, prefix: "PLC" },
  limit_switch: { label: "Limit switch", unit: "", min: 1, max: 1, initial: 1, prefix: "LS" },
  proximity_switch: { label: "Proximity switch", unit: "", min: 1, max: 1, initial: 1, prefix: "PS" },
  analog_input: { label: "Analog input", unit: "V", min: 0, max: 24, initial: 5, prefix: "AI" },
  hmi: { label: "HMI voltage display", unit: "", min: 1, max: 1, initial: 1, prefix: "HMI" },
};

export const DEVICE_TERMINALS: Record<string, string[]> = {
  contactor: ["L2_IN", "L2_OUT", "L3_IN", "L3_OUT"], selector_switch: ["B"], three_phase_source: ["L2", "L3"],
  transformer: ["S1", "S2"], three_phase_transformer: ["L2", "L3", "S1", "S2", "S3", "SN"], bridge_rectifier: ["DC_P", "DC_N"],
  induction_motor: ["V1", "V2", "W1", "W2", "PE"], rccb: ["N_IN", "N_OUT"], overload_relay: ["L2_IN", "L2_OUT", "L3_IN", "L3_OUT"],
  vfd: ["U", "V", "W", "N"], plc: ["IN1", "IN2", "IN3", "IN4", "OUT1", "OUT2", "OUT3", "OUT4"],
};

export const TERMINAL_LABELS: Record<string, [string, string]> = {
  three_phase_source: ["L1", "N"], three_phase_transformer: ["L1", "N"], transformer: ["P1", "P2"],
  contactor: ["L1_IN", "L1_OUT"], overload_relay: ["L1_IN", "L1_OUT"], induction_motor: ["U1", "U2"],
  rccb: ["L_IN", "L_OUT"], vfd: ["DC+", "DC-"], plc: ["24V", "COM"], bridge_rectifier: ["AC1", "AC2"], selector_switch: ["COM", "A"],
};

type NumericField = { label: string; initial: number; min: number; max: number; integer?: boolean; options?: never };
type ChoiceField = { label: string; initial: string; options: string[]; min?: never; max?: never; integer?: never };
export const DEVICE_PARAMETERS: Record<string, NumericField | ChoiceField> = {
  line_voltage_rms: { label: "Line voltage (V RMS)", initial: 400, min: 1, max: 1000 },
  phase_sequence: { label: "Phase sequence", initial: "abc", options: ["abc", "acb"] },
  phase_a_scale: { label: "L1 multiplier", initial: 1, min: 0, max: 1.5 },
  phase_b_scale: { label: "L2 multiplier", initial: 1, min: 0, max: 1.5 },
  phase_c_scale: { label: "L3 multiplier", initial: 1, min: 0, max: 1.5 },
  phase_degrees: { label: "Phase offset (deg)", initial: 0, min: -360, max: 360 },
  primary_connection: { label: "Primary connection", initial: "star", options: ["star", "delta"] },
  secondary_connection: { label: "Secondary connection", initial: "star", options: ["star", "delta"] },
  primary_inductance_h: { label: "Primary inductance (H)", initial: 1, min: 0.001, max: 100 },
  coupling: { label: "Magnetic coupling", initial: 0.999, min: 0.5, max: 0.999999 },
  winding_resistance_ohm: { label: "Winding resistance (ohm)", initial: 0.1, min: 0.001, max: 100 },
  coil_voltage: { label: "Coil voltage (V)", initial: 24, min: 1, max: 240 },
  delay_seconds: { label: "Delay (s)", initial: 0.1, min: 0.001, max: 10 },
  timer_mode: { label: "Timer mode", initial: "on_delay", options: ["on_delay", "off_delay"] },
  selector_position: { label: "Selector position", initial: "a", options: ["off", "a", "b"] },
  rated_current_a: { label: "Rated current (A)", initial: 8, min: 0.01, max: 1000 },
  magnetic_multiple: { label: "Magnetic trip multiple", initial: 10, min: 3, max: 20 },
  thermal_time_seconds: { label: "Thermal time constant (s)", initial: 5, min: 0.01, max: 3600 },
  i2t_limit: { label: "I-squared-t limit (A2s)", initial: 100, min: 0.001, max: 1e8 },
  residual_current_a: { label: "Residual trip (A)", initial: 0.03, min: 0.001, max: 1 },
  trip_delay_seconds: { label: "Trip delay (s)", initial: 0.03, min: 0.001, max: 1 },
  stator_resistance_ohm: { label: "Stator resistance (ohm)", initial: 1.405, min: 0.01, max: 100 },
  rotor_resistance_ohm: { label: "Rotor resistance (ohm)", initial: 1.395, min: 0.01, max: 100 },
  stator_leakage_h: { label: "Stator leakage (H)", initial: 0.005839, min: 0.0001, max: 1 },
  rotor_leakage_h: { label: "Rotor leakage (H)", initial: 0.005839, min: 0.0001, max: 1 },
  magnetizing_h: { label: "Magnetizing inductance (H)", initial: 0.1722, min: 0.001, max: 10 },
  winding_capacitance_nf: { label: "Winding capacitance (nF)", initial: 10, min: 0.1, max: 1000 },
  pole_pairs: { label: "Pole pairs", initial: 2, min: 1, max: 8, integer: true },
  inertia_kg_m2: { label: "Inertia (kg m2)", initial: 0.02, min: 0.001, max: 100 },
  friction_nm_s: { label: "Viscous friction (Nm s)", initial: 0.001, min: 0, max: 10 },
  load_torque_nm: { label: "Load torque (Nm)", initial: 5, min: 0, max: 1000 },
  thermal_capacity_j_k: { label: "Thermal capacity (J/K)", initial: 1200, min: 1, max: 1e6 },
  thermal_resistance_k_w: { label: "Thermal resistance (K/W)", initial: 0.3, min: 0.001, max: 100 },
  ambient_temperature_c: { label: "Ambient temperature (C)", initial: 25, min: -20, max: 60 },
  luminous_efficacy_lm_w: { label: "Luminous efficacy (lm/W)", initial: 0, min: 0, max: 300 },
  scan_seconds: { label: "PLC scan (s)", initial: 0.01, min: 0.001, max: 0.1 },
  analog_threshold_v: { label: "Input threshold (V)", initial: 5, min: 0, max: 24 },
  drive_frequency_hz: { label: "Drive frequency (Hz)", initial: 50, min: 1, max: 100 },
  drive_ramp_seconds: { label: "Drive ramp (s)", initial: 0.1, min: 0.001, max: 10 },
};

export const DEVICE_FIELDS: Record<string, string[]> = {
  voltage_source: ["phase_degrees"], bulb: ["luminous_efficacy_lm_w"], indicator_lamp: ["luminous_efficacy_lm_w"],
  contactor_coil: ["coil_voltage"], timer_relay: ["coil_voltage", "timer_mode", "delay_seconds"], selector_switch: ["selector_position"],
  three_phase_source: ["line_voltage_rms", "phase_sequence", "phase_a_scale", "phase_b_scale", "phase_c_scale", "phase_degrees"],
  transformer: ["primary_inductance_h", "coupling", "winding_resistance_ohm"],
  three_phase_transformer: ["primary_connection", "secondary_connection", "primary_inductance_h", "coupling", "winding_resistance_ohm"],
  induction_motor: ["load_torque_nm", "pole_pairs", "inertia_kg_m2", "friction_nm_s", "stator_resistance_ohm", "rotor_resistance_ohm", "stator_leakage_h", "rotor_leakage_h", "magnetizing_h", "winding_capacitance_nf", "thermal_capacity_j_k", "thermal_resistance_k_w", "ambient_temperature_c"],
  fuse: ["i2t_limit"], mcb: ["rated_current_a", "magnetic_multiple", "thermal_time_seconds"],
  rccb: ["residual_current_a", "trip_delay_seconds"], overload_relay: ["rated_current_a", "thermal_time_seconds"],
  vfd: ["line_voltage_rms", "drive_frequency_hz", "drive_ramp_seconds", "phase_sequence", "rated_current_a"],
  plc: ["scan_seconds", "analog_threshold_v"],
};

export const CONTROLLER_KINDS = ["contactor_coil", "timer_relay", "overload_relay", "fuse", "mcb", "rccb"];
export const OPERATED_KINDS = ["switch", "pushbutton_no", "pushbutton_nc", "emergency_stop", "limit_switch", "proximity_switch", "vfd"];
export const FAULT_KINDS = {
  open_wire: "Open conductor", open_neutral: "Open neutral", loose_neutral: "Loose neutral", burnt_contact: "Burnt / resistive contact",
  stuck_contactor: "Stuck contact", weak_capacitor: "Weak capacitor", phase_loss: "Missing phase", phase_reversal: "Reversed phases",
  load_imbalance: "Unbalanced load", insulation_leakage: "Insulation leakage", earth_fault: "Earth fault", open_winding: "Open winding",
  intermittent_contact: "Intermittent contact", overload: "Overload", bearing_load: "Bearing load", stalled_rotor: "Stalled rotor",
};
export const FAULT_TARGETS: Record<string, string[]> = {
  weak_capacitor: ["capacitor"], phase_reversal: ["three_phase_source", "vfd"], stuck_contactor: ["switch", "contactor", "contact_no", "contact_nc", "selector_switch"],
  overload: ["induction_motor"], bearing_load: ["induction_motor"], stalled_rotor: ["induction_motor"], load_imbalance: ["resistor", "bulb", "indicator_lamp"],
  insulation_leakage: ["induction_motor"], earth_fault: ["induction_motor"],
};

export const EVENT_ACTIONS = ["press", "release", "close", "open", "reset", "select_a", "select_b", "off", "analog"] as const;
export const DEVICE_EVENT_ACTIONS: Record<string, Array<typeof EVENT_ACTIONS[number]>> = {
  switch: ["open", "close"], pushbutton_no: ["press", "release"], pushbutton_nc: ["press", "release"], emergency_stop: ["press", "release"],
  limit_switch: ["open", "close"], proximity_switch: ["open", "close"], selector_switch: ["select_a", "select_b", "off"],
  analog_input: ["analog"], mcb: ["reset"], rccb: ["reset"], overload_relay: ["reset"], vfd: ["open", "close", "reset"],
};
export const PLC_TERMINALS = ["IN1", "IN2", "IN3", "IN4", "OUT1", "OUT2", "OUT3", "OUT4"] as const;
export type CircuitEvent = { component_id: string; time_seconds: number; action: typeof EVENT_ACTIONS[number]; value?: number };
export type CircuitFault = { component_id: string; kind: keyof typeof FAULT_KINDS; terminal: string; severity?: number; resistance_ohm?: number; start_seconds?: number; end_seconds?: number | null };
export type PLCRung = { output: "OUT1" | "OUT2" | "OUT3" | "OUT4"; operation: "and" | "or" | "set" | "reset" | "ton" | "ctu"; inputs: Array<{ terminal: typeof PLC_TERMINALS[number]; normally_closed?: boolean }>; preset?: number };