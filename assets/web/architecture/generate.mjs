import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { azureServiceIcon, azureServiceIcons } from "../azure-icons/diagram-icons.mjs";

const output = dirname(fileURLToPath(import.meta.url));
const root = resolve(output, "..", "..", "..");
const imageOutput = join(root, "assets", "images", "architecture");
const outputPath = (name) => join(/\.(?:svg|png|pdf)$/.test(name) || name === "README.md" ? imageOutput : output, name);
const raster = process.argv.includes("--png");
assert(process.argv.slice(2).every((arg) => arg === "--png"), "Usage: node generate.mjs [--png]");

const W = 1800;
const H = 1200;
// Sampled from images/branding/agentic-shiksha-logo.png; white is the canvas.
const theme = {
  blue: "#033CF2",
  azure: "#019BFA",
  cyan: "#22F1EC",
  teal: "#02B3C3",
  support: "#CEE7FD",
  pale: "#F0F6FB",
  ink: "#07183A",
  muted: "#07183A",
  border: "#07183A",
  white: "#FFFFFF",
};
const brandSwatches = [
  ["Navy", theme.ink], ["Royal blue", theme.blue], ["Azure", theme.azure],
  ["Cyan", theme.cyan], ["Teal", theme.teal], ["Light blue", theme.support],
];
const snapshot = "30 SEP 2026";
const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
})[char]);

function text(x, y, value, { size = 24, weight = 400, fill = theme.ink, anchor = "middle", extra = "" } = {}) {
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" dominant-baseline="central" ${extra}>${esc(value)}</text>`;
}

function section(x, y, w, h, label, content) {
  const labelWidth = label.length * 18.3 + 40;
  return `<g data-section="${esc(label)}">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="none" stroke="${theme.border}" stroke-width="1.3" stroke-dasharray="7 9"/>
    <rect x="${x + (w - labelWidth) / 2}" y="${y - 22}" width="${labelWidth}" height="44" fill="white"/>
    ${text(x + w / 2, y, label, { size: 29, weight: 700 })}
    ${content}
  </g>`;
}

function card(x, y, w, h, title, subtitle = [], { tone = "support", size = 32, subSize = 21, service = null } = {}) {
  const titles = Array.isArray(title) ? title : [title];
  const subtitles = Array.isArray(subtitle) ? subtitle : [subtitle];
  const titleHeight = size * 1.15;
  const subHeight = subSize * 1.3;
  const gap = subtitles.length ? 11 : 0;
  const total = titles.length * titleHeight + gap + subtitles.length * subHeight;
  const top = y + (h - total) / 2;
  const color = tone === "blue" ? theme.white : theme.ink;
  const secondary = tone === "blue" ? theme.white : theme.muted;
  const lines = [
    ...titles.map((value, i) => ({ value, y: top + titleHeight * (i + 0.5), size, fill: color })),
    ...subtitles.map((value, i) => ({ value, y: top + titles.length * titleHeight + gap + subHeight * (i + 0.5), size: subSize, fill: secondary })),
  ];
  const product = typeof service === "string" ? { service } : service;
  const productLine = product?.subtitle === undefined ? 0 : titles.length + product.subtitle;
  assert(!product || (Number.isInteger(productLine) && lines[productLine]), "Service must have a visible product label");
  return `<g data-card="${esc(titles.join(" "))}">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="13" fill="${theme[tone]}"/>
    ${lines.map((line, i) => {
      const isProduct = product && i === productLine;
      const iconSize = isProduct ? Math.min(40, line.size + 7) : 0;
      const icon = isProduct
        ? `<rect data-service-icon-background="" x="${x + 12}" y="${line.y - iconSize / 2 - 4}" width="${iconSize + 8}" height="${iconSize + 8}" rx="7" fill="white"/>${azureServiceIcon(product.service, x + 16, line.y - iconSize / 2, iconSize)}`
        : "";
      return icon + text(x + w / 2 + (isProduct ? (iconSize + 12) / 2 : 0), line.y, line.value, {
        size: line.size,
        fill: line.fill,
        extra: isProduct ? `data-service-label="${esc(product.service)}"` : "",
      });
    }).join("")}
  </g>`;
}

function rail(x, y, w, h, label, labels) {
  const inset = 26;
  const gap = 22;
  const itemHeight = (h - 2 * inset - gap * (labels.length - 1)) / labels.length;
  return `<g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="none" stroke="${theme.border}" stroke-width="1.3" stroke-dasharray="7 9"/>
    ${text(0, 0, label, { size: 27, weight: 700, extra: `transform="translate(${x - 30} ${y + h / 2}) rotate(-90)"` })}
    ${labels.map((labelText, i) => {
      const cy = y + inset + i * (itemHeight + gap);
      return `<g data-card="${esc(labelText)}">
        <rect x="${x + inset}" y="${cy}" width="${w - 2 * inset}" height="${itemHeight}" rx="12" fill="${theme.pale}"/>
        ${text(0, 0, labelText, { size: 31, extra: `transform="translate(${x + w / 2} ${cy + itemHeight / 2}) rotate(-90)"` })}
      </g>`;
    }).join("")}
  </g>`;
}

function arrow(id, points, { blue = false, both = false, dash = false } = {}) {
  return `<polyline points="${points.map((p) => p.join(",")).join(" ")}" fill="none" stroke="${blue ? theme.blue : theme.border}" stroke-width="2.3" stroke-linejoin="round" ${dash ? 'stroke-dasharray="6 7"' : ""} marker-end="url(#${id}-${blue ? "blue" : "ink"})" ${both ? `marker-start="url(#${id}-${blue ? "blue" : "ink"})"` : ""}/>`;
}

function label(x, y, value, { size = 19, width = value.length * size * 0.55 + 22 } = {}) {
  return `<g><rect x="${x - width / 2}" y="${y - size}" width="${width}" height="${size * 2}" fill="white"/>${text(x, y, value, { size, fill: theme.muted })}</g>`;
}

