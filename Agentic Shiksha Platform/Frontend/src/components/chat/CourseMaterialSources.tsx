import { useState, type ReactNode } from "react";
import { Check, Copy, Download, FileText, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { absoluteBackendUrl } from "@/lib/api";
import { isCourseMaterialSource, type CourseMaterialSource } from "@/lib/citationSources";
import type { ChatSource } from "@/lib/types";


export function CourseMaterialSourceButton({ source, children }: { source: CourseMaterialSource; children: ReactNode }) {
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);
  const location = [source.page_number ? `Page ${source.page_number}` : null, source.section].filter(Boolean).join(" / ");

  async function downloadFile() {
    if (!isCourseMaterialSource(source)) return;
    setError(null);
    setDownloading(true);
    try {
      const response = await fetch(absoluteBackendUrl(source.url), { credentials: "include" });
      if (!response.ok) {
        throw new Error(response.status === 401 || response.status === 403
          ? "Sign in with access to this course to download the file."
          : response.status === 404 ? "This course file is no longer available." : "The file could not be downloaded. Please retry.");
      }
      const address = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = address;
      link.download = source.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(address), 1000);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The file could not be downloaded. Please retry.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Dialog onOpenChange={() => { setError(null); setCopied(false); }}>
      <DialogTrigger asChild>
        <button type="button" aria-label={`View passage: ${source.filename}${location ? `, ${location}` : ""}`}
          title={`${source.filename}${location ? ` / ${location}` : ""}`}
          className="inline-flex max-w-full items-baseline gap-1.5 break-words text-left text-sm text-teal-300 underline decoration-teal-700 underline-offset-4 hover:text-teal-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-400">
          {children}
        </button>
      </DialogTrigger>
      <DialogContent className="grid max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] gap-4 rounded-lg border-neutral-700 bg-neutral-900 text-neutral-100">
        <DialogHeader className="min-w-0 pr-8 text-left">
          <DialogTitle className="break-words text-lg leading-snug tracking-normal">{source.filename}</DialogTitle>
          <DialogDescription className="break-words text-neutral-400">{location || "Retrieved passage"}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto overscroll-contain">
          <blockquote className="m-0 whitespace-pre-wrap break-words border-l-2 border-teal-500 pl-4 text-sm leading-7" aria-label="Retrieved passage">
            <mark className="bg-teal-950/70 text-neutral-100">{source.excerpt}</mark>
          </blockquote>
          {source.truncated && <p className="mt-3 text-xs text-neutral-400">Passage truncated</p>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-700 pt-3">
          <span className="text-xs text-neutral-400">Course material</span>
          <div className="flex gap-2">
            <button type="button" className="flex size-9 items-center justify-center rounded-md hover:bg-neutral-800" title={copied ? "Copied" : "Copy passage"} aria-label="Copy passage"
              onClick={async () => {
                try { await navigator.clipboard.writeText(source.excerpt); setCopied(true); }
                catch { setError("The passage could not be copied."); }
              }}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </button>
            <button type="button" disabled={downloading} onClick={downloadFile} title="Download file" aria-label="Download file"
              className="flex size-9 items-center justify-center rounded-md hover:bg-neutral-800 disabled:opacity-50">
              {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            </button>
          </div>
          {error && <p role="alert" className="w-full text-sm text-red-300">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CourseMaterialSources({ sources }: { sources?: ChatSource[] }) {
  const passages = sources?.filter(isCourseMaterialSource) || [];
  if (!passages.length) return null;
  return (
    <section aria-label="Course sources" className="mt-3 border-t border-neutral-700/60 pt-3">
      <h3 className="mb-2 text-xs font-medium text-neutral-400">Sources</h3>
      <ul className="m-0 flex list-none flex-col items-start gap-2 p-0">
        {passages.map((source, index) => (
          <li key={source.citation_id} className="min-w-0 max-w-full">
            <CourseMaterialSourceButton source={source}>
              <FileText aria-hidden="true" className="size-3.5 shrink-0 self-center" />
              <span className="min-w-0 break-words">[{index + 1}] {source.filename}{source.page_number ? ` / Page ${source.page_number}` : ""}</span>
            </CourseMaterialSourceButton>
          </li>
        ))}
      </ul>
    </section>
  );
}