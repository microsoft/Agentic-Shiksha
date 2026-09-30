import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const auditDir = resolve(here, "..");
const root = resolve(auditDir, "..", "..");
const write = process.argv.includes("--write");
assert(process.argv.slice(2).every((arg) => ["--write", "--self-test"].includes(arg)), "Usage: node docs\\workflows\\tools\\validate.mjs [--write|--self-test]");
assert(!(write && process.argv.includes("--self-test")), "Choose either --write or --self-test");
const frontendRequire = createRequire(join(root, "Agentic Shiksha Platform", "Frontend", "package.json"));
const ts = frontendRequire("typescript");
const fromRoot = (path) => join(root, ...path.split("/"));
const readJson = async (name) => JSON.parse(await readFile(join(auditDir, name), "utf8"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const escapeCell = (value) => String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const sourceLink = (path, label = path, line) => `[${escapeCell(label)}](<../../${path}${line ? `#L${line}` : ""}>)`;
const routeKey = (path, kind) => `${path}::${kind}`;
const parameterized = (path) => path.split("?")[0].replace(/\{[^}]+\}/g, "{}");

function mainUiRoutes(source, filename) {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(file.parseDiagnostics.length, 0, "The UI route source must parse");
  let routeCall;
  function locate(node) {
    if (ts.isCallExpression(node) && node.expression.getText(file) === "createBrowserRouter") routeCall = node;
    ts.forEachChild(node, locate);
  }
  locate(file);
  assert(routeCall, "createBrowserRouter call not found");
  const found = [];
  function properties(object) {
    return Object.fromEntries(object.properties.filter(ts.isPropertyAssignment).map((property) => [
      property.name.getText(file).replace(/^["']|["']$/g, ""), property.initializer,
    ]));
  }
  function visit(node, parent = "/") {
    if (ts.isArrayLiteralExpression(node)) {
      node.elements.forEach((element) => visit(element, parent));
      return;
    }
    if (ts.isSpreadElement(node) || ts.isParenthesizedExpression(node)) return visit(node.expression, parent);
    if (ts.isConditionalExpression(node)) { visit(node.whenTrue, parent); visit(node.whenFalse, parent); return; }
    if (!ts.isObjectLiteralExpression(node)) throw new Error(`Unresolved UI route expression: ${node.getText(file)}`);
    const fields = properties(node);
    const index = fields.index?.kind === ts.SyntaxKind.TrueKeyword;
    assert(index || fields.path || fields.children, "A route object has no path, index or children");
    const declaredPath = fields.path ? (() => {
      assert(ts.isStringLiteral(fields.path), `Dynamic UI path needs explicit audit: ${fields.path.getText(file)}`);
      return fields.path.text;
    })() : "";
    const path = declaredPath.startsWith("/") ? declaredPath : posix.join(parent, declaredPath);
    const element = fields.element?.getText(file) || "";
    const kind = index ? "index" : fields.children ? "layout" : declaredPath === "*" ? "fallback"
      : /<Navigate\b/.test(element) ? "redirect" : "screen";
    found.push({ path, kind, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1 });
    if (fields.children) visit(fields.children, path);
  }
  visit(routeCall.arguments[0]);
  return found;
}

function jsxRoutes(source, filename) {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(file.parseDiagnostics.length, 0, `${filename}: UI source must parse`);
  const found = [];
  function visit(node, parent = "/") {
    const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : undefined;
    let path = parent;
    if (opening?.tagName.getText(file) === "Route") {
      const attrs = opening.attributes.properties.filter(ts.isJsxAttribute);
      const pathAttr = attrs.find((attr) => attr.name.getText(file) === "path");
      const index = attrs.some((attr) => attr.name.getText(file) === "index");
      if (pathAttr || index) {
        const value = pathAttr?.initializer;
        assert(!value || ts.isStringLiteral(value), `${filename}: dynamic JSX route needs explicit handling`);
        const declared = value?.text || "";
        path = declared.startsWith("/") ? declared : posix.join(parent, declared);
        found.push({ path, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1 });
      }
    }
    ts.forEachChild(node, (child) => visit(child, path));
  }
  visit(file);
  return found;
}

function anchors(body) {
  const found = new Set([...body.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]));
  const duplicates = new Map();
  for (const match of body.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const base = match[1].toLowerCase().replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/<[^>]+>/g, "").replace(/[^\p{L}\p{N}_ -]/gu, "").replace(/ /g, "-");
    const count = duplicates.get(base) || 0;
    found.add(count ? `${base}-${count}` : base);
    duplicates.set(base, count + 1);
  }
  return found;
}

async function checkLinks(path, body, virtual = new Map()) {
  const failures = [];
  const text = body.replace(/```[\s\S]*?```/g, "");
  const links = [
    ...[...text.matchAll(/\[[^\]\n]*\]\(\s*(?:<([^>]+)>|([^\s)]+))[^)]*\)/g)].map((match) => match[1] || match[2]),
    ...[...text.matchAll(/^\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/gm)].map((match) => match[1] || match[2]),
  ];
  for (const href of links) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) continue;
    const [target, fragment] = href.split("#");
    const filename = target ? resolve(dirname(path), decodeURIComponent(target)) : path;
    try {
      const targetBody = virtual.has(filename) ? virtual.get(filename) : await readFile(filename, "utf8");
      if (fragment && filename.endsWith(".md") && !anchors(targetBody).has(decodeURIComponent(fragment))) {
        failures.push(`${path}: missing anchor ${href}`);
      }
      if (fragment && /^L\d+$/.test(fragment) && Number(fragment.slice(1)) > targetBody.split("\n").length) {
        failures.push(`${path}: out-of-range source line ${href}`);
      }
    } catch (error) {
      if (error.code === "EISDIR" && !fragment) continue;
      failures.push(`${path}: unreadable link ${href} (${error.message})`);
    }
  }
  return failures;
}