function frame(diagram, body) {
  const id = diagram.id;
  const headWidth = 80 + diagram.heading.length * 26;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${id}-title ${id}-desc">
  <title id="${id}-title">Agentic Shiksha: ${esc(diagram.name)}</title>
  <desc id="${id}-desc">${esc(`${diagram.description} ${diagram.note} Source snapshot: ${snapshot}. Not a live deployment inventory.`)}</desc>
  <defs>
    ${["ink", "blue"].map((color) => `<marker id="${id}-${color}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="${theme[color === "ink" ? "border" : "blue"]}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker>`).join("")}
  </defs>
  <g font-family="Arial, Helvetica, sans-serif">
    <rect width="${W}" height="${H}" fill="white"/>
    <rect x="60" y="104" width="1680" height="1014" rx="12" fill="none" stroke="${theme.border}" stroke-width="1.4" stroke-dasharray="7 10"/>
    <rect data-heading-mask="" x="96" y="57" width="${headWidth}" height="89" fill="white"/>
    ${text(112, 101, diagram.heading, { size: 41, weight: 700, anchor: "start", extra: 'data-heading=""' })}
    ${text(112, 179, diagram.subtitle, { size: 23, fill: theme.muted, anchor: "start" })}
    ${body}
    ${text(112, 1079, diagram.caption, { size: 20, fill: theme.muted, anchor: "start" })}
  </g>
</svg>`;
}

const managedServiceNodes = [
  ["Microsoft Foundry", "foundry", "Microsoft Foundry"],
  ["Azure AI Search", "search", "Azure AI Search"],
  ["Cosmos DB", "cosmos", "Cosmos DB"],
  ["Blob Storage", "blob", "Blob Storage"],
];

const diagrams = [
  {
    id: "01-shiksha-ecosystem",
    number: "01",
    name: "Platform ecosystem",
    heading: "PLATFORM ECOSYSTEM",
    subtitle: "A course-grounded teaching and learning platform, from experience to infrastructure.",
    description: "Layered view of learner, teacher and administrator experiences, agent capabilities, application runtime and managed data services.",
    note: "Layers group capabilities; they are not individual microservices. The teacher dashboard is embedded in the main web app. Graph memory is an optional path, detailed in figure 05.",
    caption: "Capability layers, not deployment units. See 02 for service ownership and 05 for opt-in learner memory.",
    serviceNodes: managedServiceNodes,
    sources: [
      ["Architecture guide", "docs/architecture.md"],
      ["Main UI routes", "Agentic Shiksha Platform/Frontend/src/router.tsx"],
      ["TA harness", "Agentic Shiksha Platform/Backend/harness/runtime.py"],
    ],
    draw() {
      return rail(142, 246, 200, 790, "PLATFORM SUPPORT", ["Identity", "Analytics", "Configuration"])
        + section(400, 246, 1280, 190, "EXPERIENCES",
          card(424, 279, 293, 130, "Learner chat", ["Questions + artifacts"], { tone: "blue", size: 31 })
          + card(737, 279, 293, 130, "Course builder", ["Teacher workspace"], { tone: "blue", size: 31 })
          + card(1050, 279, 293, 130, ["Teacher", "dashboard"], [], { size: 30 })
          + card(1363, 279, 293, 130, ["Admin", "dashboard"], [], { size: 30 }))
        + section(400, 500, 1280, 330, "AGENTS & APPLICATION",
          card(424, 533, 396, 115, "Course Companion", ["Teacher setup assistance"], { tone: "blue", size: 31 })
          + card(842, 533, 396, 115, "Course TA agents", ["Curriculum-grounded teaching"], { tone: "blue", size: 31 })
          + card(1260, 533, 396, 115, "Teacher insights", ["Activity + learning progress"], { size: 31 })
          + card(424, 667, 1232, 64, "TA harness  /  context, tools and turn lifecycle", [], { size: 31 })
          + card(424, 750, 1232, 56, "FastAPI  /  sessions, courses, artifacts and progress", [], { size: 29 }))
        + section(400, 899, 1280, 137, "MANAGED SERVICES & DATA",
          card(424, 926, 293, 86, "Microsoft Foundry", ["Named agents"], { size: 25, subSize: 20, service: "foundry" })
          + card(737, 926, 293, 86, "Azure AI Search", ["Course grounding"], { size: 27, subSize: 20, service: "search" })
          + card(1050, 926, 293, 86, "Cosmos DB", ["Application records"], { size: 28, subSize: 20, service: "cosmos" })
          + card(1363, 926, 293, 86, "Blob Storage", ["Materials + media"], { size: 28, subSize: 20, service: "blob" }));
    },
  },
  {
    id: "02-shiksha-service-architecture",
    number: "02",
    name: "Service architecture",
    heading: "SERVICE ARCHITECTURE",
    subtitle: "Four independently built services, with explicit ownership of user experiences and APIs.",
    description: "Main React frontend and FastAPI backend, separate admin React frontend and FastAPI backend, and their shared managed dependencies.",
    note: "The admin UI also calls the main API for course placement and assignments. The admin API is not a proxy. Its access boundary must be independently authenticated and restricted; this figure is not a security-completeness claim.",
    caption: "Four independent builds. Teacher views use the main API; the admin API is not a proxy for it.",
    serviceNodes: managedServiceNodes,
    sources: [
      ["System boundaries and access limitations", "docs/architecture.md"],
      ["Admin API routing configuration", "Admin-Dashboard/frontend/src/lib/config.ts"],
      ["Teacher API routes", "Agentic Shiksha Platform/Backend/teacher_dashboard/routes.py"],
    ],
    draw() {
      const id = this.id;
      return section(116, 246, 1010, 466, "MAIN PLATFORM",
        card(144, 283, 954, 150, "Main web app", ["React + TypeScript + Vite", "Learner chat / course builder / embedded teacher dashboard"], { tone: "blue", size: 37, subSize: 23 })
        + card(144, 531, 954, 145, "Main FastAPI API", ["Sessions / course access / chat / teacher routes", "TA harness / material and curriculum workers"], { size: 37, subSize: 23 }))
        + section(1186, 246, 494, 466, "ADMINISTRATION",
          card(1214, 283, 438, 150, "Admin web app", ["Separate React + Vite build", "Institution-wide administration"], { tone: "blue", size: 34 })
          + card(1214, 531, 438, 145, "Admin FastAPI API", ["Direct analytics + storage queries", "Research + optional evaluation"], { size: 32 }))
        + arrow(id, [[621, 433], [621, 531]], { blue: true })
        + label(739, 480, "HTTPS / streams")
        + arrow(id, [[1433, 433], [1433, 531]])
        + arrow(id, [[1254, 433], [1254, 497], [1010, 497], [1010, 531]], { blue: true })
        + label(1115, 467, "Placement / assignments", { size: 18 })
        + arrow(id, [[621, 676], [621, 774], [322, 774], [322, 874]])
        + arrow(id, [[1433, 676], [1433, 774], [1474, 774], [1474, 874]])
        + `<path d="M 322 774 H 1474" fill="none" stroke="${theme.border}" stroke-width="2.3"/>`
        + arrow(id, [[706, 774], [706, 874]])
        + arrow(id, [[1090, 774], [1090, 874]])
        + label(1000, 746, "Direct service clients", { size: 20 })
        + section(116, 834, 1564, 202, "DEPENDENCIES",
          card(144, 874, 356, 124, "Microsoft Foundry", ["Agents / conversations"], { size: 29, service: "foundry" })
          + card(528, 874, 356, 124, "Azure AI Search", ["Course retrieval"], { size: 29, service: "search" })
          + card(912, 874, 356, 124, "Cosmos DB", ["Identity / chats / jobs / progress"], { size: 31, subSize: 20, service: "cosmos" })
          + card(1296, 874, 356, 124, "Blob Storage", ["Materials / media / curriculum"], { size: 31, subSize: 20, service: "blob" }));
    },
  },
  {
    id: "03-shiksha-teaching-runtime",
    number: "03",
    name: "Teaching-agent runtime",
    heading: "TEACHING RUNTIME",
    subtitle: "One course-specific TA turn: trusted context, agent execution, tools and streamed learning artifacts.",
    description: "A learner turn passes user and course checks, enters the canonical TA harness, exchanges turns with a named Foundry agent, uses learning tools and streams results to React.",
    note: "SSE and AG-UI are transport adapters, not separate agents. Tool results return to the same agent turn. Graph-memory context is only injected under the configured authoritative policy.",
    caption: "Tools return results to the same agent turn. SSE and AG-UI are delivery contracts, not separate agents.",
    serviceNodes: [["Microsoft Foundry", "foundry", "Microsoft Foundry"]],
    sources: [
      ["Typed chat entry points", "Agentic Shiksha Platform/Backend/backend/routers/chat.py"],
      ["Runtime and tool dispatch", "Agentic Shiksha Platform/Backend/harness/runtime.py"],
      ["Harness context and compatibility", "Agentic Shiksha Platform/Backend/harness/README.md"],
    ],
    draw() {
      const id = this.id;
      return rail(142, 246, 220, 790, "TURN CONTEXT", ["Course", "Learner", "Conversation"])
        + section(422, 246, 1258, 155, "AUTHORIZED INPUT",
          card(448, 278, 1206, 98, "Learner question + preferences", ["Active-user and course checks / answer depth / optional image and artifact context"], { tone: "blue", size: 33, subSize: 22 }))
        + arrow(id, [[725, 376], [725, 488]], { blue: true })
        + section(422, 452, 1258, 246, "AGENT RUNTIME",
          card(448, 488, 552, 176, "TA harness", ["Request-scoped context", "Turn lifecycle + parallel tool dispatch"], { size: 37, subSize: 23 })
          + card(1080, 488, 574, 176, "Microsoft Foundry", ["Named course TA", "Conversations + Responses API"], { tone: "blue", size: 35, subSize: 23, service: "foundry" }))
        + arrow(id, [[1002, 576], [1078, 576]], { blue: true, both: true })
        + arrow(id, [[725, 664], [725, 762]], { both: true })
        + label(958, 730, "Tool calls + results", { size: 19 })
        + section(422, 762, 1258, 159, "TEACHING TOOLS",
          card(448, 795, 387, 112, "Grounding + concepts", ["Course passages / threshold concepts"], { size: 27, subSize: 19 })
          + card(857, 795, 387, 112, "Learning artifacts", ["Docs / quizzes / challenges", "Slides / diagrams / circuits"], { size: 29, subSize: 19 })
          + card(1266, 795, 388, 112, "Teaching actions", ["Plan / clarify / suggest next steps"], { size: 29, subSize: 19 }))
        + arrow(id, [[725, 921], [725, 972]])
        + card(448, 972, 1206, 64, "SSE / AG-UI  >  React chat, artifacts and saved conversation state", [], { size: 29 });
    },
  },
  {
    id: "04-shiksha-course-knowledge",
    number: "04",
    name: "Course and knowledge pipeline",
    heading: "COURSE & KNOWLEDGE",
    subtitle: "Teacher-owned course setup becomes searchable materials, a named TA and a versioned curriculum.",
    description: "Explicit teacher submission starts persisted jobs. Source documents go to Blob Storage, a layout and embedding pipeline and Azure AI Search. Course creation registers a Foundry TA and enqueues curriculum work.",
    note: "Course Companion proposes unsaved form edits; it does not submit Create or Update. TA creation, material indexing and curriculum readiness are tracked separately. Search is course grounding, not a learner mastery store.",
    caption: "TA creation, material indexing and curriculum have separate readiness states; a created TA is not a ready course.",
    serviceNodes: [
      ["Blob Storage", "blob", "Blob Storage"],
      ["Layout + embeddings", "document-intelligence", "Document Intelligence / structure-aware chunks"],
      ["Azure AI Search", "search", "Azure AI Search"],
      ["Named course TA", "foundry", "Foundry agent definition"],
    ],
    sources: [
      ["Material routes and worker lifecycle", "Agentic Shiksha Platform/Backend/backend/routers/course_materials.py"],
      ["TA creation and curriculum jobs", "Agentic Shiksha Platform/Backend/utils/course_creation.py"],
      ["Layout and embedding skillsets", "Agentic Shiksha Platform/Backend/azure_services/tools/search/course_index_manager.py"],
      ["Hybrid semantic retrieval", "Agentic Shiksha Platform/Backend/utils/course_materials.py"],
    ],
    draw() {
      const id = this.id;
      return section(116, 246, 1564, 227, "TEACHER WORKFLOW",
        card(144, 283, 460, 127, "Course builder", ["Course details + source materials"], { tone: "blue", size: 36, subSize: 23 })
        + card(686, 283, 390, 127, "Explicit submit", ["Create / update starts work"], { size: 35, subSize: 23 })
        + card(1158, 283, 494, 127, "Persisted jobs", ["Material + curriculum workers"], { size: 35, subSize: 23 })
        + text(898, 442, "Course Companion proposes form edits; the teacher chooses when to submit.", { size: 21, fill: theme.muted }))
        + arrow(id, [[604, 347], [686, 347]], { blue: true })
        + arrow(id, [[1076, 347], [1158, 347]])
        + arrow(id, [[1405, 410], [1405, 512], [170, 512], [170, 586]])
        + arrow(id, [[1405, 512], [1630, 512], [1630, 586]])
        + section(116, 550, 980, 486, "COURSE KNOWLEDGE",
          card(144, 586, 924, 94, "Blob Storage", ["Uploaded course documents"], { size: 32, service: "blob" })
          + card(144, 719, 924, 123, "Layout + embeddings", ["Document Intelligence / structure-aware chunks", "Azure OpenAI embeddings"], { size: 33, subSize: 22, service: { service: "document-intelligence", subtitle: 0 } })
          + card(144, 879, 924, 126, "Azure AI Search", ["Hybrid keyword + vector retrieval / semantic reranking"], { tone: "blue", size: 36, subSize: 23, service: "search" }))
        + arrow(id, [[606, 680], [606, 719]])
        + arrow(id, [[606, 842], [606, 879]], { blue: true })
        + section(1152, 550, 528, 486, "COURSE TEACHING",
          card(1180, 586, 472, 94, "Named course TA", ["Foundry agent definition"], { tone: "blue", size: 32, service: { service: "foundry", subtitle: 0 } })
          + card(1180, 729, 472, 122, "Curriculum research", ["Modules + threshold concepts", "Versioned curriculum"], { size: 31, subSize: 22 })
          + card(1180, 900, 472, 105, "Independent readiness", ["TA / materials / curriculum"], { tone: "pale", size: 28, subSize: 22 }))
        + arrow(id, [[1416, 680], [1416, 729]])
        + arrow(id, [[1416, 851], [1416, 900]]);
    },
  },
  {
    id: "05-shiksha-learner-memory",
    number: "05",
    name: "Learner memory and evidence",
    heading: "LEARNER MEMORY",
    subtitle: "Opt-in graph memory: shared curriculum definitions, separate learner facts and evidence-backed state.",
    description: "A reviewed curriculum graph and policies constrain event processing. Durable learner events produce evidence and validated observations, followed by a deterministic reducer, an atomic snapshot and derived learning views.",
    note: "Disabled by default. Course modes are off, shadow and authoritative. Shadow writes evidence without becoming progress authority; authoritative mode supplies TA context and learning-state authority. Cosmos stores graph documents; no separate graph database is required. Hosted memory and legacy progress are not the evidence ledger.",
    caption: "Modes: off / shadow / authoritative. Hosted recollections and legacy progress are not the evidence ledger.",
    serviceNodes: [],
    sources: [
      ["Memory semantics and rollout modes", "docs/memory/overview.md"],
      ["Disabled-by-default settings", "Agentic Shiksha Platform/Backend/learner_memory/settings.py"],
      ["Evidence processing and atomic publication", "Agentic Shiksha Platform/Backend/learner_memory/processor.py"],
      ["Request-scoped integration", "Agentic Shiksha Platform/Backend/learner_memory/integration.py"],
    ],
    draw() {
      const id = this.id;
      return section(116, 246, 378, 790, "CURRICULUM",
        card(144, 286, 322, 172, "Published graph", ["Threshold concepts", "Misconceptions + probes"], { tone: "blue", size: 30 })
        + card(144, 516, 322, 155, "Reviewed policies", ["Prerequisites / transfer", "Required clearing tasks"], { size: 29 })
        + card(144, 712, 322, 123, "Course binding", ["Version + learning epoch"], { size: 30 })
        + card(144, 876, 322, 120, "Opt-in only", ["Disabled by default"], { tone: "pale", size: 31, subSize: 22 }))
        + section(558, 246, 1122, 790, "EVIDENCE TO LEARNING STATE",
          card(586, 286, 500, 138, "Learner events", ["Scoped input + durable receipt"], { size: 33, subSize: 22 })
          + card(1142, 286, 510, 138, "Evidence + observations", ["Quoted / validated / curriculum-bound"], { size: 29, subSize: 21 })
          + card(1142, 515, 510, 138, "Deterministic reducer", ["Misconception + concept policies"], { tone: "blue", size: 32, subSize: 22 })
          + card(586, 515, 500, 138, "Snapshot + history", ["Atomic state + completed receipt"], { size: 33, subSize: 22 })
          + card(586, 740, 1066, 128, "LearningProfile + bounded TA context", ["Authorized views; TA context and state authority in authoritative mode"], { tone: "blue", size: 34, subSize: 23 })
          + card(586, 919, 1066, 77, "LLM proposes observations. Policy decides state.", ["Cosmos document storage / private evidence in Blob / no separate graph database"], { tone: "pale", size: 26, subSize: 20 }))
        + arrow(id, [[1086, 355], [1142, 355]])
        + arrow(id, [[1397, 424], [1397, 515]])
        + label(1518, 469, "Ordered processing", { size: 17 })
        + arrow(id, [[1142, 584], [1086, 584]], { blue: true })
        + arrow(id, [[836, 653], [836, 740]], { blue: true })
        + label(995, 696, "Derived, not a new authority", { size: 19 })
        + arrow(id, [[466, 373], [527, 373], [527, 474], [1258, 474], [1258, 515]])
        + `<path d="M 466 590 H 527 V 474" fill="none" stroke="${theme.border}" stroke-width="2.3"/>`
        + label(891, 474, "Reviewed graph + policies", { size: 19 });
    },
  },
];

function paletteLegend() {
  const items = brandSwatches.map(([name, color], i) => {
    const x = 1692 + (i % 2) * 286;
    const y = 904 + Math.floor(i / 2) * 77;
    return `<g data-legend-item="${name}">
      <rect data-swatch="" x="${x}" y="${y}" width="38" height="38" rx="6" fill="${color}"/>
      ${text(x + 54, y + 8, name, { size: 21, anchor: "start" })}
      ${text(x + 54, y + 34, color, { size: 19, anchor: "start" })}
    </g>`;
  }).join("");
  return `<g data-palette-legend="" role="group" aria-labelledby="palette-key-title">
    <rect data-legend-bounds="" x="1660" y="820" width="636" height="496" rx="12" fill="none" stroke="${theme.border}" stroke-width="1.5" stroke-dasharray="7 10"/>
    ${text(1692, 858, "Agentic Shiksha logo palette", { size: 29, weight: 700, anchor: "start", extra: 'id="palette-key-title"' })}
    ${items}
    ${text(1692, 1150, "Sampled from the Agentic Shiksha logo.", { size: 20, anchor: "start", fill: theme.muted })}
    ${text(1692, 1178, "Service logos retain their official colours.", { size: 20, anchor: "start", fill: theme.muted })}
    <rect x="1692" y="1203" width="572" height="1" fill="${theme.support}"/>
    <rect x="1692" y="1218" width="26" height="26" rx="5" fill="${theme.blue}"/>
    ${text(1730, 1231, "Blue / focal capability", { size: 21, anchor: "start" })}
    <rect x="1978" y="1218" width="26" height="26" rx="5" fill="${theme.support}"/>
    ${text(2016, 1231, "Light blue / support", { size: 21, anchor: "start" })}
    ${text(1692, 1275, "Colours indicate emphasis, not deployment status.", { size: 20, anchor: "start", fill: theme.muted })}
  </g>`;
}

function overview() {
  const tiles = diagrams.map((diagram, i) => {
    const x = 76 + (i % 3) * 776;
    const y = 184 + Math.floor(i / 3) * 618;
    const svg = diagram.svg.replace(/^<svg[^>]*>/, `<svg x="${x}" y="${y}" width="696" height="464" viewBox="0 0 ${W} ${H}">`);
    return svg + text(x + 348, y + 498, `${diagram.number}  ${diagram.name}`, { size: 27, weight: 700 });
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1440" viewBox="0 0 2400 1440" role="img" aria-labelledby="overview-title overview-description">
    <title id="overview-title">Agentic Shiksha architecture image set</title>
    <desc id="overview-description">Five Agentic Shiksha architecture views using flat cards, dashed groups, and colours sampled from the project logo. Official Microsoft product icons appear beside the corresponding service names, with their original colours and proportions preserved. The separate palette key does not add workload nodes or connections.</desc>
    <g font-family="Arial, Helvetica, sans-serif">
      <rect width="2400" height="1440" fill="white"/>
      ${text(76, 97, "ARCHITECTURE ATLAS", { size: 44, weight: 700, anchor: "start" })}
      ${tiles}
      ${paletteLegend()}
      ${text(2324, 1388, "Gallery: web/architecture/index.html", { size: 22, anchor: "end", fill: theme.muted })}
    </g>
  </svg>`;
}

