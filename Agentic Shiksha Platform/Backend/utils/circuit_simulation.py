import logging
import math
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

from backend.schemas.circuit import CircuitResult, CircuitSpec, CircuitTrace
from utils.circuit_measurements import instrument_measurements
from utils.circuit_devices import DeviceCompiler


logger = logging.getLogger(__name__)
SIMULATION_SLOTS = threading.BoundedSemaphore(2)
MAX_RAW_BYTES = 8 * 1024 * 1024


class CircuitSimulationError(ValueError):
    pass


class CircuitSimulatorUnavailable(RuntimeError):
    pass


def circuit_netlist(circuit: CircuitSpec) -> tuple[str, dict[str, tuple[str, str]]]:
    grounds = {"0", *(node.lower() for node in circuit.grounds)}
    nodes = sorted({terminal.lower() for component in circuit.components if component.connected for terminal in component.nodes()} - grounds)
    node_names = {node: f"n{position + 1}" for position, node in enumerate(nodes)}
    node_names.update({node: "0" for node in grounds})
    probes = [node.lower() for node in circuit.analysis.probes] or nodes[:8]
    for instrument in circuit.instruments:
        terminals = [instrument.positive, instrument.negative, instrument.reference_positive, instrument.reference_negative]
        if instrument.kind == "rpm_meter":
            target = next((component for component in circuit.components if component.id.lower() == (instrument.target or "").lower() and component.kind == "induction_motor"), None)
            if target:
                terminals.extend([target.positive, target.negative, target.terminals["V1"], target.terminals["V2"]])
        for terminal in terminals:
            node = terminal.lower()
            if node not in grounds and node not in probes:
                probes.append(node)
    signals = {f"v({node_names[node]})": (node, "V") for node in probes}
    lines = ["Educational circuit simulation", ".options numdgt=12", ".model DDEFAULT D(Is=2.52e-9 N=1.752 Rs=0.568 Cjo=4e-12 M=0.4 Tt=20e-9)"]
    if circuit.format_version == 2:
        lines.append(".options method=gear maxord=2")
    prefixes = {"resistor": "R", "bulb": "R", "capacitor": "C", "inductor": "L", "voltage_source": "V", "diode": "D", "switch": "R"}
    compiler = DeviceCompiler(circuit, node_names)
    for position, component in enumerate(circuit.components, 1):
        if not component.connected:
            continue
        identity = f"{prefixes.get(component.kind, 'R')}{position}"
        positive, negative = node_names[component.positive.lower()], node_names[component.negative.lower()]
        value = compiler.parameter_value(component)
        if component.kind == "diode":
            value = "DDEFAULT"
        elif component.kind == "switch":
            value = "0.01" if component.closed else "1e12"
            if circuit.format_version == 2:
                command = f"({compiler.scheduled(component, int(component.closed))} || {compiler.gate(component, 'stuck_contactor')})"
                value = f"r={{{command}?0.01:1e12}}"
        elif component.kind == "voltage_source":
            if component.waveform == "step":
                duration = circuit.analysis.duration_seconds
                edge = max(duration / 10000, 1e-10)
                value = f"PULSE(0 {value} 0 {edge:.12g} {edge:.12g} {duration * 2:.12g} {duration * 4:.12g})"
            elif component.waveform == "sine":
                value = f"SIN(0 {value} {component.frequency_hz:.12g} 0 0 {component.parameters.phase_degrees:.12g})" if component.parameters.phase_degrees else f"SIN(0 {value} {component.frequency_hz:.12g})"
            else:
                value = f"DC {value}"
            signals[f"i({identity.lower()})"] = (component.id, "A")
        if component.kind != "voltage_source":
            sensor = f"Vsense{position}"
            sensed_node = f"sense{position}"
            lines.append(f"{sensor} {positive} {sensed_node} DC 0")
            positive = sensed_node
            signals[f"i({sensor.lower()})"] = (component.id, "A")
        ports = compiler.terminals(component, position, positive, negative)
        positive, negative = ports["positive"], ports["negative"]
        if compiler.stamp(component, position, ports):
            continue
        if component.kind not in prefixes:
            raise CircuitSimulationError("This device model is not available.")
        lines.append(f"{identity} {positive} {negative} {value}")
    lines.extend(compiler.lines)
    signals.update(compiler.signals)
    if len(signals) > 256:
        raise CircuitSimulationError("The circuit exceeds the 256-signal limit. Reduce components or probes.")
    for position, instrument in enumerate(circuit.instruments):
        if instrument.kind in {"voltmeter", "wattmeter", "energy_meter", "pf_meter", "frequency_meter", "oscilloscope"}:
            channels = [(instrument.positive, instrument.negative)]
            if instrument.kind == "oscilloscope":
                channels.append((instrument.reference_positive, instrument.reference_negative))
            for channel, (positive, negative) in enumerate(channels):
                if node_names[positive.lower()] != node_names[negative.lower()]:
                    lines.append(f"Rmeter{position}_{channel} {node_names[positive.lower()]} {node_names[negative.lower()]} {instrument.input_resistance_ohm:.12g}")
    lines.append(".save " + " ".join(signals))
    if circuit.analysis.mode == "dc":
        lines.append(".op")
    else:
        duration = circuit.analysis.duration_seconds
        step = duration / 500
        if circuit.format_version == 2:
            frequencies = [component.frequency_hz for component in circuit.components if component.waveform == "sine" or component.kind == "three_phase_source"]
            if frequencies:
                step = min(step, 1 / max(frequencies) / 80)
            for component in circuit.components:
                if component.kind == "plc":
                    step = min(step, component.parameters.scan_seconds / 20)
                if component.kind == "timer_relay":
                    step = min(step, component.parameters.delay_seconds / 20)
        lines.append(f".tran {step:.12g} {duration:.12g} 0 {step:.12g}" + (" uic" if circuit.format_version == 2 else ""))
    lines.append(".end")
    return "\n".join(lines) + "\n", signals