if (process.argv.includes("--self-test")) {
  const routes = mainUiRoutes(`createBrowserRouter([
    ...(import.meta.env.DEV ? [{path: "/dev", element: <Preview/>}] : []),
    {path: "/", element: <Shell/>, children: [
      {index: true, element: <Navigate to="/home"/>},
      {path: "chat/:id", element: <Chat/>},
      {path: "old", element: <Navigate to="/home"/>},
      {path: "*", element: <Missing/>}
    ]}
  ])`, "fixture.tsx");
  assert.deepEqual(routes.map((route) => routeKey(route.path, route.kind)), [
    "/dev::screen", "/::layout", "/::index", "/chat/:id::screen", "/old::redirect", "/*::fallback",
  ]);
  assert.throws(() => mainUiRoutes("createBrowserRouter([{path: computed, element: <Page/>}])", "dynamic.tsx"), /Dynamic UI path/);
  assert.throws(() => mainUiRoutes("createBrowserRouter([...externalRoutes])", "unknown.tsx"), /Unresolved UI route/);
  assert.deepEqual(jsxRoutes(`<Routes><Route path="/" element={<Layout/>}>
    <Route index element={<Home/>}/><Route path="users/:id" element={<User/>}/>
    <Route path="*" element={<Missing/>}/></Route></Routes>`, "admin.tsx").map((route) => route.path),
  ["/", "/", "/users/:id", "/*"]);
  assert.throws(() => jsxRoutes("<Route path={computed}/>", "dynamic.tsx"), /dynamic JSX route/);
  assert.equal(parameterized("/api/users/{user_id}/courses/{course_id}?limit=5"), "/api/users/{}/courses/{}");
  assert.notEqual(parameterized("/api/users/{id}"), parameterized("/api/courses/{id}"));
  const fixture = join(auditDir, "fixture.md");
  const body = '# Header\n\n<a id="explicit"></a>\n[ok](#header)\n[also ok](#explicit)\n';
  assert.deepEqual(await checkLinks(fixture, body, new Map([[fixture, body]])), []);
  assert.equal((await checkLinks(fixture, "[bad](#missing)", new Map([[fixture, body]]))).length, 1);
  assert(anchors("# Same\n# Same").has("same-1"));
  console.log("PASS ten static-validator checks: route extraction, dynamic-route rejection, parameter normalization and Markdown anchors.");
  process.exit(0);
}

