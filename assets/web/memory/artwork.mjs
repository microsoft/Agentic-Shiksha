import assert from "node:assert/strict";

const W = 1600;
export const MEMORY_PALETTES = {
  light: {
    canvas: "#FFFFFF", surface: "#FFFFFF", panel: "#F5F8FE", ink: "#132440",
    muted: "#536580", border: "#D6E1F0", blue: "#2454C6", blueLight: "#EDF3FF",
    accent: "#2454C6", onAccent: "#FFFFFF", teal: "#087B78", tealLight: "#E8F6F2",
    amber: "#855308", amberLight: "#FFF4DC", amberBorder: "#DBBC78",
    violet: "#6850A6", violetLight: "#F3EFFB", violetBorder: "#D8CDEC",
  },
  dark: {
    canvas: "#0B1426", surface: "#15243B", panel: "#101D32", ink: "#E5EDF9",
    muted: "#A5B6CC", border: "#354A67", blue: "#A7C1FF", blueLight: "#1C3154",
    accent: "#2454C6", onAccent: "#FFFFFF", teal: "#73D9CA", tealLight: "#123735",
    amber: "#F2CB82", amberLight: "#382C19", amberBorder: "#806331",
    violet: "#C3B1F2", violetLight: "#29213F", violetBorder: "#5E4D7D",
  },
};
const esc = value => String(value).replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
})[character]);
const row = (items, { x, y, width }) => items.map((item, index) => ({
  ...item, x: x + width * (index + 0.5) / items.length, y,
}));

