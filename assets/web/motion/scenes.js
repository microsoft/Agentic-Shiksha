(function () {
  "use strict";

  const W = 1280;
  const H = 720;
  const C = {
    ink: "#202941", muted: "#667085", blue: "#5346E8", blueLight: "#EEEAFE",
    mint: "#E5F5EE", green: "#147D64", cream: "#FFF4D8", coral: "#FBE9E4",
    line: "#D8DEEA", white: "#FFFFFF", canvas: "#FBFCFE",
    dark: "#151923", dark2: "#202633", lightText: "#F0F2F8", dimText: "#ABB5C8",
  };
  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
  const ease = (value) => { const t = clamp(value); return t * t * (3 - 2 * t); };
  const escape = (value) => String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  })[ch]);
  const number = (value) => Number(value.toFixed(3));

  function rect(x, y, w, h, fill = C.white, radius = 14, stroke = "", extra = "") {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" ${stroke ? `stroke="${stroke}" stroke-width="1.4"` : ""} ${extra}/>`;
  }

  function text(x, y, value, { size = 20, weight = 400, color = C.ink, anchor = "start", extra = "" } = {}) {
    return `<text x="${x}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}" dominant-baseline="central" ${extra}>${escape(value)}</text>`;
  }

  function lines(x, y, values, options = {}) {
    return values.map((value, i) => text(x, y + i * (options.leading || 28), value, options)).join("");
  }

  function path(d, color = C.line, width = 2, extra = "") {
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
  }

  function dot(x, y, r, fill, extra = "") {
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" ${extra}/>`;
  }

  function fitBox(x, y, w, h, name, body) {
    return `<g data-fit="${escape(name)}" data-x="${x}" data-y="${y}" data-w="${w}" data-h="${h}">${body}</g>`;
  }

  function serviceIcon(service, x, y, size) {
    const asset = globalThis.ShikshaAzureIcons?.[service];
    if (!asset) throw new Error(`Missing official Azure icon: ${service}`);
    return `<image data-azure-icon="${escape(service)}" aria-label="${escape(asset.label)}" x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet" href="${asset.dataUri}"/>`;
  }

  function pill(x, y, w, label, { fill = C.blueLight, color = C.blue, size = 14, service } = {}) {
    return fitBox(x, y, w, 30, label, rect(x, y, w, 30, fill, 15)
      + (service ? serviceIcon(service, x + 11, y + 6, 18) : "")
      + text(x + w / 2 + (service ? 11 : 0), y + 15, label, { size, weight: 700, color, anchor: "middle" }));
  }

  function icon(kind, x, y, color = C.blue, size = 28) {
    const shapes = {
      chat: `${rect(2, 3, 24, 19, "none", 5, color)}${path("M 9 22 L 6 27 L 16 22", color)}${path("M 8 10 H 20 M 8 15 H 16", color, 1.6)}`,
      book: `${path("M 14 6 Q 8 2 2 5 V 24 Q 8 21 14 25 Q 20 21 26 24 V 5 Q 20 2 14 6 V 25", color)}${path("M 5 10 L 10 11 M 18 11 L 23 10 M 5 15 L 10 16 M 18 16 L 23 15", color, 1.4)}`,
      search: `${dot(11, 11, 8, "none", `stroke="${color}" stroke-width="2"`)}${path("M 18 18 L 26 26", color, 2.6)}`,
      check: path("M 4 14 L 11 21 L 25 6", color, 2.7),
      grid: [0, 1, 2, 3].map((i) => rect(2 + (i % 2) * 14, 2 + Math.floor(i / 2) * 14, 10, 10, "none", 2, color)).join(""),
      agent: `${rect(3, 8, 22, 17, "none", 5, color)}${path("M 14 3 V 8 M 0 13 V 20 M 28 13 V 20", color)}${dot(9, 15, 1.7, color)}${dot(19, 15, 1.7, color)}${path("M 9 21 H 19", color, 1.7)}${dot(14, 2, 2, color)}`,
      file: `${path("M 5 2 H 17 L 24 9 V 27 H 5 Z M 17 2 V 9 H 24", color)}${path("M 10 14 H 19 M 10 19 H 19 M 10 23 H 16", color, 1.5)}`,
      person: `${dot(14, 7, 5, "none", `stroke="${color}" stroke-width="2"`)}${path("M 4 27 V 23 C 4 12 24 12 24 23 V 27 M 9 21 V 27 M 19 21 V 27", color)}`,
      shield: `${path("M 14 2 L 25 6 V 14 Q 25 22 14 28 Q 3 22 3 14 V 6 Z M 8 14 L 12 18 L 20 10", color)}`,
      database: `<ellipse cx="14" cy="6" rx="11" ry="4" fill="none" stroke="${color}" stroke-width="2"/>${path("M 3 6 V 22 C 3 28 25 28 25 22 V 6 M 3 14 C 3 20 25 20 25 14", color)}`,
      layers: path("M 2 8 L 14 2 L 26 8 L 14 14 Z M 2 15 L 14 21 L 26 15 M 2 22 L 14 28 L 26 22", color),
    };
    if (!shapes[kind]) throw new Error(`Unknown icon: ${kind}`);
    return `<g transform="translate(${x} ${y}) scale(${size / 28})">${shapes[kind]}</g>`;
  }

  function arrow(x1, y1, x2, y2, active = false, marker = "flow-arrow") {
    return path(`M ${x1} ${y1} L ${x2} ${y2}`, active ? C.blue : "#AEB7C8", 2.3,
      `marker-end="url(#${marker})"`);
  }

  function movingDot(x1, y1, x2, y2, progress, color = C.blue) {
    const t = ease(progress);
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    return dot(number(x), number(y), 9, color, 'opacity=".14"')
      + dot(number(x), number(y), 4, color);
  }

  function stageAt(stages, time) {
    let result = 0;
    for (let i = 0; i < stages.length; i++) if (time >= stages[i].start) result = i;
    return result;
  }

  function chrome(id, title, desc, content, footer, time, duration) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${id}-title ${id}-description">
      <title id="${id}-title">${escape(title)}</title><desc id="${id}-description">${escape(desc)}</desc>
      <defs><marker id="${id}-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 1 1 L 8 5 L 1 9" fill="none" stroke="#AEB7C8" stroke-width="1.5"/></marker></defs>
      ${rect(0, 0, W, H, C.canvas, 0)}
      ${text(40, 110, title, { size: 36, weight: 700 })}
      ${content}
      ${rect(40, 640, 1200, 45, C.blueLight, 10)}
      ${text(60, 662, footer, { size: 19, color: "#403882" })}
      ${rect(40, 699, 1200, 3, "#E5E8F1", 1)}
      ${rect(40, 699, number(1200 * clamp(time / duration)), 3, C.blue, 1)}
    </svg>`;
  }

  const phases = [
    { start: 0, title: "Learner input", caption: "01 / Begin with a learner question, preferences and optional image context." },
    { start: 4, title: "Course grounding", caption: "02 / Retrieve relevant passages from the course's indexed materials." },
    { start: 8, title: "Teaching runtime", caption: "03 / The TA harness coordinates a named Foundry agent and local tools." },
    { start: 12, title: "Learning outputs", caption: "04 / Stream text and artifacts back to the learner. An artifact is not proof of mastery." },
  ];

  function flowPanel(x, label, i, stage, fill, content) {
    return rect(x, 205, 270, 359, fill, 20, i === stage ? C.blue : "#E2E6EE",
      i === stage ? 'style="stroke-width:2.5"' : "")
      + dot(x + 27, 233, 12, i === stage ? C.blue : "#FFFFFF")
      + text(x + 27, 233, String(i + 1), { size: 12, weight: 700, color: i === stage ? "white" : C.muted, anchor: "middle" })
      + text(x + 48, 233, label, { size: 15, weight: 700 })
      + content;
  }

  function flow(time) {
    const t = clamp(time, 0, 15.999);
    const stage = stageAt(phases, t);
    let body = text(40, 160, "Input, grounding, orchestration and outputs - one source-backed conceptual view.", { size: 17, color: C.muted });
    body += flowPanel(40, "LEARNER INPUT", 0, stage, C.mint,
      icon("chat", 64, 278, C.green, 30)
      + fitBox(61, 331, 227, 92, "Example question", rect(61, 331, 227, 92)
        + lines(78, 361, ["Why does current", "fall as R rises?"], { size: 23, weight: 700, leading: 31 }))
      + pill(61, 447, 129, "Question", { fill: "#CDEBDF", color: "#286954" })
      + pill(61, 493, 227, "Preferences + images", { fill: "#D7EDE5", color: "#286954", size: 14 }));
    body += flowPanel(350, "COURSE GROUNDING", 1, stage, C.cream,
      icon("book", 374, 278, "#A27622", 30)
      + rect(378, 335, 218, 99, "#EEDCAE", 10)
      + rect(373, 330, 218, 99, "#F7E8C3", 10)
      + fitBox(371, 325, 218, 99, "Course passages", rect(371, 325, 218, 99)
        + text(389, 352, "Course passages", { size: 21, weight: 700 })
        + path("M 389 378 H 564 M 389 391 H 546 M 389 404 H 555", "#D4BE89", 3))
      + fitBox(371, 455, 227, 70, "Azure AI Search", rect(371, 455, 227, 70, "#FAEBC3", 10)
        + serviceIcon("search", 386, 477, 26)
        + text(423, 490, "Azure AI Search", { size: 19, weight: 700, color: "#74561F" })));
    body += flowPanel(660, "TEACHING RUNTIME", 2, stage, C.blueLight,
      icon("agent", 684, 278, C.blue, 30)
      + fitBox(681, 329, 227, 58, "TA harness", rect(681, 329, 227, 58, C.blue, 11)
        + text(794, 358, "TA harness", { size: 25, weight: 700, color: "white", anchor: "middle" }))
      + fitBox(681, 411, 227, 57, "Foundry course TA", rect(681, 411, 227, 57)
        + serviceIcon("foundry", 695, 426, 26)
        + text(732, 439, "Foundry course TA", { size: 17, weight: 700 }))
      + arrow(794, 387, 794, 410, stage === 2)
      + pill(681, 493, 227, "Local tools + turn lifecycle", { fill: "#E0D9FD", color: "#514588", size: 13 }));
    body += flowPanel(970, "LEARNING OUTPUTS", 3, stage, "#EAF2FA",
      icon("grid", 994, 278, "#3879A5", 30)
      + ["Grounded explanation", "Quiz or challenge", "Diagram, slides, circuit"].map((label, i) => {
        const reveal = stage === 3 ? ease((t - 12 - i * 0.5) / 0.6) : 0;
        return `<g transform="translate(0 ${number((1 - reveal) * 3)})">`
          + fitBox(991, 330 + i * 64, 227, 49, label, rect(991, 330 + i * 64, 227, 49, reveal ? "#FFFFFF" : "#F3F7FC", 9,
            reveal > 0.5 ? "#B7CBDD" : "")
            + text(1006, 355 + i * 64, label, { size: 17, weight: reveal > 0.5 ? 700 : 400, color: "#346487" }))
          + "</g>";
      }).join("")
      + text(992, 543, "SSE / AG-UI delivery", { size: 14, color: "#557C9B" }));
    for (let i = 0; i < 3; i++) {
      const x = 310 + i * 310;
      body += arrow(x, 382, x + 36, 382, stage === i || stage === i + 1);
      const local = (t - i * 4 - 1) / 2.5;
      if (local >= 0 && local <= 1) body += movingDot(x + 1, 382, x + 33, 382, local);
    }
    if (stage === 2) body += movingDot(794, 389, 794, 407, ((t - 8) % 1.6) / 1.6);
    body += rect(40, 587, 579, 34, "#F0F3F8", 8)
      + serviceIcon("blob", 52, 593, 22)
      + text(85, 604, "Materials + media / Blob Storage", { size: 16, color: C.muted })
      + rect(660, 587, 580, 34, "#F0F3F8", 8)
      + serviceIcon("cosmos", 672, 593, 22)
      + text(705, 604, "Application records + saved chats / Cosmos DB", { size: 16, color: C.muted });
    return chrome("flow", "From a question to a learning artifact.",
      `Illustrative architecture animation. Phase ${stage + 1}: ${phases[stage].title}. Service timing is illustrative, not a performance benchmark. Managed services represent current source dependencies, not a live inventory.`,
      body, phases[stage].caption, t, 16);
  }

  const chapterPhases = (steps) => steps.map(([title, caption], i) => ({
    start: i * 5, title, caption: `${String(i + 1).padStart(2, "0")} / ${caption}`,
  }));
  const architectureScenes = {
    context: {
      name: "System context", level: "LEVEL 1 / SYSTEM CONTEXT", duration: 20, poster: 11.8,
      file: "shiksha-level-1-context",
      title: "One platform. Different responsibilities.",
      subtitle: "Start wide: the people, the learning system, and the services that support it.",
      note: "A logical system view, not a live Azure inventory. Teaching, course authoring and administration have different responsibilities; connected services are source dependencies.",
      sources: [
        ["Architecture and roles", "../../../docs/architecture.md"],
        ["Application boundaries", "../../../docs/deployment.md"],
      ],
      stages: chapterPhases([
        ["Teacher shapes the course", "A teacher sets the course intent and reviews its materials and learning design."],
        ["Learner takes a turn", "A learner asks, practises, or explains through the course-grounded teaching experience."],
        ["Services support the interaction", "The platform uses managed agents, course search, and application storage."],
        ["People inspect the result", "Learning artifacts and scoped insights return to people; outputs are not proof of mastery."],
      ]),
    },
    services: {
      name: "Service boundaries", level: "LEVEL 2 / SERVICE BOUNDARIES", duration: 20, poster: 16.8,
      file: "shiksha-level-2-services",
      title: "Four services. Clear boundaries.",
      subtitle: "Two independently built web/API pairs. Shared dependencies do not make one shared backend.",
      note: "Four application build units, not four Azure resources. Browser code calls the APIs. The embedded teacher dashboard uses the main API; admin access and assignments also use it. The admin analytics API requires a separately authenticated, private deployment boundary.",
      sources: [
        ["Deployment units and required boundaries", "../../../docs/deployment.md"],
        ["Admin API routing", "../../../Admin-Dashboard/frontend/src/lib/config.ts"],
        ["Main application assembly", "../../../Agentic Shiksha Platform/Backend/backend/app.py"],
      ],
      stages: chapterPhases([
        ["Main web experience", "The main web bundle hosts learner chat, course creation, artifacts, and teacher views."],
        ["Main application API", "The main API owns course access, teaching turns, materials, and in-process workers."],
        ["Separate administration", "Admin analytics uses its own API through a required external access boundary."],
        ["API-owned integrations", "The APIs call managed services directly; the admin API is not a proxy for the main API."],
      ]),
    },
    runtime: {
      name: "Teaching runtime", level: "LEVEL 3 / TEACHING RUNTIME", duration: 20, poster: 11.8,
      file: "shiksha-level-3-runtime",
      title: "Inside a single teaching turn.",
      subtitle: "From a typed request to scoped context, tool orchestration, and a streamed response.",
      note: "This follows the canonical streaming path. Graph context is conditional. The harness, Foundry agent, local tools and transport adapters have separate jobs; SSE, AG-UI and A2UI are not extra teaching agents.",
      sources: [
        ["Typed chat entry points", "../../../Agentic Shiksha Platform/Backend/backend/routers/chat.py"],
        ["Harness and context phases", "../../../Agentic Shiksha Platform/Backend/harness/README.md"],
        ["Chat state and presentation", "../../../Agentic Shiksha Platform/Frontend/src/features/chat/README.md"],
      ],
      stages: chapterPhases([
        ["Authorize the request", "Typed chat routes verify an active user and course access before the teaching turn."],
        ["Contextualise", "Build scoped context. Show Contextualising while profile and grounding are prepared."],
        ["Coordinate agent and tools", "The harness calls the named Foundry TA and dispatches local tool calls and results."],
        ["Stream and reconcile", "Adapters deliver text and artifacts; the chat hook handles state, stop, errors, and persistence."],
      ]),
    },
    grounding: {
      name: "Course grounding", level: "DATAFLOW / COURSE GROUNDING", duration: 20, poster: 16.8,
      file: "shiksha-course-grounding",
      title: "Materials become usable course context.",
      subtitle: "A material-processing pipeline and a course-scoped retrieval path, not a mastery signal.",
      note: "The common indexing path uses Document Intelligence Layout, Azure OpenAI embeddings and Azure AI Search. Retrieval checks the course/material-session scope. TA creation, material readiness and curriculum readiness are separate states.",
      sources: [
        ["Material processing and dataflow", "../../../docs/agent-dataflow.md"],
        ["Common indexing pipeline", "../../../Agentic Shiksha Platform/Backend/azure_services/tools/search/course_index_manager.py"],
        ["Scoped passage retrieval", "../../../Agentic Shiksha Platform/Backend/utils/course_materials.py"],
      ],
      stages: chapterPhases([
        ["Store course materials", "Teacher materials enter Blob Storage and persisted material-processing jobs."],
        ["Extract and embed", "Document Intelligence structures the material; embeddings make chunks retrievable."],
        ["Retrieve within course scope", "Azure AI Search holds the shared index; course/session filters constrain retrieval."],
        ["Return grounded passages", "The teaching turn receives selected passages and source metadata for cited responses."],
      ]),
    },
    memory: {
      name: "Learner-memory flow", level: "DATAFLOW / OPT-IN MEMORY", duration: 20, poster: 16.8,
      file: "shiksha-learner-memory-flow",
      title: "Evidence changes state. Not confidence.",
      subtitle: "Opt-in graph memory: the feature and its worker default to off. Shown for configured courses.",
      note: "This is the custom learner-memory pipeline, not hosted conversational recall. A reviewed curriculum constrains interpretation and reduction. Shadow mode records graph state while legacy progress retains authority; authoritative mode uses the committed graph state. Rejected or pending processing preserves the last complete snapshot.",
      sources: [
        ["Learner-memory contracts and modes", "../../../docs/memory/overview.md"],
        ["Feature and worker defaults", "../../../Agentic Shiksha Platform/Backend/learner_memory/settings.py"],
        ["Validated reduction and atomic publication", "../../../Agentic Shiksha Platform/Backend/learner_memory/processor.py"],
      ],
      stages: chapterPhases([
        ["Capture durable evidence", "Accept a scoped learner event with a durable receipt; processing happens asynchronously."],
        ["Validate the interpretation", "Model observations need source evidence and validation; confidence does not write state."],
        ["Apply deterministic policy", "Reviewed curriculum and accepted evidence constrain deterministic state transitions."],
        ["Publish and inform the next turn", "Publish snapshot and history atomically; derive bounded context, gaps, and next probes."],
      ]),
    },
  };

  function panel(x, y, w, h, heading, fill, active, body) {
    return fitBox(x, y, w, h, heading,
      rect(x, y, w, h, fill, 20, active ? C.blue : "#E2E6EE",
        active ? 'style="stroke-width:2.5"' : "")
      + text(x + 22, y + 28, heading, { size: 15, weight: 700 })
      + body);
  }

  function node(x, y, w, h, title, details = [], { active = false, fill = C.white, solid = false, size = 20, dashed = false, services = [] } = {}) {
    return fitBox(x, y, w, h, title,
      rect(x, y, w, h, solid ? C.blue : fill, 12, active ? C.blue : "",
        `${active ? 'style="stroke-width:2"' : ""} ${dashed ? 'stroke="#AEB7C8" stroke-dasharray="5 5"' : ""}`)
      + services.map((service, index) => serviceIcon(service, x + 16 + index * 28, y + 12, 24)).join("")
      + text(x + 18 + (services.length ? services.length * 28 + 6 : 0), y + 24, title, { size, weight: 700, color: solid ? C.white : C.ink })
      + lines(x + 18, y + 52, details, { size: 14, leading: 19, color: solid ? "#EEEAFE" : C.muted }));
  }

  function route(id, points, time, active, dashed = false) {
    const d = points.map(([x, y], i) => `${i ? "L" : "M"} ${x} ${y}`).join(" ");
    let result = path(d, active ? C.blue : "#AEB7C8", active ? 2.7 : 2,
      `marker-end="url(#${id}-arrow)" ${dashed ? 'stroke-dasharray="5 6"' : ""}`);
    if (!active) return result;
    const lengths = points.slice(1).map((point, i) => Math.hypot(point[0] - points[i][0], point[1] - points[i][1]));
    let distance = ease(((time % 5) % 2.5) / 2.5) * lengths.reduce((a, b) => a + b, 0);
    for (let i = 0; i < lengths.length; i++) {
      if (distance <= lengths[i] || i === lengths.length - 1) {
        const progress = lengths[i] ? distance / lengths[i] : 0;
        const x = number(points[i][0] + (points[i + 1][0] - points[i][0]) * progress);
        const y = number(points[i][1] + (points[i + 1][1] - points[i][1]) * progress);
        result += `<g data-signal="">${dot(x, y, 8, C.blue, 'opacity=".15"')}${dot(x, y, 4, C.blue)}</g>`;
        break;
      }
      distance -= lengths[i];
    }
    return result;
  }

  function support(label, { fill = "#F0F3F8", color = C.muted, service } = {}) {
    return fitBox(40, 587, 1200, 34, "Supporting architecture note",
      rect(40, 587, 1200, 34, fill, 8)
      + (service ? serviceIcon(service, 52, 593, 22) : "")
      + text(service ? 85 : 59, 604, label, { size: 15, color }));
  }

  function architectureFrame(id, time, draw) {
    const spec = architectureScenes[id];
    const t = clamp(time, 0, spec.duration - 0.001);
    const stage = stageAt(spec.stages, t);
    return chrome(id, spec.title,
      `${spec.note} Current phase: ${spec.stages[stage].title}. Illustrative timing, not a latency benchmark.`,
      text(40, 160, spec.subtitle, { size: 17, color: C.muted }) + draw(t, stage),
      spec.stages[stage].caption, t, spec.duration);
  }

  function contextScene(time) {
    return architectureFrame("context", time, (t, stage) => {
      let body = panel(40, 205, 246, 359, "PEOPLE", C.mint, stage !== 2,
        node(60, 270, 206, 75, "Teacher", ["Course intent + review"], { active: stage === 0 })
        + node(60, 363, 206, 75, "Learner", ["Ask, practise, explain"], { active: stage === 1 })
        + node(60, 456, 206, 75, "Administrator", ["Institution-wide insight"], { active: stage === 3 }));
      body += panel(338, 205, 554, 359, "THE LEARNING SYSTEM", C.blueLight, true,
        node(358, 270, 514, 78, "Agentic Shiksha", ["Course-grounded teaching, authoring, and inspection"], { solid: true, size: 26 })
        + node(358, 370, 246, 88, "Teaching experience", ["Chat + learning artifacts"], { active: stage === 1, size: 19 })
        + node(624, 370, 248, 88, "Course workspace", ["Create + review materials"], { active: stage === 0, size: 19 })
        + fitBox(358, 480, 514, 51, "Insights",
          rect(358, 480, 514, 51, C.white, 12, stage === 3 ? C.blue : "")
          + text(378, 505, "Teacher insights + admin analytics", { size: 20, weight: 700 })));
      body += panel(944, 205, 296, 359, "CONNECTED SERVICES", C.cream, stage === 2,
        node(964, 270, 256, 75, "Microsoft Foundry", ["Agents + model inference"], { active: stage === 2, services: ["foundry"] })
        + node(964, 363, 256, 75, "Azure AI Search", ["Course-grounded retrieval"], { active: stage === 2, services: ["search"] })
        + node(964, 456, 256, 75, "Cosmos DB + Blob", ["Records, materials, media"], { active: stage === 2, services: ["cosmos", "blob"], size: 17 }));
      body += route("context", [[286, 306], [338, 306]], t, stage === 0)
        + route("context", [[286, 400], [338, 400]], t, stage === 1)
        + route("context", [[338, 495], [286, 495]], t, stage === 3);
      for (const y of [306, 400, 495]) body += route("context", [[892, y], [944, y]], t, stage === 2);
      return body + support("Logical system context / Original source-backed illustration, not a deployed-resource inventory.");
    });
  }

  function servicesScene(time) {
    return architectureFrame("services", time, (t, stage) => {
      let body = panel(40, 205, 292, 359, "WEB APPLICATIONS", C.mint, stage === 0,
        node(60, 270, 252, 101, "Main web", ["React / Vite / Nginx", "Learner + teacher experience"], { active: stage === 0 })
        + node(60, 423, 252, 101, "Admin web", ["Separate React / Vite build", "Administration + analytics"], { active: stage === 2 }));
      body += panel(394, 205, 388, 359, "APPLICATION APIs", C.blueLight, stage === 1 || stage === 2,
        node(416, 270, 344, 101, "Main API", ["FastAPI / TA harness", "Teacher-scoped routes + workers"], { solid: stage === 1 })
        + node(416, 423, 344, 101, "Admin API", ["Separate FastAPI / analytics", "Requires private, authenticated access"], { active: stage === 2 }));
      body += panel(844, 205, 396, 359, "API-OWNED DEPENDENCIES", "#EAF2FA", stage === 3,
        node(864, 263, 356, 78, "Foundry / Azure OpenAI", ["Agents, conversations, inference"], { active: stage === 3, services: ["foundry"] })
        + node(864, 358, 356, 78, "Azure AI Search", ["Course retrieval / optional evaluation"], { active: stage === 3, services: ["search"] })
        + node(864, 453, 356, 78, "Cosmos DB + Blob Storage", ["Records, chats, materials, media"], { active: stage === 3, services: ["cosmos", "blob"] }));
      body += route("services", [[332, 315], [394, 315]], t, stage === 0 || stage === 1)
        + route("services", [[332, 474], [394, 474]], t, stage === 2, true)
        + route("services", [[332, 443], [356, 443], [356, 351], [394, 351]], t, stage === 2)
        + route("services", [[782, 315], [844, 315]], t, stage === 3)
        + route("services", [[782, 474], [844, 474]], t, stage === 3);
      body += text(60, 397, "Four independent build units", { size: 14, color: C.green });
      return body + support("Dashed admin route = required external protection. Teacher views + admin assignments use the Main API.",
        { fill: C.cream, color: "#74561F" });
    });
  }

  function runtimeScene(time) {
    return architectureFrame("runtime", time, (t, stage) => {
      let body = flowPanel(40, "REQUEST + ACCESS", 0, stage, C.mint,
        icon("shield", 64, 278, C.green, 30)
        + node(61, 332, 227, 100, "Typed chat route", ["Active user + course access", "Turn and conversation scope"], { active: stage === 0 })
        + pill(61, 454, 227, "Question + optional images", { fill: "#D7EDE5", color: "#286954", size: 14 })
        + pill(61, 502, 227, "Answer-depth preference", { fill: "#D7EDE5", color: "#286954", size: 14 }));
      body += flowPanel(350, "CONTEXTUALISING", 1, stage, C.cream,
        icon("search", 374, 278, "#A27622", 30)
        + node(371, 330, 227, 60, "Profile + preferences", [], { active: stage === 1, size: 18 })
        + node(371, 404, 227, 60, "Grounded passages", [], { active: stage === 1, size: 18 })
        + node(371, 478, 227, 60, "Memory if enabled", [], { dashed: true, size: 18 }));
      body += flowPanel(660, "TOOL ORCHESTRATION", 2, stage, C.blueLight,
        icon("agent", 684, 278, C.blue, 30)
        + node(681, 330, 227, 63, "TA harness", [], { solid: true, size: 24 })
        + node(681, 424, 227, 63, "Foundry course TA", [], { active: stage === 2, size: 17, services: ["foundry"] })
        + pill(681, 510, 227, "Local tools + tool results", { fill: "#E0D9FD", color: "#514588", size: 14 })
        + route("runtime", [[794, 393], [794, 424]], t, stage === 2)
        + route("runtime", [[908, 455], [921, 455], [921, 361], [908, 361]], t, stage === 2));
      body += flowPanel(970, "STREAM + PRESENT", 3, stage, "#EAF2FA",
        icon("grid", 994, 278, "#3879A5", 30)
        + node(991, 330, 227, 80, "Stream adapters", ["SSE or AG-UI / A2UI"], { active: stage === 3 })
        + node(991, 428, 227, 75, "Text + learning assets", ["Clarifications and tool steps"], { active: stage === 3, size: 18 })
        + text(992, 535, "Stop, errors, and completion", { size: 14, color: "#557C9B" }));
      for (let i = 0; i < 3; i++) {
        body += route("runtime", [[310 + i * 310, 382], [350 + i * 310, 382]], t, stage === i + 1);
      }
      return body + support("Cosmos DB / persisted conversations      |      React chat hook / generation-gated state", { service: "cosmos" });
    });
  }

  function groundingScene(time) {
    return architectureFrame("grounding", time, (t, stage) => {
      let body = flowPanel(40, "TEACHER MATERIALS", 0, stage, C.mint,
        icon("file", 64, 278, C.green, 30)
        + rect(70, 342, 220, 132, "#C9E4D9", 13)
        + node(61, 330, 220, 132, "Lecture notes", ["Documents, pages, images"], { active: stage === 0 })
        + path("M 80 413 H 258 M 80 429 H 244 M 80 445 H 253", "#ADD4C4", 3)
        + pill(61, 500, 227, "Blob Storage + jobs", { fill: "#D7EDE5", color: "#286954", service: "blob" }));
      body += flowPanel(350, "LAYOUT + EMBEDDING", 1, stage, C.cream,
        icon("layers", 374, 278, "#A27622", 30)
        + node(371, 330, 227, 88, "Document Intelligence", ["Layout + OCR + chunks"], { active: stage === 1, size: 15, services: ["document-intelligence"] })
        + route("grounding", [[484, 418], [484, 455]], t, stage === 1)
        + node(371, 455, 227, 77, "Azure OpenAI", ["Chunk embeddings"], { active: stage === 1 }));
      body += flowPanel(660, "COURSE-SCOPED INDEX", 2, stage, C.blueLight,
        serviceIcon("search", 684, 278, 30)
        + text(681, 341, "Azure AI Search", { size: 23, weight: 700 })
        + ["Current course / chunk 1", "Other course / excluded", "Current course / chunk 2"].map((label, i) =>
          node(681, 369 + i * 48, 227, 40, label, [], {
            active: stage === 2 && i !== 1, size: 15, fill: i === 1 ? "#E5E1F1" : C.white,
          })).join("")
        + text(681, 535, "Filter: course + material session", { size: 14, color: "#514588" }));
      body += flowPanel(970, "GROUNDED RESPONSE", 3, stage, "#EAF2FA",
        icon("chat", 994, 278, "#3879A5", 30)
        + node(991, 330, 227, 143, "Cited explanation", ["Selected course passages", "support the teaching turn."], { active: stage === 3, size: 20 })
        + pill(1008, 425, 110, "Source [1]", { fill: "#E4EDF8", color: "#346487", size: 14 })
        + text(992, 510, "Source + page + excerpt", { size: 16, color: "#346487" })
        + text(992, 536, "Inspect the supporting material", { size: 14, color: "#557C9B" }));
      for (let i = 0; i < 3; i++) {
        body += route("grounding", [[310 + i * 310, 382], [350 + i * 310, 382]], t, stage === i + 1);
      }
      return body + support("Separate readiness states / TA created does not mean materials are indexed or curriculum is reviewed.");
    });
  }

  function memoryScene(time) {
    return architectureFrame("memory", time, (t, stage) => {
      let body = flowPanel(40, "EVIDENCE INTAKE", 0, stage, C.mint,
        icon("file", 64, 278, C.green, 30)
        + node(61, 330, 227, 99, "Durable event", ["Source evidence + receipt", "Learner / course scope"], { active: stage === 0 })
        + node(61, 453, 227, 82, "Async processing", ["Pending is not committed"], { size: 19 }));
      body += flowPanel(350, "INTERPRET + VALIDATE", 1, stage, C.cream,
        icon("search", 374, 278, "#A27622", 30)
        + node(371, 330, 227, 88, "LLM observations", ["Propose, do not commit"], { active: stage === 1 })
        + route("memory", [[484, 418], [484, 454]], t, stage === 1)
        + node(371, 454, 227, 81, "Validate provenance", ["Reject unsupported claims"], { active: stage === 1, size: 18 }));
      body += flowPanel(660, "DETERMINISTIC POLICY", 2, stage, C.blueLight,
        icon("shield", 684, 278, C.blue, 30)
        + node(681, 330, 227, 100, "State reduction", ["Reviewed curriculum", "+ accepted evidence"], { solid: true, size: 23 })
        + node(681, 454, 227, 81, "State transitions", ["No direct model state writes"], { active: stage === 2, size: 20 }));
      body += flowPanel(970, "PUBLISH + PROJECT", 3, stage, "#EAF2FA",
        icon("database", 994, 278, "#3879A5", 30)
        + node(991, 330, 227, 89, "Atomic publication", ["Snapshot + history + receipt"], { active: stage === 3, size: 19 })
        + node(991, 439, 227, 68, "LearningProfile", ["Derived, bounded context"], { active: stage === 3 })
        + text(992, 539, "State, gaps, and next probe", { size: 15, color: "#346487" }));
      for (let i = 0; i < 3; i++) {
        body += route("memory", [[310 + i * 310, 382], [350 + i * 310, 382]], t, stage === i + 1, true);
      }
      return body + support("Opt-in only / Rejected or pending work preserves the last complete snapshot. Confidence is not mastery.",
        { fill: C.cream, color: "#74561F" });
    });
  }

  const renderers = { flow, context: contextScene, services: servicesScene, runtime: runtimeScene, grounding: groundingScene, memory: memoryScene };
  globalThis.ShikshaMotion = Object.freeze({
    width: W,
    height: H,
    scenes: Object.freeze({
      flow: { duration: 16, poster: 15.5, name: "Architecture flow", stages: phases },
      ...architectureScenes,
    }),
    render(kind, time) {
      if (!Number.isFinite(time)) throw new TypeError("Animation time must be finite");
      if (Object.hasOwn(renderers, kind)) return renderers[kind](time);
      throw new Error(`Unknown scene: ${kind}`);
    },
    stageAt,
  });
})();