const inventory = await readJson("api-inventory.json");
assert(Array.isArray(inventory.routes) && inventory.routes.length, "API inventory must contain explicit source routes");
for (const route of inventory.routes) {
  assert(["mounted", "conditional", "shadowed", "unmounted", "unresolved"].includes(route.registration),
    `Unknown registration status: ${route.registration}`);
  assert(route.service && route.source && route.handler && route.handler_id && route.method && route.path?.startsWith("/"),
    "API route has incomplete identity");
}
const sidecars = await Promise.all(["main-service.json", "main-domains.json", "admin.json", "main-ui.json"].map(readJson));
const frameworkWorkflow = {
  id: "framework-api-documentation",
  title: "Framework-generated API schema and documentation",
  doc: "README.md#framework-api-documentation",
  actors: ["API client or operator able to reach the backend"],
  agent_tools: ["FastAPI/Starlette schema and documentation handlers; no agent"],
  permissions: ["No application-handler dependency is attached to the generated entries in this snapshot. Application middleware and deployment access restrictions remain separate; live access was not tested."],
  state_changes: ["Schema generation can cache the OpenAPI document in process. Reading the schema or documentation does not itself execute a business operation or write learner/course records."],
  success: ["GET/HEAD serves the configured schema, documentation page or Swagger OAuth redirect helper. The explicit main GET /docs registration is mapped separately."],
  failure_retry: ["HTTP/schema generation or browser asset-loading errors require a read/reload retry. Executing a documented API operation follows that operation's own permission, mutation and retry contract."],
  classification: "current",
  handlers: [],
  source_refs: [...new Set(inventory.framework_routes.map((route) => route.source))].map((path) => ({ path })),
  doc_refs: ["docs/workflows/README.md"],
};
for (const route of inventory.framework_routes) {
  assert(["GET", "HEAD"].includes(route.method) && route.dependencies.length === 0,
    "Framework contract changed; re-audit its methods and dependencies");
}
sidecars.push({ service: "framework", workflows: [frameworkWorkflow] });
const workflows = new Map();
const primaryHandlers = new Map();
const sidecarSources = new Set();
const errors = [];
const required = ["actors", "agent_tools", "permissions", "state_changes", "success", "failure_retry", "source_refs", "doc_refs"];

for (const sidecar of sidecars) {
  assert(Array.isArray(sidecar.workflows), "Missing workflow list");
  for (const workflow of sidecar.workflows) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(workflow.id)) errors.push(`Invalid workflow id: ${workflow.id}`);
    if (workflows.has(workflow.id)) errors.push(`Duplicate workflow id: ${workflow.id}`);
    workflows.set(workflow.id, workflow);
    for (const key of required) {
      if (!Array.isArray(workflow[key]) || workflow[key].length === 0) errors.push(`${workflow.id}: missing ${key}`);
    }
    if (!workflow.title || !workflow.doc || !workflow.classification) errors.push(`${workflow.id}: incomplete metadata`);
    for (const handler of workflow.handlers || []) {
      if (primaryHandlers.has(handler)) errors.push(`Multiple primary workflows for ${handler}`);
      primaryHandlers.set(handler, workflow.id);
    }
    for (const ref of workflow.source_refs || []) {
      sidecarSources.add(ref.path);
      try {
        assert((await stat(fromRoot(ref.path))).isFile());
        if (ref.symbol && !/^[A-Za-z_$][\w$]*(?:\.(?:[A-Za-z_$][\w$]*|<locals>))*$/.test(ref.symbol)) {
          errors.push(`${workflow.id}: source symbol is not an identifier: ${ref.symbol}`);
        }
      }
      catch { errors.push(`${workflow.id}: missing source ${ref.path}`); }
    }
    for (const ref of workflow.doc_refs || []) {
      try { assert((await stat(fromRoot(ref.split("#")[0]))).isFile()); }
      catch { errors.push(`${workflow.id}: missing referenced guide ${ref}`); }
    }
  }
  for (const surface of [...(sidecar.ui_routes || []), ...(sidecar.ui_actions || [])]) {
    if (!sidecar.workflows.some((workflow) => workflow.id === surface.workflow_id)) errors.push(`Unmapped UI surface: ${surface.path || surface.id}`);
    if (!surface.source || !surface.path && !surface.id) errors.push("A UI surface lacks stable identity/source");
    if (surface.source) sidecarSources.add(surface.source);
  }
}