function drawing(theme) {
  assert(Object.hasOwn(MEMORY_PALETTES, theme), `Unknown memory figure theme: ${theme}`);
  const C = MEMORY_PALETTES[theme];
  const txt = (x, y, value, size = 22, options = {}) =>
    `<text x="${x}" y="${y}" font-size="${size}" fill="${options.color || C.ink}" font-weight="${options.weight || 400}" text-anchor="${options.anchor || "start"}"${options.spacing ? ` letter-spacing="${options.spacing}"` : ""}>${esc(value)}</text>`;
  const rect = (x, y, width, height, fill = C.surface, stroke = C.border, radius = 20) =>
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
  const tag = (x, y, label, color = C.blue, fill = C.blueLight) =>
    `${rect(x, y, label.length * 10.6 + 30, 32, fill, fill, 10)}${txt(x + 15, y + 22, label, 17, { color, weight: 700 })}`;

  function diagram(number, title, subtitle, height) {
    const nodes = [];
    const edges = [];
    const base = [];
    const connectors = [];
    const edgeLabels = [];
    const foreground = [];
    const nodeById = new Map();
    const marker = color => `arrow-${number}-${color.replace("#", "")}`;

    function node(value) {
      assert(!nodeById.has(value.id), `Duplicate node ${value.id}`);
      const n = { width: 180, height: 72, shape: "card", fill: C.surface, stroke: C.border, ...value };
      nodes.push(n);
      nodeById.set(n.id, n);
      const x = n.x - n.width / 2;
      const y = n.y - n.height / 2;
      let body;
      if (n.shape === "concept") {
        n.radius = n.width / 2;
        body = `<circle data-body="" cx="${n.x}" cy="${n.y}" r="${n.radius}" fill="${C.accent}" stroke="${C.accent}" stroke-width="3"/>`;
        body += txt(n.x, n.y - 20, n.code, 34, { color: C.onAccent, weight: 700, anchor: "middle" });
        n.lines.forEach((line, index) => { body += txt(n.x, n.y + 14 + index * 27, line, 23, { color: C.onAccent, anchor: "middle" }); });
      } else if (n.shape === "misconception") {
        n.radius = 36;
        body = n.shared ? `<circle cx="${n.x}" cy="${n.y}" r="49" fill="${C.tealLight}" stroke="none"/>` : "";
        body += `<circle data-body="" cx="${n.x}" cy="${n.y}" r="36" fill="${C.surface}" stroke="${n.shared ? C.teal : C.blue}" stroke-width="2.5"/>`;
        body += txt(n.x, n.y + 8, n.code, 24, { anchor: "middle", weight: 700, color: n.shared ? C.teal : C.blue });
        n.lines.forEach((line, index) => { body += txt(n.x, n.y + 65 + index * 26, line, 22, { anchor: "middle" }); });
      } else if (n.shape === "learner") {
        n.radius = 36;
        body = `<circle data-body="" cx="${n.x}" cy="${n.y}" r="36" fill="${C.ink}" stroke="${C.ink}"/>`;
        body += txt(n.x, n.y + 8, n.code, 25, { color: C.canvas, anchor: "middle", weight: 700 });
      } else if (n.shape === "session") {
        body = `<rect data-body="" x="${x}" y="${y}" width="${n.width}" height="${n.height}" rx="${n.height / 2}" fill="${C.surface}" stroke="${C.border}" stroke-width="2"/>`;
        body += txt(n.x, n.y + 8, n.code, n.compact ? 20 : 23, { anchor: "middle", weight: 700 });
      } else {
        body = n.shape === "paper"
          ? `<path data-body="" d="M${x + 14},${y}H${x + n.width - 22}L${x + n.width},${y + 22}V${y + n.height - 14}Q${x + n.width},${y + n.height} ${x + n.width - 14},${y + n.height}H${x + 14}Q${x},${y + n.height} ${x},${y + n.height - 14}V${y + 14}Q${x},${y} ${x + 14},${y}Z" fill="${n.fill}" stroke="${n.stroke}" stroke-width="1.8"/><path d="M${x + n.width - 22},${y}V${y + 22}H${x + n.width}" fill="none" stroke="${n.stroke}" stroke-width="1.8"/>`
          : n.shape === "observation"
            ? `<path data-body="" d="M${x + 22},${y}H${x + n.width - 22}L${x + n.width},${n.y}L${x + n.width - 22},${y + n.height}H${x + 22}L${x},${n.y}Z" fill="${n.fill}" stroke="${n.stroke}" stroke-width="2"/>`
            : `<rect data-body="" x="${x}" y="${y}" width="${n.width}" height="${n.height}" rx="${n.radius || 18}" fill="${n.fill}" stroke="${n.stroke}" stroke-width="${n.emphasis ? 2.5 : 1.5}"/>`;
        const lines = n.lines || [];
        const lineHeight = n.lineHeight || 26;
        const blockHeight = 23 + lines.length * lineHeight;
        const top = n.y - blockHeight / 2 + 19;
        body += txt(n.x, top, n.code, n.codeSize || 22, { anchor: "middle", weight: 700, color: n.color || C.ink });
        lines.forEach((line, index) => {
          body += txt(n.x, top + 30 + index * lineHeight, line, n.textSize || 23, { anchor: "middle", color: n.color || C.ink });
        });
      }
      foreground.push(`<g data-node="${esc(n.id)}" data-type="${esc(n.type)}"><title>${esc(n.description || [n.code, ...(n.lines || [])].join(": "))}</title>${body}</g>`);
      return n;
    }
    function port(id, side, shift = 0) {
      const n = nodeById.get(id);
      assert(n, `Missing node ${id}`);
      if (n.radius && ["concept", "misconception", "learner"].includes(n.shape)) {
        const offset = n.radius * shift;
        const reach = Math.sqrt(n.radius ** 2 - offset ** 2);
        if (side === "top" || side === "bottom") return { x: n.x + offset, y: n.y + (side === "top" ? -reach : reach) };
        return { x: n.x + (side === "left" ? -reach : reach), y: n.y + offset };
      }
      if (side === "top" || side === "bottom") return { x: n.x + n.width * shift / 2, y: n.y + (side === "top" ? -n.height / 2 : n.height / 2) };
      return { x: n.x + (side === "left" ? -n.width / 2 : n.width / 2), y: n.y + n.height * shift / 2 };
    }
    function label(x, y, value, color, size = 20) {
      const width = value.length * size * 0.54 + 20;
      return `<g data-edge-label=""><rect x="${x - width / 2}" y="${y - size + 2}" width="${width}" height="${size + 8}" rx="6" fill="${C.canvas}" fill-opacity="0.97"/>${txt(x, y, value, size, { anchor: "middle", color })}</g>`;
    }
    function edge(source, target, type, options = {}) {
      const from = options.from || "bottom";
      const to = options.to || "top";
      const a = port(source, from, options.fromShift || 0);
      const b = port(target, to, options.toShift || 0);
      const color = options.color || C.muted;
      const gap = Math.max(24, Math.abs(a.y - b.y) * 0.48);
      const path = options.path || (options.horizontal
        ? `M${a.x},${a.y} C${(a.x + b.x) / 2},${a.y} ${(a.x + b.x) / 2},${b.y} ${b.x},${b.y}`
        : `M${a.x},${a.y} C${a.x},${a.y + (from === "top" ? -gap : gap)} ${b.x},${b.y + (to === "bottom" ? gap : -gap)} ${b.x},${b.y}`);
      edges.push({ source, target, type });
      connectors.push(`<g data-edge="${esc(source)}:${esc(type)}:${esc(target)}" data-relation="${type}"><title>${esc(`${source} ${type} ${target}`)}</title><path d="${path}" fill="none" stroke="${color}" stroke-width="${options.width || 2.5}"${options.dash ? ` stroke-dasharray="${options.dash}"` : ""} marker-end="url(#${marker(color)})"/></g>`);
      if (options.label) edgeLabels.push(label(options.labelX ?? (a.x + b.x) / 2, options.labelY ?? (a.y + b.y) / 2, options.label, color, options.labelSize || 20));
    }
    function relationBundle(relations, y) {
      base.push(rect(48, y, 1504, 78, C.violetLight, C.violetBorder, 18));
      let body = txt(72, y + 30, "SHARED IDs", 18, { color: C.violet, weight: 700, spacing: 1 });
      body += txt(72, y + 56, "States refer to definitions", 20, { color: C.violet });
      relations.forEach(([source, target], index) => {
        assert(nodeById.has(source) && nodeById.has(target));
        edges.push({ source, target, type: "INSTANCE_OF", bundled: true });
        const x = 490 + index * 356;
        body += txt(x, y + 47, `${target} state`, 22, { color: C.violet });
        body += `<path d="M${x + 120},${y + 40}H${x + 185}" stroke="${C.violet}" stroke-width="2.5" stroke-dasharray="3 5" marker-end="url(#${marker(C.violet)})"/>`;
        body += txt(x + 204, y + 48, target, 25, { color: C.violet, weight: 700 });
      });
      foreground.push(`<g data-relation="INSTANCE_OF" data-bundled-links="${relations.length}"><title>${esc(relations.map(([source, target]) => `${source} INSTANCE_OF ${target}`).join("; "))}</title>${body}</g>`);
    }
    function collapsedRelations(source, targets, type) {
      assert(nodeById.has(source));
      for (const target of targets) {
        assert(nodeById.has(target));
        edges.push({ source, target, type, collapsed: true });
      }
    }
    function panel(x, y, width, panelHeight, title, subtitle, code, color = C.blue, fill = C.blueLight) {
      base.push(rect(x, y, width, panelHeight, C.panel, C.border, 24));
      base.push(tag(x + 24, y + 22, code, color, fill));
      base.push(txt(x + 24, y + 89, title, 30, { weight: 700 }));
      base.push(txt(x + 24, y + 121, subtitle, 21, { color: C.muted }));
    }
    function finish(note, alt, legend = "") {
      const palette = [...new Set([C.muted, C.blue, C.teal, C.amber, C.violet, C.ink])];
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" role="img" aria-labelledby="title desc" data-theme="${theme}">
<title id="title">Agentic Shiksha: ${esc(title)}</title><desc id="desc">${esc(alt + " " + note)}</desc>
<defs>${palette.map(color => `<marker id="${marker(color)}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M1 1L9 5L1 9Z" fill="${color}"/></marker>`).join("")}</defs>
<rect width="${W}" height="${height}" fill="${C.canvas}"/>
<g font-family="Arial, Helvetica, sans-serif">
${rect(48, 32, 36, 36, C.accent, C.accent, 10)}${txt(66, 57, "AS", 17, { color: C.onAccent, weight: 700, anchor: "middle" })}
${txt(100, 57, "AGENTIC SHIKSHA / LEARNER MEMORY", 17, { weight: 700, spacing: 1.3 })}
${txt(1552, 57, `FIGURE 0${number} / 03`, 17, { color: C.muted, anchor: "end" })}
${txt(48, 125, title, 44, { weight: 700 })}
${txt(48, 163, subtitle, 23, { color: C.muted })}
${base.join("")}${connectors.join("")}${edgeLabels.join("")}${foreground.join("")}${legend}
<line x1="48" y1="${height - 61}" x2="1552" y2="${height - 61}" stroke="${C.border}" stroke-width="1.5"/>
${txt(48, height - 28, note, 17, { color: C.muted })}
${txt(1552, height - 28, "SYNTHETIC EXAMPLE", 17, { anchor: "end", color: C.muted, weight: 700 })}
</g></svg>`;
      return { number, title, subtitle, note, alt, theme, width: W, height, svg, nodes, edges };
    }
    return { node, edge, relationBundle, collapsedRelations, panel, finish, base, foreground };
  }
  return { C, txt, rect, tag, diagram };
}

const concepts = [
  { id: "TC1", code: "TC1", type: "ThresholdConcept", shape: "concept", lines: ["Complete", "circuits"] },
  { id: "TC2", code: "TC2", type: "ThresholdConcept", shape: "concept", lines: ["Current", "conservation"] },
];
const misconceptions = [
  { id: "MC1", code: "MC1", type: "MisconceptionDefinition", shape: "misconception", lines: ["A single wire", "is enough"] },
  { id: "MC3", code: "MC3", type: "MisconceptionDefinition", shape: "misconception", lines: ["Current is", "used up"], shared: true },
  { id: "MC2", code: "MC2", type: "MisconceptionDefinition", shape: "misconception", lines: ["Voltage equals", "current"] },
];

function connectedGraphs({ C, txt, rect, diagram }) {
  const d = diagram(1, "Shared knowledge. Personal memory.", "One reviewed curriculum. Separate learner states. Evidence behind every interpretation.", 1100);
  d.panel(48, 210, 650, 626, "The curriculum graph", "Concepts and misconceptions, shared by all.", "01 / SHARED DEFINITIONS");
  d.panel(744, 210, 808, 626, "The learner graph", "A private, evolving view of learner L1.", "02 / LEARNER-SCOPED", C.teal, C.tealLight);
  row(concepts, { x: 48, y: 458, width: 650 }).forEach(n => d.node({ ...n, width: 170, height: 170 }));
  row(misconceptions, { x: 64, y: 673, width: 618 }).forEach(n => d.node(n));
  d.edge("TC1", "TC2", "PREREQUISITE_OF", { from: "right", to: "left", horizontal: true, color: C.blue, dash: "7 5", label: "prerequisite", labelY: 431, labelSize: 19 });
  d.edge("TC1", "MC1", "HAS_COMMON_MISCONCEPTION", { fromShift: -0.36 });
  d.edge("TC1", "MC3", "HAS_COMMON_MISCONCEPTION", { fromShift: 0.4, toShift: -0.35, color: C.teal });
  d.edge("TC2", "MC3", "HAS_COMMON_MISCONCEPTION", { fromShift: -0.4, toShift: 0.35, color: C.teal });
  d.edge("TC2", "MC2", "HAS_COMMON_MISCONCEPTION", { fromShift: 0.36 });
  d.foreground.push(rect(211, 575, 324, 34, C.panel, C.panel, 6), txt(373, 599, "Associated misconceptions", 22, { anchor: "middle", color: C.muted }));
  d.foreground.push(txt(373, 809, "One MC3 definition. Two concept links.", 22, { anchor: "middle", weight: 700, color: C.teal }));

  d.node({ id: "L1", type: "Learner", shape: "learner", code: "L1", x: 1156, y: 387 });
  d.node({ id: "P1", type: "LearnerProfile", code: "Profile", lines: ["Goals / context"], x: 876, y: 387, width: 216, height: 74, textSize: 20 });
  row([
    { id: "S1", type: "Session", code: "S1" }, { id: "S2", type: "Session", code: "S2" }, { id: "S3", type: "Session", code: "S3" },
  ], { x: 1310, y: 387, width: 210 }).forEach(n => d.node({ ...n, shape: "session", compact: true, width: 56, height: 44 }));
  d.edge("L1", "P1", "HAS_PROFILE", { from: "left", to: "right", horizontal: true, label: "profile", labelY: 367 });
  d.edge("L1", "S1", "HAS_SESSION", { from: "right", to: "left", horizontal: true, label: "sessions", labelY: 367 });
  d.edge("S1", "S2", "NEXT_SESSION", { from: "right", to: "left", horizontal: true, width: 1.5 });
  d.edge("S2", "S3", "NEXT_SESSION", { from: "right", to: "left", horizontal: true, width: 1.5 });
  row([
    { id: "CS1", code: "TC1 / concept state", lines: ["Progressing", "Threshold not crossed"] },
    { id: "CS2", code: "TC2 / concept state", lines: ["Not attempted", "Threshold not crossed"] },
  ], { x: 764, y: 542, width: 768 }).forEach(n => d.node({ ...n, type: "ConceptState", width: 282, height: 110, fill: C.blueLight, stroke: C.blue, textSize: 23, codeSize: 21 }));
  d.node({ id: "MS3", type: "MisconceptionState", x: 1156, y: 694, width: 336, height: 86, code: "MC3 / misconception state", lines: ["Resolving"], fill: C.amberLight, stroke: C.amberBorder, color: C.amber, codeSize: 21, textSize: 28 });
  d.edge("L1", "CS1", "HAS_CONCEPT_STATE", { fromShift: -0.5, toShift: 0.3, label: "has state", labelX: 995, labelY: 465 });
  d.edge("L1", "CS2", "HAS_CONCEPT_STATE", { fromShift: 0.5, toShift: -0.3, label: "has state", labelX: 1320, labelY: 465 });
  d.edge("CS1", "MS3", "HAS_ASSOCIATED_STATE", { fromShift: 0.3, toShift: -0.6, label: "associated", labelX: 992, labelY: 632, color: C.teal });
  d.edge("CS2", "MS3", "HAS_ASSOCIATED_STATE", { fromShift: -0.3, toShift: 0.6, label: "associated", labelX: 1315, labelY: 632, color: C.teal });
  d.collapsedRelations("L1", ["MS3"], "HAS_MISCONCEPTION_STATE");
  row([{ id: "E12", code: "E12" }, { id: "E19", code: "E19" }], { x: 916, y: 795, width: 480 })
    .forEach(n => d.node({ ...n, type: "Evidence", shape: "paper", width: 132, height: 48 }));
  d.edge("MS3", "E12", "HAS_EVIDENCE", { fromShift: -0.4 });
  d.edge("MS3", "E19", "HAS_EVIDENCE", { fromShift: 0.4 });
  d.foreground.push(txt(1156, 804, "evidence", 20, { anchor: "middle", color: C.muted }));
  d.relationBundle([["CS1", "TC1"], ["CS2", "TC2"], ["MS3", "MC3"]], 860);

  const steps = ["Evidence", "Observation", "State policy", "Next teaching step"];
  const workflow = steps.map((step, index) => {
    const x = 48 + index * 386;
    return `${rect(x, 970, index === 3 ? 346 : 332, 58, C.panel, C.border, 15)}
${txt(x + 20, 1007, `0${index + 1}`, 20, { color: C.blue, weight: 700 })}
${txt(x + 60, 1007, step, 23, { weight: 700 })}
${index < 3 ? `<path d="M${x + 342},999H${x + 374}l-6,-5m6,5l-6,5" fill="none" stroke="${C.muted}" stroke-width="2"/>` : ""}`;
  }).join("");
  return {
    ...d.finish("Conceptual view. State labels are illustrative; evidence and interpretation remain separate.",
      "Two connected graphs: shared threshold concepts TC1 and TC2 link to one common misconception MC3. Learner L1 has separate concept and misconception states, sessions, and evidence E12 and E19. Stable IDs connect states to definitions; evidence informs observations and state policy, not automatic mastery.", workflow),
    id: "01-connected-memory-graphs", recommended: true,
  };
}

function sharedConcepts({ C, txt, rect, tag, diagram }) {
  const d = diagram(2, "One misconception. Multiple concepts.", "A many-to-many curriculum map preserves the shared idea instead of duplicating it.", 1040);
  d.base.push(rect(48, 212, 1504, 646, C.panel, C.border, 24));
  d.foreground.push(tag(76, 237, "CURRICULUM / SHARED KNOWLEDGE"));
  row(concepts, { x: 170, y: 401, width: 1260 }).forEach(n => d.node({ ...n, width: 180, height: 180 }));
  row(misconceptions, { x: 104, y: 690, width: 1392 }).forEach(n => d.node(n));
  d.edge("TC1", "TC2", "PREREQUISITE_OF", { from: "right", to: "left", horizontal: true, color: C.blue, dash: "8 6", width: 3, label: "prerequisite", labelY: 380, labelSize: 23 });
  d.edge("TC1", "MC1", "HAS_COMMON_MISCONCEPTION", { fromShift: -0.5, label: "has misconception", labelX: 260, labelY: 552 });
  d.edge("TC1", "MC3", "HAS_COMMON_MISCONCEPTION", { fromShift: 0.5, toShift: -0.45, label: "has misconception", labelX: 658, labelY: 566, color: C.teal, width: 3 });
  d.edge("TC2", "MC3", "HAS_COMMON_MISCONCEPTION", { fromShift: -0.5, toShift: 0.45, label: "has misconception", labelX: 942, labelY: 566, color: C.teal, width: 3 });
  d.edge("TC2", "MC2", "HAS_COMMON_MISCONCEPTION", { fromShift: 0.5, label: "has misconception", labelX: 1340, labelY: 552 });
  d.foreground.push(rect(352, 888, 896, 62, C.tealLight, C.tealLight, 18), txt(800, 928, "Two links. One definition. No duplicated misconception.", 26, { color: C.teal, weight: 700, anchor: "middle" }));
  return {
    ...d.finish("Shared curriculum definitions are not claims about an individual learner.",
      "TC1, complete circuits, is a prerequisite of TC2, current conservation. Each concept has its own misconception and both connect to MC3, the mistaken idea that current is used up. MC3 is one shared definition, not two copies."),
    id: "02-curriculum-many-to-many",
  };
}

function evidenceGraph({ C, txt, rect, diagram }) {
  const d = diagram(3, "Evidence is not an interpretation.", "Keep the response, the inferred meaning, and policy-derived learner state distinct.", 1220);
  const centers = row([
    { index: 1, session: "S1 / initial explanation", evidence: "E12", response: ["The bulb uses up", "the current."], observation: "O12", claim: ["Supports presence", "of MC3"], color: C.amber, fill: C.amberLight },
    { index: 2, session: "S2 / independent probe", evidence: "E19", response: ["Current is conserved", "around a closed loop."], observation: "O19", claim: ["Contradicts presence", "of MC3"], color: C.teal, fill: C.tealLight },
    { index: 3, session: "S3 / transfer task", evidence: "E26", response: ["Applies conservation", "in a different circuit."], observation: "O26", claim: ["Demonstrates", "a transfer condition"], color: C.teal, fill: C.tealLight },
  ], { x: 138, y: 0, width: 1398 });
  d.foreground.push(txt(48, 251, "Session", 20, { color: C.muted, weight: 700 }));
  d.foreground.push(txt(48, 436, "Evidence", 20, { color: C.muted, weight: 700 }));
  d.foreground.push(txt(48, 631, "Observation", 20, { color: C.muted, weight: 700 }));
  d.foreground.push(txt(48, 845, "Learner state", 20, { color: C.muted, weight: 700 }));
  d.foreground.push(txt(48, 874, "Policy-derived", 18, { color: C.muted }));
  for (const column of centers) {
    d.base.push(rect(column.x - 197, 204, 394, 503, C.panel, C.panel, 24));
    d.node({ id: `S${column.index}`, type: "Session", shape: "session", x: column.x, y: 246, code: column.session, width: 358, height: 56 });
    d.node({ id: column.evidence, type: "Evidence", shape: "paper", x: column.x, y: 432, code: `${column.evidence} / recorded response`, lines: column.response, width: 350, height: 128, codeSize: 20, textSize: 24, lineHeight: 29 });
    d.node({ id: column.observation, type: "Observation", shape: "observation", x: column.x, y: 629, code: `${column.observation} / interpretation`, lines: column.claim, width: 314, height: 118, codeSize: 20, textSize: 23, color: column.color, fill: column.fill, stroke: column.color });
    d.edge(column.evidence, `S${column.index}`, "OBSERVED_IN", { from: "top", to: "bottom", label: "observed in", labelX: column.x + 84, labelY: 324 });
    d.edge(column.observation, column.evidence, "DERIVED_FROM", { from: "top", to: "bottom", label: "derived from", labelX: column.x + 84, labelY: 538 });
  }
  d.node({ id: "MS3", type: "MisconceptionState", x: 650, y: 844, code: "MC3 / misconception state", lines: ["Resolving / improving"], width: 398, height: 102, fill: C.amberLight, stroke: C.amberBorder, color: C.amber, codeSize: 22, textSize: 27 });
  d.node({ id: "CS1", type: "ConceptState", x: 1303, y: 844, code: "TC1 / concept state", lines: ["Progressing / not crossed"], width: 398, height: 102, fill: C.blueLight, stroke: C.blue, codeSize: 22, textSize: 25 });
  d.edge("O12", "MS3", "SUPPORTS", { toShift: -0.48, label: "supports", labelX: 446, labelY: 750, labelSize: 22, color: C.amber });
  d.edge("O19", "MS3", "CONTRADICTS", { toShift: 0.48, label: "contradicts", labelX: 831, labelY: 750, labelSize: 22, color: C.teal });
  d.edge("O26", "CS1", "SUPPORTS_CONCEPT_DEMONSTRATION", { label: "demonstrates", labelX: 1391, labelY: 750, labelSize: 22, color: C.teal });
  d.node({ id: "IA", type: "InsightsAgent", x: 470, y: 1051, code: "Insights Agent", lines: ["PROPOSED / READ-ONLY"], width: 340, height: 100, fill: C.violetLight, stroke: C.violetBorder, color: C.violet, codeSize: 27, textSize: 20 });
  d.node({ id: "I1", type: "Insight", x: 1150, y: 1051, code: "Longitudinal insight / hypothesis", lines: ["Improvement is emerging across contexts.", "Probe again before claiming clearance.", "References: E12, E19, E26"], width: 728, height: 138, fill: C.violetLight, stroke: C.violetBorder, color: C.violet, codeSize: 23, textSize: 24, lineHeight: 28 });
  d.collapsedRelations("I1", ["E12", "E19", "E26"], "DERIVED_FROM");
  d.edge("IA", "MS3", "READS", { from: "top", to: "bottom", fromShift: 0.1, toShift: -0.2, dash: "3 5", color: C.violet, label: "reads", labelX: 665, labelY: 979, path: "M487,1001 C487,969 610,969 610.2,895" });
  d.edge("IA", "CS1", "READS", { from: "top", to: "bottom", dash: "3 5", color: C.violet, label: "reads", labelX: 1086, labelY: 957, path: "M580,1001 L580,975 Q580,965 604,965 L1287,965 Q1303,965 1303,945 L1303,895" });
  d.edge("IA", "I1", "GENERATED_INSIGHT", { from: "right", to: "left", horizontal: true, color: C.violet, label: "proposes", labelY: 1029, labelSize: 22 });
  return {
    ...d.finish("Interpretations can change. Evidence stays traceable. The proposed agent cannot assign mastery.",
      "Three synthetic sessions retain evidence E12, E19 and E26 separately from interpretations O12, O19 and O26. Supporting and contradicting observations inform misconception and concept states. A proposed read-only Insights Agent cites the evidence in a revisable hypothesis, not a mastery verdict."),
    id: "03-evidence-and-longitudinal-insights",
  };
}

export function createMemoryFigures(theme = "light") {
  const tools = drawing(theme);
  return [connectedGraphs(tools), sharedConcepts(tools), evidenceGraph(tools)];
}
