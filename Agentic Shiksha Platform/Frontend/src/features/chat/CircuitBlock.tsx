import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Activity, ArrowDown, ArrowDownToLine, ArrowUp, ChartNoAxesCombined, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, Info, LayoutGrid, Loader2, Pause, Play, Plug, Plus, RefreshCw, Repeat2, RotateCcw, Settings2, SlidersHorizontal, Trash2, Unplug, X, ZoomIn, ZoomOut } from "lucide-react";
import { CIRCUIT_PARTS, bulbReading, circuitNumber, componentNodes, insertSeriesComponent, moveCircuitComponent, newCircuitComponent, parseCircuitSpec, reconcileCircuitReferences, type CircuitChatContext, type CircuitComponent, type CircuitContentBlock, type CircuitKind, type CircuitResult, type CircuitSpec } from "@/lib/circuit";
import { DEVICE_TERMINALS, INDUSTRIAL_PARTS, TERMINAL_LABELS } from "@/lib/circuitDevices";
import { CIRCUIT_EXAMPLES, circuitExample, type CircuitExample } from "@/lib/circuitExamples";
import { enableCircuitTool, getCircuitToolStatus, invalidateCourseInfoCache, simulateCircuit, type CircuitToolStatus } from "@/lib/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AssetFullscreenButton } from "@/components/assets/AssetFullscreenButton";
import { useChatStore } from "@/lib/chatStore";
import { useUserStore } from "@/lib/userStore";
import CircuitInstruments from "./CircuitInstruments";
import { CircuitDeviceInspector, CircuitTimeline } from "./CircuitDevices";
import "./CircuitBlock.css";

const COLORS = ["#38bdf8", "#fbbf24", "#34d399", "#fb7185", "#c4b5fd", "#f97316", "#e2e8f0", "#2dd4bf"];
const FIELD = "h-8 min-w-0 w-full rounded-md border border-neutral-600 bg-neutral-950 px-2 text-xs text-neutral-100 disabled:opacity-60";
const ICON = "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-neutral-300 hover:bg-neutral-700 disabled:opacity-40";
const DOCK_TAB = "min-w-0 flex-1 gap-1 rounded-none px-1 text-xs text-neutral-400 shadow-none data-[state=active]:bg-neutral-800 data-[state=active]:text-cyan-300 data-[state=active]:shadow-none";

function CircuitInfo({ notices = [] }: { notices?: string[] }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement | null>(null);
  const close = () => { setOpen(false); button.current?.focus(); };
  return <>
    <button ref={button} type="button" aria-label="About flow visualization" title="About the simulation" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(value => !value)} className={`${ICON} ml-auto`}><Info className="h-3.5 w-3.5" /></button>
    {open && <div role="dialog" aria-label="About the circuit simulation" className="absolute inset-x-3 bottom-10 z-20 max-h-[calc(100%-3rem)] overflow-y-auto rounded-lg border border-neutral-600 bg-neutral-900 p-4 text-xs text-neutral-300 shadow-xl" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}>
      <div className="mb-2 flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-white">Simulation model</h3><button autoFocus type="button" aria-label="Close simulation information" title="Close information" className={ICON} onClick={close}><X className="h-4 w-4" /></button></div>
      <p>Readings come from ngspice. Moving markers are illustrative, not physical electron drift. Electrons move opposite to conventional current; currents below 1 nA are not animated.</p>
      <p className="mt-2">Positive branch current runs from the component's positive terminal to its negative terminal. A negative source current means the source is supplying the circuit.</p>
      <p className="mt-2">Bulbs use fixed resistance and power-based glow. Switches are fixed-state SPST devices. Numerical convergence does not certify real hardware or protection settings.</p>
      {notices.map(notice => <p key={notice} className="mt-2">{notice}</p>)}
    </div>}
  </>;
}

function PartSymbol({ part, current }: { part: CircuitComponent; current?: number }) {
  switch (part.kind) {
    case "resistor": return <path d="M-28 0 H-24 L-20 -9 L-12 9 L-4 -9 L4 9 L12 -9 L20 9 L24 0 H28" />;
    case "indicator_lamp":
    case "bulb": {
      const reading = bulbReading(part, current);
      const brightness = reading?.brightness ?? 0;
      return <g data-testid="circuit-bulb" data-component-id={part.id} data-brightness={brightness} data-power-watts={reading?.power} data-state={!reading ? "unknown" : reading.overrated ? "overrated" : brightness < 0.001 ? "off" : "lit"}>
        <title>{reading ? `${part.id}: ${circuitNumber(reading.power, "W")} / ${circuitNumber(reading.ratedPower, "W")} rated. Illustrative glow; fixed-resistance bulb, no thermal or burnout model.` : `${part.id}: bulb result unavailable`}</title>
        <circle r="22" stroke="none" fill="#fbbf24" fillOpacity={brightness * 0.2} />
        <circle r="18" fill="#fbbf24" fillOpacity={brightness * 0.65} stroke={reading?.overrated ? "#fb7185" : brightness >= 0.001 ? "#fbbf24" : "currentColor"} />
        <path d="M-28 0 H-18 M18 0 H28 M-12 -12 L12 12 M-12 12 L12 -12" fill="none" />
      </g>;
    }
    case "capacitor": return <path d="M-28 0 H-5 M-5 -16 V16 M5 -16 V16 M5 0 H28" />;
    case "inductor": return <path d="M-28 0 H-24 C-24 -16 -12 -16 -12 0 C-12 -16 0 -16 0 0 C0 -16 12 -16 12 0 C12 -16 24 -16 24 0 H28" />;
    case "diode": return <><path d="M-28 0 H-12 M-12 -13 L10 0 L-12 13 Z M10 -14 V14 M10 0 H28" /><text x="16" y="-16" fill="currentColor" stroke="none" fontSize="9">K</text></>;
    case "switch": return <><path d={`M-28 0 H-14 M14 0 H28 M-12 0 L12 ${part.closed ? 0 : -18}`} /><circle cx="-13" cy="0" r="2" /><circle cx="13" cy="0" r="2" /></>;
    case "voltage_source": return <><path d="M-28 0 H-18 M18 0 H28" /><circle r="18" />{part.waveform === "sine" ? <path d="M-12 0 Q-6 -18 0 0 Q6 18 12 0" /> : <><path d="M-12 0 H-4 M-8 -4 V4 M4 0 H12" /></>}</>;
    case "wire": return <path d="M-28 0 H28" />;
    case "ammeter": return <><path d="M-28 0 H-18 M18 0 H28" /><circle r="18" /><text textAnchor="middle" y="5" fill="currentColor" stroke="none" fontSize="14">A</text></>;
    case "pushbutton_no": case "pushbutton_nc": case "emergency_stop": case "contact_no": case "contact_nc": case "limit_switch": case "proximity_switch": return <><path d="M-28 0 H-8 M8 0 H28 M-8 -12 V12 M8 -12 V12" />{["pushbutton_nc", "emergency_stop", "contact_nc"].includes(part.kind) && <path d="M-13 16 L13 -16" />}{part.kind.startsWith("pushbutton") && <path d="M-12 -20 H12 M0 -20 V-14" />}</>;
    case "contactor_coil": case "timer_relay": return <><path d="M-28 0 H-18 M18 0 H28" /><rect x="-18" y="-15" width="36" height="30" /><text textAnchor="middle" y="5" fill="currentColor" stroke="none" fontSize="11">{part.kind === "timer_relay" ? "T" : "KM"}</text></>;
    case "fuse": case "mcb": return <><path d="M-28 0 H28" /><rect x="-18" y="-9" width="36" height="18" /></>;
    case "analog_input": case "hmi": return <><path d="M-28 0 H-18 M18 0 H28" /><rect x="-18" y="-16" width="36" height="32" /><text textAnchor="middle" y="4" fill="currentColor" stroke="none" fontSize="10">{part.kind === "hmi" ? "HMI" : "AI"}</text></>;
    case "three_phase_source": case "transformer": case "three_phase_transformer": case "bridge_rectifier": case "induction_motor": case "rccb": case "overload_relay": case "vfd": case "plc": case "selector_switch": case "contactor": return null;
  }
}

const FLOW_SPACING = 28;
const FLOW_THRESHOLD = 1e-9;
const CROSSING_RADIUS = 8;

function flowCurrents(circuit: CircuitSpec, result: CircuitResult, sample: number): Record<string, number> | null {
  const currents: Record<string, number> = {};
  for (const part of circuit.components) {
    if (part.connected === false) { currents[`part:${part.id}`] = 0; continue; }
    const trace = result.traces.find(candidate => candidate.unit === "A" && candidate.name === part.id);
    if (!trace) return null;
    currents[`part:${part.id}`] = trace.values[sample];
  }
  const nodes = new Set(circuit.components.flatMap(componentNodes));
  for (const node of nodes) {
    let total = 0;
    circuit.components.forEach((part, position) => {
      if (part.connected === false) return;
      for (const [terminal, connectedNode] of Object.entries({ positive: part.positive, negative: part.negative, ...part.terminals })) {
        if (connectedNode !== node) continue;
        const trace = terminal === "positive" ? currents[`part:${part.id}`] : result.traces.find(candidate => candidate.unit === "A" && candidate.name === `${part.id}_${terminal}`)?.values[sample];
        total -= trace ?? (terminal === "negative" ? -currents[`part:${part.id}`] : 0);
        currents[`terminal:${part.id}:${terminal}`] = trace ?? (terminal === "negative" ? -currents[`part:${part.id}`] : 0);
      }
      currents[`rail:${node}:${position}`] = total;
    });
  }
  return currents;
}

function flowSample(result: CircuitResult, time: number): number {
  if (result.mode === "dc") return 0;
  const next = result.time_seconds.findIndex(value => value >= time);
  if (next < 0) return result.time_seconds.length - 1;
  return next > 0 && time - result.time_seconds[next - 1] < result.time_seconds[next] - time ? next - 1 : next;
}