const supported = inventory.routes.filter((route) => ["mounted", "conditional", "shadowed"].includes(route.registration));
for (const route of supported) {
  if (!primaryHandlers.has(route.handler_id)) errors.push(`Undocumented API handler: ${route.handler_id} (${route.method} ${route.path})`);
}
const inventoryHandlers = new Set(inventory.routes.map((route) => route.handler_id));
for (const [handler, workflow] of primaryHandlers) {
  if (!inventoryHandlers.has(handler)) errors.push(`${workflow}: handler not present in API inventory: ${handler}`);
}
for (const file of inventory.source_files || []) {
  if (sha(await readFile(fromRoot(file.path))) !== file.sha256) errors.push(`API source changed since inventory: ${file.path}`);
}
for (const unresolved of inventory.unresolved || []) errors.push(`Unresolved API inventory item: ${JSON.stringify(unresolved)}`);
for (const route of inventory.routes.filter((route) => route.registration === "unresolved")) {
  errors.push(`Unresolved route registration: ${route.handler_id}`);
}

const mainUi = sidecars.find((sidecar) => sidecar.service === "main-ui");
const routerPath = "Agentic Shiksha Platform/Frontend/src/router.tsx";
const discoveredUi = mainUiRoutes(await readFile(fromRoot(routerPath), "utf8"), routerPath);
const expectedUi = new Set(discoveredUi.map((route) => routeKey(route.path, route.kind)));
const mappedUi = new Set((mainUi.ui_routes || []).map((route) => routeKey(route.path, route.kind)));
for (const key of expectedUi) if (!mappedUi.has(key)) errors.push(`Undocumented main UI route: ${key}`);
for (const key of mappedUi) if (!expectedUi.has(key)) errors.push(`Documented main UI route not found: ${key}`);
assert.equal(mappedUi.size, mainUi.ui_routes.length, "Duplicate main UI route mapping");

const admin = sidecars.find((sidecar) => sidecar.service === "admin");
const adminRouteFiles = [...new Set((admin.ui_routes || []).map((route) => route.source))];
const discoveredAdminUi = (await Promise.all(adminRouteFiles.map(async (path) => jsxRoutes(await readFile(fromRoot(path), "utf8"), path)))).flat();
const adminExpectedPaths = discoveredAdminUi.map((route) => route.path).sort();
const adminMappedPaths = (admin.ui_routes || []).map((route) => route.path.startsWith("/") ? route.path : `/${route.path}`).sort();
if (JSON.stringify(adminExpectedPaths) !== JSON.stringify(adminMappedPaths)) {
  errors.push(`Admin UI route mismatch: source=${JSON.stringify(adminExpectedPaths)}; documented=${JSON.stringify(adminMappedPaths)}`);
}

