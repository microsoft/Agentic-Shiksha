# add_circuit

`AddCircuitTool` runs ngspice and returns a validated `circuit` chat block containing
the circuit specification and numerical results. It does not use a model to invent
voltages or currents, and does not accept raw SPICE or external device models.

## Chat-driven entry

Learners ask the TA for a supported simulation in conversation; the tool produces
an interactive Open card. There is no standalone Simulation shortcut in the TA
actions menu. The runtime injects
[simulation_request_context_v1.md](../../../prompt_store/tools/simulation_request_context_v1.md)
on tool-enabled streaming turns, so existing named TAs receive the current routing
guidance without changing their remote definitions. Both new and continued chats,
including AG-UI, share this behavior.

The registered tool must still be available. An older TA needs the owner's explicit
enable/update action if its circuit schema is unavailable or outdated. Unclear model
details are clarified before constructing a simulation; conceptual questions and
unsupported simulations do not trigger fake output or a menu redirect.

## Supported Circuits

- DC operating points and transient simulations with DC, step, or sine voltage sources.
- Resistors, bulbs, capacitors, inductors, generic silicon diodes, and fixed-state switches.
- Format 1: 2-24 components, at most 17 distinct terminal names. Format 2: 2-48
  components, at most 64 nodes, named device terminals, events and faults. Both
  require a ground reference and permit 8 selected plot probes plus instrument probes.
- SI units: ohms, farads, henries, volts, hertz, seconds. Source values are limited to
  -48 through 48 V; this is an educational model, not a hardware safety assessment.
- Switch resistance is 0.01 ohm closed or 1e12 ohms open. The diode is a fixed generic
  silicon model, not a manufacturer-specific component.
- The ordinary `switch` remains a two-terminal SPST. Format 2 adds an explicit
  center-off SPDT selector, linked contacts, and timed control events.
- Transient duration is 1 microsecond through 10 seconds, at most 50 sine periods
  in format 1 or 200 periods in format 2, subject to execution/output limits.
  Each component has a current trace named by its component ID. Positive current runs
  from its positive terminal to its negative terminal, including voltage sources.
  Internal zero-volt series probes let ngspice measure passive-component currents
  without deriving them from selected voltage probes or changing component values.

Chat shows a compact **Open** circuit item. The existing document pane contains the
simulator, using a full-screen pane on mobile and short landscape screens. The schematic
fits the available space while Run and playback stay visible. A fixed dock separates
Components, Simulation, Meters, Waveforms, and Readings instead of stacking a scrolling form.
Waveforms select a signal; readings page through four tiles, with all data retained in CSV.
Focus mode hides the dock, and zoom/pan never adds canvas scrollbars. Zooming out to
the minimum restores the fitted view instead of using a separate Fit button. The
full-screen button beside Close expands the entire pane using the browser Fullscreen API, falling
back to a viewport-filling pane when unavailable. Exit or Escape restores the pane
without discarding drafts. Full screen also works in read-only shared chats.
The simulator supports editing values and nodes, node-first component insertion,
disconnect/reconnect, drag placement, switch states, waveform selection, voltage probes,
Run/Pause, Reset unsimulated changes, pinch/pan zoom, voltage/current plots, circuit SVG
and results CSV export. Successful reruns update the saved chat
block; Reset restores the latest successful run. Failed runs retain the previous result
and label unsimulated edits. Public shared chats expose saved results, visual playback,
and downloads, not editing or authenticated reruns.

## Node Editing

Select two existing node labels or junctions, then choose the component to connect
between them. Positive/negative terminal order follows selection order. `connected`
defaults to true; setting it false keeps the part in the drawing but excludes it from
ngspice and omits its current trace. Reconnect and Run to restore a solved branch.
Validation applies ground paths, active sources, loads, and probes to connected parts.