function gallery(imagePrefix = "../../images/architecture/") {
  const links = diagrams.map((d) => `<a href="#${d.id}">${d.number} ${esc(d.name)}</a>`).join("");
  const figures = diagrams.map((d) => `<article id="${d.id}" class="figure">
    <header class="figure-heading"><div><p class="eyebrow">VIEW ${d.number} / 05</p><h2>${esc(d.name)}</h2></div>
      <div class="downloads"><a href="${imagePrefix}${d.id}.svg" download>Editable SVG</a>${raster ? `<a class="primary" href="${imagePrefix}${d.id}.png" download>PNG / 3600 x 2400</a>` : ""}</div></header>
    <a class="image-link" href="${imagePrefix}${d.id}.svg" aria-label="Open ${esc(d.name)} at full size"><img src="${imagePrefix}${d.id}.svg" width="${W}" height="${H}" alt="${esc(d.description)}" loading="lazy"/></a>
    <p class="reading-note">${esc(d.note)}</p>
    <details><summary>Source references</summary><ul>${d.sources.map(([name, path]) => `<li><a href="${esc(`../../../${path.split("/").map(encodeURIComponent).join("/")}`)}">${esc(name)}</a></li>`).join("")}</ul></details>
  </article>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="description" content="Five editable, source-grounded architecture diagrams for Agentic Shiksha."/>
  <title>Agentic Shiksha Architecture Atlas</title>
  <style>
    :root { color-scheme: light; --blue: ${theme.blue}; --ink: ${theme.ink}; }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body { margin: 0; background: ${theme.pale}; color: var(--ink); font-family: Arial, Helvetica, sans-serif; }
    a { color: var(--blue); text-underline-offset: 4px; }
    a:focus-visible, summary:focus-visible { outline: 3px solid var(--blue); outline-offset: 5px; }
    .topbar { background: white; border-bottom: 1px solid ${theme.support}; }
    .topbar-inner { max-width: 1420px; margin: auto; padding: 24px 32px; display: flex; align-items: center; justify-content: space-between; gap: 20px; }
    .brand { display: flex; align-items: center; gap: 13px; font-size: 17px; font-weight: 700; letter-spacing: .6px; }
    .mark { background: var(--ink); color: white; padding: 13px 9px; border-radius: 2px; }
    .stamp { font-size: 12px; letter-spacing: 1px; color: ${theme.muted}; }
    main { max-width: 1420px; margin: auto; padding: 0 32px; }
    .hero { padding: 58px 0 32px; }
    .eyebrow { font-size: 12px; font-weight: 700; letter-spacing: 1.6px; color: ${theme.muted}; margin: 0 0 13px; }
    h1 { font-size: clamp(34px, 4vw, 57px); letter-spacing: -1.8px; line-height: 1.06; margin: 0 0 22px; }
    .intro { color: ${theme.muted}; max-width: 820px; font-size: 18px; line-height: 1.65; }
    .hero-links { display: flex; gap: 22px; flex-wrap: wrap; margin-top: 22px; font-size: 14px; }
    nav { display: flex; flex-wrap: wrap; gap: 10px; padding: 16px 0 30px; }
    nav a { padding: 12px 15px; border: 1px dashed ${theme.border}; border-radius: 5px; background: white; text-decoration: none; font-size: 13px; color: ${theme.ink}; }
    nav a:hover { color: var(--blue); border-color: var(--blue); }
    .figure { margin: 0 0 42px; padding: 28px; background: white; border: 1px solid ${theme.support}; border-radius: 12px; scroll-margin-top: 22px; }
    .figure-heading { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 26px; flex-wrap: wrap; }
    h2 { font-size: 28px; letter-spacing: -.6px; margin: 0; }
    .downloads { display: flex; gap: 10px; flex-wrap: wrap; }
    .downloads a { display: inline-block; padding: 12px 15px; border: 1px solid ${theme.support}; border-radius: 6px; font-size: 13px; font-weight: 700; text-decoration: none; }
    .downloads .primary { background: var(--blue); color: white; border-color: var(--blue); }
    .image-link { display: block; }
    img { display: block; width: 100%; height: auto; }
    .reading-note { padding: 16px 19px; background: ${theme.pale}; border-left: 3px solid ${theme.teal}; color: ${theme.ink}; font-size: 14px; line-height: 1.7; margin: 22px 0 15px; }
    details { font-size: 13px; line-height: 1.9; }
    summary { cursor: pointer; color: ${theme.ink}; }
    .guide { background: white; border: 1px dashed ${theme.border}; border-radius: 12px; padding: 32px; margin: 24px 0 48px; scroll-margin-top: 22px; }
    .guide p, .guide li { color: ${theme.ink}; font-size: 15px; line-height: 1.8; }
    .guide code { background: ${theme.pale}; padding: 3px 5px; border-radius: 3px; overflow-wrap: anywhere; }
    pre { background: ${theme.pale}; padding: 18px; border-radius: 7px; white-space: pre-wrap; overflow-wrap: anywhere; }
    pre code { padding: 0; }
    .swatches { display: flex; gap: 20px; flex-wrap: wrap; margin: 24px 0; }
    .swatches span { display: flex; align-items: center; gap: 10px; font-size: 14px; }
    .swatch { width: 28px; height: 28px; display: inline-block; border: 1px solid ${theme.support}; border-radius: 5px; }
    footer { padding: 0 0 40px; font-size: 12px; line-height: 1.8; color: ${theme.muted}; }
    @media (max-width: 600px) { main { padding: 0 14px; } .topbar-inner { padding: 16px; } .stamp { display: none; } .hero { padding-top: 34px; } .figure { padding: 16px; } h2 { font-size: 23px; } .guide { padding: 22px; } }
    @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
    @media print { nav, .downloads, .hero-links, .guide, details { display: none; } body { background: white; } main { padding: 0; } .figure { border: none; break-before: page; padding: 0; } }
  </style>
</head>
<body>
  <header class="topbar"><div class="topbar-inner"><div class="brand"><span class="mark">AS</span> AGENTIC SHIKSHA / ARCHITECTURE ATLAS</div><span class="stamp">SOURCE SNAPSHOT / ${snapshot}</span></div></header>
  <main>
    <section class="hero">
      <p class="eyebrow">FIVE VIEWS. ONE VISUAL LANGUAGE.</p>
      <h1>Agentic Shiksha, drawn clearly.</h1>
      <p class="intro">The Agentic Shiksha architecture style: a white canvas, thin dashed boundaries, flat light-blue layers, royal-blue emphasis and navy typography. Diagram colours come from the project logo; official Microsoft service icons retain their original artwork beside explicit product names. Architecture relationships are unchanged. Based on the current source, not an assumed cloud deployment.</p>
      <div class="hero-links"><a href="${imagePrefix}00-shiksha-architecture-overview.${raster ? "png" : "svg"}">View the complete set</a><a href="shiksha-architecture-set.zip" download>Download ${raster ? "SVG + PNG" : "SVG"} bundle</a><a href="#recreate">How to create or adapt these</a><a href="../motion/index.html">Actual-platform tutorials</a><a href="../research/index.html">Detailed research diagrams</a></div>
    </section>
    <nav aria-label="Architecture views">${links}</nav>
    ${figures}
    <section class="guide" id="recreate">
      <p class="eyebrow">REUSABLE STYLE SYSTEM</p><h2>Keep the style. Change the architecture.</h2>
      <p>Use a vector template for diagrams with exact labels and relationships. SVG keeps text sharp and editable; the PNG exports are ready for slides and documents. These images use no remote fonts or cloud calls. Always use the full name <strong>Agentic Shiksha</strong> in visible titles and labels.</p>
      <p id="brand-palette"><strong>Project palette and service logos:</strong> diagram colours are sampled from the <a href="../../images/branding/agentic-shiksha-logo.png">Agentic Shiksha logo</a>. Actual service nodes also embed the original Microsoft artwork from the <a href="../../images/azure-icons/README.md">Azure icon collection</a>, without recolouring, cropping or distortion. These marks identify Microsoft services, not Agentic Shiksha components or conceptual learner states.</p>
      <div class="swatches">
        ${brandSwatches.map(([name, color]) => `<span><i class="swatch" style="background:${color}"></i>${name} ${color}</span>`).join("")}
      </div>
      <ol>
        <li>Edit the five diagram definitions and shared theme in <a href="generate.mjs"><code>generate.mjs</code></a>. Keep the source references and opt-in labels accurate. A card's <code>service</code> attaches the matching official logo to its actual product label; generic agents and evidence graphs are not Azure service nodes.</li>
        <li>Use the existing frontend Node environment. From the repository root, run the following command to rebuild SVGs, PNGs, the overview, this gallery and the ZIP:</li>
      </ol>
      <pre><code>node assets\\web\\architecture\\generate.mjs --png</code></pre>
      <p>PNG rendering uses the main frontend's existing <code>@playwright/test</code> dependency and an installed Playwright Chromium browser. If that browser is missing, from the main frontend folder run <code>npx playwright install chromium</code>. Run without <code>--png</code> for dependency-free SVG generation and an SVG-only bundle; previously rendered PNGs are not advertised or packaged in that mode. Generation verifies the diagram palette, unchanged embedded logo bytes and full project name. PNG mode also checks service-to-logo/label mappings, icon clearance, text fit, overlapping cards, image dimensions, source references and gallery layout at desktop and mobile widths.</p>
      <p>For visual editing, import an SVG into Figma or Inkscape. Insert SVGs or PNGs directly into PowerPoint. Diagram source size: 1800 x 1200; PNG export: 3600 x 2400. Text uses Arial with Helvetica and sans-serif fallbacks; another font may change label fit, so re-run the checks after editing.</p>
      <p><strong>Style brief for future diagrams:</strong> Agentic Shiksha Architecture Atlas; white canvas; navy uppercase titles; fine dashed grouping boxes; softly rounded flat light-blue cards; royal-blue emphasis; teal/cyan accents from the logo; generous spacing; minimal directional connectors; explicit service labels with the matching official icons. Keep cards flat without gradients or shadows. Retain the original colours and proportions of Microsoft product artwork as the only exception to the diagram palette.</p>
      <p>Blue identifies the focus of a view, not deployment status. Dashed outlines identify group boundaries, not security guarantees. Source references work inside this repository; if you extract the image bundle elsewhere, return to the repository to inspect those files or regenerate PNGs.</p>
    </section>
    <footer>Original Agentic Shiksha illustrations / ${snapshot}. Research implementation, not a live resource inventory or a certification of production readiness. No application code or cloud resources were changed to generate this set.</footer>
  </main>
</body>
</html>`;
}

function verifyBranding(svg, filename) {
  const palette = new Set([...Object.values(theme), "white", "none"]);
  for (const [, color] of svg.matchAll(/\b(?:fill|stroke)="([^"]+)"/g)) {
    assert(palette.has(color), `${filename}: off-palette colour ${color}`);
  }
  assert.doesNotMatch(svg, /<(?:foreignObject|script)\b/i, `${filename}: Atlas must remain a static image`);
  for (const [image] of svg.matchAll(/<image\b[^>]*>/g)) {
    const attributes = Object.fromEntries([...image.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]));
    const icon = azureServiceIcons[attributes["data-azure-icon"]];
    assert(icon, `${filename}: only named official service logos may be embedded`);
    assert.equal(attributes.href, icon.dataUri, `${filename}: original icon bytes must be embedded unchanged`);
    assert.equal(attributes["aria-label"], icon.label, `${filename}: icon must identify its service`);
    assert.equal(attributes.preserveAspectRatio, "xMidYMid meet", `${filename}: preserve logo proportions`);
    assert.equal(attributes.width, attributes.height, `${filename}: square logo viewport`);
    assert.doesNotMatch(image, /\b(?:transform|filter|clip-path)=/, `${filename}: do not modify Microsoft artwork`);
  }
  const visible = [...svg.matchAll(/<(?:text|title|desc)\b[^>]*>(.*?)<\/(?:text|title|desc)>/gs)]
    .map(([, value]) => value).join(" ");
  assert.match(visible, /Agentic Shiksha/i, `${filename}: full project name`);
  assert.doesNotMatch(visible.replace(/Agentic\s+Shiksha/gi, ""), /\bShiksha\b/i, `${filename}: no shortened project name`);
  const labels = [...svg.matchAll(/<text\b[^>]*>(.*?)<\/text>/gs)].map(([, value]) => value).join("\n");
  assert.doesNotMatch(labels, /SOURCE SNAPSHOT|NOT A LIVE(?: DEPLOYMENT)? INVENTORY|^\s*(?:Focus|Supporting layer|0[1-5]\s*\/\s*05)\s*$/im,
    `${filename}: omit page counters, snapshot footers, and the inline emphasis legend`);
  assert.doesNotMatch(labels, /AGENTIC SHIKSHA\s*\/|^\s*AGENTIC SHIKSHA (?:ECOSYSTEM|SERVICE ARCHITECTURE|TEACHING RUNTIME|COURSE &amp; KNOWLEDGE|LEARNER MEMORY)|^\s*AS\s*$|05 VIEWS \/ SVG/im,
    `${filename}: preserve the topic title without repeated project headers or badges`);
}

