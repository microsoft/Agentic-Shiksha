import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { randomUuid } from "@/lib/secureId";
import {
  learnerMemoryApi,
  type LearnerMemory,
  type MemoryConfig,
  type MemoryContext,
  type MemoryEvidence,
  type CohortMemory,
} from "@/lib/learnerMemoryApi";

export const memoryLabel = (value: string) => value.toLowerCase().replace(/_/g, " ").replace(/^./, letter => letter.toUpperCase());
const buttonClass = "rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50";
const fieldClass = "rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200";

function MemoryList({ title, ids, empty }: { title: string; ids: string[]; empty: string }) {
  return <section className="rounded-lg border border-neutral-800 p-3">
    <h4 className="text-xs font-medium text-neutral-300">{title}</h4>
    <p className="mt-1 text-xs text-neutral-400">{ids.length ? ids.join(", ") : empty}</p>
  </section>;
}

function EvidenceCitation({ agentId, studentId, evidence }: { agentId: string; studentId: string; evidence: MemoryEvidence }) {
  const id = evidence.evidence_id || evidence.id;
  const [detail, setDetail] = useState<MemoryEvidence | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const open = async () => {
    if (!id || loading) return;
    setLoading(true);
    setError("");
    try { setDetail(await learnerMemoryApi.getEvidence(agentId, studentId, id)); }
    catch { setError("This evidence could not be loaded. Access may have changed."); }
    finally { setLoading(false); }
  };
  const selected = detail || evidence;
  return <li className="rounded-md border border-neutral-800 p-3 text-xs">
    <button type="button" className="break-all text-sky-300 underline underline-offset-2" disabled={!id || loading} onClick={() => void open()}>
      Evidence {id || "reference unavailable"}
    </button>
    {selected.source && <p className="mt-1 text-neutral-400">{memoryLabel(selected.source)}</p>}
    {(selected.quote || selected.excerpt || selected.reasoning || selected.untrusted_learner_content) && <blockquote className="mt-2 whitespace-pre-wrap border-l-2 border-neutral-600 pl-3 text-neutral-300">{selected.quote || selected.excerpt || selected.reasoning || selected.untrusted_learner_content}</blockquote>}
    {(selected.observed_at || selected.occurred_at) && <time className="mt-1 block text-neutral-500" dateTime={selected.observed_at || selected.occurred_at || undefined}>{new Date(selected.observed_at || selected.occurred_at || "").toLocaleString()}</time>}
    {error && <p role="alert" className="mt-1 text-rose-300">{error}</p>}
  </li>;
}