const apiTargets = [];
for (const sidecar of sidecars) {
  const callers = [
    ...sidecar.workflows.map((workflow) => ({ workflow: workflow.id, targets: workflow.api_targets || [] })),
    ...(sidecar.ui_actions || []).map((action) => ({
      workflow: action.workflow_id, ui_action: action.id, condition: action.condition, targets: action.api_targets || [],
    })),
  ];
  for (const caller of callers) {
    for (const target of caller.targets) {
      const matches = supported.filter((route) => route.service === target.service
        && route.method.toUpperCase() === target.method.toUpperCase()
        && parameterized(route.path) === parameterized(target.path));
      if (!matches.length) errors.push(`${caller.workflow}: API target not registered: ${target.method} ${target.path}`);
      apiTargets.push({
        workflow: caller.workflow, ...(caller.ui_action ? { ui_action: caller.ui_action, condition: caller.condition } : {}),
        ...target, api_workflows: [...new Set(matches.map((route) => primaryHandlers.get(route.handler_id)))],
      });
    }
  }
}

function guideFromJson(sidecar) {
  return `# Main frontend workflow coverage\n\n[Audit index](README.md) / [API endpoint index](api-index.md)\n\nSource snapshot: **2026-09-30**. Generated from [main-ui.json](main-ui.json). UI gates are presentation, not proof of server authorization. The API guides document actual enforcement and limitations. A workflow may be a tab, dialog or artifact action rather than a separate URL.\n\n## Registered routes\n\n| Path | Kind / condition | Primary workflow |\n| --- | --- | --- |\n${sidecar.ui_routes.map((route) => `| \`${route.path}\` | ${escapeCell(route.kind)} / ${escapeCell(route.condition)} | [${workflows.get(route.workflow_id).title}](#${route.workflow_id}) |`).join("\n")}\n\n## Reachable action families\n\nThese are manually traced component actions, not additional URL routes or a claim that every possible event interleaving has been tested.\n\n| Action | Source | Primary workflow |\n| --- | --- | --- |\n${sidecar.ui_actions.map((action) => `| ${escapeCell(action.title)} | ${sourceLink(action.source, action.id)} | [${action.workflow_id}](#${action.workflow_id}) |`).join("\n")}\n\n${sidecar.workflows.map((workflow) => `<a id="${workflow.id}"></a>\n## ${workflow.title}\n\n**Classification:** ${workflow.classification}.\n\n${[
    ["Actors", "actors"], ["Actual agent, tool or worker", "agent_tools"], ["Permissions", "permissions"],
    ["State changes", "state_changes"], ["Success path", "success"], ["Failure and retry behavior", "failure_retry"],
  ].map(([title, key]) => `**${title}**\n${workflow[key].map((item) => `- ${item}`).join("\n")}`).join("\n\n")}\n\n**API hand-offs**\n${workflow.api_targets.length ? workflow.api_targets.map((target) => {
    const linked = apiTargets.find((item) => item.workflow === workflow.id && item.method === target.method && item.path === target.path);
    return `- \`${target.method} ${target.path}\` (${target.service}); ${linked.api_workflows.map((id) => `[${id}](${workflows.get(id).doc})`).join(", ")}.`;
  }).join("\n") : "- Local action or part of the surrounding chat/tool flow; no independent API request is implied."}\n\n**Source evidence**\n${workflow.source_refs.map((ref) => `- ${sourceLink(ref.path, ref.symbol || ref.path)}`).join("\n")}\n\n**Existing guides**\n${workflow.doc_refs.map((ref) => `- ${sourceLink(ref)}`).join("\n")}\n`).join("\n")}\n## Explicit exclusions\n\n${sidecar.exclusions.map((item) => `- **${item.surface}:** ${item.reason}`).join("\n")}\n`;
}

if (errors.length) {
  console.error(errors.map((error) => `FAIL ${error}`).join("\n"));
  process.exit(1);
}
const mainUiGuide = guideFromJson(mainUi);
for (const workflow of workflows.values()) {
  const [filename, anchor] = workflow.doc.split("#");
  try {
    const body = filename === "main-ui.md" && write ? mainUiGuide : await readFile(join(auditDir, filename), "utf8");
    if (!body.includes(`id="${anchor}"`)) errors.push(`${workflow.id}: missing guide anchor ${workflow.doc}`);
  } catch { errors.push(`${workflow.id}: missing guide ${filename}`); }
}