function FlowMarkers({ identity, start, end, current, offset, electrons, gap, bridges = [] }: {
  identity: string; start: [number, number]; end: [number, number]; current: number;
  offset: number; electrons: boolean; gap?: number; bridges?: number[];
}) {
  if (Math.abs(current) <= FLOW_THRESHOLD) return null;
  const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
  if (!length) return null;
  return <g aria-hidden="true" pointerEvents="none" data-wire-id={identity} data-current-amperes={current} data-flow-direction={Math.sign(current) * (electrons ? -1 : 1)} fill={electrons ? "#fbbf24" : "#38bdf8"}>
    {Array.from({ length: Math.ceil(length / FLOW_SPACING) }, (_, position) => {
      const distance = position * FLOW_SPACING + offset;
      if (distance >= length || (gap !== undefined && Math.abs(distance - gap) < 29)) return null;
      const bridge = bridges.find(center => Math.abs(distance - center) < CROSSING_RADIUS);
      const rise = bridge === undefined ? 0 : Math.sqrt(CROSSING_RADIUS ** 2 - (distance - bridge) ** 2);
      return <circle key={position} cx={start[0] + (end[0] - start[0]) * distance / length} cy={start[1] + (end[1] - start[1]) * distance / length - rise} r="3" />;
    })}
  </g>;
}

type CanvasEditor = { selectedNodes: string[]; selectNode: (node: string) => void; clearNodes: () => void; groundNode: (node: string) => void; move: (id: string, row: number, position: number) => void };