For series insertion, select a connected component and choose **Series**, the new part,
and the positive or negative lead. The editor splits only that lead with a fresh node;
it does not attach another branch across the existing two nodes. Other parallel branches
and ground references remain unchanged. Run recomputes the result. Tests verify a
1-kohm series resistor halves current in an existing 1-kohm branch at 12 V without changing
an independent 2-kohm parallel branch, for insertion on either lead.

Select a single node and Ground to attach it to the common reference. `grounds` contains
unique existing non-zero node names; all map to SPICE node 0. Both terminals of a connected
component cannot be grounded, and grounded nodes cannot be voltage probes. The editor
requires confirmation and clears probe selection for a fresh solve. This is an ideal
reference connection, not a protective-earth bond. In format 2, `node_roles` labels
L1/L2/L3/N/PE without joining them. Use explicit wires and resistances for neutral,
protective-earth, body leakage and earthing paths.

Dragging reorders visual rows and sets `position` (0 through 1) along the branch. Layout
does not change terminal node names, and position never enters the netlist. Saved valid
results can therefore accompany placement-only edits without a new solve.

Run solves stale/unsimulated circuits and starts playback; the same green control then
becomes Pause. Resuming a current result reuses its data. Circuit SVG export includes the
whole drawing even when zoomed; results CSV is disabled for stale data. The information
button opens model limitations rather than relying only on a hover tooltip.

## Bulbs

Use `kind: "bulb"`, not a resistor named `BULB`. `value` is the fixed operating
resistance in ohms (0.1 through 1e8); `rated_voltage` is 0.1 through 48 V, default 12 V.
The editor's new bulb defaults to 120 ohms. ngspice solves it as a resistive load and
returns its signed branch current, while the schematic draws a circle-and-cross lamp.

Power is derived from the solved current as $P=I^2R$. Illustrative glow scales with
$P/(V_{rated}^2/R)$, capped at full brightness; above-rated power is flagged without
predicting burnout. This is not a nonlinear filament, thermal, LED, or photometric model.
No valid result, unsimulated edits, or a failed run clears the glow. Transient playback
uses the current at the displayed sample; reversing polarity does not reverse power.

The node picker can add a Bulb, and the Components dock can explicitly change a selected resistor's
**Load type** to Bulb while retaining its resistance and connections. Existing saved
resistor stand-ins are not silently converted. Run persists the bulb kind, rating, and
result; public shares preserve the lamp display without allowing edits.

## Flow Visualization

Matching terminal node names establish connectivity. A shared ground does not by itself
parallel two source outputs. In the schematic, bridges indicate unconnected crossings;
only junction dots indicate terminals on that rail. A successful numerical solution is
not a check that a topology matches an intended experiment, that a diode is a suitable
freewheeling path, or that real hardware is safe. Incompatible ideal voltage sources
directly across the same two nodes are rejected by the solver; the regression suite
checks both that case and independently loaded AC/DC sources sharing ground.

Electron flow is the default; conventional current reverses marker direction. Signed
ngspice branch currents drive component leads, and their current balance drives each
node-rail segment. Markers stay outside component symbols, including capacitor plates.
Marker speed is illustrative, not physical electron drift or a calibrated speed scale.
Currents at or below 1 nA are not animated, including the open-switch leakage model.

Playback supports pause, restart, speed selection, and transient time scrubbing/looping.
A complete transient plays over eight seconds at 1x; the displayed timestamp and selected
branch reading use the nearest saved solver sample. Reduced-motion preferences disable
automatic playback. Editing, running, or a failed run hides flow until the displayed
circuit has a valid solution. Older saved results without all branch-current traces keep
their readings and plots but require an authenticated rerun before flow is available.

## Installation

The [backend Dockerfile](../../../Dockerfile) installs ngspice. For local Windows
development, install a native ngspice distribution and ensure `ngspice.exe` is on
the `PATH` inherited by the backend process. It is a separate native program, not
a dependency installed by `pip install -r requirements.txt`. A pre-existing
workstation-specific Conda environment is not required.

