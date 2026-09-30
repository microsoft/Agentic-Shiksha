import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, GraduationCap, Loader2, RefreshCw } from "lucide-react";
import type { DashboardAgent } from "@/lib/dashboardApi";
import { fetchDirectoryUsers, type DirectoryUser } from "@/lib/api";
import { directoryAffiliations, getAllDepartments, getAllInstitutes } from "@/lib/userDirectory";
import {
  getStudentRoster,
  saveStudentRoster,
  StudentAssignmentError,
  type StudentRoster,
} from "@/lib/studentAssignmentsApi";
import { getCourseName } from "@/lib/utils";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const secondaryButton = "inline-flex items-center justify-center gap-1.5 rounded-lg border border-neutral-700/50 bg-neutral-800 px-3 py-2 text-xs font-medium text-neutral-300 transition-colors hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:cursor-not-allowed disabled:opacity-40";
const primaryButton = "inline-flex items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:cursor-not-allowed disabled:opacity-40";
const selectStyle = "h-9 w-full min-w-0 border-neutral-700/50 bg-neutral-800/80 text-xs text-neutral-200 focus:ring-violet-400";

interface Props {
  agents: DashboardAgent[];
  courseAffiliations: NonNullable<DashboardAgent["courseAffiliations"]>;
  loadingAgents: boolean;
  agentsError: string | null;
  initialAgentId: string | null;
  onRetryAgents: () => void;
  onClose: () => void;
}

