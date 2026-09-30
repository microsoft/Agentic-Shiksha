import { useEffect, useId, useRef, useState } from "react";
import { Building2, Loader2, RefreshCw } from "lucide-react";
import type { DashboardAgent } from "@/lib/dashboardApi";
import { getCoursePlacement, saveCoursePlacement, type CoursePlacement } from "@/lib/studentAssignmentsApi";
import { getAllDepartments, getAllInstitutes, loadDirectory, type UserEntry } from "@/lib/userDirectory";
import { getCourseName } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const secondary = "rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-xs text-neutral-200 disabled:opacity-40";
const primary = "rounded-lg bg-violet-600 px-4 py-2 text-xs font-medium text-white disabled:opacity-40";
const field = "h-10 w-full min-w-0 rounded-md border border-neutral-700 bg-neutral-800 px-3 text-sm text-neutral-100 disabled:opacity-40";

export function CoursePlacementDialog({ agents, loadingAgents, agentsError, initialAgentId, onRetryAgents, onSaved, onClose }: {
  agents: DashboardAgent[];
  loadingAgents: boolean;
  agentsError: string | null;
  initialAgentId: string | null;
  onRetryAgents: () => void;
  onSaved: (placement: CoursePlacement) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [agentId, setAgentId] = useState(initialAgentId || "");
  const [saved, setSaved] = useState<CoursePlacement | null>(null);
  const [institute, setInstitute] = useState("");
  const [department, setDepartment] = useState("");
  const [directory, setDirectory] = useState<UserEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [directoryError, setDirectoryError] = useState(false);
  const [reload, setReload] = useState(0);
  const [pending, setPending] = useState<{ agentId: string | null } | null>(null);
  const [confirmedSave, setConfirmedSave] = useState(false);
  const epoch = useRef(0);
  const dirty = !!saved && (saved.institute !== institute.trim() || saved.department !== department.trim());
  const available = agents.some(agent => (agent.agentId || agent.id) === agentId);

  useEffect(() => {
    let active = true;
    loadDirectory().then(users => { if (active) { setDirectory([...users]); setDirectoryError(false); } })
      .catch(() => { if (active) setDirectoryError(true); });
    return () => { active = false; };
  }, [reload]);

  useEffect(() => {
    const current = ++epoch.current;
    const controller = new AbortController();
    setSaved(null);
    setInstitute("");
    setDepartment("");
    setError(null);
    setConfirmedSave(false);
    if (!agentId || !available) { setLoading(false); return; }
    setLoading(true);
    getCoursePlacement(agentId, controller.signal).then(placement => {
      if (controller.signal.aborted || current !== epoch.current) return;
      setSaved(placement);
      setInstitute(placement.institute);
      setDepartment(placement.department);
    }).catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "The TA department could not be loaded.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); epoch.current += 1; };
  }, [agentId, available, reload]);

  const requestAction = (next: string | null) => {
    if (saving) return;
    if (dirty) setPending({ agentId: next });
    else if (next === null) onClose();
    else setAgentId(next);
  };
  const save = async () => {
    if (!saved || !dirty || saving || Boolean(institute.trim()) !== Boolean(department.trim())) return;
    const current = epoch.current;
    setSaving(true);
    setError(null);
    setConfirmedSave(false);
    try {
      const placement = await saveCoursePlacement(agentId, institute, department, saved.revision);
      if (current !== epoch.current) return;
      setSaved(placement);
      setInstitute(placement.institute);
      setDepartment(placement.department);
      setConfirmedSave(true);
      onSaved(placement);
    } catch (failure) {
      if (current === epoch.current) setError(failure instanceof Error ? failure.message : "The assignment could not be saved. Reload before retrying.");
    } finally {
      if (current === epoch.current) setSaving(false);
    }
  };
  const pairs = agents.flatMap(agent => agent.courseAffiliations ?? []);
  const institutes = [...new Set([...getAllInstitutes(directory), ...pairs.map(pair => pair.institute), saved?.institute || ""])].filter(Boolean).sort();
  const departments = [...new Set([
    ...getAllDepartments(institute.trim(), directory),
    ...pairs.filter(pair => pair.institute.toLowerCase() === institute.trim().toLowerCase()).map(pair => pair.department),
    ...(saved?.institute === institute ? [saved.department] : []),
  ])].filter(Boolean).sort();

  return <>
    <Dialog open onOpenChange={open => { if (!open) requestAction(null); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border-neutral-700 bg-neutral-900 p-4 text-neutral-100 sm:max-w-xl sm:p-6"
        onEscapeKeyDown={event => { if (saving) event.preventDefault(); }} onPointerDownOutside={event => { if (saving) event.preventDefault(); }}>
        <DialogHeader className="pr-5 text-left">
          <DialogTitle className="flex items-center gap-2"><Building2 className="h-5 w-5 text-violet-400" />Assign TA to department</DialogTitle>
          <DialogDescription className="text-xs text-neutral-400">
            Choose where this TA appears in college and department filters. This does not change its teachers, student roster, or course access.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor={`${id}-ta`} className="text-xs font-medium">Teaching Assistant (TA)</label>
            <Select value={agentId} onValueChange={value => requestAction(value)} disabled={saving || loadingAgents || !!agentsError}>
              <SelectTrigger id={`${id}-ta`} className={field}><SelectValue placeholder="Select any TA..." /></SelectTrigger>
              <SelectContent>{agents.map(agent => {
                const key = agent.agentId || agent.id;
                return <SelectItem key={key} value={key}>{agent.courseName || getCourseName(agent.name || key)}</SelectItem>;
              })}</SelectContent>
            </Select>
            <p className="text-xs text-neutral-400">All TAs are available here, including unassigned TAs and those in another college.</p>
          </div>
          {loadingAgents && <p role="status" className="text-xs text-neutral-400">Loading TAs...</p>}
          {agentsError && <div role="alert" className="text-xs text-red-300">{agentsError} <button type="button" className="underline" onClick={onRetryAgents}>Retry TAs</button></div>}
          {loading && <p role="status" className="flex items-center gap-2 text-xs"><Loader2 className="h-4 w-4 animate-spin" />Loading saved department...</p>}
          {error && <p role="alert" className="break-words text-sm text-red-300">{error}</p>}
          {directoryError && <p role="alert" className="text-xs text-amber-300">Directory suggestions could not be loaded. Enter the exact college and department names, or reload.</p>}
          {saved && <>
            <p className="text-xs text-neutral-400">Saved department: {saved.institute ? `${saved.institute} / ${saved.department}` : "Unassigned"}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-xs font-medium">College / institution
                <input aria-label="TA college" list={`${id}-colleges`} className={field} maxLength={200} disabled={saving} value={institute}
                  onChange={event => { setInstitute(event.target.value); setDepartment(""); setConfirmedSave(false); }} placeholder="Choose or enter college" />
                <datalist id={`${id}-colleges`}>{institutes.map(name => <option key={name} value={name} />)}</datalist>
              </label>
              <label className="space-y-1.5 text-xs font-medium">Department
                <input aria-label="TA department" list={`${id}-departments`} className={field} maxLength={200} disabled={saving || !institute.trim()} value={department}
                  onChange={event => { setDepartment(event.target.value); setConfirmedSave(false); }} placeholder="Choose or enter department" />
                <datalist id={`${id}-departments`}>{departments.map(name => <option key={name} value={name} />)}</datalist>
              </label>
            </div>
            <p className="text-xs text-neutral-400">Use the same names as the user directory. A TA does not inherit every department of its creator or teachers.</p>
            {institute.trim() && !department.trim() && <p className="text-xs text-amber-300">Choose a department before saving.</p>}
            {!institute.trim() && !department.trim() && dirty && <p role="alert" className="text-xs text-amber-300">Saving clears only the TA's department placement. Existing student and teacher assignments stay unchanged.</p>}
            <button type="button" className={secondary} disabled={saving || (!institute && !department)} onClick={() => { setInstitute(""); setDepartment(""); setConfirmedSave(false); }}>Clear department placement</button>
          </>}
          {confirmedSave && <p role="status" className="text-sm text-emerald-300">TA department saved. Course choices have been updated; existing rosters are unchanged.</p>}
        </div>
        <DialogFooter className="flex-wrap gap-2">
          <button type="button" className={secondary} disabled={saving || !agentId || loading} onClick={() => setReload(value => value + 1)}><RefreshCw className="mr-1 inline h-3.5 w-3.5" />Reload saved assignment</button>
          <button type="button" className={secondary} disabled={saving} onClick={() => requestAction(null)}>Done</button>
          <button type="button" className={primary} disabled={!saved || !dirty || saving || Boolean(institute.trim()) !== Boolean(department.trim())} onClick={() => void save()}>{saving ? "Saving..." : "Save TA department"}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={pending !== null} onOpenChange={open => { if (!open) setPending(null); }}>
      <DialogContent className="border-neutral-700 bg-neutral-900 text-neutral-100 sm:max-w-md">
        <DialogHeader><DialogTitle>Discard department changes?</DialogTitle><DialogDescription className="text-neutral-400">The saved TA placement and student roster will not be changed.</DialogDescription></DialogHeader>
        <DialogFooter className="gap-2">
          <button type="button" className={secondary} onClick={() => setPending(null)}>Keep editing</button>
          <button type="button" className={primary} onClick={() => {
            const next = pending?.agentId;
            setPending(null);
            if (next === null) onClose();
            else if (next) setAgentId(next);
          }}>Discard changes</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
