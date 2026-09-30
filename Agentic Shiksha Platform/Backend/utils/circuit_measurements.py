import math
from bisect import bisect_left

from backend.schemas.circuit import CircuitMeasurement, CircuitQuantity, CircuitSpec, CircuitTrace


def mean_product(time: list[float], first: list[float], second: list[float]) -> float:
    if not time:
        return first[0] * second[0]
    duration = time[-1] - time[0]
    return math.fsum(
        (end - start) * (2 * first[index] * second[index] + first[index] * second[index + 1]
                         + first[index + 1] * second[index] + 2 * first[index + 1] * second[index + 1]) / 6
        for index, (start, end) in enumerate(zip(time, time[1:]))
    ) / duration


def signal_statistics(time: list[float], values: list[float]) -> tuple[float, float, float]:
    mean = mean_product(time, values, [1.0] * len(values))
    square = max(0.0, mean_product(time, values, values))
    return mean, math.sqrt(square), math.sqrt(max(0.0, square - mean * mean))


def signal_frequency(time: list[float], values: list[float]) -> tuple[float, list[float]] | None:
    if len(time) < 33 or max(values) - min(values) < 1e-6:
        return None
    center = (max(values) + min(values)) / 2
    crossings = [
        time[index] + (center - before) * (time[index + 1] - time[index]) / (after - before)
        for index, (before, after) in enumerate(zip(values, values[1:])) if before <= center < after
    ]
    if len(crossings) < 3:
        return None
    periods = [after - before for before, after in zip(crossings, crossings[1:])]
    period = math.fsum(periods) / len(periods)
    if max(abs(value - period) for value in periods) > period * 0.02:
        return None
    if max(after - before for before, after in zip(time, time[1:])) > period / 16:
        return None
    return 1 / period, crossings