async function validateServiceLabels(page, filename, expected) {
  await page.evaluate(async () => {
    await Promise.all([...document.querySelectorAll("image")].map(async (node) => {
      const image = new Image();
      image.src = node.href.baseVal;
      await image.decode();
    }));
  });
  const mappings = await page.evaluate(() =>
    [...document.querySelectorAll("[data-card] [data-service-label]")].map(label => [
      label.closest("[data-card]").getAttribute("data-card"),
      label.getAttribute("data-service-label"),
      label.textContent,
    ]),
  );
  assert.deepEqual(mappings, expected, `${filename}: service labels must preserve their source mapping`);
  const icons = await page.evaluate(() =>
    [...document.querySelectorAll("[data-card] image[data-azure-icon]")].map(icon => [
      icon.closest("[data-card]").getAttribute("data-card"),
      icon.getAttribute("data-azure-icon"),
    ]),
  );
  assert.deepEqual(icons, expected.map(([card, service]) => [card, service]), `${filename}: every actual service node needs its corresponding logo`);
}

async function validateOverviewPalette(page) {
  assert.equal(await page.locator("[data-palette-legend]").count(), 1, "Overview must have one logo palette key");
  const result = await page.evaluate(() => {
    const legend = document.querySelector("[data-palette-legend]");
    const bounds = legend.querySelector("[data-legend-bounds]").getBoundingClientRect();
    const errors = [];
    const allText = [...document.querySelectorAll("text")];
    const intersects = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5
      && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
    for (const node of legend.querySelectorAll("text, [data-swatch]")) {
      const box = node.getBoundingClientRect();
      if (box.left < bounds.left + 16 || box.right > bounds.right - 16
        || box.top < bounds.top + 16 || box.bottom > bounds.bottom - 16) {
        errors.push(`Palette content outside bounds: ${node.textContent}`);
      }
      for (const label of allText) {
        if (node !== label && intersects(box, label.getBoundingClientRect())) {
          errors.push(`Overlapping palette content: ${label.textContent}`);
        }
      }
    }
    return {
      errors,
      swatches: [...legend.querySelectorAll("[data-legend-item]")].map(item => [
        item.getAttribute("data-legend-item"), item.querySelector("[data-swatch]").getAttribute("fill"),
      ]),
      workloadElements: legend.querySelectorAll("[data-card], path, polyline, line").length,
      width: document.documentElement.viewBox.baseVal.width,
      height: document.documentElement.viewBox.baseVal.height,
    };
  });
  assert.deepEqual(result.errors, [], `Overview palette layout:\n${result.errors.join("\n")}`);
  assert.equal(result.workloadElements, 0, "Palette must not add workload nodes or connections");
  assert.deepEqual(result.swatches, brandSwatches);
  assert.deepEqual([result.width, result.height], [2400, 1440], "Overview SVG dimensions");
  console.log("Verified logo palette key, full project name, no overlaps or additional workload connections.");
}