export function GraphMemoryPanel({ agentId, studentId, config, tcId: initialTc = "", contextMode = "ta", evidenceId }: {
  agentId: string; studentId: string; config: MemoryConfig; tcId?: string; contextMode?: "ta" | "individual"; evidenceId?: string;
}) {
  const [memory, setMemory] = useState<LearnerMemory | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [tcId, setTcId] = useState(initialTc);
  const [context, setContext] = useState<MemoryContext | null>(null);
  const [contextError, setContextError] = useState("");
  const [contextLoading, setContextLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const retryId = useRef(randomUuid());
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const retryProcessing = async () => {
    setRetrying(true);
    setError("");
    try {
      await learnerMemoryApi.retryProcessing(agentId, studentId, retryId.current);
      retryId.current = randomUuid();
      refresh();
    } catch {
      setError("Processing could not be retried. The saved evidence is unchanged; retry the same operation.");
    } finally { setRetrying(false); }
  };
  useEffect(() => { setTcId(initialTc); }, [initialTc, agentId, studentId]);
  useEffect(() => {
    const controller = new AbortController();
    if (!config.enabled || config.mode === "off") return;
    setLoading(true);
    setError("");
    setMemory(null);
    learnerMemoryApi.getMemory(agentId, studentId, controller.signal)
      .then(value => { if (!controller.signal.aborted) setMemory(value); })
      .catch(() => { if (!controller.signal.aborted) setError("Learning evidence could not be loaded. No mastery or crossing can be inferred."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [agentId, studentId, config.enabled, config.mode, revision, config.curriculum_binding?.curriculum_version]);
  useEffect(() => {
    const changed = (event: Event) => {
      if (event instanceof CustomEvent && event.detail?.agentId === agentId && event.detail?.userId === studentId) refresh();
    };
    window.addEventListener("learner-memory-updated", changed);
    return () => window.removeEventListener("learner-memory-updated", changed);
  }, [agentId, studentId, refresh]);
  useEffect(() => {
    if (!memory?.pending_count || memory.processing_receipt?.status === "FAILED") return;
    const timer = window.setTimeout(refresh, 5000);
    return () => window.clearTimeout(timer);
  }, [memory, refresh]);
  useEffect(() => {
    setContext(null);
    setContextError("");
    if (!tcId) return;
    const controller = new AbortController();
    setContextLoading(true);
    learnerMemoryApi.getContext(agentId, studentId, tcId, controller.signal, contextMode)
      .then(value => { if (!controller.signal.aborted) setContext(value); })
      .catch(() => { if (!controller.signal.aborted) setContextError("Bounded graph context is unavailable. Try again after refreshing."); })
      .finally(() => { if (!controller.signal.aborted) setContextLoading(false); });
    return () => controller.abort();
  }, [agentId, studentId, tcId, revision, contextMode]);
  if (!config.enabled || config.mode === "off") return null;
  const snapshot = memory?.snapshot;
  const profile = memory?.profile || snapshot?.profile;
  const freshness = typeof memory?.freshness === "object" ? memory.freshness : null;
  const graphVersion = config.curriculum_binding?.curriculum_version;
  const snapshotVersion = profile?.curriculum_version || snapshot?.scope?.curriculum_version;
  const revalidation = Boolean(memory?.freshness === "stale" || profile?.needs_revalidation || freshness?.needs_revalidation
    || (snapshotVersion && graphVersion && snapshotVersion !== graphVersion));
  const concepts = [...new Set([
    ...Object.keys(snapshot?.concept_states || {}), ...Object.keys(snapshot?.threshold_states || {}),
    ...(profile?.strong_tcs || []), ...(profile?.weak_tcs || []), ...(profile?.unresolved_prerequisites || []),
    ...(profile?.candidate_tcs || []), ...(profile?.crossed_tcs || []), ...(profile?.active_tc ? [profile.active_tc] : []),
  ])];
  const evidence = context?.evidence || (context?.evidence_ids || []).map(evidence_id => ({ evidence_id }));
  return <section aria-label="Graph Memory" className="space-y-4 text-neutral-200" data-testid="graph-memory-panel">
    <header className="flex items-start justify-between gap-3">
      <div><h3 className="text-base font-semibold">Graph Memory</h3><p className="mt-1 text-xs text-neutral-400">Server-derived learning profile · {config.mode === "shadow" ? "Shadow mode — experimental, not authoritative" : "Authoritative evidence"}</p></div>
      <button type="button" className={buttonClass} onClick={refresh} disabled={loading} aria-label="Refresh Graph Memory"><RefreshCw className="h-3.5 w-3.5" /></button>
    </header>
    {loading && <p role="status" className="flex gap-2 text-sm text-neutral-400"><Loader2 className="h-4 w-4 animate-spin" />Loading learning evidence…</p>}
    {error && <p role="alert" className="rounded-lg border border-rose-900 p-3 text-sm text-rose-300">{error}</p>}
    {memory && <>
      <div role="status" className="rounded-lg border border-neutral-700 bg-neutral-950/50 p-3 text-xs text-neutral-300">
        <p>Snapshot {snapshot?.snapshot_version ?? 0} · Curriculum {snapshotVersion || graphVersion || "unavailable"}</p>
        <p className="mt-1">{memory.pending_count > 0 ? `${memory.pending_count} event(s) pending. Showing the last committed evidence only.` : "No pending events reported."}</p>
        {memory.processing_receipt?.status === "FAILED" && <p role="alert" className="mt-2 text-rose-300">Evidence processing failed after retries. No new learner state has been published. {contextMode === "individual" ? "Retry after resolving the reported processing issue." : "Ask your teacher to review and retry the saved evidence."}</p>}
        {memory.processing_receipt?.status === "RETRY_PENDING" && <p className="mt-2 text-amber-300">Evidence processing is waiting for a retry; it has not been graded as successful.</p>}
        {memory.processing_receipt?.status === "FAILED" && contextMode === "individual" && <button type="button" className={`${buttonClass} mt-2`} disabled={retrying} onClick={() => void retryProcessing()}>{retrying ? "Queuing retry…" : "Retry evidence processing"}</button>}
        <p className="mt-1">Freshness: {typeof memory.freshness === "string" ? memoryLabel(memory.freshness)
          : (profile?.updated_at || freshness?.as_of || snapshot?.as_of) ? `Updated ${new Date(profile?.updated_at || freshness?.as_of || snapshot?.as_of || "").toLocaleString()}` : "No evidence timestamp yet"}</p>
        {profile?.updated_at && <p className="mt-1">Last committed: <time dateTime={profile.updated_at}>{new Date(profile.updated_at).toLocaleString()}</time></p>}
        {revalidation && <p className="mt-2 font-medium text-amber-300">Revalidation required — curriculum or policy changes may invalidate earlier crossings.</p>}
      </div>
      {!snapshot || concepts.length === 0 ? <p className="rounded-lg border border-neutral-800 p-4 text-sm text-neutral-400">No evidence yet. Not assessed does not mean struggling.</p> : <>
        <p className="text-xs text-neutral-400">Concept mastery and threshold crossing are separate decisions. Unassessed prerequisites are diagnostic gaps, not weak concepts.</p>
        <div className="overflow-x-auto"><table className="w-full text-left text-xs">
          <thead className="border-b border-neutral-700 text-neutral-400"><tr><th className="p-2">Stable concept ID</th><th className="p-2">Concept mastery</th><th className="p-2">Threshold crossing</th></tr></thead>
          <tbody>{concepts.map(id => {
            const concept = snapshot.concept_states[id];
            const threshold = snapshot.threshold_states[id];
            return <tr key={id} className="border-b border-neutral-800">
              <td className="p-2"><button className="text-left text-sky-300 underline" onClick={() => setTcId(id)}>{id}</button></td>
              <td className="p-2">{memoryLabel(concept?.state || "NOT_ATTEMPTED")}</td>
              <td className="p-2">{revalidation ? "Revalidation required" : memoryLabel(threshold?.state || "NOT_CROSSED")}
                {threshold && <p className="mt-1 text-[10px] text-neutral-500">Required cleared: {threshold.required_cleared ?? 0}/{threshold.required_total ?? 0} · Transfer: {memoryLabel(threshold.transfer_state || "NOT_ATTEMPTED")}</p>}
                {threshold?.reason_codes?.length ? <p className="mt-1 text-neutral-400">{threshold.reason_codes.map(memoryLabel).join("; ")}</p> : null}
              </td>
            </tr>;
          })}</tbody>
        </table></div>
      </>}
      {profile && <div className="space-y-3" aria-label="Learning profile">
        <p className="text-sm">Active concept: <span className="text-neutral-400">{profile.active_tc || "Not selected"}</span> · Trend: {memoryLabel(profile.learning_trend)}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <MemoryList title="Strong concepts (mastery)" ids={profile.strong_tcs} empty="No mastery evidence yet" />
          <MemoryList title="Needs support (assessed)" ids={profile.weak_tcs} empty="No assessed struggles recorded" />
          <MemoryList title="Threshold candidates" ids={profile.candidate_tcs} empty="No candidates yet" />
          <MemoryList title={revalidation ? "Earlier crossings — revalidation required" : "Crossed thresholds"} ids={profile.crossed_tcs} empty="No verified crossings yet" />
          <MemoryList title="Unresolved prerequisites (diagnostic gaps)" ids={profile.unresolved_prerequisites} empty="No unresolved prerequisites recorded" />
          <MemoryList title="Active misconceptions" ids={Object.entries(profile.active_misconceptions).map(([id, item]) => `${id}: ${memoryLabel(item.state)}`)} empty="No active misconceptions recorded; unassessed is not cleared" />
        </div>
        {profile.next_recommended_probe && <p className="rounded-lg border border-sky-900/70 p-3 text-xs text-sky-200">Next recommended probe: {profile.next_recommended_probe.problem_id || profile.next_recommended_probe.tc_id} — {memoryLabel(profile.next_recommended_probe.reason_code)}</p>}
      </div>}
      {snapshot && Object.keys(snapshot.misconception_states).length > 0 && <section aria-label="Misconception evidence" className="rounded-lg border border-neutral-800 p-3">
        <h4 className="text-sm font-medium">Misconception evidence</h4>
        <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto text-xs text-neutral-400">
          {Object.entries(snapshot.misconception_states).map(([id, entry]) => <li key={id}><span className="text-neutral-200">{id}</span> · {memoryLabel(entry.state)}{entry.trend ? ` · ${memoryLabel(entry.trend)}` : ""}{entry.qualifying_evidence_count !== undefined ? ` · ${entry.qualifying_evidence_count} qualifying evidence item(s)` : ""}</li>)}
        </ul>
      </section>}
      <section className="border-t border-neutral-800 pt-4" aria-label="Evidence and graph context">
        <h4 className="text-sm font-medium">Evidence and graph context</h4>
        {evidenceId && <ul className="mt-3"><EvidenceCitation key={`${studentId}:${evidenceId}`} agentId={agentId} studentId={studentId} evidence={{ evidence_id: evidenceId }} /></ul>}
        <label className="mt-2 flex flex-col gap-1 text-xs text-neutral-400">Inspect concept
          <select className={fieldClass} value={tcId} onChange={event => setTcId(event.target.value)}><option value="">Select a stable concept ID</option>{[...new Set([...concepts, ...(initialTc ? [initialTc] : [])])].map(id => <option key={id}>{id}</option>)}</select>
        </label>
        {contextLoading && <p role="status" className="mt-2 text-xs text-neutral-400">Loading bounded graph context…</p>}
        {contextError && <p role="alert" className="mt-2 text-xs text-rose-300">{contextError}</p>}
        {context && <div className="mt-3 space-y-3">
          {(context.complete === false || context.truncated) && <p className="text-xs text-amber-300">Partial context — traversal and evidence limits apply.</p>}
          {(context.edges || []).length > 0 && <ul className="space-y-1 text-xs text-neutral-400">{context.edges?.map((edge, index) => <li key={edge.id || index}>{edge.source_id} → {memoryLabel(edge.relation)} → {edge.target_id}{edge.required_for_crossing ? " · Required for crossing" : ""}</li>)}</ul>}
          {context.prerequisite_gaps?.map(gap => <p key={gap.tc_id} className="text-xs text-amber-200">{gap.tc_id}: diagnostic evidence is missing; probe before concluding difficulty.</p>)}
          {context.likely_bottlenecks?.map(item => <p key={item.tc_id} className="text-xs text-amber-200">{item.tc_id}: likely upstream bottleneck, supported by the selected evidence.</p>)}
          <ul className="space-y-2">{evidence.map((item, index) => <EvidenceCitation key={item.evidence_id || ("id" in item && item.id) || index} agentId={agentId} studentId={studentId} evidence={item} />)}</ul>
          {!evidence.length && <p className="text-xs text-neutral-400">No qualifying evidence citations in this bounded context.</p>}
        </div>}
      </section>
    </>}
  </section>;
}

function Counts({ title, values }: { title: string; values: Record<string, number | Record<string, number>> }) {
  return <section className="rounded-lg border border-neutral-800 p-3"><h4 className="text-sm font-medium">{title}</h4>
    {Object.keys(values).length ? <dl className="mt-2 space-y-2 text-xs">{Object.entries(values).map(([id, count]) => <div key={id}><dt className="text-neutral-300">{memoryLabel(id)}</dt><dd className="mt-1 text-neutral-400">{typeof count === "number" ? count : Object.entries(count).map(([state, value]) => `${memoryLabel(state)}: ${value}`).join(" · ")}</dd></div>)}</dl>
      : <p className="mt-2 text-xs text-neutral-400">No assessed state counts available.</p>}
  </section>;
}

export function TeacherGraphMemoryPanel({ agentId, config, students, selectedStudentId, onStudentChange, citation }: {
  agentId: string; config: MemoryConfig; students: Array<{ user_id: string; name?: string; display_name?: string }>;
  selectedStudentId?: string; onStudentChange?: (id: string) => void; citation?: { tc_id?: string; evidence_id?: string } | null;
}) {
  const [studentId, setStudentId] = useState("");
  const [tcId, setTcId] = useState("");
  const [filter, setFilter] = useState("");
  const [cohort, setCohort] = useState<CohortMemory | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [offset, setOffset] = useState(0);
  useEffect(() => { if (selectedStudentId !== undefined) setStudentId(selectedStudentId); }, [selectedStudentId]);
  useEffect(() => { setStudentId(""); setTcId(""); setFilter(""); setOffset(0); }, [agentId]);
  useEffect(() => {
    const controller = new AbortController();
    setCohort(null);
    setError("");
    learnerMemoryApi.getCohort(agentId, tcId, controller.signal, offset)
      .then(value => { if (!controller.signal.aborted) setCohort(value); })
      .catch(() => { if (!controller.signal.aborted) setError("Course cohort evidence could not be loaded. No cross-course fallback is used."); });
    return () => controller.abort();
  }, [agentId, tcId, revision, offset]);
  return <section className="h-full space-y-5 overflow-y-auto p-5 text-neutral-200" aria-label="Teacher Graph Memory">
    <header><h2 className="text-lg font-semibold">Course Graph Memory</h2><p className="mt-1 text-xs text-neutral-400">Cohort breadth and individual evidence depth · {config.mode} · {agentId}</p></header>
    <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); setTcId(filter.trim()); setOffset(0); setRevision(value => value + 1); }}>
      <label className="flex flex-col gap-1 text-xs text-neutral-400">Stable concept filter<input className={fieldClass} value={filter} onChange={event => setFilter(event.target.value)} placeholder="All course concepts" /></label>
      <button className={buttonClass} type="submit">Apply course filter</button>
    </form>
    {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
    {!cohort && !error && <p role="status" className="text-sm text-neutral-400">Loading cohort evidence…</p>}
    {cohort && <section aria-label="Cohort breadth" className="space-y-3">
      <p role="status" className="text-xs text-neutral-400">{cohort.student_count} of {cohort.total_students} students · {cohort.complete ? "Complete cohort" : "Partial cohort — not all roster data is available"}{cohort.pending_count ? ` · ${cohort.pending_count} pending events` : ""}</p>
      {!!cohort.stale_students && <p role="status" className="text-xs text-amber-300">{cohort.stale_students} learner snapshot(s) require revalidation. Crossing counts may reflect earlier evidence or policies.</p>}
      <div className="grid gap-3 md:grid-cols-3"><Counts title="Concept mastery" values={cohort.concept_counts || {}} /><Counts title="Threshold crossing" values={cohort.threshold_counts} /><Counts title="Misconceptions" values={cohort.misconception_counts} /></div>
      <div className="grid gap-3 md:grid-cols-3"><Counts title="Transfer evidence" values={cohort.transfer_counts || {}} /><Counts title="Blockers and regression" values={cohort.blockers || {}} /><Counts title="Prerequisite bottlenecks" values={cohort.prerequisite_bottlenecks || {}} /></div>
      {(offset > 0 || cohort.next_offset != null) && <div className="flex items-center gap-2 text-xs text-neutral-400">
        <span>Counts on this page only · roster offset {offset}</span>
        {offset > 0 && <button className={buttonClass} onClick={() => setOffset(0)}>First cohort page</button>}
        {cohort.next_offset != null && <button className={buttonClass} onClick={() => setOffset(cohort.next_offset ?? 0)}>Next cohort page</button>}
      </div>}
      <p className="text-xs text-neutral-500">Not assessed and insufficient evidence are not struggling. Counts never combine courses.</p>
    </section>}
    <label className="flex max-w-lg flex-col gap-1 text-xs text-neutral-400">Individual evidence depth<select className={fieldClass} value={studentId} onChange={event => { setStudentId(event.target.value); onStudentChange?.(event.target.value); }}>
      <option value="">Select an authorized course learner</option>{students.map(student => <option key={student.user_id} value={student.user_id}>{student.name || student.display_name || student.user_id}</option>)}
    </select></label>
    {studentId && students.some(student => student.user_id === studentId) && <GraphMemoryPanel key={`${agentId}:${studentId}`} agentId={agentId} studentId={studentId} config={config} tcId={citation?.tc_id || tcId} evidenceId={citation?.evidence_id} contextMode="individual" />}
  </section>;
}
