import { useRef } from "react";
import { FileText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CreateButton } from "@/components/ui/CreateButton";
import type { AgentCapabilities } from "@/lib/agentCapabilities";
import { fileKey, formatBytes } from "./builderTypes";
import { CapabilityControls } from "./CapabilityControls";

type ReviewMaterialsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: File[];
  capabilities: AgentCapabilities;
  onCapabilitiesChange: (capabilities: AgentCapabilities) => void;
  isCreating: boolean;
  onConfirm: () => void;
};

export function ReviewMaterialsDialog({
  open,
  onOpenChange,
  files,
  capabilities,
  onCapabilitiesChange,
  isCreating,
  onConfirm,
}: ReviewMaterialsDialogProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const selectedFiles = [...new Map(files.map((file) => [fileKey(file), file])).values()];

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!isCreating) onOpenChange(nextOpen); }}>
      <DialogContent
        className={`flex max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl flex-col gap-0 overflow-hidden rounded-2xl border-neutral-700 bg-neutral-900 p-0 text-neutral-100 ${isCreating ? "[&>button]:hidden" : ""}`}
        onOpenAutoFocus={(event) => {
          previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          event.preventDefault();
          titleRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (previousFocusRef.current?.isConnected) {
            event.preventDefault();
            previousFocusRef.current.focus();
          }
        }}
        onEscapeKeyDown={(event) => { if (isCreating) event.preventDefault(); }}
        onInteractOutside={(event) => { if (isCreating) event.preventDefault(); }}
      >
        <DialogHeader className="shrink-0 px-6 pb-4 pt-6 text-left">
          <DialogTitle ref={titleRef} tabIndex={-1} className="pr-6 text-2xl font-semibold outline-none">Review your materials</DialogTitle>
          <DialogDescription className="pt-2 leading-relaxed text-neutral-400">
            Check your selected files and choose what your teaching assistant can do before creating it.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-6 overflow-y-auto px-6 pb-6">
          <section aria-labelledby="review-materials-heading">
            <h3 id="review-materials-heading" className="mb-3 text-sm font-medium text-neutral-300">
              Selected materials
            </h3>
            {selectedFiles.length > 0 ? (
              <ul className="space-y-2">
                {selectedFiles.map((file) => (
                  <li key={fileKey(file)} className="flex items-center gap-3 rounded-xl border border-neutral-700 bg-neutral-800/50 p-3">
                    <FileText className="h-5 w-5 shrink-0 text-violet-300" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="break-all text-sm font-medium">{file.name}</p>
                      <p className="mt-1 text-xs text-neutral-400">{formatBytes(file.size)}</p>
                    </div>
                    <span className="shrink-0 text-xs text-neutral-400">Selected</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl border border-dashed border-neutral-700 p-4 text-sm text-neutral-400">
                No files selected. You can still create an assistant with your course details.
              </p>
            )}
          </section>

          <CapabilityControls
            capabilities={capabilities}
            onChange={onCapabilitiesChange}
            disabled={isCreating}
          />
          <p className="text-xs leading-relaxed text-neutral-400">
            Your course details and capability choices are kept when you go back to editing.
          </p>
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t border-neutral-700 bg-neutral-950/30 p-4 sm:px-6">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={isCreating}
            className="rounded-xl border border-neutral-700 px-4 py-2.5 text-sm font-medium text-neutral-300 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Back to editing
          </button>
          <CreateButton onClick={onConfirm} loading={isCreating}>
            Confirm and create
          </CreateButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