def instrument_measurements(circuit: CircuitSpec, samples: dict[tuple[str, str], list[float]], time: list[float], selected: list[int]) -> list[CircuitMeasurement]:
    count = len(time) or 1
    grounds = {"0", *(node.lower() for node in circuit.grounds)}
    normalized = {(name.lower(), unit): values for (name, unit), values in samples.items()}

    def voltage(positive: str, negative: str) -> list[float]:
        def node_values(node: str) -> list[float]:
            return [0.0] * count if node.lower() in grounds else normalized[node.lower(), "V"]
        return [positive_value - negative_value for positive_value, negative_value in zip(node_values(positive), node_values(negative))]

    readings = []
    for instrument in circuit.instruments:
        def unavailable(reason: str) -> CircuitMeasurement:
            return CircuitMeasurement(instrument_id=instrument.id, status="unavailable", reason=reason)

        start = max(0, bisect_left(time, instrument.window_start_seconds) - 1) if time else 0
        window = time[start:]
        if window and (len(window) < 2 or window[-1] <= instrument.window_start_seconds):
            readings.append(unavailable("The selected measurement window has too few samples."))
            continue
        fraction = (instrument.window_start_seconds - window[0]) / (window[1] - window[0]) if window and window[0] < instrument.window_start_seconds else 0.0
        if fraction:
            window = [instrument.window_start_seconds, *window[1:]]

        def window_values(values: list[float]) -> list[float]:
            result = values[start:]
            if fraction:
                result = [result[0] + fraction * (result[1] - result[0]), *result[1:]]
            return result

        quantities = []
        channels = []

        def quantity(label: str, value: float, unit: str):
            quantities.append(CircuitQuantity(label=label, value=value, unit=unit))

        if instrument.kind in {"rpm_meter", "lux_meter"}:
            target = next((component for component in circuit.components if component.id.lower() == (instrument.target or "").lower()), None)
            if instrument.kind == "rpm_meter" and target and (target.id.lower(), "rpm") in normalized:
                shaft_speed = window_values(normalized[target.id.lower(), "rpm"])[-1]
                quantity("Shaft speed", shaft_speed, "rpm")
                first_phase = signal_frequency(window, window_values(voltage(target.positive, target.negative)))
                second_phase = signal_frequency(window, window_values(voltage(target.terminals["V1"], target.terminals["V2"])))
                if first_phase and second_phase and abs(first_phase[0] - second_phase[0]) < first_phase[0] * 0.02:
                    displacement = ((second_phase[1][0] - first_phase[1][0]) * first_phase[0] * 360 + 180) % 360 - 180
                    if 90 < abs(displacement) < 150:
                        synchronous_speed = math.copysign(first_phase[0] * 60 / target.parameters.pole_pairs, displacement)
                        quantity("Synchronous speed", synchronous_speed, "rpm")
                        quantity("Slip", 100 * (1 - shaft_speed / synchronous_speed), "%")
            elif instrument.kind == "lux_meter" and target and target.kind in {"bulb", "indicator_lamp"} and target.parameters.luminous_efficacy_lm_w > 0:
                current = window_values(normalized[target.id.lower(), "A"])
                power = mean_product(window, current, current) * target.value
                lux = power * target.parameters.luminous_efficacy_lm_w * math.cos(math.radians(instrument.angle_degrees)) / (4 * math.pi * instrument.distance_m ** 2)
                quantity("Isotropic point-source illuminance", instrument.ambient_lux + lux, "lx")
            else:
                readings.append(unavailable("RPM requires an induction motor; lux requires a lamp with explicit luminous efficacy. No reading can be inferred from animation."))
                continue
            readings.append(CircuitMeasurement(instrument_id=instrument.id, status="available", quantities=quantities))
            continue
        full_voltage = voltage(instrument.positive, instrument.negative)
        voltages = window_values(full_voltage)
        current = window_values([
            math.fsum(normalized[conductor.component_id.lower() + ("_" + conductor.terminal.lower() if conductor.terminal != "positive" and circuit.format_version == 2 else ""), "A"][index] * conductor.direction * (-1 if conductor.terminal == "negative" and circuit.format_version == 1 else 1) for conductor in instrument.conductors)
            for index in range(count)
        ])
        voltage_mean, voltage_rms, voltage_ac = signal_statistics(window, voltages)
        current_mean, current_rms, current_ac = signal_statistics(window, current)
        if instrument.kind in {"voltmeter", "clamp_meter"}:
            values = (voltage_mean, voltage_ac, voltage_rms) if instrument.kind == "voltmeter" else (current_mean, current_ac, current_rms)
            position = {"dc": 0, "ac": 1, "ac_dc": 2}[instrument.mode]
            quantity(("DC mean", "AC RMS", "Total RMS")[position], values[position], "V" if instrument.kind == "voltmeter" else "A")
        elif instrument.kind in {"wattmeter", "energy_meter", "pf_meter"}:
            real_power = mean_product(window, voltages, current)
            apparent_power = voltage_rms * current_rms
            if instrument.kind == "pf_meter" and (not window or apparent_power < 1e-9):
                readings.append(unavailable("Power factor needs an AC time window with non-zero voltage and current."))
                continue
            if instrument.kind == "energy_meter" and not window:
                readings.append(unavailable("Energy needs a transient run with an explicit simulation-time interval."))
                continue
            if instrument.kind != "pf_meter":
                quantity("Real power", real_power, "W")
                quantity("Apparent power", apparent_power, "VA")
            if apparent_power >= 1e-9 and window:
                quantity("True power factor", max(-1.0, min(1.0, real_power / apparent_power)), "PF")
            if instrument.kind == "energy_meter":
                quantity("Net energy", real_power * (window[-1] - window[0]) / 3600000, "kWh")
                quantity("Simulation interval", window[-1] - window[0], "s")
        elif instrument.kind == "frequency_meter":
            frequency = signal_frequency(window, voltages)
            if frequency is None:
                readings.append(unavailable("Need at least three stable rising crossings and 16 samples per period; DC and irregular signals have no reliable frequency reading."))
                continue
            quantity("Frequency", frequency[0], "Hz")
        elif instrument.kind == "oscilloscope":
            if not time:
                readings.append(unavailable("The oscilloscope needs transient analysis."))
                continue
            reference = voltage(instrument.reference_positive, instrument.reference_negative)
            reference_window = window_values(reference)
            quantity("A RMS", voltage_rms, "V")
            quantity("A DC", voltage_mean, "V")
            quantity("A ripple peak-to-peak", max(voltages) - min(voltages), "V")
            quantity("B RMS", signal_statistics(window, reference_window)[1], "V")
            quantity("B ripple peak-to-peak", max(reference_window) - min(reference_window), "V")
            frequency = signal_frequency(window, voltages)
            reference_frequency = signal_frequency(window, reference_window)
            if frequency:
                quantity("A frequency", frequency[0], "Hz")
            if frequency and reference_frequency and abs(frequency[0] - reference_frequency[0]) < frequency[0] * 0.02:
                phase = -360 * frequency[0] * (reference_frequency[1][0] - frequency[1][0])
                quantity("B rising-edge phase relative to A", (phase + 180) % 360 - 180, "deg")
            channels = [CircuitTrace(name=name, unit="V", values=[values[index] for index in selected]) for name, values in [("ChannelA", full_voltage), ("ChannelB", reference)]]
        readings.append(CircuitMeasurement(instrument_id=instrument.id, status="available", quantities=quantities, channels=channels))
    return readings