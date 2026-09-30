import { useState, type ReactNode } from "react";
import { Gauge, Plus, Trash2 } from "lucide-react";
import { CIRCUIT_INSTRUMENTS, circuitNumber, componentNodes, type CircuitInstrument, type CircuitResult, type CircuitSpec } from "@/lib/circuit";

const FIELD = "h-8 min-w-0 w-full rounded-md border border-neutral-600 bg-neutral-950 px-2 text-xs text-neutral-100 disabled:opacity-60";
const ICON = "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-neutral-300 hover:bg-neutral-700 disabled:opacity-40";

export default function CircuitInstruments({ circuit, result, selectedPart, change, locked, readOnly, stale, renderScope }: {
  circuit: CircuitSpec; result: CircuitResult | null; selectedPart: string; change: (circuit: CircuitSpec) => void;
  locked: boolean; readOnly: boolean; stale: boolean; renderScope: (channels: CircuitResult["traces"]) => ReactNode;
}) {
  const [selected, setSelected] = useState("");
  const [kind, setKind] = useState<CircuitInstrument["kind"]>("voltmeter");
  const instruments = circuit.instruments ?? [];
  const meter = instruments.find(item => item.id === selected) ?? instruments[0];
  const reading = stale ? undefined : result?.measurements?.find(item => item.instrument_id === meter?.id);
  const active = circuit.components.filter(part => part.connected !== false);
  const nodes = [...new Set(["0", ...active.flatMap(componentNodes)])];
  const patch = (next: Partial<CircuitInstrument>) => change({ ...circuit, instruments: instruments.map(item => item.id === meter.id ? { ...item, ...next } : item) });
  const voltageMeter = meter && !["clamp_meter", "rpm_meter", "lux_meter"].includes(meter.kind);
  const currentMeter = meter && ["clamp_meter", "wattmeter", "energy_meter", "pf_meter"].includes(meter.kind);
  const connections = active.flatMap(part => ["positive", "negative", ...Object.keys(part.terminals ?? {})].map(terminal => ({ component_id: part.id, terminal })));
  const nextConductor = connections.find(connection => !meter?.conductors.some(conductor => conductor.component_id === connection.component_id && (conductor.terminal ?? "positive") === connection.terminal));
  const add = () => {
    if (locked || instruments.length >= 8 || !active.length) return;
    let index = 1;
    while (instruments.some(item => item.id.toLowerCase() === `meter${index}`)) index += 1;
    const part = active.find(item => item.id === selectedPart) ?? active[0];
    const id = `Meter${index}`;
    change({ ...circuit, instruments: [...instruments, { id, kind, positive: part.positive, negative: part.negative, mode: circuit.analysis.mode === "dc" ? "dc" : "ac", conductors: [{ component_id: part.id, direction: 1 }], target: part.id }] });
    setSelected(id);
  };
  const nodeInput = (key: "positive" | "negative" | "reference_positive" | "reference_negative", label: string) => <label className="min-w-0 space-y-1 text-xs text-neutral-400">{label}<select aria-label={`Meter ${label}`} className={FIELD} value={meter[key] ?? "0"} onChange={event => patch({ [key]: event.target.value })}>{nodes.map(node => <option key={node} value={node}>{node}</option>)}</select></label>;
  return <div className="flex h-full min-h-0 flex-col gap-2" aria-label="Virtual instruments">
    <div className="flex shrink-0 items-center gap-2">
      <Gauge className="h-4 w-4 shrink-0 text-emerald-300" />
      {instruments.length > 0 && <select aria-label="Selected meter" className={FIELD} value={meter.id} onChange={event => setSelected(event.target.value)}>{instruments.map(item => <option key={item.id} value={item.id}>{item.id}: {CIRCUIT_INSTRUMENTS[item.kind]}</option>)}</select>}
      {!readOnly && <><select aria-label="New meter type" className={FIELD} value={kind} disabled={locked} onChange={event => setKind(event.target.value as CircuitInstrument["kind"])}>{Object.entries(CIRCUIT_INSTRUMENTS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button type="button" className={ICON} aria-label="Add meter" title="Add meter" disabled={locked || instruments.length >= 8} onClick={add}><Plus className="h-4 w-4" /></button>{meter && <button type="button" className={ICON} aria-label="Remove meter" title="Remove meter" disabled={locked} onClick={() => change({ ...circuit, instruments: instruments.filter(item => item.id !== meter.id) })}><Trash2 className="h-4 w-4" /></button>}</>}
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
      {meter && <>
        {!readOnly && <fieldset disabled={locked} className="grid grid-cols-2 gap-2 pb-3">
          {voltageMeter && <>{nodeInput("positive", "A+")}{nodeInput("negative", "A-")}</>}
          {meter.kind === "oscilloscope" && <>{nodeInput("reference_positive", "B+")}{nodeInput("reference_negative", "B-")}</>}
          {["voltmeter", "clamp_meter"].includes(meter.kind) && <div className="col-span-2 flex h-8 gap-1" role="group" aria-label="Meter mode">{(["dc", "ac", "ac_dc"] as const).map(mode => <button type="button" key={mode} aria-pressed={meter.mode === mode} className={`rounded-md px-3 text-xs ${meter.mode === mode ? "bg-emerald-900 text-emerald-100" : "text-neutral-400"}`} onClick={() => patch({ mode })}>{mode === "dc" ? "DC" : mode === "ac" ? "AC" : "AC+DC"}</button>)}</div>}
          {currentMeter && <div className="col-span-2 grid gap-2">{meter.conductors.map((conductor, index) => <div className="flex gap-2" key={index}><label className="min-w-0 flex-1 space-y-1 text-xs text-neutral-400">Conductor / terminal<select aria-label={`Meter conductor ${index + 1}`} className={FIELD} value={`${conductor.component_id}:${conductor.terminal ?? "positive"}`} onChange={event => { const [component_id, terminal] = event.target.value.split(":"); patch({ conductors: meter.conductors.map((item, position) => position === index ? { ...item, component_id, terminal } : item) }); }}>{connections.map(connection => <option key={`${connection.component_id}:${connection.terminal}`} value={`${connection.component_id}:${connection.terminal}`} disabled={meter.conductors.some((item, position) => position !== index && item.component_id === connection.component_id && (item.terminal ?? "positive") === connection.terminal)}>{connection.component_id} / {connection.terminal}</option>)}</select></label><label className="w-24 space-y-1 text-xs text-neutral-400">Direction<select aria-label={`Meter direction ${index + 1}`} className={FIELD} value={conductor.direction} onChange={event => patch({ conductors: meter.conductors.map((item, position) => position === index ? { ...item, direction: Number(event.target.value) as -1 | 1 } : item) })}><option value={1}>Into device</option><option value={-1}>Out of device</option></select></label>{meter.conductors.length > 1 && <button type="button" className={`${ICON} self-end`} aria-label={`Remove conductor ${index + 1}`} title="Remove conductor" onClick={() => patch({ conductors: meter.conductors.filter((_, position) => position !== index) })}><Trash2 className="h-3.5 w-3.5" /></button>}</div>)}{meter.kind === "clamp_meter" && <button type="button" className="flex h-8 items-center gap-1 text-xs text-emerald-200 disabled:opacity-40" disabled={meter.conductors.length >= 4 || !nextConductor} onClick={() => { if (nextConductor) patch({ conductors: [...meter.conductors, { ...nextConductor, direction: 1 }] }); }}><Plus className="h-3.5 w-3.5" />Conductor</button>}</div>}
          {voltageMeter && <label className="min-w-0 space-y-1 text-xs text-neutral-400">Input resistance (ohm)<input aria-label="Meter input resistance" className={FIELD} type="number" min={1000} max={1e12} step="any" value={meter.input_resistance_ohm ?? 1e7} onChange={event => patch({ input_resistance_ohm: event.target.valueAsNumber })} /></label>}
          {circuit.analysis.mode === "transient" && <label className="min-w-0 space-y-1 text-xs text-neutral-400">Window start (s)<input aria-label="Meter window start" className={FIELD} type="number" min={0} max={circuit.analysis.duration_seconds ?? 0.05} step="any" value={meter.window_start_seconds ?? 0} onChange={event => patch({ window_start_seconds: event.target.valueAsNumber })} /></label>}
          {["rpm_meter", "lux_meter"].includes(meter.kind) && <label className="col-span-2 min-w-0 space-y-1 text-xs text-neutral-400">Target<select aria-label="Meter target" className={FIELD} value={meter.target ?? ""} onChange={event => patch({ target: event.target.value })}><option value="">Select target</option>{active.map(part => <option key={part.id} value={part.id}>{part.id}</option>)}</select></label>}
          {meter.kind === "lux_meter" && <>{([ ["distance_m", "Distance (m)", 1, 0.05, 100], ["angle_degrees", "Angle (deg)", 0, 0, 90], ["ambient_lux", "Ambient (lx)", 0, 0, 100000] ] as const).map(([key, label, initial, minimum, maximum]) => <label key={key} className="min-w-0 space-y-1 text-xs text-neutral-400">{label}<input aria-label={`Meter ${label}`} className={FIELD} type="number" min={minimum} max={maximum} step="any" value={meter[key] ?? initial} onChange={event => patch({ [key]: event.target.valueAsNumber })} /></label>)}</>}
        </fieldset>}
        <section aria-label={`${meter.id} display`} className="border-t border-neutral-700 py-3" aria-live="polite">
          {!reading ? <p className="text-xs text-neutral-500">{stale ? "Run required" : "No saved measurement"}</p> : reading.status === "unavailable" ? <p role="status" className="text-xs text-amber-200">{reading.reason}</p> : <dl className="grid grid-cols-2 gap-x-3 gap-y-3">{reading.quantities.map(quantity => <div key={quantity.label} className="min-w-0"><dt className="text-[11px] text-neutral-400">{quantity.label}</dt><dd className="break-words font-mono text-base text-emerald-200">{circuitNumber(quantity.value, quantity.unit)}</dd></div>)}</dl>}
          {!!reading?.channels.length && <><div className="mt-3 flex gap-3 text-xs"><span className="text-sky-400">Channel A</span><span className="text-amber-400">Channel B</span></div><div className="flex h-48 min-w-0" aria-label="Meter oscilloscope">{renderScope(reading.channels)}</div></>}
        </section>
      </>}
      {!meter && <p className="py-2 text-xs text-neutral-500">No instruments</p>}
    </div>
  </div>;
}