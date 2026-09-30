import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Info, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { getMaterialJob, processMaterialJob, type KBScope, type MaterialJobStatus, type MaterialPreflight } from "@/lib/api";


export function MaterialReviewDialog({ report, onClose, onConfirm }: {
  report: MaterialPreflight | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return <Dialog open={report !== null} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[85dvh] max-w-2xl overflow-y-auto border-neutral-700 bg-neutral-900 text-neutral-100">
      <DialogHeader>
        <DialogTitle>Material preflight</DialogTitle>
        <DialogDescription className="text-neutral-400">{report?.files.length} files / PDF: 100 MiB, 2,000 pages / Other formats: 16 MB / Batch: 250 MiB</DialogDescription>
      </DialogHeader>
      <ul className="divide-y divide-neutral-700" aria-label="File validation results">
        {report?.files.map((file, index) => <li key={`${file.filename}:${index}`} className="flex min-w-0 gap-3 py-3">
          {file.accepted ? <CheckCircle2 aria-label="Accepted" className="mt-1 h-4 w-4 shrink-0 text-emerald-400" /> : <AlertCircle aria-label="Rejected" className="mt-1 h-4 w-4 shrink-0 text-red-400" />}
          <div className="min-w-0 flex-1">
            <p className="break-all text-sm font-medium">{file.filename}</p>
            {file.details && <p className="mt-1 text-xs text-neutral-400">
              {(file.details.size_bytes / 1024 / 1024).toFixed(2)} MiB
              {file.details.pages !== null && ` / ${file.details.pages} pages`}
              {file.details.ocr_pages > 0 && ` / ${file.details.ocr_pages} OCR pages`}
              {file.details.needs_preparation && " / Split copies required"}
            </p>}
            {file.error && <p className="mt-1 break-words text-sm text-red-300">{file.error}</p>}
          </div>
        </li>)}
      </ul>
      <DialogFooter>
        <button type="button" onClick={onClose} className="rounded-md border border-neutral-600 px-3 py-2 text-sm">Cancel</button>
        <button type="button" onClick={onConfirm} disabled={!report?.accepted} className="rounded-md bg-white px-3 py-2 text-sm font-medium text-neutral-950 disabled:opacity-40">Confirm materials</button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}


type MaterialJobOptions = {
  jobId: string | null;
  initialStatus?: MaterialJobStatus | null;
  onChange?: (status: MaterialJobStatus) => void;
};

type MaterialJobSnapshot = {
  jobId: string | null;
  status: MaterialJobStatus | null;
  error: string | null;
  retrying: string | null;
};

export type MaterialJobController = MaterialJobSnapshot & {
  needsAttention: boolean;
  refresh: () => void;
  retry: (sourceId: string) => Promise<void>;
  updateStatus: (status: MaterialJobStatus) => void;
};

export function useMaterialJob({ jobId, initialStatus, onChange }: MaterialJobOptions): MaterialJobController {
  const [snapshot, setSnapshot] = useState<MaterialJobSnapshot>({
    jobId, status: initialStatus?.job_id === jobId ? initialStatus : null, error: null, retrying: null,
  });
  const [revision, setRevision] = useState(0);
  const activeJob = useRef(jobId);
  const controllerRef = useRef<AbortController | null>(null);
  const retryRef = useRef<string | null>(null);
  const initialStatusRef = useRef(initialStatus);
  const onChangeRef = useRef(onChange);
  activeJob.current = jobId;
  initialStatusRef.current = initialStatus;
  onChangeRef.current = onChange;

  const updateStatus = (next: MaterialJobStatus) => {
    if (next.job_id !== activeJob.current || controllerRef.current?.signal.aborted) return;
    setSnapshot(previous => ({
      jobId: next.job_id, status: next, error: null,
      retrying: previous.jobId === next.job_id ? previous.retrying : null,
    }));
    onChangeRef.current?.(next);
  };

  useEffect(() => {
    if (!jobId) {
      setSnapshot({ jobId: null, status: null, error: null, retrying: null });
      retryRef.current = null;
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    retryRef.current = null;
    setSnapshot(previous => ({
      jobId,
      status: previous.jobId === jobId ? previous.status
        : initialStatusRef.current?.job_id === jobId ? initialStatusRef.current : null,
      error: null, retrying: null,
    }));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await getMaterialJob(jobId, controller.signal);
        if (controller.signal.aborted) return;
        if (next.job_id !== jobId) throw new Error("Material status did not match the requested job.");
        setSnapshot(previous => ({ ...previous, jobId, status: next, error: null }));
        onChangeRef.current?.(next);
        if (!['COMPLETED', 'FAILED'].includes(next.status)) timer = setTimeout(poll, 2500);
      } catch {
        if (!controller.signal.aborted) setSnapshot(previous => ({
          ...previous, jobId, error: "Material status is unavailable. Retry checking.",
        }));
      }
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [jobId, revision]);

  const retry = async (sourceId: string) => {
    const controller = controllerRef.current;
    if (!jobId || !controller || controller.signal.aborted || retryRef.current !== null) return;
    retryRef.current = sourceId;
    setSnapshot(previous => ({ ...previous, retrying: sourceId }));
    try {
      const next = await processMaterialJob(jobId, [sourceId]);
      if (controller.signal.aborted || activeJob.current !== jobId) return;
      if (next.job_id !== jobId) throw new Error("Material retry did not match the requested job.");
      updateStatus(next);
      setRevision(value => value + 1);
    } catch (failure) {
      if (!controller.signal.aborted && activeJob.current === jobId) {
        toast.error(failure instanceof Error ? failure.message : "Material retry failed.");
      }
    } finally {
      if (!controller.signal.aborted && activeJob.current === jobId) {
        retryRef.current = null;
        setSnapshot(previous => ({ ...previous, retrying: null }));
      }
    }
  };
  const current = snapshot.jobId === jobId ? snapshot : { jobId, status: null, error: null, retrying: null };
  return {
    ...current,
    needsAttention: !!current.status && (materialJobStopped(current.status) || current.status.files.some(file => file.status === "failed")),
    refresh: () => setRevision(value => value + 1), retry, updateStatus,
  };
}

function materialJobStopped(status: MaterialJobStatus | null): boolean {
  return !!status && ["FAILED", "COMPLETED"].includes(status.status) && ["preparing", "indexing"].includes(status.progress);
}

const MATERIAL_STATUS_LABELS: Record<MaterialJobStatus["files"][number]["status"], string> = {
  uploaded: "Uploaded",
  preparing: "Preparing",
  indexing: "Indexing",
  ready: "Ready",
  failed: "Needs retry",
};

export function MaterialFileInfo({ filename, sourceId, kbScope = "course", materials, pendingUpload = false, disabled = false }: {
  filename: string;
  sourceId?: string | null;
  kbScope?: KBScope;
  materials: MaterialJobController;
  pendingUpload?: boolean;
  disabled?: boolean;
}) {
  const file = pendingUpload ? undefined : materials.status?.files.find(candidate =>
    candidate.kb_scope === kbScope && (sourceId ? candidate.source_id === sourceId : candidate.filename === filename),
  );
  const needsRetry = !!file && (file.status === "failed" || (materialJobStopped(materials.status) && file.status !== "ready"));
  const statusLabel = pendingUpload ? "Pending upload"
    : materials.error ? "Status unavailable"
    : needsRetry ? "Needs retry"
    : file ? MATERIAL_STATUS_LABELS[file.status]
    : materials.jobId && !materials.status ? "Checking status"
    : "Status unavailable";
  const parts = file && !materials.error ? file.parts : null;
  const notice = pendingUpload ? "Indexing details will be available after this upload is saved."
    : materials.error ? materials.error
    : needsRetry && !file?.error ? "Processing stopped before this file was ready. Retry indexing; the original is kept."
    : !file && (!materials.jobId || materials.status) ? "No indexing details are available for this file."
    : null;
  return <Dialog>
    <DialogTrigger asChild>
      <button
        type="button"
        aria-label={`Indexing info for ${filename}`}
        title={`${statusLabel}${parts !== null ? ` - ${parts} indexing ${parts === 1 ? "file" : "files"}` : ""}`}
        className={`shrink-0 rounded p-1.5 transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-400 ${needsRetry || materials.error ? "text-amber-400 hover:text-amber-300" : "text-neutral-400 hover:text-white"}`}
      >
        <Info className="h-4 w-4" aria-hidden="true" />
      </button>
    </DialogTrigger>
    <DialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-xl border-neutral-700 bg-neutral-900 p-5 text-neutral-100">
      <DialogHeader>
        <DialogTitle className="text-sm">File indexing details</DialogTitle>
        <DialogDescription className="break-all pr-4 text-xs text-neutral-400">{filename}</DialogDescription>
      </DialogHeader>
      <dl className="space-y-3 text-sm" aria-live="polite">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-neutral-400">Status</dt>
          <dd className={`flex items-center gap-1.5 ${needsRetry ? "text-amber-300" : file?.status === "ready" && !materials.error ? "text-emerald-400" : "text-neutral-100"}`}>
            {file?.status === "ready" && !materials.error && <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
            {statusLabel}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-neutral-400">Indexing files</dt>
          <dd>{parts ?? "Not available yet"}</dd>
        </div>
      </dl>
      {file?.error && <p role="alert" className="break-words text-xs text-amber-300">{file.error}</p>}
      {notice && <p role={needsRetry || materials.error ? "alert" : undefined} className="text-xs text-neutral-400">{notice}</p>}
      {materials.error ? <button type="button" onClick={materials.refresh} className="flex items-center justify-center gap-2 rounded-md border border-neutral-600 px-3 py-2 text-xs">
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Retry status check
      </button> : needsRetry && file && <button
        type="button"
        disabled={disabled || materials.retrying !== null}
        onClick={() => void materials.retry(file.source_id)}
        aria-label={`Retry ${filename}`}
        className="flex items-center justify-center gap-2 rounded-md border border-neutral-600 px-3 py-2 text-xs disabled:opacity-40"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${materials.retrying === file.source_id ? "animate-spin" : ""}`} aria-hidden="true" />
        {materials.retrying === file.source_id ? "Retrying..." : "Retry indexing"}
      </button>}
    </DialogContent>
  </Dialog>;
}

export function MaterialJobPanel({ jobId, initialStatus, onChange, showCreationStatus = true }: MaterialJobOptions & {
  showCreationStatus?: boolean;
}) {
  const { status, error, retrying, retry, refresh } = useMaterialJob({ jobId, initialStatus, onChange });
  if (!jobId) return null;
  const stopped = materialJobStopped(status);
  const title = status?.progress === "ready" ? "Materials ready" : status?.progress === "failed" || stopped ? "Materials need attention" : status?.progress === "uploading" ? "Files uploaded" : "Materials processing";
  return <section aria-label="Material processing status" className="min-w-0 shrink-0 border-y border-neutral-700 bg-neutral-950/50 px-4 py-3 text-neutral-100">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {showCreationStatus && status?.ta_status && <span className="text-xs text-neutral-300">{status.ta_status === "COMPLETED" ? "TA created" : status.ta_status === "FAILED" ? "TA creation needs attention" : "TA creation in progress"}</span>}
    </div>
    {showCreationStatus && status?.ta_error && <p role="alert" className="mt-2 break-words text-sm text-amber-300">{status.ta_error}</p>}
    {stopped && <p role="alert" className="mt-2 text-sm text-amber-300">Material processing stopped. Retry the unfinished files; uploaded originals are kept.</p>}
    {error && <div role="alert" className="mt-2 flex items-center gap-2 text-sm text-amber-300">{error}<button type="button" title="Retry status check" aria-label="Retry status check" onClick={refresh} className="h-8 w-8 shrink-0 p-2"><RefreshCw className="h-4 w-4" /></button></div>}
    <ul className="mt-1 max-h-52 overflow-y-auto divide-y divide-neutral-800">
      {status?.files.map(file => {
        const needsRetry = file.status === "failed" || (stopped && file.status !== "ready");
        return <li key={`${file.kb_scope}:${file.source_id}`} className="flex min-w-0 items-center gap-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="break-all text-sm">{file.filename}</p>
            <p className="text-xs text-neutral-400">{file.kb_scope}{file.parts > 0 && ` / ${file.parts} indexing copies`}</p>
            <p className="mt-1 text-xs capitalize sm:hidden">{needsRetry ? "Needs retry" : file.status}</p>
            {file.error && <p className="mt-1 break-words text-xs text-red-300">{file.error}</p>}
          </div>
          <span className="hidden text-xs capitalize sm:block">{needsRetry ? "Needs retry" : file.status}</span>
          {needsRetry ? <button type="button" disabled={retrying !== null} aria-label={`Retry ${file.filename}`} title={`Retry ${file.filename}`} onClick={() => void retry(file.source_id)} className="h-8 w-8 shrink-0 rounded-md p-2 hover:bg-neutral-800 disabled:opacity-40"><RefreshCw className={`h-4 w-4 ${retrying === file.source_id ? "animate-spin" : ""}`} /></button> : file.status === "ready" ? <CheckCircle2 className="m-2 h-4 w-4 shrink-0 text-emerald-400" /> : <Loader2 className="m-2 h-4 w-4 shrink-0 animate-spin text-neutral-400" />}
        </li>;
      })}
    </ul>
  </section>;
}