if (errors.length) {
  console.error(errors.map((error) => `FAIL ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  const routeRows = supported.map((route) => ({ ...route, workflow: primaryHandlers.get(route.handler_id) }));
  const summary = {
    snapshot: "2026-09-30",
    basis: "Static source coverage, not live deployment/OpenAPI or a runtime test",
    api_routes: routeRows.length,
    api_handlers: new Set(routeRows.map((route) => route.handler_id)).size,
    framework_operations: inventory.framework_routes.length,
    workflows: workflows.size,
    main_ui_routes: discoveredUi.length,
    admin_ui_routes: discoveredAdminUi.length,
    ui_action_families: sidecars.reduce((sum, sidecar) => sum + (sidecar.ui_actions || []).length, 0),
    mapped_api_handlers: primaryHandlers.size,
    unmapped_api_handlers: 0,
    unmapped_main_ui_routes: 0,
    unmapped_admin_ui_routes: 0,
    unresolved_inventory: 0,
    services: [...new Set(routeRows.map((route) => route.service))].sort().map((service) => {
      const routes = routeRows.filter((route) => route.service === service);
      return {
        service,
        registrations: routes.length,
        unique_method_paths: new Set(routes.map((route) => `${route.method} ${route.path}`)).size,
        handlers: new Set(routes.map((route) => route.handler_id)).size,
        by_registration: Object.fromEntries(["mounted", "conditional", "shadowed"].map((registration) => [
          registration, routes.filter((route) => route.registration === registration).length,
        ])),
      };
    }),
    source_files: await Promise.all([...sidecarSources].sort().map(async (path) => ({ path, sha256: sha(await readFile(fromRoot(path))) }))),
  };
  const endpointIndex = `# API-to-workflow index\n\n[Coverage audit](README.md)\n\nEvery explicit mounted/conditional/shadowed registration in [api-inventory.json](api-inventory.json) maps to one primary workflow below. Multiple methods, aliases and shadowed declarations remain visible; these are not all independent user journeys. Unmounted declarations are listed separately in the static inventory.\n\n| Service | Method / path | Registration | Primary workflow | Source handler |\n| --- | --- | --- | --- | --- |\n${routeRows.map((route) => `| ${route.service} | \`${route.method} ${escapeCell(route.path)}\` | ${route.registration} | [${route.workflow}](${workflows.get(route.workflow).doc}) | ${sourceLink(route.source, `\`${route.handler}\``, route.line)} |`).join("\n")}\n\n## Framework-generated surfaces\n\nThese are counted separately from explicit application registrations. All use the [framework documentation contract](README.md#framework-api-documentation).\n\n| Service | Method / path | Surface | Source configuration |\n| --- | --- | --- | --- |\n${inventory.framework_routes.map((route) => `| ${route.service} | \`${route.method} ${route.path}\` | ${route.surface} | ${sourceLink(route.source, route.setting, route.line)} |`).join("\n")}\n\n## UI-to-API hand-offs\n\nThese preserve service boundaries and documented UI conditions. A registered destination does not by itself prove a caller has permission or that a deployment enables the feature.\n\n| UI contract / action | Service | Request | Primary API contract | UI condition |\n| --- | --- | --- | --- | --- |\n${apiTargets.map((target) => `| [${target.ui_action || target.workflow}](${workflows.get(target.workflow).doc}) | ${target.service} | \`${target.method} ${target.path}\` | ${target.api_workflows.map((id) => `[${id}](${workflows.get(id).doc})`).join(", ")} | ${escapeCell(target.condition || "See UI contract")} |`).join("\n")}\n`;
  const coveragePage = `# Verified static workflow coverage\n\n[Audit scope and reproduction](README.md) / [API index](api-index.md) / [Machine-readable results](coverage.json)\n\nSnapshot: **${summary.snapshot}**. This is source-to-documentation coverage, not a live integration test. See the audit scope for exclusions and counting rules.\n\n## API registrations\n\n| Service | Registrations | Distinct method/path pairs | Handlers | Conditional | Shadowed |\n| --- | ---: | ---: | ---: | ---: | ---: |\n${summary.services.map((service) => `| ${service.service} | ${service.registrations} | ${service.unique_method_paths} | ${service.handlers} | ${service.by_registration.conditional} | ${service.by_registration.shadowed} |`).join("\n")}\n\nAdditionally, **${summary.framework_operations} framework-generated GET/HEAD operations** have the separate [documentation contract](README.md#framework-api-documentation) and [route index](api-index.md#framework-generated-surfaces).\n\n## UI declarations and contracts\n\n| Measure | Verified count |\n| --- | ---: |\n| Main frontend route/layout/index declarations | ${summary.main_ui_routes} |\n| Admin frontend route declarations | ${summary.admin_ui_routes} |\n| Manually traced reachable UI action families | ${summary.ui_action_families} |\n| Workflow contracts, including framework documentation | ${summary.workflows} |\n| Unmapped API handlers | 0 |\n| Unmapped main/admin UI routes | 0 |\n| Unresolved API inventory expressions | 0 |\n\nRoute extraction and contract/link checks are automated; the semantic action-family trace is manual and source-linked. Source hashes and exact UI/API hand-offs are in the machine-readable result.\n\n## Workflow matrix\n\nEach linked contract includes permissions, state changes, success, failure/retry behavior and source evidence. A UI row with zero primary handlers can still call APIs; its hand-offs link to their primary contracts.\n\n| Workflow | Actors | Actual agent / tool | Classification | Primary API handlers |\n| --- | --- | --- | --- | ---: |\n${[...workflows.values()].map((workflow) => `| [${escapeCell(workflow.title)}](${workflow.doc}) | ${escapeCell(workflow.actors.join("; "))} | ${escapeCell(workflow.agent_tools.join("; "))} | ${workflow.classification} | ${(workflow.handlers || []).length} |`).join("\n")}\n`;
  const outputs = new Map([
    [join(auditDir, "main-ui.md"), mainUiGuide],
    [join(auditDir, "api-index.md"), endpointIndex],
    [join(auditDir, "coverage.md"), coveragePage],
    [join(auditDir, "coverage.json"), JSON.stringify({
      ...summary,
      framework_workflow: frameworkWorkflow,
      framework_routes: inventory.framework_routes.map((route) => ({ ...route, workflow: frameworkWorkflow.id })),
      api_targets: apiTargets,
    }, null, 2) + "\n"],
  ]);
  const guideFiles = [...new Set(["README.md", "coverage.md", "api-index.md", ...[...workflows.values()].map((workflow) => workflow.doc.split("#")[0])])];
  const linkFailures = (await Promise.all(guideFiles.map(async (filename) => {
    const path = join(auditDir, filename);
    return checkLinks(path, outputs.get(path) || await readFile(path, "utf8"), outputs);
  }))).flat();
  assert.equal(linkFailures.length, 0, linkFailures.join("\n"));
  if (write) {
    for (const [path, content] of outputs) await writeFile(path, content);
  } else {
    for (const [path, content] of outputs) {
      if (await readFile(path, "utf8") !== content) {
        throw new Error(`Generated audit is stale: ${path}. Review source changes, then regenerate with --write.`);
      }
    }
  }
  console.log(`PASS ${summary.api_routes} API registrations / ${summary.api_handlers} handlers / ${summary.workflows} workflows / ${summary.main_ui_routes} main UI routes / ${summary.admin_ui_routes} admin UI routes / ${summary.ui_action_families} UI action families.`);
  console.log("No unmapped API handlers, main/admin UI routes, stale source hashes or unresolved inventory entries.");
}
