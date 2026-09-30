import { readFileSync } from "node:fs";
import { azureServiceIcon } from "../azure-icons/diagram-icons.mjs";

// Embed the supplied logo so exported SVGs also work as standalone README images.
const brandLogo = `data:image/png;base64,${readFileSync(new URL("../../images/branding/agentic-shiksha-logo.png", import.meta.url)).toString("base64")}`;

// Original composition and conceptual glyphs; Microsoft service icons retain their own terms.
export const SNAPSHOT = "2026-09-30";
export const FONT = "'Segoe UI', Arial, sans-serif";

export const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
})[char]);

const palettes = {
  dark: {
    bg: "#0B1220", panel: "#101C2D", card: "#17263B", ink: "#F0F5FF",
    muted: "#B5C5DB", border: "#526985", blue: "#89AAFF", teal: "#65DDCD",
    violet: "#C5AEFF", amber: "#F5CA86", red: "#FFACAC", white: "#FFFFFF",
  },
  paper: {
    bg: "#FAFAF6", panel: "#F1F0F8", card: "#FFFFFF", ink: "#203047",
    muted: "#526176", border: "#A7B4C5", blue: "#345EB4", teal: "#087D78",
    violet: "#7950AC", amber: "#A86B21", red: "#AD454F", white: "#FFFFFF",
  },
  cloud: {
    bg: "#F5F9FF", panel: "#EAF2FD", card: "#FFFFFF", ink: "#16324F",
    muted: "#4F6884", border: "#92ABC8", blue: "#2268BE", teal: "#087E8B",
    violet: "#7754AF", amber: "#A76A21", red: "#AE4A55", white: "#FFFFFF",
  },
};

export function text(x, y, value, {
  size = 24, weight = 400, fill = "#203047", anchor = "start", extra = "",
} = {}) {
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" dominant-baseline="central" ${extra}>${esc(value)}</text>`;
}

export function rect(x, y, w, h, {
  fill = "none", stroke = "none", radius = 18, dash = "", width = 1.8, extra = "",
} = {}) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" ${dash ? `stroke-dasharray="${dash}"` : ""} ${extra}/>`;
}

export function glyph(kind, x, y, size, color, background = "none") {
  const drawings = {
    book: '<path d="M9 13C18 10 25 13 32 18C39 13 46 10 55 13V50C46 47 39 49 32 54C25 49 18 47 9 50Z"/><path d="M32 18V54M17 22L25 25M17 31L25 34M39 25L47 22M39 34L47 31"/>',
    web: '<rect x="7" y="10" width="50" height="43" rx="5"/><path d="M7 21H57M14 16H16M22 16H24M14 30H27V44H14ZM34 31H49M34 38H49M34 45H43"/>',
    api: '<path d="M18 17L5 32L18 47M46 17L59 32L46 47M38 11L26 53"/><circle cx="32" cy="32" r="4" fill="currentColor" stroke="none"/>',
    document: '<path d="M15 6H39L51 18V57H15ZM39 6V20H51M23 29H42M23 38H42M23 47H35"/>',
    agent: '<path d="M32 5L55 18V46L32 59L9 46V18ZM9 18L32 32L55 18M32 32V59"/><path d="M22 12L44 25V39" opacity=".55"/><circle cx="32" cy="32" r="6" fill="currentColor" stroke="none"/>',
    search: '<path d="M8 15H27M8 25H22M8 35H22M8 45H30"/><circle cx="39" cy="26" r="13"/><path d="M48 37L59 50"/>',
    database: '<ellipse cx="32" cy="13" rx="22" ry="8"/><path d="M10 13V48C10 59 54 59 54 48V13M10 29C10 40 54 40 54 29M10 44C10 55 54 55 54 44"/>',
    blob: '<path d="M8 19L32 6L56 19V46L32 59L8 46ZM8 19L32 33L56 19M32 33V59M20 12L44 26"/><path d="M39 39L48 34V44L39 49Z" fill="currentColor" stroke="none"/>',
    graph: '<path d="M15 17L47 15M18 21L30 44M45 20L34 44"/><circle cx="12" cy="17" r="7"/><circle cx="51" cy="15" r="7"/><circle cx="32" cy="51" r="7"/>',
    receipt: '<path d="M14 6H50V57L44 52L38 57L32 52L26 57L20 52L14 57ZM23 18H41M23 27H41M23 36H32"/><path d="M35 40L40 45L49 33"/>',
    tools: '<path d="M38 8A15 15 0 0 0 21 28L6 45L18 57L35 40A15 15 0 0 0 55 22L45 32L33 20Z"/>',
    person: '<circle cx="32" cy="16" r="10"/><path d="M11 57V46C11 29 53 29 53 46V57M23 40V57M41 40V57"/>',
    gate: '<path d="M32 5L59 32L32 59L5 32ZM21 32L29 40L45 23"/>',
    layers: '<path d="M5 21L32 6L59 21L32 36ZM5 33L32 48L59 33M5 45L32 60L59 45"/>',
    play: '<circle cx="32" cy="32" r="25"/><path d="M25 18L46 32L25 46Z"/>',
  };
  if (!drawings[kind]) throw new Error(`Unknown original glyph: ${kind}`);
  return `<g aria-hidden="true" transform="translate(${x} ${y}) scale(${size / 64})" color="${color}" fill="${background}" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${drawings[kind]}</g>`;
}