From the backend service directory, after the Python
[setup](../../../README.md#local-setup-powershell) and
[offline test environment](../../../tests/README.md#offline-test-environment):

```powershell
Get-Command ngspice
ngspice --version
.\.venv\Scripts\python.exe -m pytest tests\test_circuit_simulation.py tests\test_tool_definitions.py -q
```

If using Conda to provide ngspice, review its transaction before accepting unrelated
dependency updates. A terminal or backend process started before installation may
need restarting to inherit the executable path.

Use synthetic CI settings from the linked test guide, disable dotenv loading,
and mock external networking/MSAL when validating router imports locally; real learner
data and Azure credentials are not test inputs. The regressions cover circuit schema
validation, tool/HTTP behavior, numerical device models, explicit upgrade preservation,
and rejection of retired trainer inputs/routes. Solver tests skip explicitly when
ngspice is unavailable. A missing engine,
timeout or failed solve never substitutes made-up readings.

## Agent Enablement

New TAs receive the schema through `AgentToolBuilder`. Existing agent definitions do
not automatically change when the application is deployed. The course owner or an
administrator can open Course Info, choose **Enable tool**, and confirm. The authenticated
endpoint checks the expected agent version, preserves its current model, instructions,
metadata, description, other settings and tools, and adds only `add_circuit`.
`GET /api/agents/{agent_name}/circuit/tool` reports `enabled`, `update_available`
(false by default), `engine_available`, and `agent_version`. An update is available
when the installed function parameters or description differ from the current definition.
An enabled older definition remains usable for valid circuit requests but needs an explicit
owner-authorized **Update simulation tool** action to use the current circuit-only schema.
The same `POST` with `expected_version` replaces that function in its existing position;
it does not reorder or replace other tools. An already-current schema is idempotent,
even if the caller's version is old; a stale version that would require a mutation
returns 409. It uses the existing Blob lease and no automatic retry for the
version creation; after an uncertain response, recheck status before retrying.

Deploying code or reading tool status never changes an existing agent definition.
The explicit schema upgrade also advertises the current industrial kinds and instruments. Editor conversion and
manual bulb creation use the simulation endpoint after the updated backend is deployed.

## Execution Bounds

Netlists use internal element/node identifiers derived from a strict component schema;
user titles and labels never become SPICE statements. The process runs without a shell,
startup files, credentials, or inherited environment data, in a temporary directory.
There are two concurrent slots per backend process and an eight-second wall timeout.
Linux `prlimit`, when available, also caps address space at 512 MiB, CPU at eight seconds,
and output files at 8 MiB. Windows uses the wall-time/concurrency/input bounds and
post-run output-size check. Results reject missing, nonfinite, duplicated, or incomplete
signals and retain at most 1,001 samples per trace. This is bounded execution, not a
general-purpose sandbox for arbitrary SPICE scripts.

Industrial results permit at most 256 signals, with a 64,000-value plot-sample budget.
Full-resolution meter calculations happen before chart downsampling. Oversized or
non-convergent runs fail explicitly; there is no estimated-results fallback.

## Virtual Instruments

- Voltmeter: any two active nodes, with DC mean, AC RMS excluding DC, or total RMS.
  Its configurable 1 kohm-1 Tohm input resistance (default 10 Mohm) loads the circuit.
- Ammeter: insert the explicit zero-volt, zero-burden device in series using **Series**.
  Clamp meters are non-contact and sum up to four signed component-terminal currents.
  Positive terminal current enters the device; direction can be reversed per conductor.
- Watt/energy/PF: integrate aligned voltage and current over the selected simulation
  interval. Real power is mean instantaneous power; apparent power is total RMS V times
  total RMS I. True PF includes distortion, is signed, and is unavailable at zero load.
  Energy is net kWh for that run/window, not browser playback time or a lifetime counter.
- Frequency: requires three stable rising crossings, period consistency within 2%,
  and at least 16 solver samples per period. DC/irregular/undersampled signals report
  unavailable. The two-channel scope displays differential waveforms, RMS/DC values,
  peak-to-peak ripple, and rising-edge phase when the frequencies agree.
- RPM comes from the shaft state. The meter also reports synchronous speed and slip
  when stable measured phase voltages establish frequency and sequence. No speed is
  inferred from the RUN lamp or animation.
- Lux requires nonzero explicit luminous efficacy on a bulb/indicator lamp. It uses
  electrical power, an isotropic point-source inverse-square model, incidence cosine,
  distance, and ambient lux. It does not infer lumens from visual glow or model optics.

Instrument settings and numerical results persist with the circuit. Electrical edits
hide meter readings until Run succeeds. Public shares expose saved measurements only.

## Industrial Models

The Components palette includes wires, NO/NC buttons, emergency stop, coils, linked
auxiliary contacts, three-pole contactors, mechanical interlocks, on/off-delay relays,
selectors, pilot lamps, three-phase sources, single/three-phase transformers, bridge
rectifiers, six-lead induction motors, fuse/MCB/RCCB/overload devices, VFD, PLC,
limit/proximity switches, analog inputs and HMI voltage displays. The terminal contract
is explicit; multi-terminal devices are never silently reduced to two-terminal parts.

Simulation includes a bounded event timeline, conductor-role labels, and removable
faults: open wire/neutral/winding, loose neutral, resistive contact, stuck contact,
weak capacitance, missing/reversed phase, load imbalance, insulation/body leakage,
earth fault, intermittent contact, bearing load, overload and locked rotor. Start/end
intervals allow intermittent overload and repair experiments. Unsupported event/device
or fault/device combinations are rejected rather than silently ignored.

**Simulation > Experiment** supplies editable DOL, reversing, star-delta, PLC sequencing,
unbalanced-neutral, star-delta transformer, bridge/capacitor, VFD and lighting examples.
Replacing a draft requires confirmation. The regression suite solves these exact
frontend-generated topologies, not a separate set of backend-only approximations.

Model fidelity is deliberately explicit:

- Three-phase supply: specified line RMS voltage (1-1000 V), per-phase magnitude,
  frequency and sequence. Transformers use coupled inductors and winding resistance;
  star/delta winding connections determine phase shift and neutral displacement.
- Induction machine: linear stationary-frame stator/rotor flux equations integrated
  by ngspice, with torque, mechanical inertia, load/friction, winding capacitance and a
  lumped thermal state. No saturation, core loss or manufacturer calibration. Reference:
  [Aalto Electric Drives machine models](https://aalto-electric-drives.github.io/motulator/model/drive/induction_machine.html).
  Tests independently compare steady-state current with the classical equivalent circuit.
- Protection: accumulated I-squared-t fuse; first-order thermal state and configurable
  magnetic threshold for MCB; thermal overload; residual-current threshold/delay for RCCB.
  A trip latches. Reset is device-specific and thermal reset requires cooling; a fuse
  cannot be reset. These are educational curves, not IEC/device certification curves.
- VFD: lossless averaged DC-fed V/f output, ramp and phase reversal. Input power follows
  delivered output power. Fault code 1 means undervoltage, 2 latched overcurrent. No PWM,
  switching losses, vendor control firmware, or protection certification is implied.
- PLC: sampled input image, ordered bounded AND/OR/SET/RESET/TON/CTU rungs and output image.
  Outputs update halfway through each scan; input sampling uses a finite aperture.
  Outputs are 24 V with 1 ohm source impedance. This is not a safety PLC or full IEC 61131 runtime.

All models are simulation-only. Convergence, a displayed measurement, a virtual emergency
stop, or a completed repair exercise never certifies real equipment or safe isolation.

Engine tests verify a 10 V equal-resistor divider (5 V output, -5 mA source current)
and a 5 V, 1 kohm, 1 uF RC step (about 3.16 V after 1 ms), plus signed parallel-branch,
switch, capacitor, inductor, diode, and bulb currents. Bulb cases cover zero, reduced,
rated, and reversed voltage and validate rated-voltage bounds. No cloud calls are needed.