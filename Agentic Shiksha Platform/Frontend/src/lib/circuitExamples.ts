import type { CircuitComponent, CircuitSpec } from "./circuit";

export const CIRCUIT_EXAMPLES = {
  dol: "DOL starter", reversing: "Reversing starter", star_delta: "Star-delta starter", sequencing: "PLC conveyor sequence",
  neutral: "Unbalanced star / neutral", transformer: "Star-delta transformer", rectifier: "Bridge and capacitor", drive: "VFD motor drive",
  lighting: "Lamp and lux meter",
} as const;
export type CircuitExample = keyof typeof CIRCUIT_EXAMPLES;

export function circuitExample(example: CircuitExample): CircuitSpec {
  const component = (id: string, kind: CircuitComponent["kind"], positive: string, negative: string, value = 1, extra: Partial<CircuitComponent> = {}): CircuitComponent => ({ id, kind, positive, negative, value, ...extra });
  const grid = component("Grid", "three_phase_source", "l1", "0", 1, { frequency_hz: 50, terminals: { L2: "l2", L3: "l3" } });
  const control = component("Control", "voltage_source", "control", "0", 24);
  const motor = component("Motor", "induction_motor", "u", "star", 1, { terminals: { V1: "v", V2: "star", W1: "w", W2: "star", PE: "0" }, parameters: { load_torque_nm: 2 } });
  const circuit: CircuitSpec = { title: CIRCUIT_EXAMPLES[example], format_version: 2, components: [], analysis: { mode: "transient", duration_seconds: 0.4, probes: [] }, instruments: [], events: [], faults: [], node_roles: {} };
  const poles = (id: string, link: string, incoming: string[], outgoing: string[], interlock?: string) => component(id, "contactor", incoming[0], outgoing[0], 1, { link, interlock, terminals: { L2_IN: incoming[1], L2_OUT: outgoing[1], L3_IN: incoming[2], L3_OUT: outgoing[2] } });
  if (["dol", "reversing", "star_delta"].includes(example)) {
    circuit.components = [grid, control,
      component("Stop", "pushbutton_nc", "control", "enabled", 1, { closed: false }),
      component("Emergency", "emergency_stop", "enabled", "safe", 1, { closed: false }),
      component("Start", "pushbutton_no", "safe", "coil", 1, { closed: false }),
      component("KM1", "contactor_coil", "coil", "0", 240),
      component("Hold", "contact_no", "safe", "coil", 1, { link: "KM1" }),
      poles("Main", "KM1", ["l1", "l2", "l3"], ["feed1", "feed2", "feed3"]),
      component("OLR", "overload_relay", "feed1", "u", 1, { terminals: { L2_IN: "feed2", L2_OUT: "v", L3_IN: "feed3", L3_OUT: "w" }, parameters: { rated_current_a: 8, thermal_time_seconds: 5 } }),
      component("RunNO", "contact_no", "control", "pilot", 1, { link: "KM1" }),
      component("Pilot", "indicator_lamp", "pilot", "0", 2400), motor,
    ];
    circuit.events = [{ component_id: "Start", time_seconds: 0.01, action: "press" }, { component_id: "Start", time_seconds: 0.04, action: "release" }];
    circuit.instruments = [
      { id: "Clamp", kind: "clamp_meter", positive: "0", negative: "0", mode: "ac", conductors: [{ component_id: "Motor", direction: 1 }], window_start_seconds: 0.3 },
      { id: "RPM", kind: "rpm_meter", positive: "0", negative: "0", mode: "dc", conductors: [], target: "Motor" },
      { id: "Power", kind: "wattmeter", positive: "u", negative: "star", mode: "ac", conductors: [{ component_id: "Motor", direction: 1 }], window_start_seconds: 0.3 },
    ];
    circuit.node_roles = { l1: "L1", l2: "L2", l3: "L3", "0": "PE" };
    if (example === "reversing") {
      circuit.analysis.duration_seconds = 0.6;
      circuit.components.push(
        component("Reverse", "pushbutton_no", "safe", "reverse_coil", 1, { closed: false }),
        component("KM2", "contactor_coil", "reverse_coil", "0", 240, { interlock: "KM1" }),
        component("ReverseHold", "contact_no", "safe", "reverse_coil", 1, { link: "KM2" }),
        poles("ReverseMain", "KM2", ["l3", "l2", "l1"], ["feed1", "feed2", "feed3"], "KM1"),
      );
      circuit.components.find(part => part.id === "Main")!.interlock = "KM2";
      circuit.components.find(part => part.id === "KM1")!.interlock = "KM2";
      circuit.events.push({ component_id: "Stop", time_seconds: 0.22, action: "press" }, { component_id: "Stop", time_seconds: 0.26, action: "release" }, { component_id: "Reverse", time_seconds: 0.28, action: "press" }, { component_id: "Reverse", time_seconds: 0.31, action: "release" });
    }
    if (example === "star_delta") {
      motor.negative = "u2";
      motor.terminals = { V1: "v", V2: "v2", W1: "w", W2: "w2", PE: "0" };
      grid.parameters = { line_voltage_rms: 230 };
      circuit.instruments = circuit.instruments.filter(instrument => instrument.kind !== "wattmeter");
      circuit.components.push(
        component("Timer", "timer_relay", "coil", "0", 240, { parameters: { delay_seconds: 0.15 } }),
        component("Delay", "timer_relay", "coil", "0", 240, { parameters: { delay_seconds: 0.17 } }),
        component("StarGate", "contact_nc", "coil", "star_coil", 1, { link: "Timer" }),
        component("StarCoil", "contactor_coil", "star_coil", "0", 240),
        component("DeltaGate", "contact_no", "coil", "delta_coil", 1, { link: "Delay" }),
        component("DeltaCoil", "contactor_coil", "delta_coil", "0", 240),
        poles("Star", "StarCoil", ["u2", "v2", "w2"], ["star", "star", "star"], "DeltaCoil"),
        poles("Delta", "DeltaCoil", ["u2", "v2", "w2"], ["v", "w", "u"], "StarCoil"),
      );
    }
  } else if (example === "neutral") {
    circuit.components = [grid, component("Neutral", "wire", "neutral", "0", 0.01),
      component("LoadA", "resistor", "l1", "neutral", 100), component("LoadB", "resistor", "l2", "neutral", 200), component("LoadC", "resistor", "l3", "neutral", 300)];
    circuit.analysis.duration_seconds = 0.1;
    circuit.node_roles = { l1: "L1", l2: "L2", l3: "L3", neutral: "N", "0": "PE" };
    circuit.instruments = ["l1", "l2", "l3", "neutral"].map((node, index) => ({ id: `Meter${index + 1}`, kind: "voltmeter", positive: node, negative: node === "neutral" ? "0" : "neutral", mode: "ac", conductors: [] }));
  } else if (example === "transformer") {
    circuit.components = [grid, component("Transformer", "three_phase_transformer", "l1", "0", 2, { terminals: { L2: "l2", L3: "l3", S1: "sa", S2: "sb", S3: "sc", SN: "sn" }, parameters: { primary_connection: "star", secondary_connection: "delta" } }), component("LoadA", "resistor", "sa", "sb", 100), component("LoadB", "resistor", "sb", "sc", 100), component("LoadC", "resistor", "sc", "sa", 100)];
    circuit.analysis.duration_seconds = 0.1;
    circuit.instruments = [{ id: "Secondary", kind: "voltmeter", positive: "sa", negative: "sb", mode: "ac", conductors: [], window_start_seconds: 0.04 }];
  } else if (example === "rectifier") {
    circuit.components = [component("AC", "voltage_source", "ac", "0", 24, { waveform: "sine", frequency_hz: 50 }), component("Bridge", "bridge_rectifier", "ac", "0", 1, { terminals: { DC_P: "dc", DC_N: "return" } }), component("Load", "resistor", "dc", "return", 1000), component("Capacitor", "capacitor", "dc", "return", 0.0001)];
    circuit.analysis.duration_seconds = 0.1;
    circuit.instruments = [{ id: "Scope", kind: "oscilloscope", positive: "dc", negative: "return", reference_positive: "ac", reference_negative: "0", mode: "ac_dc", conductors: [], window_start_seconds: 0.04 }];
  } else if (example === "drive") {
    circuit.components = [component("Bus", "voltage_source", "bus", "0", 48), component("Drive", "vfd", "bus", "0", 1, { terminals: { U: "u", V: "v", W: "w", N: "star" }, parameters: { drive_ramp_seconds: 0.2, rated_current_a: 12 } }), { ...motor, parameters: { load_torque_nm: 0, inertia_kg_m2: 0.002 } }];
    circuit.analysis.duration_seconds = 0.4;
    circuit.instruments = [{ id: "RPM", kind: "rpm_meter", positive: "0", negative: "0", mode: "dc", conductors: [], target: "Motor" }];
  } else if (example === "sequencing") {
    circuit.components = [control, component("Sensor", "analog_input", "sensor", "0", 0),
      component("PLC", "plc", "control", "0", 1, { terminals: { IN1: "sensor", IN2: "0", IN3: "0", IN4: "0", OUT1: "out1", OUT2: "out2", OUT3: "out3", OUT4: "out4" }, rungs: [
        { output: "OUT1", operation: "and", inputs: [{ terminal: "IN1" }] }, { output: "OUT2", operation: "ton", inputs: [{ terminal: "IN1" }], preset: 0.03 }, { output: "OUT3", operation: "ctu", inputs: [{ terminal: "IN1" }], preset: 2 },
      ] }), component("Conveyor", "indicator_lamp", "out1", "0", 2400), component("Pump", "indicator_lamp", "out2", "0", 2400), component("HMI", "hmi", "out3", "0")];
    circuit.analysis.duration_seconds = 0.15;
    circuit.events = [{ component_id: "Sensor", time_seconds: 0.015, action: "analog", value: 24 }, { component_id: "Sensor", time_seconds: 0.065, action: "analog", value: 0 }, { component_id: "Sensor", time_seconds: 0.095, action: "analog", value: 24 }];
  } else {
    circuit.components = [component("Supply", "voltage_source", "supply", "0", 12), component("Lamp", "bulb", "supply", "0", 120, { parameters: { luminous_efficacy_lm_w: 100 } })];
    circuit.analysis = { mode: "dc", probes: [] };
    circuit.instruments = [{ id: "Lux", kind: "lux_meter", positive: "0", negative: "0", mode: "dc", conductors: [], target: "Lamp", distance_m: 1, ambient_lux: 10 }];
  }
  return circuit;
}