def parse_simulation(raw: str, circuit: CircuitSpec, signals: dict[str, tuple[str, str]]) -> CircuitResult:
    try:
        header, values_text = raw.split("Values:\n", 1)
        metadata, variables_text = header.split("Variables:\n", 1)
        fields = dict(line.split(":", 1) for line in metadata.splitlines() if ":" in line)
        if fields.get("Flags", "").strip() != "real":
            raise ValueError("Unsupported simulation output")
        variable_count, point_count = int(fields["No. Variables"]), int(fields["No. Points"])
        if not 1 <= variable_count <= 257 or not 1 <= point_count <= 20000:
            raise ValueError("Simulation output exceeds limits")
        variables = [line.split()[1].lower() for line in variables_text.splitlines() if line.strip()]
        rows = [line.split() for line in values_text.splitlines() if line.strip()]
        if len(variables) != variable_count or len(set(variables)) != variable_count or len(rows) != point_count * variable_count:
            raise ValueError("Incomplete simulation output")
        values = [[] for _variable in variables]
        for position in range(point_count):
            group = rows[position * variable_count:(position + 1) * variable_count]
            if int(group[0][0]) != position:
                raise ValueError("Invalid sample order")
            for column, row in enumerate(group):
                value = float(row[-1])
                if not math.isfinite(value):
                    raise ValueError("Nonfinite simulation value")
                values[column].append(value)
        sample_limit = min(1001, 64000 // (len(signals) + 1))
        selected = sorted({round(position * (point_count - 1) / min(point_count - 1, sample_limit - 1)) for position in range(min(point_count, sample_limit))}) if point_count > 1 else [0]
        traces = []
        time = []
        full_time = []
        full_samples = {}
        for variable, samples in zip(variables, values):
            if variable == "time":
                full_time = samples
                time = [samples[position] for position in selected]
                continue
            key = f"i({variable[:-7]})" if variable.endswith("#branch") else variable
            if key not in signals:
                raise ValueError("Unknown simulator signal")
            name, unit = signals[key]
            full_samples[name, unit] = samples
            traces.append(CircuitTrace(name=name, unit=unit, values=[samples[position] for position in selected]))
        if len(traces) != len(signals):
            raise ValueError("Missing simulator signal")
        if circuit.analysis.mode == "transient" and (not time or time[-1] < circuit.analysis.duration_seconds * 0.999):
            raise ValueError("Transient did not complete")
        measurements = instrument_measurements(circuit, full_samples, full_time, selected)
        notices = []
        kinds = {component.kind for component in circuit.components}
        if "induction_motor" in kinds:
            notices.append("Linear stationary-frame induction-machine model; no magnetic saturation, core losses or manufacturer calibration. Temperature uses a single thermal mass.")
        if kinds & {"fuse", "mcb", "rccb", "overload_relay"}:
            notices.append("Educational I-squared-t, thermal, magnetic and residual-current protection models, not certified device curves or safety verification.")
        if "vfd" in kinds:
            notices.append("Lossless averaged V/f drive with DC input, ramp, undervoltage code 1 and overcurrent code 2; no PWM harmonics or switching losses.")
        if "plc" in kinds:
            notices.append("Educational sampled PLC: input image at scan start, ordered rung evaluation, output image at half scan; 24 V outputs with 1 ohm impedance. Not a safety PLC.")
        if any(instrument.kind == "lux_meter" for instrument in circuit.instruments):
            notices.append("Lux uses explicit lamp efficacy and an isotropic point-source inverse-square model; no reflections, shadows or fixture optics.")
        if point_count > len(selected):
            notices.append("Plots are downsampled for bounded storage. Meter calculations use the full-resolution solver samples, not the plotted points.")
        return CircuitResult(mode=circuit.analysis.mode, time_seconds=time, traces=traces, measurements=measurements, notices=notices)
    except (ValueError, KeyError, IndexError, TypeError):
        raise CircuitSimulationError("The circuit did not produce a complete solution. Check its connections and component values.") from None


def simulate_circuit(circuit: CircuitSpec) -> CircuitResult:
    executable = shutil.which("ngspice")
    if not executable:
        raise CircuitSimulatorUnavailable("The circuit simulator is not installed on this server.")
    if not SIMULATION_SLOTS.acquire(blocking=False):
        raise CircuitSimulatorUnavailable("The circuit simulator is busy. Please retry shortly.")
    try:
        netlist, signals = circuit_netlist(circuit)
        with tempfile.TemporaryDirectory(prefix="circuit-") as directory:
            folder = Path(directory)
            (folder / "circuit.cir").write_text(netlist, encoding="ascii")
            try:
                limiter = shutil.which("prlimit")
                command = [executable, "-n", "-b", "-o", "simulator.log", "-r", "result.raw", "circuit.cir"]
                if limiter:
                    command = [limiter, "--as=536870912", "--cpu=8", f"--fsize={MAX_RAW_BYTES}", "--", *command]
                result = subprocess.run(
                    command,
                    cwd=folder, env={"HOME": directory, "SPICE_ASCIIRAWFILE": "1", "LANG": "C", "OMP_NUM_THREADS": "1"},
                    stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    timeout=8, check=False,
                )
            except subprocess.TimeoutExpired:
                raise CircuitSimulationError("The simulation exceeded its time limit. Simplify the circuit or shorten the run.") from None
            output = folder / "result.raw"
            if result.returncode or not output.is_file() or output.stat().st_size > MAX_RAW_BYTES:
                raise CircuitSimulationError("The circuit could not be solved. Check for floating nodes, shorted sources, or unsuitable values.")
            return parse_simulation(output.read_text(encoding="ascii"), circuit, signals)
    except CircuitSimulationError:
        raise
    except OSError as error:
        logger.warning("Circuit simulator unavailable (%s)", type(error).__name__)
        raise CircuitSimulatorUnavailable("The circuit simulator could not start. Please retry.") from None
    finally:
        SIMULATION_SLOTS.release()