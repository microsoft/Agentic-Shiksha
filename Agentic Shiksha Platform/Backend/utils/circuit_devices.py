import math

from backend.schemas.circuit import CircuitComponent, CircuitSpec
from backend.schemas.circuit_devices import CircuitFault


class DeviceCompiler:
    def __init__(self, circuit: CircuitSpec, nodes: dict[str, str]):
        self.circuit = circuit
        self.nodes = nodes
        self.lines: list[str] = []
        self.signals: dict[str, tuple[str, str]] = {}
        self.indices = {component.id.lower(): index for index, component in enumerate(circuit.components, 1)}
        self.components = {component.id.lower(): component for component in circuit.components}
        self.lines.append(".model INDUSTRIALSW SW(Ron=0.01 Roff=1e12 Vt=0.5 Vh=0.1)")

    def fault_gate(self, fault: CircuitFault) -> str:
        if self.circuit.analysis.mode == "dc":
            return "1"
        end = f" && time<{fault.end_seconds:.12g}" if fault.end_seconds is not None else ""
        return f"(time>={fault.start_seconds:.12g}{end})"

    def faults(self, component: CircuitComponent, *kinds: str) -> list[CircuitFault]:
        return [fault for fault in self.circuit.faults if fault.component_id.lower() == component.id.lower() and (not kinds or fault.kind in kinds)]

    def gate(self, component: CircuitComponent, *kinds: str) -> str:
        return "(" + " || ".join(self.fault_gate(fault) for fault in self.faults(component, *kinds)) + ")" if self.faults(component, *kinds) else "0"

    def scheduled(self, component: CircuitComponent, initial: float, actions: dict[str, float] | None = None) -> str:
        expression = f"{initial:.12g}"
        mapping = actions or {"press": 1, "release": 0, "close": 1, "open": 0, "off": 0, "select_a": 1, "select_b": 2}
        events = sorted((event for event in self.circuit.events if event.component_id.lower() == component.id.lower()), key=lambda event: event.time_seconds)
        for event in events:
            if event.action in mapping or event.action == "analog":
                value = event.value if event.action == "analog" else mapping[event.action]
                expression = f"(time>={event.time_seconds:.12g}?{value:.12g}:{expression})"
        return expression

    def control(self, identity: str | None) -> str:
        component = self.components.get((identity or "").lower())
        return f"v(d{self.indices[component.id.lower()]}ctl)" if component and component.connected else "0"

    def terminal_fault(self, component: CircuitComponent, terminal: str, node: str) -> str:
        faults = [fault for fault in self.faults(component, "open_wire", "open_neutral", "loose_neutral", "burnt_contact", "phase_loss", "open_winding", "intermittent_contact") if fault.terminal == terminal]
        for fault in faults:
            identity = f"f{self.circuit.faults.index(fault)}"
            gate = self.fault_gate(fault)
            resistance = fault.resistance_ohm if fault.kind in {"loose_neutral", "burnt_contact"} else 1e8 if component.kind == "induction_motor" else 1e12
            if fault.kind == "intermittent_contact":
                gate = f"({gate} && sin(62.8318530718*time)>0)"
            self.lines.append(f"R{identity} {node} {identity} r={{1e-6+({gate}?{resistance:.12g}:0)}}")
            node = identity
        return node

    def terminals(self, component: CircuitComponent, index: int, positive: str, negative: str) -> dict[str, str]:
        ports = {"positive": self.terminal_fault(component, "positive", positive), "negative": negative}
        for terminal, node in {"negative": component.negative, **component.terminals}.items():
            if self.circuit.format_version == 1:
                continue
            inner = f"d{index}p{terminal.lower()}"
            sensor = f"Vsense{index}_{terminal.lower()}"
            self.lines.append(f"{sensor} {self.nodes[node.lower()]} {inner} DC 0")
            self.signals[f"i({sensor.lower()})"] = (f"{component.id}_{terminal}", "A")
            ports[terminal] = self.terminal_fault(component, terminal, inner)
        return ports

    def parameter_value(self, component: CircuitComponent) -> str:
        expression = f"{component.value:.12g}"
        for fault in self.faults(component, "weak_capacitor", "load_imbalance"):
            scale = 1 - fault.severity * 0.99 if fault.kind == "weak_capacitor" else 1 + 4 * fault.severity
            expression = f"({expression})*(1+({scale:.12g}-1)*{self.fault_gate(fault)})"
        return "{" + expression + "}" if self.faults(component, "weak_capacitor", "load_imbalance") else expression

    def switch(self, identity: str, positive: str, negative: str, expression: str):
        self.lines.extend([f"B{identity} {identity}ctl 0 V={{{expression}}}", f"S{identity} {positive} {negative} {identity}ctl 0 INDUSTRIALSW"])

    def state(self, identity: str, derivative: str, initial: float = 0):
        self.lines.extend([f"C{identity} {identity} 0 1 IC={initial:.12g}", f"B{identity} {identity} 0 I={{-({derivative})}}"])

    def signal(self, identity: str, expression: str, name: str, unit: str):
        self.lines.append(f"B{identity} {identity} 0 V={{{expression}}}")
        self.signals[f"v({identity})"] = (name, unit)

    def motor(self, component: CircuitComponent, index: int, ports: dict[str, str]):
        identity = f"d{index}"
        parameters = component.parameters
        stator = parameters.stator_leakage_h + parameters.magnetizing_h
        rotor = parameters.rotor_leakage_h + parameters.magnetizing_h
        mutual = parameters.magnetizing_h
        determinant = stator * rotor - mutual * mutual
        voltages = [f"v({ports[first]},{ports[second]})" for first, second in [("positive", "negative"), ("V1", "V2"), ("W1", "W2")]]
        self.lines.extend([
            f"B{identity}ua {identity}ua 0 V={{(2*{voltages[0]}-{voltages[1]}-{voltages[2]})/3}}",
            f"B{identity}ub {identity}ub 0 V={{({voltages[1]}-{voltages[2]})/sqrt(3)}}",
        ])
        for axis in ("a", "b"):
            self.lines.extend([
                f"B{identity}is{axis} {identity}is{axis} 0 V={{({rotor:.12g}*v({identity}ps{axis})-{mutual:.12g}*v({identity}pr{axis}))/{determinant:.12g}}}",
                f"B{identity}ir{axis} {identity}ir{axis} 0 V={{({stator:.12g}*v({identity}pr{axis})-{mutual:.12g}*v({identity}ps{axis}))/{determinant:.12g}}}",
            ])
            self.state(f"{identity}ps{axis}", f"v({identity}u{axis})-{parameters.stator_resistance_ohm:.12g}*v({identity}is{axis})")
            cross = f"-v({identity}prb)" if axis == "a" else f"v({identity}pra)"
            self.state(f"{identity}pr{axis}", f"-{parameters.rotor_resistance_ohm:.12g}*v({identity}ir{axis})+{parameters.pole_pairs}*v({identity}speed)*({cross})")
        self.state(f"{identity}zero", f"(({'+'.join(voltages)})/3-{parameters.stator_resistance_ohm:.12g}*v({identity}zero))/{parameters.stator_leakage_h:.12g}")
        phase_currents = [f"v({identity}isa)+v({identity}zero)", f"-0.5*v({identity}isa)+sqrt(3)/2*v({identity}isb)+v({identity}zero)", f"-0.5*v({identity}isa)-sqrt(3)/2*v({identity}isb)+v({identity}zero)"]
        for phase, ((first, second), current) in enumerate(zip([("positive", "negative"), ("V1", "V2"), ("W1", "W2")], phase_currents)):
            self.lines.append(f"B{identity}phase{phase} {ports[first]} {ports[second]} I={{{current}}}")
            self.lines.append(f"C{identity}winding{phase} {ports[first]} {ports[second]} {parameters.winding_capacitance_nf * 1e-9:.12g}")
        torque = f"{1.5 * parameters.pole_pairs:.12g}*(v({identity}psa)*v({identity}isb)-v({identity}psb)*v({identity}isa))"
        self.signal(f"{identity}torque", torque, f"{component.id}_torque", "Nm")
        load = f"{parameters.load_torque_nm:.12g}"
        for fault in self.faults(component, "overload", "bearing_load"):
            load += f"+{max(1, parameters.load_torque_nm) * (1 + 9 * fault.severity):.12g}*{self.fault_gate(fault)}"
        stall = self.gate(component, "stalled_rotor")
        acceleration = f"(v({identity}torque)-({load})*tanh(v({identity}speed)/0.1)-{parameters.friction_nm_s:.12g}*v({identity}speed))/{parameters.inertia_kg_m2:.12g}"
        self.state(f"{identity}speed", f"({stall}?-v({identity}speed)*10000:({acceleration}))")
        self.signal(f"{identity}rpm", f"v({identity}speed)*{30 / math.pi:.12g}", component.id, "rpm")
        copper = f"1.5*({parameters.stator_resistance_ohm:.12g}*(v({identity}isa)^2+v({identity}isb)^2)+{parameters.rotor_resistance_ohm:.12g}*(v({identity}ira)^2+v({identity}irb)^2))+3*{parameters.stator_resistance_ohm:.12g}*v({identity}zero)^2"
        self.state(f"{identity}heat", f"(({copper})+{parameters.friction_nm_s:.12g}*v({identity}speed)^2-v({identity}heat)/{parameters.thermal_resistance_k_w:.12g})/{parameters.thermal_capacity_j_k:.12g}")
        self.signal(f"{identity}temperature", f"v({identity}heat)+{parameters.ambient_temperature_c:.12g}", f"{component.id}_temp", "degC")
        self.lines.append(f"R{identity}body {ports['PE']} 0 1e12")
        for fault in self.faults(component, "insulation_leakage", "earth_fault"):
            terminal = ports[fault.terminal]
            self.lines.append(f"R{identity}leak{self.circuit.faults.index(fault)} {terminal} {ports['PE']} r={{{self.fault_gate(fault)}?{fault.resistance_ohm:.12g}:1e12}}")

    def protection(self, component: CircuitComponent, index: int, ports: dict[str, str]):
        identity = f"d{index}"
        parameters = component.parameters
        current = f"i(vsense{index})"
        pairs = [(ports["positive"], ports["negative"])]
        if component.kind == "overload_relay":
            pairs.extend([(ports["L2_IN"], ports["L2_OUT"]), (ports["L3_IN"], ports["L3_OUT"])])
            current = f"sqrt((i(vsense{index})^2+i(vsense{index}_l2_in)^2+i(vsense{index}_l3_in)^2)/3)"
        reset_times = [event.time_seconds for event in self.circuit.events if event.component_id.lower() == component.id.lower() and event.action == "reset"]
        reset = "(" + " || ".join(f"(time>={time:.12g} && time<{time + 0.001:.12g})" for time in reset_times) + ")" if reset_times else "0"
        if component.kind == "fuse":
            derivative = f"({current})^2"
            threshold = f"v({identity}heat)>={parameters.i2t_limit:.12g}"
        elif component.kind == "rccb":
            pairs.append((ports["N_IN"], ports["N_OUT"]))
            residual = f"abs(i(vsense{index})+i(vsense{index}_n_in))"
            derivative = f"({residual}>={parameters.residual_current_a:.12g}?1:-v({identity}heat)*10000)"
            threshold = f"v({identity}heat)>={parameters.trip_delay_seconds:.12g}"
        else:
            derivative = f"((({current})/{parameters.rated_current_a:.12g})^2-v({identity}heat))/{parameters.thermal_time_seconds:.12g}"
            threshold = f"v({identity}heat)>=1.44"
            if component.kind == "mcb":
                threshold += f" || abs({current})>={parameters.rated_current_a * parameters.magnetic_multiple:.12g}"
        self.state(f"{identity}heat", derivative)
        reset_allowed = "0" if component.kind == "fuse" else f"({reset} && v({identity}heat)<0.5)"
        self.state(f"{identity}trip", f"({reset_allowed}?-v({identity}trip)*10000:(({threshold}) && v({identity}trip)<1?(1-v({identity}trip))*100000:0))")
        self.signal(f"{identity}ctl", f"v({identity}trip)>0.5", component.id, "state")
        for pole, (incoming, outgoing) in enumerate(pairs):
            self.switch(f"{identity}p{pole}", incoming, outgoing, f"v({identity}trip)<0.5")

    def drive(self, component: CircuitComponent, index: int, ports: dict[str, str]):
        identity = f"d{index}"
        parameters = component.parameters
        enabled = self.scheduled(component, int(component.closed))
        bus = f"v({ports['positive']},{ports['negative']})"
        phase_currents = [f"i(vsense{index}_{terminal.lower()})" for terminal in ("U", "V", "W")]
        overload = " || ".join(f"abs({current})>{parameters.rated_current_a * 2.5:.12g}" for current in phase_currents)
        reset = " || ".join(f"(time>={event.time_seconds:.12g} && time<{event.time_seconds + 0.001:.12g})" for event in self.circuit.events if event.component_id.lower() == component.id.lower() and event.action == "reset") or "0"
        self.state(f"{identity}trip", f"(({reset}) && !({enabled})?-v({identity}trip)*10000:(({overload}) && v({identity}trip)<1?(1-v({identity}trip))*100000:0))")
        frequency = f"{parameters.drive_frequency_hz:.12g}*min(time/{parameters.drive_ramp_seconds:.12g},1)"
        self.state(f"{identity}angle", f"{2 * math.pi:.12g}*({frequency})")
        self.signal(f"{identity}code", f"(v({identity}trip)>0.5?2:(abs({bus})<10?1:0))", f"{component.id}_code", "state")
        direction = 1 if parameters.phase_sequence == "abc" else -1
        for phase, terminal in enumerate(("U", "V", "W")):
            angle = f"v({identity}angle)-{phase * 2 * math.pi / 3 * direction:.12g}*(1-2*{self.gate(component, 'phase_reversal')})"
            amplitude = f"min(abs({bus})/sqrt(3),{parameters.line_voltage_rms * math.sqrt(2 / 3):.12g})*min(({frequency})/50,1)"
            self.lines.append(f"B{identity}phase{phase} {ports[terminal]} {ports['N']} V={{({enabled}) && v({identity}code)<0.5?({amplitude})*sin({angle}):0}}")
        power = "+".join(f"-v({ports[terminal]},{ports['N']})*{current}" for terminal, current in zip(("U", "V", "W"), phase_currents))
        self.lines.append(f"B{identity}input {ports['positive']} {ports['negative']} I={{abs({bus})>1?({power})/({bus}):0}}")
        self.lines.append(f"R{identity}reference {ports['N']} {ports['negative']} 1e12")

    def plc(self, component: CircuitComponent, index: int, ports: dict[str, str]):
        identity = f"d{index}"
        parameters = component.parameters
        scan = parameters.scan_seconds
        phase = f"(time/{scan:.12g}-floor(time/{scan:.12g}))"
        enabled = f"v({ports['positive']},{ports['negative']})>12"
        sample = f"({phase}<0.15)"
        write = f"({phase}>0.5 && {phase}<0.65)"
        remember = f"({phase}>0.8)"
        rate = max(10000, 1000 / scan)
        self.lines.append(f"R{identity}supply {ports['positive']} {ports['negative']} 2400")
        for terminal in ("IN1", "IN2", "IN3", "IN4", "OUT1", "OUT2", "OUT3", "OUT4"):
            self.state(f"{identity}sample{terminal.lower()}", f"({sample}?((v({ports[terminal]},{ports['negative']})>{parameters.analog_threshold_v:.12g})-v({identity}sample{terminal.lower()}))*{rate:.12g}:0)")
            if terminal.startswith("IN"):
                self.lines.append(f"R{identity}{terminal.lower()} {ports[terminal]} {ports['negative']} 1e7")
        output_expressions = {terminal: "0" for terminal in ("OUT1", "OUT2", "OUT3", "OUT4")}
        for position, rung in enumerate(component.rungs):
            rung_id = f"{identity}r{position}"
            terms = [f"(v({identity}sample{item.terminal.lower()}){'<' if item.normally_closed else '>'}0.5)" for item in rung.inputs]
            condition = "(" + (" || " if rung.operation == "or" else " && ").join(terms) + ")"
            previous = output_expressions[rung.output] if any(prior.output == rung.output for prior in component.rungs[:position]) else f"v({identity}sample{rung.output.lower()})>0.5"
            expression = condition
            if rung.operation == "set":
                expression = f"({condition} || ({previous}))"
            elif rung.operation == "reset":
                expression = f"(!{condition} && ({previous}))"
            elif rung.operation == "ton":
                self.state(f"{rung_id}timer", f"({enabled} && {condition}?1:-v({rung_id}timer)*{rate:.12g})")
                expression = f"v({rung_id}timer)>={rung.preset:.12g}"
            elif rung.operation == "ctu":
                self.state(f"{rung_id}previous", f"({remember}?(({condition})-v({rung_id}previous))*{rate:.12g}:0)")
                self.state(f"{rung_id}oldcount", f"({sample}?(v({rung_id}count)-v({rung_id}oldcount))*{rate:.12g}:0)")
                self.state(f"{rung_id}count", f"(!({enabled})?-v({rung_id}count)*{rate:.12g}:({write}?(v({rung_id}oldcount)+({condition} && v({rung_id}previous)<0.5)-v({rung_id}count))*{rate:.12g}:0))")
                expression = f"v({rung_id}count)>={rung.preset - 0.01:.12g}"
            output_expressions[rung.output] = expression
        for terminal, expression in output_expressions.items():
            output = f"{identity}output{terminal.lower()}"
            self.state(output, f"(!({enabled})?-v({output})*{rate:.12g}:({write}?(({expression})-v({output}))*{rate:.12g}:0))")
            self.lines.append(f"B{identity}{terminal.lower()} {output}drive {ports['negative']} V={{({enabled}) && v({output})>0.5?24:0}}")
            self.lines.append(f"R{identity}{terminal.lower()} {output}drive {ports[terminal]} 1")
            self.signals[f"v({output})"] = (f"{component.id}_{terminal}", "state")

    def winding(self, identity: str, primary: tuple[str, str], secondary: tuple[str, str], component: CircuitComponent):
        parameters = component.parameters
        self.lines.extend([
            f"R{identity}p {primary[0]} {identity}p {parameters.winding_resistance_ohm:.12g}",
            f"L{identity}p {identity}p {primary[1]} {parameters.primary_inductance_h:.12g}",
            f"R{identity}s {secondary[0]} {identity}s {parameters.winding_resistance_ohm:.12g}",
            f"L{identity}s {identity}s {secondary[1]} {parameters.primary_inductance_h / component.value ** 2:.12g}",
            f"K{identity} L{identity}p L{identity}s {parameters.coupling:.12g}",
            f"R{identity}reference {secondary[1]} 0 1e12",
        ])

    def stamp(self, component: CircuitComponent, index: int, ports: dict[str, str]) -> bool:
        positive, negative = ports["positive"], ports["negative"]
        identity = f"d{index}"
        parameters = component.parameters
        kind = component.kind
        if kind == "ammeter":
            self.lines.append(f"V{identity} {positive} {negative} DC 0")
        elif kind in {"wire", "indicator_lamp", "contactor_coil", "timer_relay"}:
            self.lines.append(f"R{identity} {positive} {negative} {self.parameter_value(component)}")
            if kind in {"contactor_coil", "timer_relay"}:
                pickup = f"abs(i(vsense{index}))*{component.value / parameters.coil_voltage:.12g}"
                if kind == "timer_relay":
                    delay = parameters.delay_seconds
                    charge = f"({pickup}>0.6?-1:v({identity}elapsed)*10000)" if parameters.timer_mode == "on_delay" else f"({pickup}>0.6?(v({identity}elapsed)-{delay:.12g})*10000:(v({identity}elapsed)>0?1:v({identity}elapsed)*10000))"
                    self.lines.extend([f"C{identity}elapsed {identity}elapsed 0 1 IC=0", f"B{identity}elapsed {identity}elapsed 0 I={{{charge}}}"])
                    pickup = f"v({identity}elapsed)>={delay:.12g}" if parameters.timer_mode == "on_delay" else f"v({identity}elapsed)>0.00001"
                self.lines.append(f"B{identity}ctl {identity}ctl 0 V={{{pickup}}}")
                self.signals[f"v({identity}ctl)"] = (component.id, "state")
        elif kind in {"pushbutton_no", "pushbutton_nc", "emergency_stop", "limit_switch", "proximity_switch"}:
            command = self.scheduled(component, int(component.closed))
            if kind in {"pushbutton_nc", "emergency_stop"}:
                command = f"1-({command})"
            self.switch(identity, positive, negative, command)
        elif kind in {"contact_no", "contact_nc", "contactor"}:
            command = self.control(component.link)
            controller = self.components.get((component.link or "").lower())
            interlock = component.interlock or (controller.interlock if controller else None)
            if interlock:
                command = f"({command})*({self.control(interlock)}<0.4)"
            if kind == "contact_nc":
                command = f"1-({command})"
            command = f"({self.gate(component, 'stuck_contactor')}?1:({command}))"
            pairs = [(positive, negative)]
            if kind == "contactor":
                pairs.extend([(ports["L2_IN"], ports["L2_OUT"]), (ports["L3_IN"], ports["L3_OUT"])])
            for pole, (incoming, outgoing) in enumerate(pairs):
                self.switch(f"{identity}p{pole}", incoming, outgoing, command)
        elif kind == "selector_switch":
            position = {"off": 0, "a": 1, "b": 2}[parameters.selector_position]
            command = f"({self.gate(component, 'stuck_contactor')}?{position}:({self.scheduled(component, position)}))"
            self.switch(f"{identity}a", positive, negative, f"({command})==1")
            self.switch(f"{identity}b", positive, ports["B"], f"({command})==2")
        elif kind == "three_phase_source":
            direction = 1 if parameters.phase_sequence == "abc" else -1
            reversal = self.gate(component, "phase_reversal")
            amplitude = parameters.line_voltage_rms * math.sqrt(2 / 3)
            for phase, (terminal, scale) in enumerate(zip(["positive", "L2", "L3"], [parameters.phase_a_scale, parameters.phase_b_scale, parameters.phase_c_scale])):
                angle = f"({parameters.phase_degrees * math.pi / 180:.12g}-{phase * 2 * math.pi / 3 * direction:.12g}*(1-2*{reversal}))"
                self.lines.append(f"B{identity}phase{phase} {ports[terminal]} {negative} V={{{amplitude * scale:.12g}*sin({2 * math.pi * component.frequency_hz:.12g}*time+{angle})}}")
        elif kind == "transformer":
            self.winding(identity, (positive, negative), (ports["S1"], ports["S2"]), component)
        elif kind == "three_phase_transformer":
            primary, secondary = [positive, ports["L2"], ports["L3"]], [ports["S1"], ports["S2"], ports["S3"]]
            for phase in range(3):
                primary_return = negative if parameters.primary_connection == "star" else primary[(phase + 1) % 3]
                secondary_return = ports["SN"] if parameters.secondary_connection == "star" else secondary[(phase + 1) % 3]
                self.winding(f"{identity}w{phase}", (primary[phase], primary_return), (secondary[phase], secondary_return), component)
            self.lines.extend([f"R{identity}pn {negative} 0 1e12", f"R{identity}sn {ports['SN']} 0 1e12"])
        elif kind == "bridge_rectifier":
            for diode, (anode, cathode) in enumerate([(positive, ports["DC_P"]), (negative, ports["DC_P"]), (ports["DC_N"], positive), (ports["DC_N"], negative)]):
                self.lines.append(f"D{identity}_{diode} {anode} {cathode} DDEFAULT")
        elif kind == "analog_input":
            self.lines.append(f"B{identity} {positive} {negative} V={{{self.scheduled(component, component.value)}}}")
        elif kind == "hmi":
            self.lines.extend([f"R{identity} {positive} {negative} 1e7", f"B{identity}display {identity}display 0 V=v({positive},{negative})"])
            self.signals[f"v({identity}display)"] = (f"{component.id}_display", "V")
        elif kind == "induction_motor":
            self.motor(component, index, ports)
        elif kind in {"fuse", "mcb", "rccb", "overload_relay"}:
            self.protection(component, index, ports)
        elif kind == "vfd":
            self.drive(component, index, ports)
        elif kind == "plc":
            self.plc(component, index, ports)
        else:
            return False
        return True