export function StudentAssignmentsDialog({
  agents, courseAffiliations, loadingAgents, agentsError, initialAgentId, onRetryAgents, onClose,
}: Props) {
  const opener = useRef(document.activeElement);
  const [agentId, setAgentId] = useState(initialAgentId || "");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ agentId: string | null } | null>(null);
  const agentAvailable = agents.some(agent => (agent.agentId || agent.id) === agentId);

  const applyAction = (nextAgentId: string | null) => {
    if (nextAgentId === null) onClose();
    else {
      setDirty(false);
      setAgentId(nextAgentId);
    }
  };
  const requestAction = (nextAgentId: string | null) => {
    if (saving || nextAgentId === agentId) return;
    if (dirty) setPendingAction({ agentId: nextAgentId });
    else applyAction(nextAgentId);
  };

  return (
    <>
      <Dialog open onOpenChange={open => { if (!open) requestAction(null); }}>
        <DialogContent
          className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] flex-col gap-4 overflow-hidden rounded-xl border-neutral-700/60 bg-neutral-900 p-4 text-neutral-100 sm:max-w-3xl sm:p-6"
          aria-busy={saving}
          onCloseAutoFocus={event => {
            event.preventDefault();
            if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus();
          }}
          onEscapeKeyDown={event => { if (saving) event.preventDefault(); }}
          onPointerDownOutside={event => { if (saving) event.preventDefault(); }}
        >
          <DialogHeader className="shrink-0 pr-5 text-left">
            <DialogTitle className="flex items-center gap-2">
              <GraduationCap className="h-5 w-5 shrink-0 text-violet-400" aria-hidden="true" />
              Assign Students
            </DialogTitle>
            <DialogDescription className="text-xs text-neutral-400">
              Only assigned students can access this TA. Shared links and institution or department
              membership do not grant access. Filters only change which students are shown.
              {" "}To move the TA itself, use Assign TA to department in User Directory.
            </DialogDescription>
          </DialogHeader>

          <div className="grid shrink-0 gap-1.5">
            <label htmlFor="assignment-course" className="text-xs font-medium text-neutral-300">
              Course / Teaching Assistant (TA)
            </label>
            <Select value={agentId} onValueChange={requestAction} disabled={saving || loadingAgents || !!agentsError}>
              <SelectTrigger id="assignment-course" className={selectStyle}>
                <SelectValue placeholder="Select a course…" />
              </SelectTrigger>
              <SelectContent>
                {agents.map(agent => {
                  const id = agent.agentId || agent.id;
                  return (
                    <SelectItem key={id} value={id}>
                      {agent.courseName || getCourseName(agent.name || id)}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {loadingAgents ? (
            <p role="status" className="flex items-center gap-2 text-sm text-neutral-400">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading courses…
            </p>
          ) : agentsError ? (
            <div role="alert" className="space-y-3 text-sm text-red-300">
              <p>Courses could not be loaded. {agentsError}</p>
              <button type="button" className={secondaryButton} onClick={onRetryAgents}>
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Retry loading courses
              </button>
            </div>
          ) : agents.length === 0 ? (
            <p role="status" className="text-sm text-neutral-400">No TAs are available to assign students to.</p>
          ) : agentAvailable ? (
            <StudentRosterEditor
              key={agentId}
              agentId={agentId}
              courseAffiliations={courseAffiliations}
              onSavingChange={setSaving}
              onDirtyChange={setDirty}
              onClose={() => requestAction(null)}
            />
          ) : (
            <p role="status" className="text-sm text-neutral-400">Select a course to load its saved student assignments.</p>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={pendingAction !== null} onOpenChange={open => { if (!open) setPendingAction(null); }}>
        <DialogContent
          className="w-[calc(100vw-2rem)] rounded-xl border-neutral-700/60 bg-neutral-900 text-neutral-100 sm:max-w-md"
          onCloseAutoFocus={event => {
            event.preventDefault();
            document.getElementById("assignment-course")?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Discard unsaved assignments?</DialogTitle>
            <DialogDescription className="text-neutral-400">
              Your changes have not been saved. The saved roster will remain unchanged.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <button type="button" className={secondaryButton} onClick={() => setPendingAction(null)}>Keep editing</button>
            <button type="button" className={primaryButton} onClick={() => {
              if (pendingAction) applyAction(pendingAction.agentId);
              setPendingAction(null);
            }}>Discard changes</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function StudentRosterEditor({
  agentId, courseAffiliations, onSavingChange, onDirtyChange, onClose,
}: {
  agentId: string;
  courseAffiliations: NonNullable<DashboardAgent["courseAffiliations"]>;
  onSavingChange: (saving: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
  onClose: () => void;
}) {
  const [roster, setRoster] = useState<StudentRoster | null>(null);
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);
  const [search, setSearch] = useState("");
  const [institute, setInstitute] = useState("all");
  const [department, setDepartment] = useState("all");
  const dirty = !!roster && (selected.size !== roster.student_ids.length
    || roster.student_ids.some(id => !selected.has(id)));

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setRoster(null);
    setDirectory([]);
    setSelected(new Set());
    setLoadError(null);
    setSaveError(null);
    setConflict(false);
    setSaved(false);
    Promise.all([
      getStudentRoster(agentId, controller.signal),
      fetchDirectoryUsers(undefined, undefined, controller.signal),
    ])
      .then(([data, users]) => {
        if (controller.signal.aborted) return;
        setDirectory(users);
        setRoster(data);
        setSelected(new Set(data.student_ids));
      })
      .catch(error => {
        if (!controller.signal.aborted) {
          setLoadError(error instanceof Error ? error.message : "Student assignments could not be loaded.");
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [agentId, attempt]);

  const directoryById = new Map<string, DirectoryUser>();
  const directoryByEmail = new Map<string, DirectoryUser | null>();
  for (const user of directory) {
    if (user.id) directoryById.set(user.id, user);
    if (user.userId) directoryById.set(user.userId, user);
    const email = user.email.trim().toLowerCase();
    if (!email) continue;
    if (!directoryByEmail.has(email)) directoryByEmail.set(email, user);
    else if (directoryByEmail.get(email)?.id !== user.id) directoryByEmail.set(email, null);
  }
  const students = (roster?.students ?? []).map(student => {
    const profile = directoryById.get(student.user_id)
      ?? directoryByEmail.get(student.email.trim().toLowerCase());
    return { ...student, affiliations: profile?.affiliations ?? [] };
  });
  const unavailableSelected = students.filter(student => student.status === "unavailable" && selected.has(student.user_id));
  const affiliations = [
    ...directory.flatMap(user => [user, ...(user.affiliations ?? [])]),
    ...courseAffiliations,
    ...students,
  ];
  const institutes = getAllInstitutes(affiliations);
  const departments = getAllDepartments(institute === "all" ? undefined : institute, affiliations);
  const query = search.trim().toLowerCase();
  const matching = students.filter(student => directoryAffiliations(student).some(affiliation =>
    (institute === "all" || affiliation.institute === institute)
    && (department === "all" || affiliation.department === department)
    && (!query || [student.name, student.email, affiliation.institute, affiliation.department, student.user_id]
      .some(value => value.toLowerCase().includes(query)))),
  );
  const editable = !!roster && !loading && !saving && !conflict;

  const changeSelection = (update: (next: Set<string>) => void) => {
    if (!editable) return;
    setSelected(previous => {
      const next = new Set(previous);
      update(next);
      return next;
    });
    setSaved(false);
    setSaveError(null);
  };

  const save = async () => {
    if (!editable || !roster || !dirty || unavailableSelected.length > 0) return;
    setSaving(true);
    onSavingChange(true);
    setSaveError(null);
    setSaved(false);
    try {
      const result = await saveStudentRoster(agentId, [...selected], roster.revision);
      setRoster({ ...roster, ...result });
      setSelected(new Set(result.student_ids));
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Student assignments could not be saved.");
      setConflict(error instanceof StudentAssignmentError && error.status === 409);
    } finally {
      setSaving(false);
      onSavingChange(false);
    }
  };

  return (
    <>
      <div className="min-h-0 space-y-4 overflow-y-auto pr-1" aria-busy={loading || saving}>
        {loading ? (
          <p role="status" className="flex items-center gap-2 py-6 text-sm text-neutral-400">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading saved student assignments…
          </p>
        ) : loadError ? (
          <div role="alert" className="space-y-3 rounded-lg border border-red-800/40 bg-red-900/20 p-3 text-sm text-red-300">
            <p>{loadError} No assignments have been changed.</p>
            <button type="button" className={secondaryButton} onClick={() => setAttempt(value => value + 1)}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Retry loading roster
            </button>
          </div>
        ) : roster && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid min-w-0 gap-1.5">
                <label htmlFor="assignment-search" className="text-xs text-neutral-400">Search students</label>
                <input
                  id="assignment-search" type="search" value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Name, email, or affiliation"
                  className="h-9 min-w-0 rounded-lg border border-neutral-700/50 bg-neutral-800/80 px-3 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-violet-400"
                />
              </div>
              <div className="grid min-w-0 gap-1.5">
                <label htmlFor="assignment-institute" className="text-xs text-neutral-400">Institution</label>
                <Select value={institute} onValueChange={value => { setInstitute(value); setDepartment("all"); }}>
                  <SelectTrigger id="assignment-institute" className={selectStyle}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All institutions</SelectItem>
                    {institutes.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid min-w-0 gap-1.5">
                <label htmlFor="assignment-department" className="text-xs text-neutral-400">Department</label>
                <Select value={department} onValueChange={setDepartment}>
                  <SelectTrigger id="assignment-department" className={selectStyle}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All departments</SelectItem>
                    {departments.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p role="status" aria-live="polite" className="text-xs text-neutral-300">
                {selected.size} selected · {matching.length} of {students.length} students shown
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={secondaryButton}
                  disabled={!editable || !matching.some(student => student.status !== "unavailable" && !selected.has(student.user_id))}
                  onClick={() => changeSelection(next => {
                    matching.forEach(student => { if (student.status !== "unavailable") next.add(student.user_id); });
                  })}>Select matching</button>
                <button type="button" className={secondaryButton}
                  disabled={!editable || !matching.some(student => selected.has(student.user_id))}
                  onClick={() => changeSelection(next => { matching.forEach(student => next.delete(student.user_id)); })}>
                  Clear matching
                </button>
              </div>
            </div>
            {selected.size === 0 && (
              <p role="alert" className="flex items-start gap-2 rounded-lg border border-amber-700/40 bg-amber-900/20 p-3 text-xs text-amber-200">
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                No students selected. Saving an empty roster revokes all student access to this TA, including access through shared links.
              </p>
            )}
            {unavailableSelected.length > 0 && (
              <div id="assignment-unavailable-warning" role="alert" className="space-y-2 rounded-lg border border-amber-700/40 bg-amber-900/20 p-3 text-xs text-amber-200">
                <p>
                  {unavailableSelected.length} unavailable {unavailableSelected.length === 1 ? "student remains" : "students remain"} selected.
                  {" "}Remove unavailable students before saving; they are no longer eligible for access.
                  Unavailable selections hidden by filters must also be removed.
                </p>
                {(search || institute !== "all" || department !== "all") && (
                  <button type="button" className={secondaryButton} onClick={() => {
                    setSearch("");
                    setInstitute("all");
                    setDepartment("all");
                  }}>Clear filters to review students</button>
                )}
              </div>
            )}
            <p className="text-xs text-neutral-400">
              Invited students can be assigned now; access starts after their account is active.
              Unavailable entries stay selected until you explicitly remove them, and cannot be saved.
            </p>
            {matching.length === 0 ? (
              <p role="status" className="py-5 text-sm text-neutral-400">
                {students.length === 0 ? "No student candidates are available." : "No students match these filters. Selections outside the filters are unchanged."}
              </p>
            ) : (
              <ul aria-label="Student roster" className="divide-y divide-neutral-800 rounded-lg border border-neutral-800">
                {matching.map(student => (
                  <li key={student.user_id}>
                    <label className="flex cursor-pointer items-start gap-3 px-3 py-3 hover:bg-neutral-800/60">
                      <input
                        type="checkbox"
                        aria-label={`${student.name || student.user_id} (${student.email || student.user_id})`}
                        checked={selected.has(student.user_id)}
                        disabled={!editable || (student.status === "unavailable" && !roster.student_ids.includes(student.user_id))}
                        onChange={event => {
                          const checked = event.target.checked;
                          changeSelection(next => { if (checked) next.add(student.user_id); else next.delete(student.user_id); });
                        }}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                      />
                      <span className="min-w-0 flex-1 space-y-1">
                        <span className="block break-words text-sm text-neutral-200">{student.name || student.email || student.user_id}</span>
                        {student.email && <span className="block break-all text-xs text-neutral-400">{student.email}</span>}
                        <span className="block break-words text-xs text-neutral-500">
                          {directoryAffiliations(student).map(affiliation =>
                            [affiliation.institute, affiliation.department].filter(Boolean).join(" · "))
                            .filter(Boolean).join("; ") || "No affiliation"}
                        </span>
                      </span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
                        student.status === "active" ? "bg-emerald-900/40 text-emerald-300"
                          : student.status === "invited" ? "bg-amber-900/40 text-amber-300"
                            : "bg-neutral-800 text-neutral-400"
                      }`}>{student.status === "active" ? "Active" : student.status === "invited" ? "Invited" : "Unavailable"}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {saveError && (
          <div role="alert" className="space-y-1 rounded-lg border border-red-800/40 bg-red-900/20 p-3 text-sm text-red-300">
            <p>{saveError}</p>
            <p>{conflict
              ? "The saved roster changed. Reload the saved roster before editing again; reloading discards your unsaved changes."
              : "Your selection is preserved. Retry the save, or reload the saved roster to check its current state."}</p>
          </div>
        )}
      </div>
      <div className="shrink-0 space-y-3 border-t border-neutral-800 pt-3">
        <p role="status" aria-live="polite" className="flex min-h-4 items-center gap-1.5 text-xs text-neutral-400">
          {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Saving assignments. Please wait…</>
            : saved ? <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" /> Assignments saved.</>
              : dirty ? "Unsaved assignment changes." : roster ? "Showing saved assignments." : ""}
        </p>
        <DialogFooter className="flex-wrap gap-2 sm:space-x-0">
          {roster && (
            <button type="button" className={secondaryButton} disabled={loading || saving}
              onClick={() => setAttempt(value => value + 1)}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Reload saved roster
            </button>
          )}
          <button type="button" className={secondaryButton} onClick={onClose} disabled={saving}>
            {dirty ? "Cancel" : "Done"}
          </button>
          <button type="button" className={primaryButton}
            disabled={!editable || !dirty || unavailableSelected.length > 0}
            aria-describedby={unavailableSelected.length > 0 ? "assignment-unavailable-warning" : undefined}
            onClick={save}>
            {saving ? "Saving…" : saveError && !conflict ? "Retry save" : "Save assignments"}
          </button>
        </DialogFooter>
      </div>
    </>
  );
}
