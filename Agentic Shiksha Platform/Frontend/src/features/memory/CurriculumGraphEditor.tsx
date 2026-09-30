import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useUserStore } from "@/lib/userStore";
import { prefixedId, randomUuid } from "@/lib/secureId";
import { learnerMemoryApi, MemoryApiError, type CurriculumDraft, type CurriculumGraph, type GraphNodeType, type GraphRelation, type MemoryConfig, type MemoryMode } from "@/lib/learnerMemoryApi";
import { NODE_TYPES, RELATIONS, parseGraph, parsePolicy, validateGraph } from "./curriculumGraphValidation";
import { memoryLabel } from "./GraphMemoryPanel";

const field = "w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-200";
const button = "rounded-md border border-neutral-600 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40";

function emptyGraph(agentId: string, config: MemoryConfig): CurriculumGraph {
  return {
    tenant_id: config.memory_scope?.tenant_id || "",
    institute_ids: config.memory_scope ? [config.memory_scope.institute_id] : [],
    curriculum_id: config.curriculum_binding?.curriculum_id || prefixedId("curriculum"),
    version: "1", course_name: agentId, course_ids: [agentId],
    status: "DRAFT", published_ready: false,
    nodes: [{ id: agentId, type: "COURSE", name: agentId, active: true }],
    edges: [],
    policies: {
      version: "review-required-v1", teacher_reviewed: false, confidence_calibrated: false,
      required_misconception_coverage: 1, require_reasoning_for_clearance: true,
      min_clearance_independent_probes: 2, min_clearance_contexts: 2, min_clearance_families: 2,
      require_transfer_for_crossing: true,
    },
  };
}