async function validateSvg(page, filename, expectedServices) {
  await page.goto(pathToFileURL(outputPath(filename)).href);
  await page.evaluate(() => document.fonts.ready);
  const errors = await page.evaluate(() => {
    const failures = [];
    if (document.querySelector("parsererror")) failures.push("Invalid SVG XML");
    const svg = document.documentElement;
    const bounds = svg.getBoundingClientRect();
    const heading = document.querySelector("[data-heading]").getBoundingClientRect();
    const headingMask = document.querySelector("[data-heading-mask]").getBoundingClientRect();
    if (heading.right > headingMask.right - 20) failures.push("Heading has insufficient clearance from dashed frame");
    const cards = [...document.querySelectorAll("[data-card]")];
    const boxes = cards.map((group) => ({
      name: group.getAttribute("data-card"),
      box: group.querySelector("rect").getBoundingClientRect(),
    }));
    for (const group of cards) {
      const box = group.querySelector("rect").getBoundingClientRect();
      for (const node of group.querySelectorAll("text")) {
        const t = node.getBoundingClientRect();
        if (t.left < box.left + 9 || t.right > box.right - 9 || t.top < box.top + 5 || t.bottom > box.bottom - 5) {
          failures.push(`Text does not fit ${group.getAttribute("data-card")}: ${node.textContent}`);
        }
      }
      for (const icon of group.querySelectorAll("image[data-azure-icon]")) {
        const image = icon.getBoundingClientRect();
        const label = group.querySelector("[data-service-label]").getBoundingClientRect();
        if (image.left < box.left + 8 || image.right > box.right - 8
          || image.top < box.top + 5 || image.bottom > box.bottom - 5) {
          failures.push(`Logo does not fit ${group.getAttribute("data-card")}`);
        }
        if (image.right + 8 > label.left || Math.abs((image.top + image.bottom - label.top - label.bottom) / 2) > 3) {
          failures.push(`Logo must sit beside its service label: ${group.getAttribute("data-card")}`);
        }
        for (const node of group.querySelectorAll("text")) {
          const text = node.getBoundingClientRect();
          if (Math.min(image.right, text.right) - Math.max(image.left, text.left) > 0
            && Math.min(image.bottom, text.bottom) - Math.max(image.top, text.top) > 0) {
            failures.push(`Logo overlaps text: ${node.textContent}`);
          }
        }
      }
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].box;
        const b = boxes[j].box;
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
          && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) {
          failures.push(`Overlapping cards: ${boxes[i].name} / ${boxes[j].name}`);
        }
      }
    }
    const textNodes = [...document.querySelectorAll("text")];
    for (const node of textNodes) {
      const t = node.getBoundingClientRect();
      if (t.left < bounds.left || t.right > bounds.right || t.top < bounds.top || t.bottom > bounds.bottom) {
        failures.push(`Text outside canvas: ${node.textContent}`);
      }
    }
    for (let i = 0; i < textNodes.length; i++) {
      for (let j = i + 1; j < textNodes.length; j++) {
        const a = textNodes[i].getBoundingClientRect();
        const b = textNodes[j].getBoundingClientRect();
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
          && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) {
          failures.push(`Overlapping labels: ${textNodes[i].textContent} / ${textNodes[j].textContent}`);
        }
      }
    }
    return failures;
  });
  assert.deepEqual(errors, [], `${filename} failed layout validation:\n${errors.join("\n")}`);
  await validateServiceLabels(page, filename, expectedServices);
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function exportBundle() {
  const basenames = ["00-shiksha-architecture-overview", ...diagrams.map((diagram) => diagram.id)];
  const filenames = [
    ...basenames.flatMap((name) => [`${name}.svg`, ...(raster ? [`${name}.png`] : [])]).map(outputPath),
    ...["generate.mjs", "index.html", "README.md"].map(outputPath),
    join(root, "assets", "images", "branding", "agentic-shiksha-logo.png"),
    ...["diagram-icons.mjs", "diagram-icons.test.mjs", "README.md"].map(name => join(root, "assets", "web", "azure-icons", name)),
    ...["README.md", "Microsoft_Terms_of_Use.pdf", ...Object.values(azureServiceIcons).map(icon => icon.filename)]
      .map(name => join(root, "assets", "images", "azure-icons", name)),
  ];
  const localParts = [];
  const centralParts = [];
  const entries = [];
  let offset = 0;
  // ZIP entry names use forward slashes; disk paths retain the platform's separator.
  for (const filePath of filenames) {
    const filename = relative(root, filePath).split(sep).join("/");
    const name = Buffer.from(filename);
    const data = await readFile(filePath);
    const compressed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    entries.push({ filename, data, crc, offset, start: offset + local.length + name.length, size: compressed.length });
    localParts.push(local, name, compressed);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  const filename = join(output, "shiksha-architecture-set.zip");
  await writeFile(filename, Buffer.concat([...localParts, directory, end]));
  const archive = await readFile(filename);
  assert.equal(archive.readUInt32LE(archive.length - 22), 0x06054b50, "ZIP end record");
  assert.equal(archive.readUInt16LE(archive.length - 12), filenames.length, "ZIP entry count");
  for (const entry of entries) {
    const data = inflateRawSync(archive.subarray(entry.start, entry.start + entry.size));
    assert.deepEqual(data, entry.data, `ZIP must contain the current ${entry.filename}`);
    assert.equal(crc32(data), archive.readUInt32LE(entry.offset + 14), `ZIP checksum: ${entry.filename}`);
  }
  console.log(`Verified ${entries.length} current files in shiksha-architecture-set.zip, preserving images/web layout and the original project logo.`);
}

async function verifyPng(filename, width, height) {
  const data = await readFile(outputPath(filename));
  assert.equal(data.subarray(1, 4).toString(), "PNG", `${filename} must be PNG`);
  assert.equal(data.readUInt32BE(16), width, `${filename} width`);
  assert.equal(data.readUInt32BE(20), height, `${filename} height`);
}

async function exportPngs() {
  const require = createRequire(join(root, "Agentic Shiksha Platform", "Frontend", "package.json"));
  const { chromium } = require("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    for (const diagram of diagrams) {
      await validateSvg(page, `${diagram.id}.svg`, diagram.serviceNodes);
      await page.screenshot({ path: outputPath(`${diagram.id}.png`), animations: "disabled" });
      await verifyPng(`${diagram.id}.png`, W * 2, H * 2);
      console.log(`Verified ${diagram.id}.png / ${W * 2} x ${H * 2}`);
    }
    await context.close();

    const overviewContext = await browser.newContext({ viewport: { width: 2400, height: 1440 }, deviceScaleFactor: 1 });
    const overviewPage = await overviewContext.newPage();
    await overviewPage.goto(pathToFileURL(outputPath("00-shiksha-architecture-overview.svg")).href);
    assert.equal(await overviewPage.locator("parsererror").count(), 0, "Overview must be valid SVG");
    await validateServiceLabels(overviewPage, "00-shiksha-architecture-overview.svg", diagrams.flatMap((diagram) => diagram.serviceNodes));
    await validateOverviewPalette(overviewPage);
    await overviewPage.screenshot({ path: outputPath("00-shiksha-architecture-overview.png"), animations: "disabled" });
    await verifyPng("00-shiksha-architecture-overview.png", 2400, 1440);
    await overviewContext.close();

    const galleryContext = await browser.newContext();
    const galleryPage = await galleryContext.newPage();
    for (const width of [1440, 390]) {
      await galleryPage.setViewportSize({ width, height: 1000 });
      await galleryPage.goto(pathToFileURL(join(output, "index.html")).href);
      await galleryPage.evaluate(async () => {
        await Promise.all([...document.images].map((image) => {
          image.loading = "eager";
          return image.decode();
        }));
      });
      const result = await galleryPage.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        images: [...document.images].every((image) => image.complete && image.naturalWidth > 0),
        figures: document.querySelectorAll("article.figure").length,
        logoSource: !!document.querySelector('#brand-palette a[href="../../images/branding/agentic-shiksha-logo.png"]'),
        bundleLink: !!document.querySelector('a[download][href="shiksha-architecture-set.zip"]'),
        brokenAnchors: [...document.querySelectorAll('a[href^="#"]')]
          .filter((link) => !document.getElementById(link.getAttribute("href").slice(1)))
          .map((link) => link.getAttribute("href")),
      }));
      assert.deepEqual(result, { overflow: false, images: true, figures: 5, logoSource: true, bundleLink: true, brokenAnchors: [] }, `Gallery validation at ${width}px`);
    }
    await galleryContext.close();
    console.log("Verified gallery at 1440px and 390px; all five figures, images and navigation anchors passed.");
  } finally {
    await browser.close();
  }
}

await mkdir(output, { recursive: true });
await mkdir(imageOutput, { recursive: true });
for (const diagram of diagrams) {
  for (const [, source] of diagram.sources) {
    await readFile(join(root, ...source.split("/")));
  }
  diagram.svg = frame(diagram, diagram.draw());
  verifyBranding(diagram.svg, `${diagram.id}.svg`);
  await writeFile(outputPath(`${diagram.id}.svg`), diagram.svg + "\n");
}
const overviewSvg = overview();
verifyBranding(overviewSvg, "00-shiksha-architecture-overview.svg");
await writeFile(outputPath("00-shiksha-architecture-overview.svg"), overviewSvg + "\n");
await writeFile(join(output, "index.html"), gallery());
if (raster) await exportPngs();
await exportBundle();
console.log("Verified project palette, original service logos and Agentic Shiksha naming across all five diagrams and overview.");
console.log(`Generated five original architecture views and overview in ${imageOutput}; gallery and bundle in ${output}`);