function CircuitSchematic({ circuit, selected, select, disabled, currents, offsets, electrons, expanded, toggleControls, editor }: {
  circuit: CircuitSpec; selected: string; select: (id: string) => void; disabled: boolean;
  currents: Record<string, number> | null; offsets: Record<string, number>; electrons: boolean;
  expanded: boolean; toggleControls: () => void;
  editor?: CanvasEditor;
}) {
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState({ x: 0.5, y: 0.5 });
  const [preview, setPreview] = useState<{ id: string; row: number; position: number } | null>(null);
  const svg = useRef<SVGSVGElement | null>(null);
  const camera = useRef({ zoom, center });
  camera.current = { zoom, center };
  const drag = useRef<{ x: number; y: number; center: typeof center; scale: number; moved: boolean; id?: string } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const suppressedClick = useRef(false);
  const parts = preview ? moveCircuitComponent(circuit, preview.id, preview.row, preview.position).components : circuit.components;
  const nodes = ["0", ...Array.from(new Set(circuit.components.flatMap(componentNodes).map(node => node.toLowerCase()))).filter(node => node !== "0").sort()];
  const width = Math.max(560, nodes.length * 140);
  const rowHeight = circuit.components.some(part => Object.keys(part.terminals ?? {}).length) ? 200 : 90;
  const levelOf = (position: number) => (rowHeight === 90 ? 70 : 130) + position * rowHeight;
  const height = 110 + circuit.components.length * rowHeight;
  const column = (node: string) => 60 + nodes.indexOf(node.toLowerCase()) * ((width - 120) / Math.max(nodes.length - 1, 1));
  const junctionRows = Object.fromEntries(nodes.map(node => [node, parts.flatMap((part, position) => part.connected !== false && componentNodes(part).some(terminal => terminal.toLowerCase() === node) ? [position] : [])]));
  const groundNodes = new Set(["0", ...(circuit.grounds || [])]);
  const zoomAt = (next: number, clientX: number, clientY: number) => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    const current = camera.current;
    const nextZoom = Math.min(6, Math.max(1, next));
    const horizontal = (point.x / width - current.center.x) * current.zoom + 0.5;
    const vertical = (point.y / height - current.center.y) * current.zoom + 0.5;
    const nextCenter = {
      x: Math.min(1 - 0.5 / nextZoom, Math.max(0.5 / nextZoom, point.x / width + (0.5 - horizontal) / nextZoom)),
      y: Math.min(1 - 0.5 / nextZoom, Math.max(0.5 / nextZoom, point.y / height + (0.5 - vertical) / nextZoom)),
    };
    camera.current = { zoom: nextZoom, center: nextCenter };
    setZoom(nextZoom);
    setCenter(nextCenter);
  };
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const current = camera.current;
      if (event.ctrlKey || event.metaKey || event.deltaMode !== 0) {
        zoomAt(current.zoom * Math.exp(-event.deltaY * (event.deltaMode ? 0.12 : 0.008)), event.clientX, event.clientY);
      } else {
        const scale = element.getScreenCTM()?.a || 1;
        const next = {
          x: Math.min(1 - 0.5 / current.zoom, Math.max(0.5 / current.zoom, current.center.x + event.deltaX / scale / width)),
          y: Math.min(1 - 0.5 / current.zoom, Math.max(0.5 / current.zoom, current.center.y + event.deltaY / scale / height)),
        };
        camera.current = { ...current, center: next };
        setCenter(next);
      }
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [width, height]);
  const focus = (nextZoom: number) => {
    const position = Math.max(0, circuit.components.findIndex(part => part.id === selected));
    setZoom(nextZoom);
    setCenter(nextZoom === 1 ? { x: 0.5, y: 0.5 } : {
      x: 0.5,
      y: Math.min(1 - 0.5 / nextZoom, Math.max(0.5 / nextZoom, levelOf(position) / height)),
    });
  };
  return <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-testid="circuit-schematic">
    <div className="circuit-canvas relative min-h-0 flex-1 overflow-hidden">
    <svg ref={svg} width="100%" height="100%" data-scene-width={width} data-scene-height={height} data-zoom={zoom} viewBox={`${center.x * width - width / zoom / 2} ${center.y * height - height / zoom / 2} ${width / zoom} ${height / zoom}`} role="group" aria-label={`${circuit.title} schematic`} className={`absolute inset-0 block touch-none text-neutral-300 ${zoom > 1 ? "cursor-grab active:cursor-grabbing" : ""}`}
      onPointerDown={event => {
        if (event.button !== 0) return;
        if (pointers.current.size === 0) suppressedClick.current = false;
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointers.current.size === 2) {
          const [first, second] = [...pointers.current.values()];
          pinch.current = { distance: Math.hypot(second.x - first.x, second.y - first.y), zoom };
          drag.current = null;
          setPreview(null);
          suppressedClick.current = true;
          return;
        }
        const id = editor && !disabled ? (event.target as Element).closest("[data-drag-component]")?.getAttribute("data-drag-component") : undefined;
        if (!id && zoom <= 1) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        drag.current = { x: event.clientX, y: event.clientY, center, scale: Math.min(bounds.width / (width / zoom), bounds.height / (height / zoom)), moved: false, id: id || undefined };
      }}
      onPointerMove={event => {
        if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointers.current.size === 2 && pinch.current) {
          const [first, second] = [...pointers.current.values()];
          zoomAt(pinch.current.zoom * Math.hypot(second.x - first.x, second.y - first.y) / Math.max(1, pinch.current.distance), (first.x + second.x) / 2, (first.y + second.y) / 2);
          return;
        }
        const start = drag.current;
        if (!start || !(event.buttons & 1)) return;
        const horizontal = event.clientX - start.x;
        const vertical = event.clientY - start.y;
        start.moved = start.moved || Math.hypot(horizontal, vertical) > 4;
        if (!start.moved) return;
        suppressedClick.current = true;
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
        if (start.id && editor) {
          const matrix = event.currentTarget.getScreenCTM();
          const part = circuit.components.find(component => component.id === start.id);
          if (!matrix || !part) return;
          const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
          setPreview({ id: part.id, row: Math.max(0, Math.min(parts.length - 1, Math.round((point.y - levelOf(0)) / rowHeight))), position: Math.max(0, Math.min(1, (point.x - column(part.positive)) / (column(part.negative) - column(part.positive)))) });
          return;
        }
        setCenter({
          x: Math.min(1 - 0.5 / zoom, Math.max(0.5 / zoom, start.center.x - horizontal / start.scale / width)),
          y: Math.min(1 - 0.5 / zoom, Math.max(0.5 / zoom, start.center.y - vertical / start.scale / height)),
        });
      }}
      onPointerUp={event => {
        pointers.current.delete(event.pointerId); pinch.current = null;
        if (preview && editor) editor.move(preview.id, preview.row, preview.position);
        setPreview(null); drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { drag.current = null; pinch.current = null; pointers.current.clear(); setPreview(null); }}
      onClickCapture={event => { if (suppressedClick.current) { event.stopPropagation(); event.preventDefault(); suppressedClick.current = false; } }}>
      {nodes.map(node => {
        const junctions = junctionRows[node];
        return <g key={node}>
          <g role={editor ? "button" : undefined} tabIndex={editor ? 0 : undefined} aria-label={`Select node ${node}`} aria-pressed={editor?.selectedNodes.includes(node)} className={editor ? "cursor-pointer" : ""} onClick={event => { event.stopPropagation(); if (!disabled) editor?.selectNode(node); }} onKeyDown={event => { if (!disabled && ["Enter", " "].includes(event.key)) { event.preventDefault(); editor?.selectNode(node); } }}>
            <rect x={column(node) - 42} y="7" width="84" height="30" rx="4" fill={editor?.selectedNodes.includes(node) ? "#0e7490" : "#171717"} />
            <text x={column(node)} y="26" textAnchor="middle" fill={editor?.selectedNodes.includes(node) ? "#ffffff" : "#a3a3a3"} fontSize="12">{node === "0" ? "0 (GND)" : node}</text>{circuit.node_roles?.[node] && <text x={column(node)} y="46" textAnchor="middle" fill={circuit.node_roles[node] === "PE" ? "#34d399" : "#fbbf24"} fontSize="10">{circuit.node_roles[node]}</text>}
          </g>
          {groundNodes.has(node) && <g data-ground-node={node} transform={`translate(${column(node)},${junctions.length ? levelOf(junctions.at(-1)!) + 24 : 50})`} stroke="#a3a3a3" strokeWidth="2" fill="none"><title>{`${node}: 0 V ground reference`}</title><path d="M0 -24 V0 M-14 0 H14 M-9 5 H9 M-4 10 H4" /></g>}
          {junctions.slice(0, -1).map((position, index) => {
            const start: [number, number] = [column(node), levelOf(position)];
            const end: [number, number] = [column(node), levelOf(junctions[index + 1])];
            const identity = `rail:${node}:${position}`;
            return <g key={identity}><path d={`M${start[0]} ${start[1]} V${end[1]}`} stroke="#737373" strokeWidth="2" />{currents && !preview && <FlowMarkers identity={identity} start={start} end={end} current={currents[identity] || 0} offset={offsets[identity] || 0} electrons={electrons} />}</g>;
          })}
        </g>;
      })}
      {parts.map((part, position) => {
        const positive = column(part.positive);
        const negative = column(part.negative);
        const crossings = part.connected === false ? [] : nodes.filter(node => {
          const horizontal = column(node);
          const rows = junctionRows[node];
          return horizontal > Math.min(positive, negative) && horizontal < Math.max(positive, negative)
            && rows[0] < position && rows.at(-1)! > position;
        });
        const center = Math.max(Math.min(positive, negative) + 42, Math.min(Math.max(positive, negative) - 42, positive + (negative - positive) * (part.position ?? 0.5)));
        const boundaries = [Math.min(positive, negative), ...crossings.map(column), Math.max(positive, negative)];
        const middle = crossings.some(node => Math.abs(column(node) - center) < 40)
          ? boundaries.slice(0, -1).map((edge, index) => (edge + boundaries[index + 1]) / 2).sort((left, right) => Math.abs(left - center) - Math.abs(right - center))[0]
          : center;
        const level = levelOf(position);
        const direction = positive < negative ? 1 : -1;
        const color = selected === part.id ? "#38bdf8" : "#a3a3a3";
        const ports = Object.entries({ positive: part.positive, negative: part.negative, ...part.terminals });
        if (part.terminals && Object.keys(part.terminals).length) {
          const blockX = width / 2;
          return <g key={part.id} role="button" tabIndex={disabled ? -1 : 0} aria-label={`Select ${part.id}`} aria-pressed={selected === part.id} data-component-id={part.id} data-connected={part.connected !== false} onClick={() => { if (!disabled) select(part.id); }} onKeyDown={event => { if (!disabled && ["Enter", " "].includes(event.key)) { event.preventDefault(); select(part.id); } }}>
            {ports.map(([terminal, node], portIndex) => {
              const left = portIndex % 2 === 0;
              const pinY = level - 48 + Math.floor(portIndex / 2) * 24;
              const pinX = blockX + (left ? -90 : 90);
              const railX = column(node);
              const label = terminal === "positive" ? TERMINAL_LABELS[part.kind]?.[0] ?? "+" : terminal === "negative" ? TERMINAL_LABELS[part.kind]?.[1] ?? "-" : terminal;
              return <g key={terminal} data-device-terminal={terminal}>{part.connected !== false && <><path d={`M${railX} ${level} V${pinY} H${pinX}`} stroke="#101010" strokeWidth="6" fill="none" /><path d={`M${railX} ${level} V${pinY} H${pinX}`} stroke={color} strokeWidth="2" fill="none" /><circle data-junction-node={node} cx={railX} cy={level} r="4" fill="#34d399" onClick={event => { event.stopPropagation(); editor?.selectNode(node); }} /></>}<text x={pinX + (left ? -5 : 5)} y={pinY - 4} textAnchor={left ? "end" : "start"} fill="#a3a3a3" fontSize="10">{label}: {node}</text></g>;
            })}
            <g data-component-symbol={part.id} data-drag-component={part.id} className={editor ? "cursor-move" : ""}><rect x={blockX - 85} y={level - 70} width="170" height="145" rx="4" stroke={color} strokeWidth="2" fill="#171717" fillOpacity="0.96" /><text x={blockX} y={level - 48} textAnchor="middle" fill="#f5f5f5" fontSize="14">{part.id}</text><text x={blockX} y={level - 27} textAnchor="middle" fill="#a3a3a3" fontSize="10">{CIRCUIT_PARTS[part.kind].label}</text>{part.kind === "induction_motor" ? <><circle cx={blockX} cy={level + 12} r="25" stroke={color} fill="none" strokeWidth="2" /><text x={blockX} y={level + 18} textAnchor="middle" fill="#34d399" fontSize="17">M</text></> : <text x={blockX} y={level + 20} textAnchor="middle" fill="#fbbf24" fontSize="18">{part.kind === "three_phase_source" ? "3~" : part.kind.includes("transformer") ? "||" : part.kind === "bridge_rectifier" ? "AC / DC" : part.kind === "plc" ? "PLC" : part.kind === "vfd" ? "V/f" : part.kind === "rccb" ? "I residual" : part.kind === "selector_switch" ? "SPDT" : "3 poles"}</text>}<text x={blockX} y={level + 60} textAnchor="middle" fill="#737373" fontSize="10">{part.connected === false ? "Disconnected" : part.link ?? ""}</text></g>
          </g>;
        }
        return <g key={part.id} role="button" tabIndex={disabled ? -1 : 0} aria-label={`Select ${part.id}`} aria-pressed={selected === part.id}
          data-component-id={part.id} data-connected={part.connected !== false}
          onClick={() => { if (!disabled) select(part.id); }} onKeyDown={event => {
            if (disabled) return;
            if (event.altKey && editor && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
              event.preventDefault(); editor.move(part.id, position + (event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0), (part.position ?? 0.5) + (event.key === "ArrowRight" ? 0.1 : event.key === "ArrowLeft" ? -0.1 : 0));
            } else if (["Enter", " "].includes(event.key)) { event.preventDefault(); select(part.id); }
          }}
          className={disabled ? "" : "cursor-pointer outline-none focus:opacity-70"}>
          <rect x="12" y={level - 32} width={width - 24} height="73" rx="4" fill={selected === part.id ? "#38bdf810" : "transparent"} />
          {part.connected !== false && <path d={`M${positive} ${level} H${middle - direction * 28} M${middle + direction * 28} ${level} H${negative}`} stroke={color} strokeWidth="2" />}
          {crossings.map(node => {
            const horizontal = column(node);
            const bridge = `M${horizontal - CROSSING_RADIUS} ${level} A${CROSSING_RADIUS} ${CROSSING_RADIUS} 0 0 1 ${horizontal + CROSSING_RADIUS} ${level}`;
            return <g key={node} data-crossing-component={part.id} data-crossing-node={node}>
              <title>{`No connection: ${part.id} crosses ${node}`}</title>
              <path d={`M${horizontal - CROSSING_RADIUS} ${level} H${horizontal + CROSSING_RADIUS}`} stroke="#101010" strokeWidth="7" />
              <path d={bridge} fill="none" stroke="#101010" strokeWidth="6" />
              <path d={bridge} fill="none" stroke={color} strokeWidth="2" />
            </g>;
          })}
          <g data-component-symbol={part.id} data-drag-component={part.id} className={editor ? "cursor-move" : ""} transform={`translate(${middle},${level}) scale(${direction},1)`} fill="none" stroke={selected === part.id ? "#38bdf8" : "#e5e5e5"} strokeWidth="2"><title>{editor ? `${part.id}: drag to reposition; Alt + arrows to move` : part.id}</title><rect x="-29" y="-20" width="58" height="40" fill="transparent" stroke="none" /><PartSymbol part={part} current={currents?.[`part:${part.id}`]} /></g>
          {part.connected !== false && [part.positive, part.negative].map(node => <circle key={node} data-junction-node={node.toLowerCase()} cx={column(node)} cy={level} r={editor?.selectedNodes.includes(node) ? "7" : "4"} fill={editor?.selectedNodes.includes(node) ? "#38bdf8" : "#34d399"} className={editor ? "cursor-crosshair" : ""} onClick={event => { event.stopPropagation(); if (!disabled) editor?.selectNode(node.toLowerCase()); }}><title>{node}</title></circle>)}
          {currents && !preview && part.connected !== false && <FlowMarkers identity={`part:${part.id}`} start={[positive, level]} end={[negative, level]} current={currents[`part:${part.id}`] || 0} offset={offsets[`part:${part.id}`] || 0} electrons={electrons} gap={Math.abs(middle - positive)} bridges={crossings.map(node => Math.abs(column(node) - positive))} />}
          <text x={middle} y={level - 23} textAnchor="middle" fill="#f5f5f5" fontSize="12">{part.id}</text>
          <text x={middle} y={level + 33} textAnchor="middle" fill="#a3a3a3" fontSize="11">{part.connected === false ? "Disconnected" : part.kind === "switch" ? (part.closed ? "Closed" : "Open") : part.kind === "diode" ? "Silicon" : circuitNumber(part.value, CIRCUIT_PARTS[part.kind].unit)}</text>
        </g>;
      })}
    </svg>
    </div>
    <div className="flex h-9 shrink-0 items-center justify-end gap-1 border-t border-neutral-800 px-2">
      <span className="mr-auto min-w-0 truncate text-[11px] text-neutral-500">{editor?.selectedNodes.length ? `Node ${editor.selectedNodes.join(" / ")}` : `${circuit.components.length} components / ${nodes.length} nodes`}</span>
      {editor && <><button type="button" className={ICON} aria-label="Clear node selection" title="Clear selection" disabled={!editor.selectedNodes.length} onClick={editor.clearNodes}><X className="h-3.5 w-3.5" /></button><button type="button" className={ICON} aria-label="Ground selected node" title="Ground selected node" disabled={editor.selectedNodes.length !== 1 || editor.selectedNodes[0] === "0"} onClick={() => editor.groundNode(editor.selectedNodes[0])}><ArrowDownToLine className="h-4 w-4" /></button></>}
      <button type="button" className={ICON} aria-label="Zoom out circuit" title="Zoom out to fit" disabled={zoom <= 1} onClick={() => focus(Math.max(1, zoom / 1.5))}><ZoomOut className="h-3.5 w-3.5" /></button>
      <button type="button" className={ICON} aria-label="Zoom in circuit" title="Zoom to selected component" disabled={zoom >= 6} onClick={() => focus(Math.min(6, zoom * 1.5))}><ZoomIn className="h-3.5 w-3.5" /></button>
      <button type="button" className={ICON} aria-label={expanded ? "Show circuit controls" : "Hide circuit controls"} title={expanded ? "Show controls" : "Hide controls"} aria-pressed={!expanded} onClick={toggleControls}>{expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button>
    </div>
  </div>;
}

function CircuitVisualization({ circuit, result, stale, selected, select, disabled, readOnly, run, toolbarTarget, runTarget, expanded, toggleControls, editor }: {
  circuit: CircuitSpec; result: CircuitResult | null; stale: boolean; selected: string;
  select: (id: string) => void; disabled: boolean;
  readOnly: boolean; run: () => Promise<boolean>; toolbarTarget: HTMLDivElement | null; runTarget: HTMLDivElement | null;
  expanded: boolean; toggleControls: () => void;
  editor?: CanvasEditor;
}) {
  const [playing, setPlaying] = useState(() => !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [electrons, setElectrons] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(true);
  const [frame, setFrame] = useState<{ time: number; offsets: Record<string, number> }>({ time: 0, offsets: {} });
  const sample = result ? flowSample(result, frame.time) : 0;
  const currents = !stale && result ? flowCurrents(circuit, result, sample) : null;
  const available = !!currents;
  const peak = result?.traces.filter(trace => trace.unit === "A").reduce((maximum, trace) => Math.max(maximum, ...trace.values.map(Math.abs)), 0) || 0;
  const start = result?.time_seconds[0] || 0;
  const end = result?.time_seconds.at(-1) || 0;
  const moving = playing && available;

  useEffect(() => {
    setFrame({ time: result?.time_seconds[0] || 0, offsets: {} });
  }, [result]);
  useEffect(() => {
    if (playing && end > start) setFrame(current => current.time >= end ? { time: start, offsets: {} } : current);
  }, [playing, start, end]);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => { if (preference.matches) setPlaying(false); };
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!moving || !result) return;
    let request = 0;
    let previous = 0;
    const advance = (now: number) => {
      if (!previous) previous = now;
      if (now - previous >= 1000 / 30) {
        const elapsed = Math.min((now - previous) / 1000, 0.1) * speed;
        previous = now;
        setFrame(current => {
          const time = end ? current.time + elapsed * (end - start) / 8 : 0;
          const nextTime = time > end && loop && end > start ? start + (time - start) % (end - start) : Math.min(time, end);
          const values = flowCurrents(circuit, result, flowSample(result, nextTime));
          const offsets = { ...current.offsets };
          for (const [identity, value] of Object.entries(values || {})) {
            const travel = Math.abs(value) <= FLOW_THRESHOLD ? 0 : Math.sign(value) * (electrons ? -1 : 1) * Math.sqrt(Math.abs(value) / Math.max(peak, FLOW_THRESHOLD)) * 60 * elapsed;
            offsets[identity] = (((offsets[identity] || 0) + travel) % FLOW_SPACING + FLOW_SPACING) % FLOW_SPACING;
          }
          return { time: nextTime, offsets };
        });
      }
      request = requestAnimationFrame(advance);
    };
    request = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(request);
  }, [moving, result, circuit, speed, electrons, peak, end, start, loop]);
  useEffect(() => {
    if (!loop && end > start && frame.time >= end) setPlaying(false);
  }, [frame.time, end, start, loop]);

  const current = currents?.[`part:${selected}`];
  const selectedPart = circuit.components.find(part => part.id === selected);
  const lamp = selectedPart ? bulbReading(selectedPart, current) : null;
  const flowStatus = stale ? "Flow paused: result is stale" : !available ? "Branch-current data unavailable" : lamp ? lamp.overrated ? "Above rating" : lamp.brightness < 0.001 ? "Off" : "Lit" : Math.abs(current || 0) <= FLOW_THRESHOLD ? "No visible flow" : moving ? "Playing" : "Paused";
  return <div className="relative flex min-h-0 min-w-0 flex-col overflow-hidden" data-testid="circuit-visualization" data-playing={moving}>
    {runTarget && createPortal(<button type="button" aria-label={disabled ? "Simulating" : moving ? "Pause" : readOnly ? "Play saved simulation" : "Run"} title={moving ? "Pause playback" : stale || !available ? "Solve the circuit and play" : "Play the solved circuit"} disabled={disabled || (readOnly && !available)} onClick={async () => {
      if (moving) { setPlaying(false); return; }
      if (stale || !available) { if (!readOnly && await run()) setPlaying(true); }
      else setPlaying(true);
    }} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white disabled:opacity-50">{disabled ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : moving ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}{disabled ? "Running" : moving ? "Pause" : readOnly ? "Play" : "Run"}</button>, runTarget)}
    {toolbarTarget && createPortal(<div role="group" aria-label="Flow playback" className="flex shrink-0 flex-wrap items-center gap-1">
      {result?.mode === "transient" && <button type="button" aria-label="Loop flow playback" title="Loop playback" aria-pressed={loop} className={`${ICON} ${loop ? "bg-neutral-700" : ""}`} onClick={() => setLoop(!loop)}><Repeat2 className="h-4 w-4" /></button>}
      <div role="group" aria-label="Flow direction" className="inline-flex h-8 shrink-0 rounded-md border border-neutral-600 p-0.5">{[true, false].map(value => <button key={String(value)} type="button" aria-label={value ? "Electron flow" : "Conventional current"} aria-pressed={electrons === value} onClick={() => setElectrons(value)} className={`rounded px-2 text-xs ${electrons === value ? "bg-neutral-700 text-white" : "text-neutral-400"}`}>{value ? "Electrons" : "Current"}</button>)}</div>
      <select aria-label="Flow playback speed" title="Playback speed" value={speed} onChange={event => setSpeed(Number(event.target.value))} className="h-8 rounded-md border border-neutral-600 bg-neutral-950 px-1 text-xs text-neutral-200"><option value={0.5}>0.5x</option><option value={1}>1x</option><option value={2}>2x</option></select>
    </div>, toolbarTarget)}
    <CircuitSchematic circuit={circuit} selected={selected} select={select} disabled={disabled} currents={currents} offsets={frame.offsets} electrons={electrons} expanded={expanded} toggleControls={toggleControls} editor={editor} />
    {result?.mode === "transient" && <div className="flex h-7 shrink-0 items-center gap-3 px-3"><input className="min-w-0 flex-1 accent-amber-400" type="range" aria-label="Playback time" min={start} max={end} step={(end - start) / 1000 || 1} value={frame.time} disabled={!available} onChange={event => { setPlaying(false); setFrame({ time: Number(event.target.value), offsets: {} }); }} /><output aria-label="Simulation playback time" className="w-24 shrink-0 text-right font-mono text-xs text-neutral-300">{circuitNumber(result.time_seconds[sample], "s")}</output></div>}
    <div className="flex h-8 min-w-0 shrink-0 items-center gap-2 px-3 text-xs text-neutral-400"><span className="max-w-24 truncate" title={selected}>{selected}</span><output aria-label={selectedPart?.kind === "bulb" ? "Bulb power" : "Selected branch current"} title={lamp ? `${circuitNumber(current!, "A")} / ${circuitNumber(lamp.ratedPower, "W")} rated. Illustrative glow; fixed-resistance model.` : undefined} className="shrink-0 font-mono text-neutral-200">{selectedPart?.kind === "bulb" ? lamp ? circuitNumber(lamp.power, "W") : "-- W" : current === undefined ? "-- A" : circuitNumber(current, "A")}</output>{!stale && result?.traces.filter(trace => trace.name === selected && trace.unit === "rpm").map(trace => <output key={trace.name} aria-label="Motor shaft speed" className="shrink-0 font-mono text-emerald-200">{circuitNumber(trace.values[sample], "rpm")}</output>)}<span className={`min-w-0 truncate ${lamp?.overrated ? "text-amber-300" : ""}`} title={flowStatus}>{flowStatus}</span><CircuitInfo notices={result?.notices} /></div>
  </div>;
}

function TracePlot({ result, unit, signal }: { result: CircuitResult; unit: CircuitResult["traces"][number]["unit"]; signal: string }) {
  const traces = result.traces.filter(trace => trace.unit === unit && (!signal || trace.name === signal));
  if (result.mode !== "transient" || !traces.length) return null;
  const samples = traces.flatMap(trace => trace.values);
  const lower = Math.min(0, ...samples);
  const upper = Math.max(0, ...samples);
  const span = upper - lower || 1;
  const end = result.time_seconds.at(-1) || 1;
  return <div className="relative min-h-0 min-w-0 flex-1">
    <svg viewBox="0 0 640 250" className="absolute inset-0 block h-full w-full" role="img" aria-label={`${unit === "V" ? "Voltage" : unit === "A" ? "Current" : unit} waveform`}>
      {Array.from({ length: 5 }, (_, position) => {
        const level = 20 + position * 46;
        return <g key={position}><path d={`M76 ${level} H620`} stroke="#404040" /><text x="68" y={level + 4} textAnchor="end" fontSize="11" fill="#a3a3a3">{circuitNumber(upper - position * span / 4, unit)}</text></g>;
      })}
      {traces.map((trace, position) => <polyline key={trace.name} fill="none" stroke={COLORS[position % COLORS.length]} strokeWidth="2" points={trace.values.map((value, index) => `${76 + result.time_seconds[index] / end * 544},${20 + (upper - value) / span * 184}`).join(" ")} />)}
      <text x="76" y="230" fontSize="11" fill="#a3a3a3">0 s</text><text x="620" y="230" textAnchor="end" fontSize="11" fill="#a3a3a3">{circuitNumber(end, "s")}</text>
    </svg>
  </div>;
}

function CircuitReadings({ result }: { result: CircuitResult }) {
  const [page, setPage] = useState(0);
  const pages = Math.ceil(result.traces.length / 4);
  const current = Math.min(page, pages - 1);
  const traces = result.traces.slice(current * 4, current * 4 + 4);
  return <div className="flex h-full min-h-0 flex-col">
    <section aria-label="Circuit readings" className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-2 pb-2">
      {traces.map(trace => <dl key={`${trace.unit}:${trace.name}`} className="flex min-w-0 flex-col justify-center rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2"><dt className="truncate text-xs text-neutral-400" title={`${trace.unit}(${trace.name})`}>{trace.unit === "V" ? `V(${trace.name})` : trace.unit === "A" ? `I(${trace.name})` : trace.name}</dt><dd className={`mt-1 truncate font-mono text-base ${trace.unit === "V" ? "text-cyan-200" : "text-amber-200"}`}>{circuitNumber(trace.values.at(-1) || 0, trace.unit)}</dd>{result.mode === "transient" && <span className="text-[10px] text-neutral-500">Final value</span>}</dl>)}
    </section>
    <div className="mt-auto flex h-9 shrink-0 items-center justify-end gap-2 border-t border-neutral-800 pt-1">
      <span className="mr-auto text-xs text-neutral-500">{current * 4 + 1}-{Math.min((current + 1) * 4, result.traces.length)} of {result.traces.length}</span>
      <button type="button" className={ICON} aria-label="Previous readings" title="Previous readings" disabled={current === 0} onClick={() => setPage(current - 1)}><ChevronLeft className="h-4 w-4" /></button>
      <button type="button" className={ICON} aria-label="Next readings" title="Next readings" disabled={current === pages - 1} onClick={() => setPage(current + 1)}><ChevronRight className="h-4 w-4" /></button>
    </div>
  </div>;
}

export function CircuitLaunchCard({ block, onOpen }: { block: CircuitContentBlock; onOpen?: (block: CircuitContentBlock) => void }) {
  const ready = !!block.circuit && !!block.result && !block.isStreaming;
  return <div className="flex min-w-0 items-center gap-4 w-full rounded-xl bg-neutral-900 border border-neutral-700/50 px-4 py-3" data-testid="circuit-launch-card">
    <div className="flex items-center gap-4 flex-1 min-w-0">
      <div className="w-12 h-12 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0">
        <Activity className="h-6 w-6 text-amber-400" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-white truncate" title={block.title || "Circuit"}>{block.title || "Circuit"}</p>
        <p className="text-xs text-neutral-500 truncate">{ready ? "Circuit simulation" : "Preparing simulation..."}</p>
      </div>
    </div>
    {ready ? <button type="button" aria-label={`Open circuit: ${block.title}`} disabled={!onOpen} onClick={event => { event.stopPropagation(); onOpen?.(block); }} className="px-8 py-2.5 rounded-lg border border-neutral-600 text-sm font-medium text-white hover:bg-neutral-700 transition-colors shrink-0 disabled:opacity-50">Open</button> : <Loader2 role="status" aria-label="Simulating circuit" className="h-4 w-4 shrink-0 animate-spin text-neutral-400" />}
  </div>;
}

export default function CircuitBlock({ block, agentId, threadId, readOnly = false, embedded = false, active = true }: { block: CircuitContentBlock; agentId?: string; threadId?: string | null; readOnly?: boolean; embedded?: boolean; active?: boolean }) {
  const [draft, setDraft] = useState<CircuitSpec | null>(block.circuit || null);
  const [result, setResult] = useState<CircuitResult | null>(block.result || null);
  const [selected, setSelected] = useState(block.circuit?.components[0]?.id || "");
  const [unit, setUnit] = useState<CircuitResult["traces"][number]["unit"]>("V");
  const [signal, setSignal] = useState("");
  const [tab, setTab] = useState(readOnly ? (block.result?.mode === "transient" ? "waveforms" : "readings") : "components");
  const [newKind, setNewKind] = useState<CircuitKind>("resistor");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(null);
  const [runTarget, setRunTarget] = useState<HTMLDivElement | null>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [selectedNodes, setSelectedNodes] = useState<string[]>([]);
  const [seriesTarget, setSeriesTarget] = useState<{ id: string; lead: "positive" | "negative" } | null>(null);
  const [groundNode, setGroundNode] = useState<string | null>(null);
  const [example, setExample] = useState<CircuitExample>("dol");
  const [confirmExample, setConfirmExample] = useState(false);
  const [deviceOptionsOpen, setDeviceOptionsOpen] = useState(false);
  const [experimentsOpen, setExperimentsOpen] = useState(false);
  const root = useRef<HTMLElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const solvedRef = useRef({ circuit: block.circuit || null, result: block.result || null });
  const userId = useUserStore(state => state.userId);

  useEffect(() => {
    solvedRef.current = { circuit: block.circuit || null, result: block.result || null };
    setDraft(block.circuit || null);
    setResult(block.result || null);
    setSelected(current => block.circuit?.components.some(part => part.id === current) ? current : block.circuit?.components[0]?.id || "");
    setDirty(false);
  }, [block.circuit, block.result]);
  useEffect(() => () => requestRef.current?.abort(), [agentId, threadId, userId]);

  useEffect(() => {
    if (!active || readOnly || !agentId || !threadId || !userId || !draft || block.isStreaming) return;
    const context: CircuitChatContext = {
      agentId, threadId, userId, circuitId: block.circuitId, circuit: draft,
      result: !dirty && !busy && !error ? result : null,
      status: busy ? "simulating" : error ? "simulation_failed" : dirty ? "modified_not_simulated" : result ? "simulated" : "not_simulated",
    };
    useChatStore.setState(state => {
      const thread = state.threads[threadId];
      if (state.activeThreadId !== threadId || !thread || thread.userId !== userId || thread.agentId !== agentId) return state;
      return { circuitChatContext: context };
    });
    return () => useChatStore.setState(state => state.circuitChatContext === context ? { circuitChatContext: null } : state);
  }, [agentId, threadId, userId, readOnly, active, block.circuitId, block.isStreaming, draft, result, dirty, busy, error]);

  if (!draft) return <div role="status" aria-label="Simulating circuit" className="flex items-center gap-2 border-y border-neutral-700 py-5 text-sm text-neutral-300"><Loader2 className="h-4 w-4 animate-spin" />Simulating circuit...</div>;
  const locked = readOnly || !agentId || busy || !!block.isStreaming;
  const part = draft.components.find(component => component.id === selected) || draft.components[0];
  const nodes = Array.from(new Set(draft.components.filter(component => component.connected !== false).flatMap(componentNodes))).filter(node => node !== "0" && !draft.grounds?.includes(node)).sort();
  const probes = draft.analysis.probes.length ? draft.analysis.probes : nodes.slice(0, 8);
  const seriesPart = draft.components.find(component => component.id === seriesTarget?.id);
  const partLimit = draft.format_version === 2 ? 48 : 24;
  const seriesCapacity = draft.components.length < partLimit && new Set(draft.components.flatMap(componentNodes)).size < (draft.format_version === 2 ? 64 : 17);
  const change = (next: CircuitSpec) => { setDraft(reconcileCircuitReferences(next)); setDirty(true); setError(null); };
  const changePart = (patch: Partial<CircuitComponent>) => change({ ...draft, components: draft.components.map(component => component.id === part.id ? { ...component, ...patch } : component) });
  const persist = (circuit: CircuitSpec, next: CircuitResult) => {
    if (!threadId) return;
    useChatStore.setState(state => {
      const thread = state.threads[threadId];
      if (!thread || thread.userId !== userId || thread.agentId !== agentId) return state;
      return { messagesByThreadId: { ...state.messagesByThreadId, [threadId]: (state.messagesByThreadId[threadId] || []).map(message => ({ ...message,
        contentBlocks: message.contentBlocks?.map(content => content.type === "circuit" && content.circuitId === block.circuitId ? { ...content, title: circuit.title, circuit, result: next, isStreaming: false } : content),
      })) } };
    });
  };
  const movePart = (id: string, row: number, position: number) => {
    if (locked) return;
    const next = moveCircuitComponent(draft, id, row, position);
    setDraft(next);
    setSelected(id);
    if (!dirty && result) { solvedRef.current = { circuit: next, result }; persist(next, result); }
  };
  const addPart = () => {
    if (locked || selectedNodes.length !== 2 || draft.components.length >= partLimit) return;
    const added = newCircuitComponent(draft, newKind, selectedNodes[0], selectedNodes[1]);
    const industrial = Object.hasOwn(INDUSTRIAL_PARTS, newKind);
    change({ ...draft, ...(industrial ? { format_version: 2 as const, analysis: { ...draft.analysis, mode: "transient" as const, duration_seconds: Math.max(draft.analysis.duration_seconds ?? 0.05, 0.1) } } : {}), components: [...draft.components, added] });
    setSelected(added.id); setSelectedNodes([]); setTab("components"); setExpanded(false);
  };
  const addSeriesPart = () => {
    if (locked || !seriesTarget) return;
    try {
      const inserted = insertSeriesComponent(draft, seriesTarget.id, seriesTarget.lead, newKind);
      change(inserted.circuit);
      setSelected(inserted.componentId);
      setSeriesTarget(null);
      setSelectedNodes([]);
      setTab("components");
      setExpanded(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The series component could not be inserted.");
    }
  };

  const run = async () => {
    if (locked || !agentId) return false;
    const circuit = parseCircuitSpec(draft);
    if (!circuit) { setError("Check the component values, node names, and selected probes."); return false; }
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    setBusy(true);
    setError(null);
    try {
      const next = await simulateCircuit(agentId, circuit, controller.signal);
      if (controller.signal.aborted || useUserStore.getState().userId !== userId) return false;
      solvedRef.current = { circuit, result: next };
      setDraft(circuit);
      setResult(next);
      setDirty(false);
      persist(circuit, next);
      return true;
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Simulation failed. Check the circuit and retry.");
      return false;
    } finally { if (requestRef.current === controller) setBusy(false); }
  };

  const download = (format: "circuit" | "results") => {
    let content: string;
    if (format === "circuit") {
      const source = root.current?.querySelector<SVGSVGElement>('svg[data-scene-width]');
      if (!source) return;
      const image = source.cloneNode(true) as SVGSVGElement;
      const width = source.dataset.sceneWidth!;
      const height = source.dataset.sceneHeight!;
      image.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      image.setAttribute("viewBox", `0 0 ${width} ${height}`);
      image.setAttribute("width", width);
      image.setAttribute("height", height);
      image.removeAttribute("class");
      image.style.color = "#d4d4d4";
      const background = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      background.setAttribute("width", width); background.setAttribute("height", height); background.setAttribute("fill", "#101010");
      image.prepend(background);
      content = new XMLSerializer().serializeToString(image);
    } else {
      if (!result || dirty || busy) return;
      const rows = [["time_s", ...result.traces.map(trace => `${trace.name}_${trace.unit}`)], ...Array.from({ length: result.traces[0].values.length }, (_, position) => [result.time_seconds[position] || 0, ...result.traces.map(trace => trace.values[position])])];
      content = rows.map(row => row.join(",")).join("\n");
    }
    const url = URL.createObjectURL(new Blob([content], { type: format === "circuit" ? "image/svg+xml" : "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = format === "circuit" ? "circuit.svg" : "results.csv";
    anchor.click();
    URL.revokeObjectURL(url);
    setDownloadOpen(false);
  };

  const plotTraces = result?.traces.filter(trace => trace.unit === unit) || [];
  const plotSignal = plotTraces.some(trace => trace.name === signal) ? signal : plotTraces[0]?.name || "";
  const status = busy ? "Simulating..." : dirty ? "Changes not simulated" : !result ? "Not simulated yet" : readOnly ? "Saved simulation" : "Simulation complete";

  return <section ref={root} aria-label={`Circuit simulator: ${block.title}`} data-fullscreen-surface={embedded ? undefined : ""} className={`circuit-workbench relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-neutral-900 text-neutral-100 ${embedded ? "h-full" : "my-3 h-[min(48rem,85dvh)] rounded-lg border border-neutral-700"}`} data-testid="circuit-block">
    <div className="relative z-10 flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-neutral-800 px-3 py-1">
      <div ref={setToolbarTarget} />
      <div aria-live="polite" className="circuit-status min-w-0 flex-1 truncate text-xs text-neutral-400" title={`${status} / ngspice / ${draft.format_version === 2 ? "Parameterized industrial models" : "Idealized low-voltage model"}`}>{status}</div>
      <div className="flex shrink-0 items-center gap-1">
        {!embedded && <AssetFullscreenButton />}
        {!readOnly && <button type="button" className={ICON} title="Reset changes" aria-label="Reset circuit changes" disabled={locked || !dirty} onClick={() => { setDraft(solvedRef.current.circuit || draft); setResult(solvedRef.current.result); setDirty(false); setError(null); }}><RotateCcw className="h-4 w-4" /></button>}
        <div className="relative"><button type="button" className={ICON} title="Download" aria-label="Download circuit" aria-haspopup="menu" aria-expanded={downloadOpen} onClick={() => setDownloadOpen(open => !open)}><Download className="h-4 w-4" /></button>{downloadOpen && <div role="menu" aria-label="Circuit downloads" className="absolute right-0 top-full z-30 mt-1 w-44 rounded-md border border-neutral-600 bg-neutral-900 p-1 shadow-xl" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDownloadOpen(false); } }}><button autoFocus type="button" role="menuitem" className="w-full rounded px-3 py-2 text-left text-xs hover:bg-neutral-800" onClick={() => download("circuit")}>Circuit (.svg)</button><button type="button" role="menuitem" disabled={!result || dirty || busy} className="w-full rounded px-3 py-2 text-left text-xs hover:bg-neutral-800 disabled:opacity-40" onClick={() => download("results")}>Results (.csv)</button></div>}</div>
        <div ref={setRunTarget} />
      </div>
    </div>
    {error && <p role="alert" className="shrink-0 border-b border-red-900/50 px-3 py-2 text-xs text-red-300">{error}</p>}
    {deviceOptionsOpen && !readOnly && <div role="dialog" aria-label="Device model parameters" className="absolute inset-x-3 top-16 z-30 mx-auto max-h-[calc(100%-5rem)] max-w-lg overflow-y-auto rounded-lg border border-neutral-600 bg-neutral-900 p-4 shadow-xl" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setDeviceOptionsOpen(false); } }}><div className="mb-3 flex items-center justify-between"><h3 className="text-sm">{part.id}</h3><button autoFocus type="button" className={ICON} aria-label="Close device parameters" title="Close" onClick={() => setDeviceOptionsOpen(false)}><X className="h-4 w-4" /></button></div><CircuitDeviceInspector circuit={draft} part={part} patch={changePart} locked={locked} /></div>}
    {experimentsOpen && !readOnly && <div role="dialog" aria-label="Industrial experiments" className="absolute inset-x-3 top-16 z-30 mx-auto max-w-sm rounded-lg border border-neutral-600 bg-neutral-900 p-4 shadow-xl" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setExperimentsOpen(false); } }}><div className="mb-3 flex items-center justify-between"><h3 className="text-sm">Industrial experiments</h3><button autoFocus type="button" className={ICON} aria-label="Close industrial experiments" title="Close" onClick={() => setExperimentsOpen(false)}><X className="h-4 w-4" /></button></div><div className="flex gap-2"><select aria-label="Circuit example" className={FIELD} value={example} onChange={event => setExample(event.target.value as CircuitExample)}>{Object.entries(CIRCUIT_EXAMPLES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button type="button" className={ICON} aria-label="Load selected circuit example" title="Load example" disabled={locked} onClick={() => { setExperimentsOpen(false); setConfirmExample(true); }}><Plus className="h-4 w-4" /></button></div><button type="button" className="mt-3 h-8 rounded-md border border-neutral-600 px-3 text-xs" disabled={locked} onClick={() => { change({ ...draft, format_version: 2 }); setExperimentsOpen(false); }}>Enable industrial timeline</button></div>}
    {confirmExample && !readOnly && <div role="dialog" aria-label="Load circuit example" className="absolute inset-x-3 top-16 z-30 mx-auto max-w-sm rounded-lg border border-neutral-600 bg-neutral-900 p-4 shadow-xl"><p className="text-sm">Replace the current draft with {CIRCUIT_EXAMPLES[example]}?</p><div className="mt-3 flex justify-end gap-2"><button type="button" className="rounded-md px-3 py-2 text-xs" onClick={() => setConfirmExample(false)}>Cancel</button><button type="button" className="rounded-md bg-cyan-700 px-3 py-2 text-xs" disabled={locked} onClick={() => { const next = circuitExample(example); change(next); setSelected(next.components[0].id); setSelectedNodes([]); setSeriesTarget(null); setGroundNode(null); setConfirmExample(false); setTab("components"); }}>Load example</button></div></div>}
    {selectedNodes.length === 2 && !readOnly && <form role="dialog" aria-label="Add component between nodes" className="absolute inset-x-3 top-16 z-30 mx-auto max-w-sm rounded-lg border border-cyan-700 bg-neutral-900 p-4 shadow-xl" onSubmit={event => { event.preventDefault(); addPart(); }} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setSelectedNodes([]); } }}>
      <div className="mb-3 flex items-center justify-between gap-2"><h3 className="min-w-0 truncate text-sm text-neutral-200">{selectedNodes[0]} to {selectedNodes[1]}</h3><button type="button" className={ICON} aria-label="Cancel component connection" title="Cancel" onClick={() => setSelectedNodes([])}><X className="h-4 w-4" /></button></div>
      <select autoFocus aria-label="New component type" className={FIELD} value={newKind} disabled={locked} onChange={event => setNewKind(event.target.value as CircuitKind)}>{Object.entries(CIRCUIT_PARTS).map(([kind, details]) => <option value={kind} key={kind}>{details.label}</option>)}</select>
      <button type="submit" className="mt-3 inline-flex h-8 items-center gap-2 rounded-md bg-cyan-700 px-3 text-xs font-medium text-white disabled:opacity-50" disabled={locked || draft.components.length >= partLimit}><Plus className="h-4 w-4" />Add component</button>
    </form>}
    {seriesTarget && seriesPart && !readOnly && <form role="dialog" aria-label="Insert component in series" className="absolute inset-x-3 top-16 z-30 mx-auto max-w-sm rounded-lg border border-cyan-700 bg-neutral-900 p-4 shadow-xl" onSubmit={event => { event.preventDefault(); addSeriesPart(); }} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setSeriesTarget(null); } }}>
      <div className="mb-3 flex items-center justify-between gap-2"><h3 className="min-w-0 truncate text-sm text-neutral-200">In series with {seriesPart.id}</h3><button type="button" className={ICON} aria-label="Cancel series insertion" title="Cancel" onClick={() => setSeriesTarget(null)}><X className="h-4 w-4" /></button></div>
      <div className="grid grid-cols-2 gap-3">
        <label className="min-w-0 space-y-1 text-xs text-neutral-400">Component<select autoFocus aria-label="New series component type" className={FIELD} value={newKind} disabled={locked} onChange={event => setNewKind(event.target.value as CircuitKind)}>{Object.entries(CIRCUIT_PARTS).filter(([kind]) => !DEVICE_TERMINALS[kind]?.length).map(([kind, details]) => <option value={kind} key={kind}>{details.label}</option>)}</select></label>
        <label className="min-w-0 space-y-1 text-xs text-neutral-400">Connection<select aria-label="Series insertion lead" className={FIELD} value={seriesTarget.lead} disabled={locked} onChange={event => setSeriesTarget({ ...seriesTarget, lead: event.target.value as "positive" | "negative" })}><option value="positive">Positive ({seriesPart.positive})</option><option value="negative">Negative ({seriesPart.negative})</option></select></label>
      </div>
      <button type="submit" className="mt-3 inline-flex h-8 items-center gap-2 rounded-md bg-cyan-700 px-3 text-xs font-medium text-white disabled:opacity-50" disabled={locked || !seriesCapacity || seriesPart.connected === false}><Plus className="h-4 w-4" />Insert in series</button>
    </form>}
    {groundNode && !readOnly && <div role="dialog" aria-label="Ground node" className="absolute inset-x-3 top-16 z-30 mx-auto max-w-sm rounded-lg border border-neutral-600 bg-neutral-900 p-4 shadow-xl" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setGroundNode(null); } }}>
      <p className="text-sm text-neutral-200">{draft.grounds?.includes(groundNode) ? `Remove the ground reference from ${groundNode}?` : `Connect all of ${groundNode} to 0 V ground?`}</p>
      <div className="mt-3 flex justify-end gap-2"><button autoFocus type="button" className="rounded-md px-3 py-2 text-xs" onClick={() => setGroundNode(null)}>Cancel</button><button type="button" className="rounded-md bg-cyan-700 px-3 py-2 text-xs text-white" onClick={() => {
        const grounds = draft.grounds?.includes(groundNode) ? draft.grounds.filter(node => node !== groundNode) : [...(draft.grounds || []), groundNode];
        change({ ...draft, grounds, analysis: { ...draft.analysis, probes: [] } }); setGroundNode(null); setSelectedNodes([]);
      }}>Confirm ground change</button></div>
    </div>}
    <div className="circuit-workspace" data-focused={expanded}>
      <CircuitVisualization circuit={draft} result={result} stale={dirty || busy || !!error} selected={part.id} select={identity => { setSelected(identity); if (!readOnly) { setTab("components"); setExpanded(false); } }} disabled={busy || !!block.isStreaming} readOnly={readOnly} run={run} toolbarTarget={toolbarTarget} runTarget={runTarget} expanded={expanded} toggleControls={() => setExpanded(value => !value)} editor={locked ? undefined : { selectedNodes, clearNodes: () => setSelectedNodes([]), selectNode: node => { setSeriesTarget(null); setSelectedNodes(current => current.includes(node) ? current.filter(item => item !== node) : [...current.slice(-1), node]); }, groundNode: setGroundNode, move: movePart }} />
      {!expanded && <Tabs value={tab} onValueChange={setTab} className="circuit-dock">
        <TabsList aria-label="Circuit workspace" className="flex h-9 w-full shrink-0 justify-start rounded-none border-b border-neutral-700 bg-neutral-950 p-0">
          {!readOnly && <TabsTrigger className={DOCK_TAB} value="components"><SlidersHorizontal className="circuit-tab-icon h-3.5 w-3.5" />Components</TabsTrigger>}
          {!readOnly && <TabsTrigger className={DOCK_TAB} value="simulation"><Settings2 className="circuit-tab-icon h-3.5 w-3.5" />Simulation</TabsTrigger>}
          <TabsTrigger className={DOCK_TAB} value="meters">Meters</TabsTrigger>
          <TabsTrigger className={DOCK_TAB} value="waveforms" disabled={!result || result.mode !== "transient"}><ChartNoAxesCombined className="circuit-tab-icon h-3.5 w-3.5" />Waveforms</TabsTrigger>
          <TabsTrigger className={DOCK_TAB} value="readings" disabled={!result}><LayoutGrid className="circuit-tab-icon h-3.5 w-3.5" />Readings</TabsTrigger>
        </TabsList>
        {!readOnly && <TabsContent value="components" className="circuit-inspector">
          <form onSubmit={event => { event.preventDefault(); void run(); }} className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain">
            <div className="flex min-w-0 items-center gap-2">
              <select aria-label="Selected component" className={FIELD} value={part.id} disabled={busy} onChange={event => setSelected(event.target.value)}>{draft.components.map(component => <option key={component.id} value={component.id}>{component.id} ({CIRCUIT_PARTS[component.kind].label})</option>)}</select>
              {draft.format_version !== 2 && <button type="button" className={ICON} aria-label="Device model parameters" title="Device model parameters" disabled={locked} onClick={() => setDeviceOptionsOpen(true)}><Settings2 className="h-4 w-4" /></button>}
              <button type="button" className={ICON} aria-label={`${part.connected === false ? "Reconnect" : "Disconnect"} ${part.id}`} title={part.connected === false ? "Reconnect both terminals" : "Disconnect both terminals"} disabled={locked} onClick={() => change({ ...draft, components: draft.components.map(component => component.id === part.id ? { ...component, connected: part.connected === false } : component), analysis: { ...draft.analysis, probes: [] } })}>{part.connected === false ? <Plug className="h-4 w-4" /> : <Unplug className="h-4 w-4" />}</button>
              <button type="button" className={ICON} aria-label={`Remove ${part.id}`} title={`Remove ${part.id}`} disabled={locked || draft.components.length <= 2} onClick={() => change({ ...draft, components: draft.components.filter(component => component.id !== part.id), analysis: { ...draft.analysis, probes: [] } })}><Trash2 className="h-4 w-4" /></button>
            </div>
            <fieldset disabled={locked} className="grid min-w-0 grid-cols-3 gap-2">
              {part.kind === "switch" ? <label className="flex items-center gap-2 self-end py-2 text-xs"><input type="checkbox" aria-label={`${part.id} closed`} checked={part.closed !== false} onChange={event => changePart({ closed: event.target.checked })} />Closed</label> : part.kind === "diode" ? <div className="self-end py-2 text-xs text-neutral-400">Silicon model</div> : <label className="min-w-0 space-y-1 text-xs text-neutral-400" title={part.kind === "bulb" ? "Fixed operating resistance in ohms" : undefined}>{part.kind === "bulb" ? "R (ohm)" : `Value (${CIRCUIT_PARTS[part.kind].unit})`}<input type="number" aria-label={`${part.id} value`} className={FIELD} value={part.value} min={CIRCUIT_PARTS[part.kind].min} max={CIRCUIT_PARTS[part.kind].max} step="any" onChange={event => changePart({ value: event.target.valueAsNumber })} /></label>}
              <label className="min-w-0 space-y-1 text-xs text-neutral-400">Positive node<input aria-label={`${part.id} positive node`} className={FIELD} value={part.positive} pattern="(0|[A-Za-z][A-Za-z0-9_]{0,15})" maxLength={16} onChange={event => changePart({ positive: event.target.value })} /></label>
              <label className="min-w-0 space-y-1 text-xs text-neutral-400">Negative node<input aria-label={`${part.id} negative node`} className={FIELD} value={part.negative} pattern="(0|[A-Za-z][A-Za-z0-9_]{0,15})" maxLength={16} onChange={event => changePart({ negative: event.target.value })} /></label>
            </fieldset>
            {part.kind === "voltage_source" && <fieldset disabled={locked} className="grid grid-cols-2 gap-2"><label className="min-w-0 space-y-1 text-xs text-neutral-400">Waveform<select aria-label="Source waveform" className={FIELD} value={part.waveform || "dc"} onChange={event => { const waveform = event.target.value as CircuitComponent["waveform"]; change({ ...draft, analysis: { ...draft.analysis, mode: waveform === "dc" ? draft.analysis.mode : "transient" }, components: draft.components.map(component => component.id === part.id ? { ...component, waveform } : component) }); }}><option value="dc">DC</option><option value="step">Step</option><option value="sine">Sine</option></select></label>{part.waveform === "sine" && <label className="min-w-0 space-y-1 text-xs text-neutral-400">Frequency (Hz)<input type="number" aria-label="Source frequency" className={FIELD} min={0.1} max={100000} step="any" value={part.frequency_hz || 100} onChange={event => changePart({ frequency_hz: event.target.valueAsNumber })} /></label>}</fieldset>}
            {(part.kind === "resistor" || part.kind === "bulb") && <fieldset disabled={locked} className="grid grid-cols-2 gap-2">
              <label className="min-w-0 space-y-1 text-xs text-neutral-400">Load type<select aria-label="Load type" className={FIELD} value={part.kind} onChange={event => changePart({ kind: event.target.value as "resistor" | "bulb" })}><option value="resistor">Resistor</option><option value="bulb">Bulb</option></select></label>
              {part.kind === "bulb" && <label className="min-w-0 space-y-1 text-xs text-neutral-400" title="Glow is relative to rated power V squared / R. Fixed-resistance model, no thermal or burnout simulation.">Rated voltage (V)<input type="number" aria-label={`${part.id} rated voltage`} className={FIELD} value={part.rated_voltage ?? 12} min={0.1} max={48} step="any" onChange={event => changePart({ rated_voltage: event.target.valueAsNumber })} /></label>}
            </fieldset>}
            {draft.format_version === 2 && <CircuitDeviceInspector circuit={draft} part={part} patch={changePart} locked={locked} />}
            <div className="mt-auto flex items-center justify-between gap-2 border-t border-neutral-800 pt-2"><span className="min-w-0 truncate text-xs text-neutral-500">{part.connected === false ? "Disconnected" : `${part.positive} / ${part.negative}`}</span><div className="flex gap-1">
              <button type="button" className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-cyan-800 px-2 text-xs text-cyan-200 hover:bg-cyan-950 disabled:opacity-40" aria-label={`Insert in series with ${part.id}`} title={part.connected === false ? "Reconnect this component before inserting in series" : !seriesCapacity ? "Series insertion needs space for one component and one node" : "Insert a component in series"} disabled={locked || part.connected === false || !seriesCapacity} onClick={() => { setSeriesTarget({ id: part.id, lead: "positive" }); setSelectedNodes([]); setGroundNode(null); }}><Plus className="h-3.5 w-3.5" />Series</button>
              <button type="button" className={ICON} aria-label={`Move ${part.id} up`} title="Move up" disabled={locked || draft.components[0].id === part.id} onClick={() => movePart(part.id, draft.components.indexOf(part) - 1, part.position ?? 0.5)}><ArrowUp className="h-4 w-4" /></button><button type="button" className={ICON} aria-label={`Move ${part.id} down`} title="Move down" disabled={locked || draft.components.at(-1)?.id === part.id} onClick={() => movePart(part.id, draft.components.indexOf(part) + 1, part.position ?? 0.5)}><ArrowDown className="h-4 w-4" /></button>
              </div>
            </div>
          </form>
        </TabsContent>}
        {!readOnly && <TabsContent value="simulation" className="circuit-inspector" style={{ overflowY: "auto" }}>
          {draft.format_version === 2 && <div className="mb-3 flex items-end gap-2"><label className="min-w-0 flex-1 space-y-1 text-xs text-neutral-400">Experiment<select aria-label="Circuit example" className={FIELD} value={example} disabled={locked} onChange={event => setExample(event.target.value as CircuitExample)}>{Object.entries(CIRCUIT_EXAMPLES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button type="button" className={ICON} aria-label="Load selected circuit example" title="Load example" disabled={locked} onClick={() => setConfirmExample(true)}><Plus className="h-4 w-4" /></button></div>}
          <div className="flex items-end gap-3"><div role="group" aria-label="Analysis mode" className="inline-flex h-8 shrink-0 rounded-md border border-neutral-600 p-0.5">{(["dc", "transient"] as const).map(mode => <button key={mode} type="button" disabled={locked} aria-pressed={draft.analysis.mode === mode} onClick={() => change({ ...draft, analysis: { ...draft.analysis, mode } })} className={`rounded px-3 text-xs ${draft.analysis.mode === mode ? "bg-neutral-700 text-white" : "text-neutral-400"}`}>{mode === "dc" ? "DC" : "Transient"}</button>)}</div>{draft.analysis.mode === "transient" && <label className="min-w-0 max-w-40 space-y-1 text-xs text-neutral-400">Duration (s)<input disabled={locked} type="number" aria-label="Simulation duration" className={FIELD} min={0.000001} max={10} step="any" value={draft.analysis.duration_seconds || 0.05} onChange={event => change({ ...draft, analysis: { ...draft.analysis, duration_seconds: event.target.valueAsNumber } })} /></label>}{draft.format_version !== 2 && <button type="button" className={ICON} aria-label="Industrial experiments" title="Industrial experiments and timeline" disabled={locked} onClick={() => setExperimentsOpen(true)}><Settings2 className="h-4 w-4" /></button>}</div>
          <fieldset disabled={locked} className="mt-3 grid grid-cols-4 gap-2"><legend className="mb-2 text-xs text-neutral-400">Voltage probes</legend>{nodes.map(node => <label key={node} className="flex min-w-0 items-center gap-1.5 text-xs" title={node}><input type="checkbox" aria-label={`Probe ${node}`} checked={probes.includes(node)} disabled={!probes.includes(node) && probes.length >= 8} onChange={event => { const next = event.target.checked ? [...probes, node] : probes.filter(probe => probe !== node); if (next.length) change({ ...draft, analysis: { ...draft.analysis, probes: next } }); }} /><span className="truncate">{node}</span></label>)}</fieldset>
          {draft.format_version === 2 && <CircuitTimeline circuit={draft} change={change} locked={locked} />}
        </TabsContent>}
        <TabsContent value="meters" className="circuit-inspector"><CircuitInstruments circuit={draft} result={result} selectedPart={part.id} change={change} locked={locked} readOnly={readOnly} stale={dirty || busy || !!error} renderScope={channels => result && <TracePlot result={{ ...result, traces: channels }} unit="V" signal="" />} /></TabsContent>
        <TabsContent value="waveforms" className={`circuit-inspector ${dirty ? "opacity-50" : ""}`}>
          {result && <div className="flex h-full min-h-0 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-2">
              {result.traces.every(trace => ["V", "A"].includes(trace.unit)) ? <div role="group" aria-label="Plot units" className="flex h-8 shrink-0 gap-1">{(["V", "A"] as const).map(value => <button type="button" key={value} aria-pressed={unit === value} onClick={() => { setUnit(value); setSignal(""); }} className={`rounded-md px-2 text-xs ${unit === value ? "bg-neutral-700 text-white" : "text-neutral-400"}`}>{value === "V" ? "Voltage" : "Current"}</button>)}</div> : <select aria-label="Plot units" className={FIELD} value={unit} onChange={event => { setUnit(event.target.value as typeof unit); setSignal(""); }}>{[...new Set(result.traces.map(trace => trace.unit))].map(value => <option key={value} value={value}>{value === "V" ? "Voltage" : value === "A" ? "Current" : value}</option>)}</select>}
              <select aria-label="Waveform signal" className={FIELD} value={plotSignal} onChange={event => setSignal(event.target.value)}>{plotTraces.map(trace => <option key={trace.name} value={trace.name}>{unit === "V" ? "V" : "I"}({trace.name})</option>)}</select>
            </div>
            <TracePlot result={result} unit={unit} signal={plotSignal} />
          </div>}
        </TabsContent>
        <TabsContent value="readings" className={`circuit-inspector ${dirty ? "opacity-50" : ""}`}>{result && <CircuitReadings result={result} />}</TabsContent>
      </Tabs>}
    </div>
  </section>;
}

export function CircuitToolControl({ agentId, initialStatus, initialError }: {
  agentId: string; initialStatus: CircuitToolStatus | null; initialError: string | null;
}) {
  const [status, setStatus] = useState<CircuitToolStatus | null>(initialStatus);
  const [error, setError] = useState<string | null>(initialError);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [revision, setRevision] = useState(0);
  const account = useUserStore(state => JSON.stringify([state.userId, state.role, state.isAuthenticated]));
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    setConfirm(false);
    setBusy(false);
    setStatus(revision === 0 ? initialStatus : null);
    setError(revision === 0 ? initialError : null);
    if (revision > 0) {
      getCircuitToolStatus(agentId, controller.signal).then(value => {
        if (!controller.signal.aborted) setStatus(value);
      }).catch(failure => {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Tool status unavailable.");
      });
    }
    return () => { controller.abort(); request.current?.abort(); };
  }, [agentId, account, revision, initialStatus, initialError]);

  const enable = async () => {
    if (!status || busy || !confirm) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(null);
    try {
      const result = await enableCircuitTool(agentId, status.agent_version, controller.signal);
      if (!controller.signal.aborted) { setStatus(result); setConfirm(false); }
    } catch (failure) {
      if (!controller.signal.aborted) {
        setStatus(null);
        setConfirm(false);
        setError(failure instanceof Error ? failure.message : "Tool update could not be confirmed. Recheck status.");
      }
    } finally { if (!controller.signal.aborted) setBusy(false); }
  };

  return <section aria-label="Circuit simulation tool" className="text-xs text-neutral-200">
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="inline-flex items-center gap-2">
      {status?.enabled ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-300" aria-hidden="true" /> : <span className="w-3.5 shrink-0" aria-hidden="true" />}
      Simulation{status?.enabled && <span className="sr-only">Enabled</span>}
    </span>
      {status && (!status.enabled || status.update_available) && <button type="button" disabled={busy || !status.engine_available} onClick={() => setConfirm(true)} className="rounded-md border border-neutral-600 px-3 py-1.5 text-xs disabled:opacity-50">{status.enabled ? "Update simulation tool" : "Enable tool"}</button>}
      {!status && !error && <Loader2 aria-label="Checking tool status" className="h-4 w-4 animate-spin" />}
    </div>
    {status && !status.engine_available && <p role="status" className="mt-2 text-xs text-amber-300">ngspice is not installed on this backend.</p>}
    {confirm && <div className="mt-3 space-y-2"><p className="text-xs text-neutral-400">{status?.enabled ? "Update this TA's circuit simulation tool?" : "Add circuit simulation to this TA's tools?"} This creates a new agent version and preserves its other settings.</p><div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={() => setConfirm(false)} className="rounded-md px-3 py-1.5 text-xs">Cancel</button><button type="button" disabled={busy} onClick={() => void enable()} className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs text-white disabled:opacity-50">{busy && <Loader2 className="h-3 w-3 animate-spin" />}{status?.enabled ? "Confirm update" : "Confirm enable"}</button></div></div>}
    {error && <div role="alert" className="mt-2 flex items-center gap-2 text-xs text-amber-300"><span className="min-w-0 flex-1 break-words">{error}</span><button type="button" aria-label="Recheck circuit tool" title="Recheck tool status" className={ICON} disabled={busy} onClick={() => { invalidateCourseInfoCache(agentId); setRevision(value => value + 1); }}><RefreshCw className="h-4 w-4" /></button></div>}
  </section>;
}