export function CurriculumGraphEditor({ agentId, config, onConfigChanged }: {
  agentId: string; config: MemoryConfig; onConfigChanged: () => void;
}) {
  const userId = useUserStore(state => state.userId);
  const [draft, setDraft] = useState<CurriculumDraft | null>(null);
  const [graph, setGraph] = useState<CurriculumGraph | null>(null);
  const [policyText, setPolicyText] = useState("");
  const [graphText, setGraphText] = useState("");
  const [jsonOpen, setJsonOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const [mode, setMode] = useState<MemoryMode>(config.mode);
  const [tenantId, setTenantId] = useState(config.memory_scope?.tenant_id || "");
  const [instituteId, setInstituteId] = useState(config.memory_scope?.institute_id || "");
  const [bindingId, setBindingId] = useState(config.curriculum_binding?.curriculum_id || "");
  const [bindingVersion, setBindingVersion] = useState(config.curriculum_binding?.curriculum_version || "1");
  const publishKey = useRef(randomUuid());
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setDirty(false);
    setGraph(null);
    setDraft(null);
    learnerMemoryApi.getDraft(agentId, controller.signal)
      .then(value => {
        if (controller.signal.aborted) return;
        setDraft(value); setGraph(value.graph); setPolicyText(JSON.stringify(value.graph.policies, null, 2));
      })
      .catch(cause => {
        if (controller.signal.aborted) return;
        if (cause instanceof MemoryApiError && cause.status === 404) {
          const initial = emptyGraph(agentId, config);
          setGraph(initial); setPolicyText(JSON.stringify(initial.policies, null, 2));
        } else setError(cause instanceof Error ? cause.message : "The graph draft could not be loaded.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [agentId, reload]);
  const change = (value: CurriculumGraph) => {
    setGraph(value); setDirty(true); setNotice(""); setError(""); publishKey.current = randomUuid();
  };
  const save = async () => {
    if (!graph || busy) return;
    setError(""); setNotice("");
    let next: CurriculumGraph;
    try {
      next = { ...graph, policies: parsePolicy(policyText), status: "DRAFT", published_ready: false };
      const errors = validateGraph(next);
      if (errors.length) throw new Error(errors.join(" "));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Invalid graph."); return; }
    setBusy(true);
    try {
      const saved = await learnerMemoryApi.saveDraft(agentId, next, draft?.graph.version === next.version ? draft.revision : null);
      setDraft(saved); setGraph(saved.graph); setPolicyText(JSON.stringify(saved.graph.policies, null, 2)); setDirty(false);
      publishKey.current = randomUuid(); setNotice(`Draft revision ${saved.revision} saved. It is not live until published.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Draft save failed."); }
    finally { setBusy(false); }
  };
  const publish = async () => {
    if (!draft?.revision || !graph || busy || dirty) return;
    const errors = validateGraph(graph, true);
    if (errors.length) { setError(errors.join(" ")); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await learnerMemoryApi.publish(agentId, draft, config.revision, publishKey.current);
      setBindingId(result.graph.curriculum_id);
      setBindingVersion(result.graph.version);
      setNotice(`Published curriculum ${result.graph.version}. A scoped administrator must activate this binding separately. Learner states require revalidation when the new graph or policy is activated.`);
      onConfigChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Publication failed."); }
    finally { setBusy(false); }
  };
  const configure = async () => {
    setBusy(true); setError("");
    try {
      await learnerMemoryApi.setConfig(agentId, {
        mode, memory_scope: { tenant_id: tenantId.trim(), institute_id: instituteId.trim() },
        curriculum_binding: { curriculum_id: bindingId.trim(), curriculum_version: bindingVersion.trim() },
        revision: config.revision,
      });
      setNotice("Course memory configuration saved. Enabling requires a compatible published graph and an approved scope.");
      onConfigChanged(); setReload(value => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Configuration failed."); }
    finally { setBusy(false); }
  };
  const importCurriculum = async () => {
    if (!graph || busy || dirty) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const imported = await learnerMemoryApi.importExistingCurriculum(agentId, graph.version, draft?.revision ?? null);
      setDraft(imported); setGraph(imported.graph); setPolicyText(JSON.stringify(imported.graph.policies, null, 2)); setDirty(false);
      setNotice("Existing course content imported as an unreviewed draft. Review stable mappings, independent diagnostic families, rubrics, transfer and policy before publication.");
      publishKey.current = randomUuid();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The existing curriculum could not be imported."); }
    finally { setBusy(false); }
  };
  return <section aria-label="Curriculum graph editor" className="space-y-4 text-neutral-200">
    <header><h3 className="text-base font-semibold">Curriculum graph &amp; crossing policy</h3>
      <p className="mt-1 text-xs text-neutral-400">Stable IDs define meaning across versions. Save a draft, review explicit prerequisites and required mappings, then publish an immutable version. Syllabus order is not prerequisite order.</p>
      <p className="mt-2 text-xs text-amber-300">Graph or policy changes require learner-state revalidation; old crossings are not automatically carried forward.</p>
    </header>
    {config.can_manage && <details className="rounded-lg border border-neutral-700 p-3"><summary className="cursor-pointer text-sm">Administrator course configuration</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs">Mode<select className={field} value={mode} onChange={event => setMode(event.target.value as MemoryMode)}><option value="off">Off</option><option value="shadow">Shadow</option><option value="authoritative">Authoritative</option></select></label>
        <label className="text-xs">Approved tenant ID<input className={field} value={tenantId} onChange={event => setTenantId(event.target.value)} /></label>
        <label className="text-xs">Approved institute ID<input className={field} value={instituteId} onChange={event => setInstituteId(event.target.value)} /></label>
        <label className="text-xs">Binding curriculum ID<input className={field} value={bindingId} onChange={event => setBindingId(event.target.value)} /></label>
        <label className="text-xs">Binding curriculum version<input className={field} value={bindingVersion} onChange={event => setBindingVersion(event.target.value)} /></label>
      </div><button className={`${button} mt-3`} disabled={busy} onClick={() => void configure()}>Save course configuration</button>
      <p className="mt-2 text-xs text-neutral-500">The server verifies scope and authorization. These fields do not grant access.</p>
    </details>}
    {loading && <p role="status" className="flex gap-2 text-xs text-neutral-400"><Loader2 className="h-4 w-4 animate-spin" />Loading graph draft…</p>}
    {error && <p role="alert" className="whitespace-pre-wrap rounded-md border border-rose-900 p-3 text-xs text-rose-300">{error}</p>}
    {notice && <p role="status" className="rounded-md border border-sky-900 p-3 text-xs text-sky-200">{notice}</p>}
    {graph && <>
      <div className="rounded-lg border border-neutral-800 p-3">
        <button className={button} disabled={busy || dirty || graph.status === "PUBLISHED"} onClick={() => void importCurriculum()}>Import existing course curriculum</button>
        <p className="mt-2 text-xs text-neutral-400">Imports a reviewed-scope copy of generated course content into this draft. It does not publish policies or carry forward learner crossings.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs">Curriculum ID<input className={field} value={graph.curriculum_id} onChange={event => change({ ...graph, curriculum_id: event.target.value, nodes: graph.nodes.map(node => ({ ...node, curriculum_id: event.target.value })), edges: graph.edges.map(edge => ({ ...edge, curriculum_id: event.target.value })) })} /></label>
        <label className="text-xs">Target graph version<input className={field} value={graph.version} onChange={event => change({ ...graph, version: event.target.value, nodes: graph.nodes.map(node => ({ ...node, curriculum_version: event.target.value })), edges: graph.edges.map(edge => ({ ...edge, curriculum_version: event.target.value })) })} /></label>
      </div>
      <section className="space-y-2"><h4 className="text-sm font-medium">Nodes</h4>
        {graph.nodes.map((node, index) => <div key={index} className="grid gap-2 rounded-lg border border-neutral-800 p-3 sm:grid-cols-3">
          <label className="text-xs text-neutral-400">Stable ID<input className={field} value={node.id} onChange={event => change({ ...graph, nodes: graph.nodes.map((item, i) => i === index ? { ...item, id: event.target.value } : item) })} /></label>
          <label className="text-xs text-neutral-400">Node type<select className={field} value={node.type} onChange={event => change({ ...graph, nodes: graph.nodes.map((item, i) => i === index ? { ...item, type: event.target.value as GraphNodeType } : item) })}>{NODE_TYPES.map(type => <option key={type}>{type}</option>)}</select></label>
          <label className="text-xs text-neutral-400">Name<input className={field} value={node.name} onChange={event => change({ ...graph, nodes: graph.nodes.map((item, i) => i === index ? { ...item, name: event.target.value } : item) })} /></label>
          <label className="text-xs text-neutral-400 sm:col-span-3">Description<textarea className={field} value={node.description || ""} onChange={event => change({ ...graph, nodes: graph.nodes.map((item, i) => i === index ? { ...item, description: event.target.value } : item) })} /></label>
          {node.type === "TC" && <label className="text-xs text-neutral-400 sm:col-span-3">Crossing policy version<input className={field} value={node.crossing_policy_version || ""} onChange={event => change({ ...graph, nodes: graph.nodes.map((item, i) => i === index ? { ...item, crossing_policy_version: event.target.value } : item) })} /></label>}
          {node.type === "PROBLEM" && <p className="text-xs text-neutral-400 sm:col-span-3">Use the complete graph JSON editor below to define options, the private answer key, independent family, reviewed rubric dimensions and diagnostic/transfer approval.</p>}
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={node.active !== false} onChange={event => change({ ...graph, nodes: graph.nodes.map((item, i) => i === index ? { ...item, active: event.target.checked } : item) })} />Active</label>
          <button className={button} onClick={() => change({ ...graph, nodes: graph.nodes.filter((_, i) => i !== index) })}>Remove node</button>
        </div>)}
        <button className={button} onClick={() => change({ ...graph, nodes: [...graph.nodes, { id: prefixedId("tc"), type: "TC", name: "New concept", active: true }] })}>Add node</button>
      </section>
      <section className="space-y-2"><h4 className="text-sm font-medium">Edges, required mappings &amp; transfer</h4>
        {graph.edges.map((edge, index) => {
          const update = (value: Partial<typeof edge>) => change({ ...graph, edges: graph.edges.map((item, i) => i === index ? { ...item, ...value } : item) });
          return <div key={index} className="grid gap-2 rounded-lg border border-neutral-800 p-3 sm:grid-cols-2">
            <label className="text-xs text-neutral-400">Source ID<select className={field} value={edge.source_id} onChange={event => update({ source_id: event.target.value })}><option value="">Select source</option>{graph.nodes.map(node => <option key={node.id} value={node.id}>{node.id} · {node.name}</option>)}</select></label>
            <label className="text-xs text-neutral-400">Target ID<select className={field} value={edge.target_id} onChange={event => update({ target_id: event.target.value })}><option value="">Select target</option>{graph.nodes.map(node => <option key={node.id} value={node.id}>{node.id} · {node.name}</option>)}</select></label>
            <label className="text-xs text-neutral-400">Relation<select className={field} value={edge.relation} onChange={event => {
              const relation = event.target.value as GraphRelation;
              update({
                relation, required_for_crossing: relation === "ASSOCIATED_WITH" || relation === "HAS_TRANSFER_PROBE" ? false : null,
                threshold_relevance: relation === "ASSOCIATED_WITH" ? "SIGNIFICANT" : null,
                transfer_condition_id: relation === "HAS_TRANSFER_PROBE" ? edge.transfer_condition_id : null,
                reviewed: false,
              });
            }}>{Object.keys(RELATIONS).map(relation => <option key={relation} value={relation}>{memoryLabel(relation)}</option>)}</select></label>
            {(edge.relation === "ASSOCIATED_WITH" || edge.relation === "HAS_TRANSFER_PROBE") && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={edge.required_for_crossing === true} onChange={event => update({ required_for_crossing: event.target.checked })} />Required for crossing</label>}
            {["ASSOCIATED_WITH", "HAS_TRANSFER_PROBE", "DIAGNOSES"].includes(edge.relation) && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={edge.reviewed === true} onChange={event => update({ reviewed: event.target.checked })} />Mapping reviewed</label>}
            {edge.relation === "ASSOCIATED_WITH" && <label className="text-xs text-neutral-400">Threshold relevance<select className={field} value={edge.threshold_relevance || "SIGNIFICANT"} onChange={event => update({ threshold_relevance: event.target.value as "BLOCKING" | "SIGNIFICANT" | "PERIPHERAL" })}><option>BLOCKING</option><option>SIGNIFICANT</option><option>PERIPHERAL</option></select></label>}
            {(edge.relation === "HAS_TRANSFER_PROBE" || edge.relation === "DIAGNOSES") && <>
              <label className="text-xs text-neutral-400">Problem version<input className={field} value={edge.problem_version || ""} onChange={event => update({ problem_version: event.target.value })} /></label>
              <label className="text-xs text-neutral-400">Assessment version<input className={field} value={edge.assessment_version || ""} onChange={event => update({ assessment_version: event.target.value })} /></label>
              <label className="text-xs text-neutral-400">Rubric version<input className={field} value={edge.rubric_version || ""} onChange={event => update({ rubric_version: event.target.value })} /></label>
              {edge.relation === "HAS_TRANSFER_PROBE" && <label className="text-xs text-neutral-400">Transfer condition ID<input className={field} value={edge.transfer_condition_id || ""} onChange={event => update({ transfer_condition_id: event.target.value })} /></label>}
            </>}
            <button className={button} onClick={() => change({ ...graph, edges: graph.edges.filter((_, i) => i !== index) })}>Remove edge</button>
          </div>;
        })}
        <button className={button} onClick={() => change({ ...graph, edges: [...graph.edges, { id: prefixedId("edge"), source_id: "", target_id: "", relation: "PREREQUISITE_OF" }] })}>Add edge</button>
      </section>
      <section><label className="text-sm font-medium">Crossing policy JSON<textarea aria-label="Crossing policy JSON" className={`${field} mt-2 min-h-48 font-mono`} spellCheck={false} value={policyText} onChange={event => { setPolicyText(event.target.value); setDirty(true); setNotice(""); }} /></label>
        <p className="mt-1 text-xs text-neutral-500">Defaults are illustrative and uncalibrated. Required mappings cannot be bypassed; approved transfer problems need frozen assessment/rubric versions.</p>
        <button className={`${button} mt-2`} onClick={() => {
          try {
            const policies = { ...parsePolicy(policyText), teacher_reviewed: true, reviewed_by: userId, reviewed_at: new Date().toISOString() };
            setPolicyText(JSON.stringify(policies, null, 2)); change({ ...graph, policies });
          } catch (cause) { setError(cause instanceof Error ? cause.message : "Invalid policy JSON."); }
        }}>Mark policy reviewed</button>
      </section>
      <details open={jsonOpen} onToggle={event => setJsonOpen(event.currentTarget.open)} className="rounded-md border border-neutral-800 p-3">
        <summary className="cursor-pointer text-sm" onClick={event => {
          if (!jsonOpen) {
            try { setGraphText(JSON.stringify({ ...graph, policies: parsePolicy(policyText) }, null, 2)); }
            catch (cause) { event.preventDefault(); setError(cause instanceof Error ? cause.message : "Invalid policy JSON."); }
          }
        }}>Advanced graph JSON (problem/rubric definitions)</summary>
        <textarea aria-label="Full curriculum graph JSON" className={`${field} mt-3 min-h-64 font-mono`} value={graphText} onChange={event => setGraphText(event.target.value)} spellCheck={false} />
        <button className={`${button} mt-2`} onClick={() => {
          try { const parsed = parseGraph(graphText); change(parsed); setPolicyText(JSON.stringify(parsed.policies, null, 2)); setJsonOpen(false); }
          catch (cause) { setError(cause instanceof Error ? cause.message : "Invalid graph JSON."); }
        }}>Apply graph JSON</button>
      </details>
      <div className="flex flex-wrap items-center gap-2">
        <button className={button} disabled={busy} onClick={() => void save()}>Save graph draft</button>
        <button className={button} disabled={busy || dirty || !draft?.revision} onClick={() => void publish()}>Publish reviewed graph</button>
        <button className={button} disabled={busy} onClick={() => setReload(value => value + 1)}>Reload server draft</button>
        <span className="break-all text-xs text-neutral-500">Revision {draft?.revision ?? "not saved"}{dirty ? " · Unsaved changes" : ""}</span>
      </div>
    </>}
  </section>;
}