function drawing(id, theme) {
  const p = palettes[theme];
  const t = (x, y, value, options = {}) => text(x, y, value, { fill: p.ink, ...options });
  const rule = (x1, y1, x2, y2, color = p.border) => `<path d="M${x1} ${y1}H${x2}" ${y1 !== y2 ? `transform="rotate(${Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI} ${x1} ${y1})"` : ""} fill="none" stroke="${color}" stroke-width="1.5"/>`;
  const edge = (name, points, { color = "blue", dashed = false, arrow = true, width = 3 } = {}) =>
    `<polyline data-connector="${esc(name)}" points="${points.map((point) => point.join(",")).join(" ")}" fill="none" stroke="${p[color]}" stroke-width="${width}" stroke-linejoin="round" ${dashed ? 'stroke-dasharray="8 8"' : ""} ${arrow ? `marker-end="url(#${id}-${color})"` : ""}/>`;
  const label = (x, y, value, options = {}) => t(x, y, value, { size: 22, fill: p.muted, anchor: "middle", ...options });
  const badge = (x, y, value, { color = p.blue, fill = p.bg, r = 21 } = {}) =>
    `<g data-flow-badge="${esc(value)}"><circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${color}" stroke-width="2"/>${t(x, y - 1, value, { size: 22, weight: 700, fill: color, anchor: "middle" })}</g>`;
  const panel = (x, y, w, h, title, { fill = p.panel, color = p.border, titleSize = 25 } = {}) =>
    `<g data-panel="${esc(title)}">${rect(x, y, w, h, { fill, stroke: color, dash: "9 9", radius: 22 })}${t(x + 30, y + 40, title, { size: titleSize, weight: 650 })}</g>`;
  const box = (name, x, y, w, h, title, body = [], {
    icon, color = p.blue, fill = p.card, stroke = p.border, dashed = false,
    size = 30, bodySize = 24, titleY = 42, bodyY = 91, lineHeight = 34,
    titleLines, tag, serviceIcons = [],
  } = {}) => {
    if (icon && serviceIcons.length) throw new Error(`Choose conceptual or service icons for ${name}, not both`);
    const titles = titleLines || [title];
    const titleX = x + (serviceIcons.length ? 82 + (serviceIcons.length - 1) * 48 : icon ? 82 : 26);
    return `<g data-node="${esc(name)}" data-fit="${esc(name)}">
      ${rect(x, y, w, h, { fill, stroke, dash: dashed ? "7 6" : "", radius: 17, extra: "data-bounds=\"\"" })}
      ${icon ? glyph(icon, x + 25, y + 23, 40, color) : ""}${serviceIcons.length && theme === "dark" ? rect(x + 19, y + 17, 52 + (serviceIcons.length - 1) * 48, 52, { fill: "#FFFFFF", radius: 8 }) : ""}${serviceIcons.map((service, i) => azureServiceIcon(service, x + 25 + i * 48, y + 23, 40)).join("")}
      ${titles.map((line, i) => t(titleX, y + titleY + i * (size + 6), line, { size, weight: 650 })).join("")}
      ${body.map((line, i) => t(x + 26, y + bodyY + i * lineHeight, line, { size: bodySize, fill: p.muted })).join("")}
      ${tag ? t(x + w - 24, y + 32, tag, { size: 22, weight: 700, fill: color, anchor: "end" }) : ""}
    </g>`;
  };
  const note = (x, y, w, h, title, lines, { fill = p.panel, color = p.blue } = {}) =>
    `<g data-node="${esc(title)}" data-fit="${esc(title)}">
      ${rect(x, y, w, h, { fill, stroke: color, radius: 13, extra: "data-bounds=\"\"" })}
      <path d="M${x + 1} ${y + 17}V${y + h - 17}" stroke="${color}" stroke-width="5"/>
      ${t(x + 24, y + 30, title, { size: 23, weight: 700, fill: color })}
      ${lines.map((line, i) => t(x + 24, y + 67 + i * 36, line, { size: 23, fill: p.muted })).join("")}
    </g>`;
  const shell = (w, h, title, description, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="${id}-title ${id}-desc">
    <title id="${id}-title">${esc(title)}</title>
    <desc id="${id}-desc">${esc(description)} Source snapshot ${SNAPSHOT}. ${body.includes("data-azure-icon=") ? "Original diagram artwork with unmodified official Microsoft Azure service icons." : "Original service-style glyphs, not official service logos."} Logical source architecture, not a live deployment inventory.</desc>
    <defs>${["blue", "teal", "violet", "amber", "red", "muted"].map((name) =>
      `<marker id="${id}-${name}" viewBox="0 0 12 12" refX="10.5" refY="6" markerWidth="9" markerHeight="9" orient="auto"><path d="M2 2L10 6L2 10" fill="none" stroke="${p[name]}" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/></marker>`).join("")}
    </defs>
    <g font-family="${FONT}">${rect(0, 0, w, h, { fill: p.bg, radius: 0 })}${body}</g>
  </svg>`;
  const header = (title, subtitle) =>
    t(64, 134, title, { size: 54, weight: 650 })
    + t(64, 191, subtitle, { size: 25, fill: p.muted });
  const footer = (w, h, detail) => rule(64, h - 72, w - 64, h - 72)
    + t(64, h - 36, detail, { size: 22, fill: p.muted });
  return { p, t, edge, label, badge, panel, box, note, shell, header, footer, rule };
}

function banner(dark = false) {
  const id = dark ? "banner-dark" : "banner-light";
  const d = drawing(id, dark ? "dark" : "paper");
  const bg = dark ? "#0C172B" : "#F6F9FE";
  const ink = dark ? "#F0F6FF" : "#0B2348";
  const accent = dark ? "#6AB9FF" : "#0068DF";
  const teal = dark ? "#479AA9" : "#67B5B8";
  const blue = dark ? "#507CC1" : "#83A8DC";
  let body = rect(0, 0, 2400, 600, { fill: bg, radius: 0 });
  body += `<defs>
    <linearGradient id="${id}-path"><stop stop-color="#00AFE9"/><stop offset="1" stop-color="#3269EC"/></linearGradient>
    <radialGradient id="${id}-teal-wash" gradientUnits="userSpaceOnUse" cx="60" cy="500" r="850">
      <stop stop-color="#32C7BB" stop-opacity="${dark ? ".12" : ".11"}"/><stop offset="1" stop-color="#32C7BB" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="${id}-blue-wash" gradientUnits="userSpaceOnUse" cx="2350" cy="80" r="800">
      <stop stop-color="#78A7ED" stop-opacity="${dark ? ".14" : ".13"}"/><stop offset="1" stop-color="#78A7ED" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="${id}-edge-fade">
      <stop stop-color="white"/><stop offset=".12" stop-color="white"/>
      <stop offset=".22" stop-color="black"/><stop offset=".78" stop-color="black"/>
      <stop offset=".88" stop-color="white"/><stop offset="1" stop-color="white"/>
    </linearGradient>
    <mask id="${id}-edges" maskUnits="userSpaceOnUse" x="0" y="0" width="2400" height="600">
      <rect width="2400" height="600" fill="url(#${id}-edge-fade)"/>
    </mask>
  </defs>
  <path d="M0 4H2400" stroke="url(#${id}-path)" stroke-width="8"/>`;
  body += `<g data-banner-background="" aria-hidden="true" mask="url(#${id}-edges)">
    <rect width="2400" height="600" fill="url(#${id}-teal-wash)"/>
    <rect width="2400" height="600" fill="url(#${id}-blue-wash)"/>`;
  for (let i = 0; i < 11; i++) {
    body += `<path d="M${-180 + i * 26} -50C${40 + i * 18} 120 ${490 - i * 14} 190 ${370 - i * 10} 352S${40 + i * 14} 520 ${220 + i * 9} 650"
      fill="none" stroke="${teal}" stroke-width="${i % 3 === 0 ? 2.4 : 1.5}" stroke-opacity=".38"/>
      <path d="M${2120 + i * 26} -40C${2370 + i * 20} 110 ${2010 + i * 16} 240 ${2170 + i * 23} 395S${2430 + i * 26} 520 ${2320 + i * 32} 650"
      fill="none" stroke="${blue}" stroke-width="${i % 3 === 0 ? 2.4 : 1.5}" stroke-opacity=".38"/>`;
  }
  for (const [color, points] of [
    [teal, [[88, 134], [236, 199], [127, 320], [322, 390], [62, 470]]],
    [blue, [[2254, 87], [2123, 195], [2322, 259], [2194, 370], [2370, 474]]],
  ]) {
    for (const [from, to] of [[0, 1], [0, 2], [1, 2], [1, 3], [2, 3], [2, 4]]) {
      body += `<path d="M${points[from].join(" ")}L${points[to].join(" ")}" fill="none" stroke="${color}" stroke-width="1.5" stroke-opacity=".32"/>`;
    }
    for (const [x, y] of points) {
      body += `<circle cx="${x}" cy="${y}" r="9" fill="${color}" fill-opacity=".1"/>
        <circle cx="${x}" cy="${y}" r="3.8" fill="${color}" fill-opacity=".7"/>`;
    }
  }
  body += "</g>";
  if (dark) body += rect(600, 4, 1200, 448, { fill: "#F6F9FE", radius: 28, extra: 'data-banner-logo-surface=""' });
  body += `<image x="610" y="20" width="1180" height="450" href="${brandLogo}"
    preserveAspectRatio="xMidYMid meet" aria-label="Agentic Shiksha logo"/>`;
  body += `<text data-banner-tagline="" x="1200" y="510" font-size="58" fill="${ink}" text-anchor="middle" dominant-baseline="central" letter-spacing="-1.2">From knowledge transmission <tspan fill="${accent}" font-weight="700">to knowledge transformation.</tspan></text>`;
  return d.shell(2400, 600, dark ? "Agentic Shiksha research identity — dark" : "Agentic Shiksha research identity",
    "The supplied Agentic Shiksha learner-and-book logo centered above the single-line message From knowledge transmission to knowledge transformation. Original, subtle teal and blue flowing lines and connected points frame the edges, leaving the center clear. This expresses teaching intent, not a product screenshot or evidence of learning outcomes.", body);
}

function courseCreation() {
  const d = drawing("course-creation", "dark");
  const { p, t, box, panel, edge, label, note } = d;
  let body = d.header("From course intent to a grounded teaching assistant",
    "Teacher control, durable jobs and retrieval are separate concerns—not a single prompt-to-agent action.");
  body += panel(64, 248, 535, 1172, "TEACHER WORKSPACE", { titleSize: 25 });
  body += panel(680, 248, 1240, 1172, "MAIN FASTAPI BACKEND  /  IN-PROCESS WORKERS", { titleSize: 25 });
  body += panel(1985, 248, 591, 1172, "MANAGED SERVICES + STORES", { titleSize: 25 });
  body += box("Teacher course intent", 100, 328, 463, 154, "Course intent", [
    "Title · level · duration",
    "Prerequisites + teaching context",
  ], { icon: "book", size: 31, bodyY: 90 });
  body += box("Teacher materials", 100, 531, 463, 154, "Materials + references", [
    "Documents + textbook details",
    "Course / exam material scopes",
  ], { icon: "document", size: 29, bodyY: 89 });
  body += box("Course Companion draft", 100, 764, 463, 180, "Course Companion", [
    "Proposes unsaved form edits",
    "Teacher can inspect / revise",
    "Does not Create or Update",
  ], { icon: "agent", color: p.violet, stroke: p.violet, size: 30, bodyY: 84, bodySize: 24, lineHeight: 33 });
  body += t(126, 1000, "Proposals are not submission.", { size: 24, fill: p.violet });
  body += box("Explicit teacher submit", 100, 1134, 463, 204, "Teacher confirms", [
    "Explicit Create / Update",
    "Course + material changes",
    "Start persisted work",
  ], { icon: "gate", stroke: p.teal, color: p.teal, fill: "#173C43", size: 32, bodyY: 96, lineHeight: 37 });
  body += box("Accepted course request", 728, 328, 488, 174, "Accept course request", [
    "Access + ownership checks",
    "Persist job and creation progress",
  ], { icon: "receipt", size: 30, bodyY: 100, lineHeight: 35 });
  body += box("Generate course specification", 728, 593, 488, 174, "Generate specification", [
    "Creation agent → typed course spec",
    "Versioned prompt + JSON validation",
  ], { icon: "agent", color: p.violet, size: 29, bodyY: 100, bodySize: 23 });
  body += box("Compose TA instructions", 728, 859, 488, 200, "Compose instructions", [
    "Pedagogy · behavior · grounding",
    "Local tool registry + course context",
    "Shared-index / session filter binding",
  ], { icon: "tools", color: p.violet, size: 31, bodyY: 92, bodySize: 23, lineHeight: 35 });
  body += note(728, 1197, 488, 137, "PERSISTENCE ≠ PROCESS ISOLATION", [
    "Leases, checkpoints and retry;",
    "workers remain in the main backend.",
  ], { color: p.blue });
  body += box("Material worker", 1340, 328, 532, 174, "Material worker", [
    "Prepare originals + indexing copies",
    "Leased work; checkpoint per file",
  ], { icon: "layers", color: p.teal, size: 31, bodyY: 100 });
  body += box("Verify material readiness", 1340, 593, 532, 174, "Index + verify readiness", [
    "Run the shared Search indexer",
    "Confirm expected files are searchable",
  ], { icon: "search", color: p.teal, size: 30, bodyY: 100, bodySize: 23 });
  body += box("Create named teaching assistant", 1340, 859, 532, 200, "Create named TA", [
    "Foundry agent version + tool definition",
    "Save course identity and metadata",
    "TA can exist before indexing finishes",
  ], { icon: "agent", size: 33, bodyY: 92, bodySize: 23, lineHeight: 35 });
  body += box("Curriculum worker", 1340, 1150, 532, 186, "Curriculum worker", [
    "Syllabus → threshold-concept research",
    "Persist result and readiness status",
    "Generated curriculum is not a publication",
  ], { icon: "graph", color: p.amber, size: 31, bodyY: 85, bodySize: 23, lineHeight: 32 });
  body += box("Blob material storage", 2025, 328, 511, 174, "Blob Storage", [
    "Original documents + prepared copies",
    "Materials, extracted images and media",
  ], { serviceIcons: ["blob"], color: p.teal, size: 33, bodyY: 100, bodySize: 23 });
  body += box("Common material search index", 2025, 593, 511, 190, "Azure AI Search", [
    "Layout / OCR → chunks → embeddings",
    "Shared index, course/session filtering",
    "Grounding—not a learner-state ledger",
  ], { serviceIcons: ["search"], color: p.teal, size: 31, bodyY: 86, bodySize: 23, lineHeight: 33 });
  body += box("Named Foundry agent", 2025, 859, 511, 200, "Microsoft Foundry", [
    "Named agents + conversations",
    "Course instructions + tool contracts",
    "Local tools execute in the TA harness",
  ], { serviceIcons: ["foundry"], size: 31, bodyY: 91, bodySize: 23, lineHeight: 35 });
  body += box("Application and curriculum records", 2025, 1150, 511, 186, "Cosmos DB + Blob", [
    "Cosmos: course records + job state",
    "Blob: setup + curriculum artifacts",
    "Readiness exposed independently",
  ], { serviceIcons: ["cosmos", "blob"], color: p.amber, size: 31, bodyY: 85, bodySize: 23, lineHeight: 32 });
  body += edge("Course intent into confirmation", [[563, 405], [581, 405], [581, 1195], [563, 1195]], { color: "muted" });
  body += edge("Materials join explicit confirmation", [[563, 608], [581, 608]], { color: "muted", arrow: false });
  body += `<circle cx="581" cy="608" r="5" fill="${p.muted}"/>`;
  body += edge("Companion proposes unsaved edits", [[100, 854], [82, 854], [82, 430], [100, 430]], { color: "violet", dashed: true });
  body += edge("Explicit submit starts work", [[563, 1236], [638, 1236], [638, 415], [728, 415]], { color: "teal" });
  body += edge("Persisted request schedules materials", [[1216, 415], [1340, 415]], { color: "teal" });
  body += label(1278, 378, "jobs", { fill: p.teal });
  body += edge("Course creation prepares specification", [[972, 502], [972, 593]]);
  body += label(1074, 548, "create path");
  body += edge("Validated specification composes prompt", [[972, 767], [972, 859]], { color: "violet" });
  body += label(1089, 814, "validated", { fill: p.violet });
  body += edge("Instructions configure named TA", [[1216, 960], [1340, 960]]);
  body += label(1278, 924, "create");
  body += edge("Material worker persists files", [[1872, 415], [2025, 415]], { color: "teal" });
  body += label(1948, 378, "files", { fill: p.teal });
  body += edge("Material worker waits for index", [[1606, 502], [1606, 593]], { color: "teal" });
  body += edge("Blob material ingest", [[2280, 502], [2280, 593]], { color: "teal" });
  body += label(2394, 548, "ingest", { fill: p.teal });
  body += edge("Run and verify shared index", [[1872, 680], [2025, 680]], { color: "teal" });
  body += label(1948, 641, "run/check", { fill: p.teal });
  body += edge("Foundry version creation", [[1872, 960], [2025, 960]]);
  body += label(1948, 924, "version");
  body += edge("Named TA creation enqueues curriculum", [[1606, 1059], [1606, 1150]], { color: "amber" });
  body += label(1741, 1105, "enqueue", { fill: p.amber });
  body += edge("Curriculum result persistence", [[1872, 1243], [2025, 1243]], { color: "amber" });
  body += label(1948, 1205, "save", { fill: p.amber });
  body += rect(64, 1472, 2512, 126, { fill: "#13253A", stroke: p.border, radius: 19 });
  body += t(96, 1505, "THREE READINESS SIGNALS", { size: 23, weight: 700, fill: p.teal, extra: 'letter-spacing="1.3"' });
  body += t(96, 1559, "TA created", { size: 32, weight: 650 });
  body += t(700, 1559, "Materials searchable", { size: 32, weight: 650 });
  body += t(1530, 1559, "Curriculum ready", { size: 32, weight: 650 });
  body += t(1120, 1505, "Independent status, retries and completion—not a single synchronous gate.", { size: 24, fill: p.muted });
  body += d.footer(2640, 1700, "Solid: work / data flow · dashed: proposals · boundaries: ownership, not deployment units.");
  return d.shell(2640, 1700, "Course creation, materials and teaching-assistant readiness",
    "A dense dark workflow separating teacher inputs and unsaved Course Companion proposals from explicit submission, durable creation and material jobs, TA specification and instruction composition, shared Search indexing and curriculum workers in the main backend. Teaching assistant creation, indexed-material readiness and curriculum readiness are independent.", body);
}

function evidenceLifecycle() {
  const d = drawing("evidence-lifecycle", "paper");
  const { p, t, box, panel, edge, label } = d;
  let body = d.header("Evidence, not recollection.",
    "Opt-in learner graph memory separates model interpretation from reviewed curriculum and deterministic state policy.");
  body += panel(64, 246, 2512, 379, "A   OFFLINE PREPARATION  /  TEACHER-REVIEWED SHARED MAP", { fill: "#F0EEF7", color: "#A89ABA" });
  body += rect(2130, 264, 396, 44, { fill: "#E5DCEF", radius: 22 });
  body += t(2328, 286, "OPT-IN · OFF BY DEFAULT", { size: 23, weight: 650, fill: p.violet, anchor: "middle" });
  body += box("Curriculum graph draft", 108, 348, 456, 175, "Curriculum draft", [
    "Course · TC · misconception",
    "Inventory · problem · version",
  ], { icon: "graph", color: p.violet, size: 30, bodyY: 98, bodySize: 23 });
  body += box("Teacher reviews policies", 656, 348, 456, 175, "Teacher review", [
    "Policies + required mappings",
    "Clearing tasks + transfer probes",
  ], { icon: "person", color: p.violet, size: 30, bodyY: 98, bodySize: 23 });
  body += box("Immutable reviewed publication", 1204, 348, 508, 175, "Validate + publish", [
    "Types · bindings · prerequisite cycles",
    "Immutable reviewed graph version",
  ], { icon: "gate", color: p.violet, size: 30, bodyY: 98, bodySize: 23 });
  body += box("Separate course binding activation", 1820, 330, 704, 218, "Activate course binding", [
    "Separate course configuration—not automatic on publish",
    "Published binding + scoped administrator",
    "Process + worker flags + extraction model",
    "Course mode: off / shadow / authoritative",
  ], { icon: "tools", color: p.violet, stroke: p.violet, size: 32, bodyY: 86, bodySize: 23, lineHeight: 33 });
  body += edge("Draft goes to teacher review", [[564, 436], [656, 436]], { color: "violet" });
  body += edge("Reviewed graph validation and publication", [[1112, 436], [1204, 436]], { color: "violet" });
  body += edge("Published version is prerequisite not activation", [[1712, 436], [1820, 436]], { color: "violet", dashed: true });
  body += t(108, 582, "Published graph = Cosmos documents. A separate graph database is not required.", { size: 23, fill: p.muted });
  body += rect(64, 668, 1600, 90, { fill: "#FFFFFF", stroke: p.border, radius: 15 });
  body += t(92, 713, "PINNED SCOPE", { size: 23, weight: 700, fill: p.violet });
  body += t(313, 698, "tenant · institute · course · learner", { size: 24, weight: 600 });
  body += t(313, 731, "curriculum ID + version · learning epoch   /   shared map, separate learner facts", { size: 23, fill: p.muted });
  body += t(1810, 715, "Pinned graph + policy version", { size: 25, weight: 600, fill: p.violet });
  body += panel(64, 804, 2512, 700, "B   ONLINE SEQUENCE  /  LEARNER-SCOPED EVIDENCE", { fill: "#EDF4F4", color: "#8AAFAC" });
  body += box("Authorized learner event", 108, 894, 385, 194, "Learner event", [
    "Authorized interaction",
    "Stable event identity",
    "Assessment or dialogue",
  ], { size: 30, bodyY: 88, bodySize: 23, lineHeight: 33 });
  body += box("Durable event receipt", 583, 894, 390, 194, "Durable receipt", [
    "Event stored before work",
    "Ordered stream cursor",
    "Lease + retry checkpoint",
  ], { size: 30, bodyY: 88, bodySize: 23, lineHeight: 33 });
  body += box("Source evidence", 1063, 894, 390, 194, "Source evidence", [
    "Immutable evidence",
    "Provenance + quotations",
    "Server-frozen assessment",
  ], { size: 30, bodyY: 88, bodySize: 23, lineHeight: 33 });
  body += box("Model proposed observations", 1543, 894, 420, 194, "LLM observations", [
    "Propose interpretations",
    "Quote the source evidence",
    "No state or new-node writes",
  ], { size: 30, fill: "#F4F0F9", stroke: p.violet, bodyY: 88, bodySize: 23, lineHeight: 33 });
  body += box("Observation validation gate", 2053, 894, 475, 194, "Observation gate", [
    "Validate schema + graph IDs",
    "Scope / event must match",
    "Evidence + quote checks",
  ], { icon: "gate", color: p.teal, stroke: p.teal, size: 30, bodyY: 88, bodySize: 23, lineHeight: 33 });
  body += edge("Event capture durability", [[493, 991], [583, 991]], { color: "teal" });
  body += edge("Durable event becomes evidence", [[973, 991], [1063, 991]], { color: "teal" });
  body += edge("Evidence goes to observation extractor", [[1453, 991], [1543, 991]], { color: "violet" });
  body += edge("Model proposals require validation", [[1963, 991], [2053, 991]], { color: "violet" });
  body += box("Bounded teaching context", 108, 1255, 385, 208, "Bounded context", [
    "TA + teacher readers",
    "Freshness + pending count",
    "Authority depends on mode",
  ], { size: 30, bodyY: 95, bodySize: 23, lineHeight: 34 });
  body += box("Derived learner profile", 583, 1255, 390, 208, "LearningProfile", [
    "Derived from accepted state",
    "Next probe + concept gaps",
    "Not an independent authority",
  ], { size: 30, bodyY: 95, bodySize: 23, lineHeight: 34 });
  body += box("Atomic learner state publication", 1063, 1255, 633, 208, "Atomic snapshot + history", [
    "One transaction: snapshot + transitions",
    "Complete receipt + version + watermark",
    "Pending work is not a new snapshot",
  ], { icon: "database", color: p.teal, stroke: p.teal, size: 31, bodyY: 95, bodySize: 23, lineHeight: 34 });
  body += box("Deterministic reduction policy", 1836, 1255, 692, 208, "Deterministic state reducer", [
    "Misconception → concept → threshold",
    "Required clearing tasks + transfer requirements",
    "Model confidence does not decide state",
  ], { icon: "gate", color: p.teal, stroke: p.teal, fill: "#E0EFEB", size: 31, bodyY: 95, bodySize: 23, lineHeight: 34 });
  body += box("Rejected observation set", 2340, 1135, 188, 78, "Reject", ["no commit"], {
    color: p.red, stroke: p.red, fill: "#F9EDEE", size: 24, bodySize: 22,
    titleY: 24, bodyY: 55,
  });
  body += edge("Validated observations enter reduction", [[2155, 1088], [2155, 1255]], { color: "teal" });
  body += label(2220, 1174, "accept", { fill: p.teal, size: 24 });
  body += edge("Rejected observations cannot publish", [[2434, 1088], [2434, 1135]], { color: "red" });
  body += edge("Reducer commits complete snapshot", [[1836, 1360], [1696, 1360]], { color: "teal" });
  body += edge("Snapshot projects learner profile", [[1063, 1360], [973, 1360]], { color: "teal" });
  body += edge("Profile yields bounded teaching context", [[583, 1360], [493, 1360]], { color: "teal" });
  body += edge("Next probe informs another learner interaction", [[300, 1255], [300, 1088]], { color: "teal" });
  body += t(334, 1142, "Next probe", { size: 23, fill: p.teal });
  body += t(334, 1175, "(authoritative use)", { size: 22, fill: p.teal });
  body += t(1085, 1158, "Only a complete reduction is published.", { size: 26, weight: 600, fill: p.teal });
  body += t(1085, 1197, "Rejected / pending work leaves the last snapshot intact.", { size: 23, fill: p.muted });
  body += edge("Published graph pins validation", [[1458, 523], [1458, 645], [1770, 645], [1770, 782], [2290, 782], [2290, 894]], { color: "violet", dashed: true });
  body += edge("Published policy pins deterministic reduction", [[1770, 782], [2556, 782], [2556, 1224], [2380, 1224], [2380, 1255]], { color: "violet", dashed: true });
  body += `<circle cx="1770" cy="782" r="5" fill="${p.violet}"/>`;
  const modes = [
    [64, 816, "#EEF0F3", "off", "Legacy behavior; no course graph capture."],
    [902, 816, "#FBF0DF", "shadow", "Writes evidence/state; legacy retains authority."],
    [1740, 836, "#E8EEF9", "authoritative", "Graph context; legacy progress writes rejected."],
  ];
  for (const [x, w, fill, mode, description] of modes) {
    body += rect(x, 1542, w, 137, { fill, stroke: p.border, radius: 16 });
    body += t(x + 26, 1580, mode, { size: 30, weight: 700, fill: mode === "shadow" ? p.amber : p.blue });
    body += t(x + 26, 1634, description, { size: 24, fill: p.muted });
  }
  body += d.footer(2640, 1780, "LLM proposes observations. Policy decides state. MASTERED ≠ CROSSED. Dashed links: reviewed policy.");
  return d.shell(2640, 1780, "Offline curriculum preparation and the online evidence lifecycle",
    "An opt-in, disabled-by-default learner-memory research figure. Reviewed graph publication and course activation are distinct. Online events are durably receipted, transformed into evidence and validated quoted observations, deterministically reduced, atomically published with transition history, and projected into a LearningProfile. Shadow mode writes but does not replace legacy authority. Graph storage uses Cosmos documents.", body);
}

function platformTopology() {
  const d = drawing("platform-topology", "cloud");
  const { p, t, box, panel, edge, badge } = d;
  let body = d.header("Four services. One learning ecosystem.",
    "Independent frontend / API builds, explicit application ownership and source-backed managed-service dependencies.");
  body += panel(64, 257, 1470, 757, "MAIN PLATFORM  /  TWO INDEPENDENT BUILDS");
  body += panel(1670, 257, 906, 757, "ADMINISTRATION  /  TWO INDEPENDENT BUILDS");
  body += t(104, 331, "Learners + teachers", { size: 25, fill: p.muted });
  body += t(1710, 331, "Institution administrators", { size: 25, fill: p.muted });
  body += `<g data-fit="Main frontend service">
    ${rect(104, 362, 488, 450, { fill: "#FFFFFF", stroke: p.blue, width: 2.4, extra: "data-bounds=\"\"" })}
    ${glyph("web", 135, 391, 57, p.blue)}
    ${t(213, 417, "Main web app", { size: 35, weight: 650 })}
    ${t(135, 487, "React / Vite", { size: 27, weight: 600, fill: p.blue })}
    ${t(135, 538, "Learner chat + rich artifacts", { size: 25, fill: p.muted })}
    ${t(135, 581, "Teacher course builder", { size: 25, fill: p.muted })}
    ${t(135, 621, "Server-driven memory panels", { size: 25, fill: p.muted })}
  </g>`;
  body += box("Embedded teacher dashboard", 137, 658, 421, 119, "Teacher dashboard", [
    "Embedded in the main app",
  ], { fill: "#E9F2FF", stroke: "#ACC4E3", size: 28, bodyY: 83, bodySize: 24 });
  body += `<g data-fit="Main FastAPI service">
    ${rect(774, 362, 708, 628, { fill: "#FFFFFF", stroke: p.blue, width: 2.4, extra: "data-bounds=\"\"" })}
    ${glyph("api", 806, 391, 55, p.blue)}
    ${t(880, 417, "Main FastAPI", { size: 38, weight: 650 })}
    ${t(808, 476, "Sessions · course access · materials · teacher APIs", { size: 24, fill: p.muted })}
  </g>`;
  body += box("Canonical course TA harness", 810, 520, 634, 115, "Canonical TA harness", [
    "harness/runtime.py · named agent turns",
  ], { icon: "agent", size: 30, bodyY: 82, bodySize: 23, stroke: "#ABC5E4" });
  body += box("Local main API tools", 810, 668, 300, 122, "Local tools", [
    "Retrieval + artifacts",
  ], { size: 29, bodyY: 83, bodySize: 23, stroke: "#ABC5E4" });
  body += box("Main process material curriculum workers", 1137, 668, 309, 122, "Material + curriculum", [
    "Same-process workers",
  ], { size: 25, bodyY: 83, bodySize: 23, stroke: "#ABC5E4" });
  body += box("Opt-in graph module", 810, 830, 634, 120, "Opt-in graph-memory module", [
    "Service + worker · OFF by default · Cosmos / Blob",
  ], { icon: "graph", size: 28, bodyY: 84, bodySize: 23, stroke: p.violet, color: p.violet, dashed: true, fill: "#F5F0FB" });
  body += box("Separate admin web frontend", 1710, 362, 342, 282, "Admin web app", [
    "Separate React / Vite",
    "Institutions + affiliations",
    "Analytics + course access",
  ], { size: 31, bodyY: 113, bodySize: 23, lineHeight: 46, stroke: p.blue });
  body += box("Separate admin FastAPI", 2184, 362, 352, 441, "Admin FastAPI", [
    "Direct storage queries",
    "Research + analytics",
    "Optional evaluation",
    "Own API + adapters",
    "Not a main-API proxy",
  ], { size: 33, bodyY: 130, bodySize: 24, lineHeight: 54, stroke: p.blue });
  body += d.note(1710, 843, 826, 138, "ACCESS BOUNDARY STILL REQUIRED", [
    "Admin route protection is not equivalent to the main API.",
    "No universal end-to-end enforcement is implied.",
  ], { fill: "#FFF5E6", color: p.amber });
  body += edge("01 Main browser calls main API", [[592, 505], [774, 505]]);
  body += badge(683, 505, "1");
  body += t(683, 551, "app API", { size: 22, fill: p.muted, anchor: "middle" });
  body += edge("02 Main API returns streamed content", [[774, 744], [592, 744]]);
  body += badge(683, 744, "2");
  body += t(683, 703, "SSE / AG-UI", { size: 22, fill: p.muted, anchor: "middle" });
  body += edge("03 Admin frontend calls admin API", [[2052, 495], [2184, 495]]);
  body += badge(2118, 495, "3");
  body += edge("04 Admin UI directly calls main API for assignments", [[1710, 581], [1610, 581], [1610, 451], [1482, 451]], { color: "teal" });
  body += badge(1550, 451, "4", { color: p.teal });
  body += t(1600, 409, "assignments", { size: 22, fill: p.teal, anchor: "middle" });
  body += panel(64, 1210, 2512, 435, "MANAGED SERVICES", { titleSize: 24, fill: "#ECF4FE" });
  body += t(98, 1296, "Official Azure service icons", { size: 22, fill: p.muted });
  body += t(1650, 1296, "8 · Admin API accesses this layer directly", { size: 23, fill: p.amber });
  body += box("Microsoft Foundry service", 104, 1340, 550, 247, "Microsoft Foundry", [
    "Named agents + conversations",
    "TA turns and curriculum research",
    "Model / tool-call orchestration",
  ], { serviceIcons: ["foundry"], size: 32, bodyY: 114, bodySize: 24, lineHeight: 39, stroke: "#9CBCDF" });
  body += box("Azure AI Search service", 714, 1340, 550, 247, "Azure AI Search", [
    "Shared material index",
    "Session-filtered course retrieval",
    "Layout + embedding pipeline",
  ], { serviceIcons: ["search"], size: 32, bodyY: 114, bodySize: 24, lineHeight: 39, stroke: "#9CBCDF" });
  body += box("Cosmos application and graph documents", 1324, 1340, 550, 247, "Azure Cosmos DB", [
    "Users, access, chats and job records",
    "Opt-in graph + learner ledger",
    "Snapshots + transition history",
  ], { serviceIcons: ["cosmos"], size: 32, bodyY: 114, bodySize: 24, lineHeight: 39, stroke: "#9CBCDF" });
  body += box("Blob materials and artifacts", 1934, 1340, 602, 247, "Azure Blob Storage", [
    "Materials, artifacts, media and history",
    "Setup + curriculum artifacts",
    "Optional private learner evidence",
  ], { serviceIcons: ["blob"], size: 32, bodyY: 114, bodySize: 24, lineHeight: 39, stroke: "#9CBCDF" });
  body += edge("05 Main API Foundry dependency", [[850, 990], [850, 1090], [379, 1090], [379, 1340]]);
  body += badge(530, 1090, "5");
  body += edge("06 Local tools and workers Search dependency", [[1044, 990], [1044, 1125], [989, 1125], [989, 1340]], { color: "teal" });
  body += badge(989, 1179, "6", { color: p.teal });
  body += edge("07 Main application Cosmos persistence", [[1290, 990], [1290, 1090], [1575, 1090], [1575, 1340]]);
  body += badge(1575, 1165, "7");
  body += edge("07 Main application Blob persistence", [[1410, 990], [1410, 1050], [2210, 1050], [2210, 1340]]);
  body += badge(2210, 1165, "7");
  body += edge("08 Independent admin integrations target managed layer", [[2536, 550], [2602, 550], [2602, 1301], [2576, 1301]], { color: "amber" });
  body += badge(2602, 1074, "8", { color: p.amber, r: 20 });
  body += t(104, 1690, "Code ownership—not a hosting, network, deployment or security inventory.", { size: 24, weight: 600, fill: p.blue });
  const flows = [
    [104, 1743, "1", "Main UI → main API: learner, builder and teacher requests."],
    [104, 1786, "2", "Main API → main UI: streamed text, tools and artifacts."],
    [104, 1829, "3", "Admin UI → admin API: institution analytics / research."],
    [104, 1872, "4", "Admin UI → main API: placement and student assignments."],
    [1380, 1743, "5", "TA harness → Foundry: named agents and conversations."],
    [1380, 1786, "6", "Local tools + material workers → Search: retrieval / indexing."],
    [1380, 1829, "7", "Main API → Cosmos / Blob: application and opt-in memory."],
    [1380, 1872, "8", "Admin API → stores directly; Foundry / Search for research."],
  ];
  for (const [x, y, number, description] of flows) {
    body += badge(x + 19, y, number, { r: 17, color: number === "8" ? p.amber : p.blue });
    body += t(x + 55, y, description, { size: 23, fill: p.muted });
  }
  body += d.footer(2640, 1990, "Dashed enclosures: logical ownership. Dashed module: explicit opt-in. No hosting platform is inferred.");
  return d.shell(2640, 1990, "Four-service platform topology and managed service ownership",
    "The main React/Vite frontend, main FastAPI backend, separate admin React frontend and separate admin FastAPI backend are independent builds. Embedded teacher views belong to the main frontend and API. Admin UI also calls main API for assignments. The main backend owns TA harness, local tools, material/curriculum workers and opt-in learner memory. The admin API accesses storage directly and independently uses Foundry/Search; it is not a main-API proxy. No universal security enforcement is asserted.", body);
}

function conceptualLoop() {
  const d = drawing("conceptual-loop", "paper");
  const { p, t, box, edge } = d;
  let body = t(40, 100, "Learn from the learner. Then teach differently.", { size: 42, weight: 650 })
    + t(40, 151, "A feedback loop around understanding, not just the next answer.", { size: 25, fill: p.muted });
  const nodes = [
    ["Learner", "person", "Attempts, predicts", "and explains", p.blue],
    ["Evidence", "receipt", "Traceable responses", "and observations", p.teal],
    ["Learner model", "graph", "Concepts, gaps", "and trajectory", p.violet],
    ["Teaching strategy", "gate", "Choose a useful", "next learning move", p.violet],
    ["Course TA", "agent", "Guide, probe", "and give feedback", p.blue],
  ];
  for (const [i, [title, icon, first, second, color]] of nodes.entries()) {
    const x = 40 + i * 284;
    body += box(title, x, 188, 244, 188, title, [first, second], {
      size: 24, bodySize: 23, titleY: 84, bodyY: 124, lineHeight: 32, stroke: color,
    });
    body += glyph(icon, x + 25, 207, 36, color)
      + t(x + 215, 225, `0${i + 1}`, { size: 22, weight: 650, fill: color, anchor: "end" });
    if (i < nodes.length - 1) body += edge(`${title} to ${nodes[i + 1][0]}`, [[x + 244, 282], [x + 284, 282]], { color: "teal" });
  }
  body += box("Reviewed course map", 608, 424, 812, 96, "Teacher-reviewed course map", [
    "Threshold concepts, misconceptions, materials and approved probes",
  ], { icon: "book", size: 28, titleY: 30, bodyY: 69, bodySize: 23, dashed: true, stroke: p.violet });
  body += edge("Course map informs strategy", [[1014, 424], [1014, 376]], { color: "violet", dashed: true });
  body += edge("Course map grounds teaching", [[1298, 424], [1298, 376]], { color: "violet", dashed: true });
  body += edge("Teaching returns to the learner", [[1420, 282], [1440, 282], [1440, 576], [162, 576], [162, 376]], { color: "teal" });
  body += t(755, 550, "Another attempt. New evidence. A different next move.", { size: 24, weight: 600, fill: p.teal, anchor: "middle" });
  body += t(40, 622, "Conceptual loop. Graph memory is opt-in; validated evidence and policy govern committed state.", { size: 23, fill: p.muted });
  return d.shell(1460, 652, "Agentic Shiksha: the learner feedback loop",
    "Six components: Learner to Evidence to Learner Model to Teaching Strategy to the course Teaching Assistant and back to Learner. A teacher-reviewed course map grounds strategy and teaching. The Course TA is the learner-facing named agent; the other components are responsibilities, not extra agents or services.", body);
}

function learnerMemory() {
  const d = drawing("learner-memory", "paper");
  const { p, t, box, edge } = d;
  let body = t(40, 100, "Remember the change, not just the chat.", { size: 42, weight: 650 })
    + t(40, 151, "Concepts + misconceptions + evidence + a learning trajectory.", { size: 25, fill: p.muted });
  body += box("Concept TC-paths", 328, 200, 568, 88, "Concept / TC-paths", ["Simple paths"], {
    size: 28, titleY: 29, bodyY: 64, bodySize: 25, stroke: p.blue,
  });
  body += box("Misconception M-repeat", 328, 355, 568, 144, "Misconception / M-repeat", [
    "A simple path may repeat a vertex",
    "if no edge repeats.",
  ], { size: 28, bodySize: 24, titleY: 28, bodyY: 71, lineHeight: 36, stroke: p.violet });
  body += box("Earlier supporting evidence", 48, 538, 402, 140, "Earlier support", [
    "Two independent explanations",
    "SUPPORTS M-repeat",
  ], { size: 28, bodySize: 23, titleY: 35, bodyY: 79, lineHeight: 34, stroke: p.teal });
  body += box("Later counter-evidence", 494, 538, 402, 140, "Later counter-evidence", [
    "E-clear-A: reasoned response",
    "CONTRADICTS M-repeat",
  ], { size: 27, bodySize: 23, titleY: 35, bodyY: 79, lineHeight: 34, stroke: p.teal });
  body += edge("Earlier evidence supports misconception", [[249, 538], [249, 518], [444, 518], [444, 499]], { color: "teal" });
  body += edge("Later evidence contradicts misconception", [[695, 538], [695, 499]], { color: "teal" });
  body += edge("Misconception belongs to concept", [[612, 355], [612, 288]], { color: "violet" });
  body += box("Committed learner state", 966, 200, 446, 208, "Committed state", [
    "RESOLVING / IMPROVING",
    "Threshold: CANDIDATE",
    "Not CROSSED",
  ], { icon: "gate", size: 29, bodySize: 24, titleY: 39, bodyY: 92, lineHeight: 37, stroke: p.violet });
  body += edge("Policy reduces evidence into state", [[896, 410], [930, 410], [930, 293], [966, 293]], { color: "violet" });
  body += box("Next evidence gap", 966, 456, 446, 108, "Next evidence gap", [
    "P-path-B: unused task family",
  ], { size: 28, bodySize: 24, titleY: 32, bodyY: 77, dashed: true, stroke: p.teal });
  body += edge("Committed state informs next probe", [[1189, 408], [1189, 456]], { color: "teal", dashed: true });
  body += t(988, 606, "One later clearing response", { size: 24, fill: p.muted })
    + t(988, 640, "is not yet sufficient clearance.", { size: 24, fill: p.muted });
  body += rect(48, 714, 1364, 128, { fill: p.panel, stroke: p.border, radius: 18 })
    + t(76, 748, "LEARNING TRAJECTORY", { size: 22, weight: 700, fill: p.blue })
    + t(76, 796, "Earlier support", { size: 26, weight: 600 })
    + t(460, 796, "Later counter-evidence", { size: 26, weight: 600 })
    + t(990, 796, "Next: independent probe", { size: 26, weight: 600 });
  body += edge("Learning trajectory: retained history", [[310, 796], [434, 796]], { color: "muted" });
  body += edge("Learning trajectory: proposed probe", [[778, 796], [960, 796]], { color: "teal", dashed: true });
  body += t(48, 878, "Synthetic, source-aligned example. Evidence can change state in either direction; this is not a fixed ladder.", { size: 23, fill: p.muted });
  return d.shell(1460, 910, "A learner-memory graph with inspectable evidence and trajectory",
    "Synthetic simple-path example. Concept TC-paths has misconception M-repeat, the belief that a simple path may repeat a vertex if no edge repeats. Two earlier independent supporting records and one later reasoned counter-evidence record produce RESOLVING with IMPROVING trend under the example's stated assumptions. Threshold state is CANDIDATE, not CROSSED. P-path-B is a proposed next independent diagnostic, not completed evidence.", body);
}

function seeItThink() {
  const d = drawing("see-it-think", "paper");
  const { p, t, box, edge } = d;
  let body = t(40, 100, "A state you can inspect. A next move you can question.", { size: 40, weight: 650 })
    + t(40, 151, "Observable evidence and decisions, not hidden chain-of-thought.", { size: 25, fill: p.muted });
  body += `<g data-node="Observable learner evidence" data-fit="Observable learner evidence">
    ${rect(48, 192, 606, 360, { fill: "#101D35", stroke: p.blue, radius: 18, extra: 'data-bounds=""' })}
    ${text(78, 230, "01 / WHAT THE LEARNER SAID", { size: 23, weight: 700, fill: "#BED1F2" })}
    ${text(78, 287, "Earlier: two independent source records", { size: 23, fill: "#B5C5DB" })}
    ${text(78, 328, '"A simple path can revisit a vertex', { size: 27, fill: "#F0F5FF" })}
    ${text(78, 366, 'if no edge repeats."', { size: 27, fill: "#F0F5FF" })}
    ${text(78, 422, "Later: E-clear-A / reasoned counter-evidence", { size: 23, fill: "#93DBCC" })}
    ${text(78, 466, '"A simple path cannot repeat a vertex;', { size: 27, fill: "#F0F5FF" })}
    ${text(78, 504, 'a walk can."', { size: 27, fill: "#F0F5FF" })}
  </g>`;
  body += box("Misconception interpretation", 698, 192, 714, 104, "Misconception / M-repeat", [
    "A simple path may repeat a vertex.",
  ], { size: 29, bodySize: 26, titleY: 31, bodyY: 74, stroke: p.violet });
  body += box("Extraction confidence", 698, 320, 337, 136, "Extraction confidence", [
    "0.95 / uncalibrated",
    "Not mastery probability",
  ], { size: 24, bodySize: 23, titleY: 32, bodyY: 78, lineHeight: 33, stroke: p.violet });
  body += box("State and trend", 1059, 320, 353, 136, "State / trend", [
    "RESOLVING",
    "IMPROVING",
  ], { size: 28, bodySize: 25, titleY: 32, bodyY: 78, lineHeight: 33, stroke: p.teal });
  body += t(720, 496, "Threshold: CANDIDATE, not CROSSED.", { size: 24, fill: p.muted });
  body += `<g data-node="Proposed teaching strategy" data-fit="Proposed teaching strategy">
    ${rect(48, 590, 1364, 154, { fill: "#EAF4F1", stroke: p.teal, radius: 18, extra: 'data-bounds=""' })}
    ${t(78, 624, "02 / PROPOSED NEXT TEACHING STRATEGY", { size: 23, weight: 700, fill: p.teal })}
    ${t(78, 671, "Predict. Explain. Probe a changed context.", { size: 34, weight: 650 })}
    ${t(78, 718, "P-path-B / unused diagnostic family / INDEPENDENT_DIAGNOSTIC_REQUIRED", { size: 24, fill: p.teal })}
  </g>`;
  body += edge("Observed evidence informs next move", [[354, 552], [354, 590]], { color: "teal" });
  body += edge("Committed state informs next move", [[1300, 456], [1300, 590]], { color: "teal" });
  body += t(48, 788, "Illustration, not the shipped UI. The profile recommends a probe ID; the teaching wording is illustrative.", { size: 23, fill: p.muted });
  return d.shell(1460, 824, "See it think: an observable learner decision record",
    "Synthetic observable record, not hidden chain-of-thought or a screenshot. Earlier learner reasoning supports misconception M-repeat. Later evidence E-clear-A contradicts it with extraction confidence 0.95, explicitly uncalibrated and not a mastery probability. Committed misconception state is RESOLVING with IMPROVING trend; the threshold is CANDIDATE, not CROSSED. A proposed teaching move asks for prediction and explanation in a changed context, followed by diagnostic P-path-B. The actual profile supplies the probe ID and reason code; teaching wording is illustrative.", body);
}

function ekalaivaPillars() {
  const d = drawing("ekalaiva-pillars", "paper");
  const { p, t, box } = d;
  let body = t(40, 100, "Six lenses. One learning philosophy.", { size: 42, weight: 650 })
    + t(40, 151, "A visual reading guide grounded in the active teaching prompts.", { size: 25, fill: p.muted });
  const pillars = [
    ["Threshold concepts", "gate", "Change the mental model,", "not just the topic.", p.blue],
    ["Concept inventories", "receipt", "Probe the misconception,", "not only the answer.", p.teal],
    ["Contextualization", "person", "Start in the learner's world.", "Recover the principle.", p.violet],
    ["Ludic design", "play", "Predict, explore, and play.", "No points required.", p.violet],
    ["Contextual challenges", "tools", "Solve, vary, and explain", "a meaningful problem.", p.blue],
    ["Grand challenges", "graph", "Connect ideas across domains.", "Keep the learner in charge.", p.teal],
  ];
  for (const [i, [title, icon, first, second, color]] of pillars.entries()) {
    const x = 48 + (i % 3) * 464;
    const y = 196 + Math.floor(i / 3) * 224;
    body += box(title, x, y, 436, 196, title, [first, second], {
      size: 29, bodySize: 24, titleY: 82, bodyY: 127, lineHeight: 34, stroke: color,
    });
    body += glyph(icon, x + 25, y + 20, 36, color)
      + t(x + 405, y + 40, `0${i + 1}`, { size: 22, weight: 650, fill: color, anchor: "end" });
  }
  body += t(48, 666, "Six explanatory lenses, not a new constitution. The active constitution has five commitments.", { size: 23, fill: p.muted });
  return d.shell(1460, 706, "Six source-grounded EKALAIVA teaching ideas",
    "An explanatory six-card grouping of pedagogical ideas, not a canonical six-rule constitution: threshold concepts, concept inventories, contextualization, ludic design, contextual challenges, and grand challenges. Each card names an intention from the teaching prompts, not measured learning outcomes or a shipped credentialing feature.", body);
}

const B = "Agentic Shiksha Platform/Backend/";
const F = "Agentic Shiksha Platform/Frontend/";
export const assets = [
  {
    id: "shiksha-research-banner", title: "Agentic Shiksha research identity", kind: "banner",
    width: 2400, height: 600, theme: "light",
    summary: "The Agentic Shiksha logo and single-line knowledge-transformation message, framed by subtle teal and blue background lines.",
    note: "The supplied logo is preserved unchanged and embedded in the SVG. The tagline expresses teaching intent, not a demonstrated learning benefit.",
    sources: [["Project logo", "assets/images/branding/agentic-shiksha-logo.png"], ["Project positioning", "README.md"], ["Pedagogical intent", "docs/pedagogy/ekalaiva.md"]],
    draw: () => banner(false),
  },
  {
    id: "shiksha-research-banner-dark", title: "Research identity / dark", kind: "banner",
    width: 2400, height: 600, theme: "dark",
    summary: "A deep-navy companion with subtle edge patterns and the original logo on a light surface for contrast.",
    note: "Content and layout match the primary banner. The logo is not recolored; a light backing preserves the dark wordmark on dark pages. Local Segoe UI / Arial keeps the typography independent of external font services.",
    sources: [["Project logo", "assets/images/branding/agentic-shiksha-logo.png"], ["Project positioning", "README.md"], ["Pedagogical intent", "docs/pedagogy/ekalaiva.md"]],
    draw: () => banner(true),
  },
  {
    id: "01-course-creation", title: "01 / Course creation and readiness", kind: "figure",
    width: 2640, height: 1700, theme: "dark",
    summary: "Teacher intent, draft-only assistance, explicit submission, prompt construction, indexing and independently progressing curriculum work.",
    note: "Both workers run in the main backend. The canonical material path uses a shared index with session/course filtering—not a newly provisioned index per course. Generated curriculum artifacts do not by themselves publish or activate graph memory.",
    sources: [
      ["Architecture source snapshot", "docs/architecture.md"],
      ["Draft-only Course Companion", `${F}src/features/create/FormAssistant.tsx`],
      ["Creation + curriculum jobs", `${B}utils/course_creation.py`],
      ["Material worker checkpoints", `${B}utils/material_jobs.py`],
      ["Router / worker lifetime", `${B}backend/routers/course_materials.py`],
      ["Common index + skillset", `${B}azure_services/tools/search/course_index_manager.py`],
      ["Scoped course retrieval", `${B}utils/course_materials.py`],
    ],
    draw: courseCreation,
  },
  {
    id: "02-evidence-lifecycle", title: "02 / Evidence lifecycle", kind: "figure",
    width: 2640, height: 1780, theme: "paper",
    summary: "A research-paper view of offline review and online evidence processing, including policy gates, atomic publication and feedback.",
    note: "Process and worker flags default to false. off, shadow and authoritative are course modes; shadow still writes evidence and state. The reviewed graph lives in Cosmos documents. LearningProfile is derived, not another authority. MASTERED and CROSSED are different states.",
    sources: [
      ["Memory overview and opt-in contract", "docs/memory/overview.md"],
      ["Disabled-by-default settings", `${B}learner_memory/settings.py`],
      ["Graph validation / publication", `${B}learner_memory/curriculum.py`],
      ["Durable event receipt", `${B}learner_memory/events.py`],
      ["Observation validation", `${B}learner_memory/observations.py`],
      ["Reducer", `${B}learner_memory/state.py`],
      ["Atomic processor publication", `${B}learner_memory/processor.py`],
      ["Derived LearningProfile", `${B}learner_memory/profile.py`],
      ["Scoped activation routes", `${B}backend/routers/learner_memory.py`],
    ],
    draw: evidenceLifecycle,
  },
  {
    id: "03-platform-topology", title: "03 / Platform topology", kind: "figure",
    width: 2640, height: 1990, theme: "cloud",
    summary: "Four independent builds, embedded teacher ownership, direct admin storage access and numbered managed-service flows.",
    note: "These are logical source boundaries, not live infrastructure. Official Microsoft service icons identify the existing managed-service dependencies only. The admin API does not have equivalent route-level protection; an independently authenticated, restricted boundary is still required. Workers are not separate microservices.",
    sources: [
      ["Four-service ownership and limits", "docs/architecture.md"],
      ["Main TA runtime", `${B}harness/runtime.py`],
      ["Embedded teacher API", `${B}teacher_dashboard/routes.py`],
      ["Material / curriculum worker lifetime", `${B}backend/routers/course_materials.py`],
      ["Admin frontend API ownership", "Admin-Dashboard/frontend/src/lib/config.ts"],
      ["Direct admin Cosmos queries", "Admin-Dashboard/backend/cosmos_queries.py"],
      ["Admin Blob research persistence", "Admin-Dashboard/backend/research_storage.py"],
      ["Admin Foundry / Search evaluation", "Admin-Dashboard/backend/groundedness_evaluator.py"],
    ],
    draw: platformTopology,
  },
  {
    id: "04-conceptual-loop", title: "04 / The learner feedback loop", kind: "figure",
    width: 1460, height: 652, theme: "paper",
    summary: "Six conceptual components make the research idea visible: evidence changes the learner model, which informs the next teaching move.",
    note: "A research figure, not a deployment diagram. The graph-memory path is opt-in and off by default. Model confidence is not mastery; validated observations and deterministic policy govern committed graph state.",
    sources: [
      ["Conceptual architecture and component links", "docs/architecture.md"],
      ["Pedagogical intent", "docs/pedagogy/ekalaiva.md"],
      ["Learner model and authority", "docs/memory/overview.md"],
      ["Course Teaching Assistant runtime", "docs/agents/course-ta.md"],
    ],
    draw: conceptualLoop,
  },
  {
    id: "05-learner-memory", title: "05 / Learner memory", kind: "figure",
    width: 1460, height: 910, theme: "paper",
    summary: "A synthetic graph connects a concept, a misconception, source evidence, committed state, and a learning trajectory.",
    note: "The simple-path example follows the assumptions in the linked guide: two earlier independent supports, one later qualifying counter-evidence record, and an unused second diagnostic. It is not a learner record, screenshot, calibrated diagnosis, or fixed progression ladder. Graph memory is off by default.",
    sources: [
      ["Synthetic example and explicit assumptions", "docs/memory/see-it-think.md"],
      ["Memory boundaries", "docs/memory/overview.md"],
      ["Misconception, threshold, and trend meanings", "docs/memory/misconception-state.md"],
      ["Deterministic state reducer", `${B}learner_memory/state.py`],
    ],
    draw: learnerMemory,
  },
  {
    id: "06-see-it-think", title: "06 / See it think", kind: "figure",
    width: 1460, height: 824, theme: "paper",
    summary: "A synthetic decision record makes learner observations, misconception, extraction confidence, evidence, state/trend, and a proposed next move inspectable.",
    note: "Not a screenshot or private model reasoning. The Graph Memory UI does not implement this compact layout or its confidence badge. Confidence 0.95 is an invented, uncalibrated interpretation value, not a mastery probability. The profile recommends a probe ID and reason code; the teaching wording is illustrative.",
    sources: [
      ["Observable record and current UI boundaries", "docs/memory/see-it-think.md"],
      ["Evidence and confidence contract", "docs/memory/evidence-model.md"],
      ["Profile and next-probe projection", `${B}learner_memory/profile.py`],
      ["Current Graph Memory UI", `${F}src/features/memory/GraphMemoryPanel.tsx`],
    ],
    draw: seeItThink,
  },
  {
    id: "07-ekalaiva-pillars", title: "07 / EKALAIVA field guide", kind: "figure",
    width: 1460, height: 706, theme: "paper",
    summary: "Six compact, original cards explain threshold concepts, concept inventories, contextualization, ludic design, contextual challenges, and grand challenges.",
    note: "This is a source-grounded explanatory grouping, not a claim that the prompts define a canonical six-pillar constitution. The active constitution has five commitments. The cards communicate pedagogical intent, not validated efficacy or complete portfolio/credentialing support.",
    sources: [
      ["Six teaching ideas and source mapping", "docs/pedagogy/ekalaiva.md"],
      ["Pedagogy guide", "docs/pedagogy/README.md"],
    ],
    draw: ekalaivaPillars,
  },
];

export function contactSheet(rendered) {
  const bannerHeight = Math.round(1210 * assets[0].height / assets[0].width);
  const figuresTop = 170 + bannerHeight + 156;
  const topologyTop = figuresTop + 970;
  const slots = [
    [64, 170, 1210, bannerHeight, assets[0]],
    [1366, 170, 1210, bannerHeight, assets[1]],
    [64, figuresTop, 1210, 779, assets[2]],
    [1366, figuresTop, 1210, 816, assets[3]],
    [64, topologyTop, 1210, 912, assets[4]],
  ];
  let nextY = topologyTop + 1160;
  for (let i = 5; i < assets.length; i += 2) {
    const row = assets.slice(i, i + 2);
    const heights = row.map((asset) => Math.round(1210 * asset.height / asset.width));
    row.forEach((asset, column) => slots.push([64 + column * 1302, nextY, 1210, heights[column], asset]));
    nextY += Math.max(...heights) + 130;
  }
  const height = assets.length > 5 ? nextY : topologyTop + 1050;
  let content = rect(0, 0, 2640, height, { fill: "#EAF0F8", radius: 0 });
  content += text(64, 71, "Research visual system", { size: 46, weight: 650 });
  for (const [x, y, w, h, asset] of slots) {
    const inner = rendered.get(asset.id).replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
    content += text(x, y - 38, asset.title, { size: 27, weight: 650 });
    content += `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 ${asset.width} ${asset.height}">${inner}</svg>`;
  }
  content += text(1366, topologyTop + 64, "SOURCE-BACKED, NOT INVENTED INFRASTRUCTURE", { size: 29, weight: 700, fill: "#345EB4" });
  const notes = [
    "Four independent application services.",
    "Teacher dashboard embedded in the main web app.",
    "Course Companion proposes; teachers submit.",
    "Materials and curriculum workers stay in the main backend.",
    "Named Foundry agents, local tools and course retrieval.",
    "Graph memory: opt-in, OFF by default.",
    "Reviewed curriculum is stored as Cosmos documents.",
    "LLM proposes observations. Policy decides state.",
    "Publication and activation remain distinct operations.",
    "Official Azure icons; other diagram glyphs are original.",
    "No live user data or cloud calls during generation.",
  ];
  notes.forEach((line, i) => {
    content += `<circle cx="1380" cy="${topologyTop + 140 + i * 62}" r="5" fill="#345EB4"/>`;
    content += text(1405, topologyTop + 140 + i * 62, line, { size: 27, fill: "#526176" });
  });
  content += text(1366, topologyTop + 875, "Open index.html for full-size artwork, sources and downloads.", { size: 28, weight: 600 });
  content += text(64, topologyTop + 1004, "Original editable SVGs · high-resolution PNGs · local reproducible generation", { size: 25, fill: "#526176" });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="2640" height="${height}" viewBox="0 0 2640 ${height}" role="img" aria-labelledby="overview-title overview-desc">
    <title id="overview-title">Agentic Shiksha research visual system contact sheet</title>
    <desc id="overview-desc">Two original identity banners and ${assets.length - 2} research figures. Conceptual and synthetic illustrations are labeled separately from source architecture. Open individual images to inspect labels.</desc>
    <g font-family="${FONT}">${content}</g>
  </svg>`;
}
