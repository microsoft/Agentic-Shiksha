import { useEffect, useState } from "react";
import { Copy, Check, Key, Share2, Loader2, RefreshCw, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Shares a teaching assistant through its access code and invite link.
 */
export function ManageCodeRevealDialog({
  code,
  courseName,
  open,
  onClose,
  loading = false,
  error,
  onRetry,
}: {
  code: string;
  courseName: string;
  open: boolean;
  onClose: () => void;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
}) {
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [copyError, setCopyError] = useState("");
  const shareCode = code.trim().toUpperCase();
  const validCode = /^[A-Z0-9]{6}$/.test(shareCode);
  const shareUrl = validCode ? new URL(`/join/${encodeURIComponent(shareCode)}`, window.location.origin).href : "";

  useEffect(() => {
    setCopied(null);
    setCopyError("");
  }, [open, code]);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(null), 2000);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  const handleCopy = async (kind: "code" | "link") => {
    setCopied(null);
    setCopyError("");
    try {
      await navigator.clipboard.writeText(kind === "code" ? shareCode : shareUrl);
      setCopied(kind);
    } catch {
      setCopyError("Clipboard access unavailable.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="w-[calc(100%_-_2rem)] min-w-0 max-w-sm gap-4 rounded-lg border-neutral-800 bg-neutral-900 p-4 text-neutral-100">
        <DialogHeader className="min-w-0 space-y-0.5 pr-8 text-left">
          <DialogTitle className="flex items-center gap-2 text-sm tracking-normal">
            <Share2 className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
            Share TA
          </DialogTitle>
          <DialogDescription className="break-words text-xs leading-5 text-neutral-400">
            {courseName}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div role="status" className="flex items-center justify-center gap-2 py-6 text-xs text-neutral-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading share details...
          </div>
        ) : error || !validCode ? (
          <div className="space-y-3">
            <p role="alert" className="text-xs text-red-400">{error || "Share details are unavailable."}</p>
            {onRetry && (
              <button type="button" onClick={onRetry} className="flex items-center gap-2 rounded-md border border-neutral-700 px-3 py-2 text-xs hover:bg-neutral-800">
                <RefreshCw className="h-4 w-4" />
                Try again
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="min-w-0 space-y-3">
              {([
                { kind: "code", label: "TA code", value: shareCode, title: "Copy TA code" },
                { kind: "link", label: "Share link", value: shareUrl, title: "Copy share link" },
              ] as const).map(({ kind, label, value, title }) => (
                <div key={kind} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2 text-xs leading-4">
                    <label htmlFor={`share-ta-${kind}`} className="font-medium text-neutral-400">{label}</label>
                    {copied === kind && <span aria-hidden="true" className="text-emerald-400">Copied</span>}
                  </div>
                  <div className="flex h-10 min-w-0 items-center overflow-hidden rounded-md border border-neutral-700/70 bg-neutral-950/60 focus-within:border-neutral-500">
                    <input
                      id={`share-ta-${kind}`}
                      readOnly
                      value={value}
                      title={value}
                      onFocus={(event) => event.currentTarget.select()}
                      className={`h-full min-w-0 flex-1 bg-transparent px-3 text-neutral-100 outline-none ${kind === "code" ? "font-mono text-base font-semibold" : "text-xs"}`}
                    />
                    <button
                      type="button"
                      aria-label={title}
                      title={title}
                      onClick={() => handleCopy(kind)}
                      className="flex h-full w-10 shrink-0 items-center justify-center border-l border-neutral-700/50 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-400"
                    >
                      {copied === kind ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              ))}
              <p role="status" className="sr-only">
                {copied === "code" ? "TA code copied" : copied === "link" ? "Share link copied" : ""}
              </p>
              {copyError && <p role="alert" className="text-xs text-red-400">{copyError}</p>}
            </div>
            <p className="border-t border-neutral-800 pt-3 text-xs leading-4 text-neutral-500">
              Sign-in required. Students need an admin assignment; links do not grant access.
              Teachers can join to manage this TA.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Dialog that prompts for the 6-digit manage code before allowing edit/delete.
 */
export function ManageCodeVerifyDialog({
  open,
  onClose,
  onVerified,
  agentId,
  action = "manage",
}: {
  open: boolean;
  onClose: () => void;
  onVerified: () => void;
  agentId: string;
  action?: "edit" | "delete" | "manage";
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);

  if (!open) return null;

  const handleVerify = async () => {
    if (code.length !== 6) {
      setError("Code must be 6 characters");
      return;
    }

    setVerifying(true);
    setError("");

    try {
      const { verifyManageCode } = await import("@/lib/api");
      await verifyManageCode(agentId, code);
      onVerified();
      setCode("");
    } catch {
      setError("Invalid code. Please try again.");
    } finally {
      setVerifying(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleVerify();
  };

  const actionLabel =
    action === "delete" ? "delete" : action === "edit" ? "edit" : "manage";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-sm mx-4 rounded-2xl border border-neutral-700/50 bg-neutral-900 p-6 text-center space-y-5 shadow-2xl">
        {/* Icon */}
        <div className="mx-auto w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center">
          <Key className="h-6 w-6 text-amber-400" />
        </div>

        {/* Title */}
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-white">Enter Manage Code</h2>
          <p className="text-sm text-neutral-400">
            Enter the 6-character code to {actionLabel} this agent.
          </p>
        </div>

        {/* Input */}
        <div>
          <input
            type="text"
            value={code}
            onChange={(e) => {
              const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
              setCode(val);
              setError("");
            }}
            onKeyDown={handleKeyDown}
            placeholder="ABC123"
            maxLength={6}
            className="w-full text-center text-2xl font-mono font-bold tracking-[0.3em] py-3 px-4 rounded-lg bg-neutral-800 border border-neutral-700 text-white placeholder:text-neutral-600 focus:outline-none focus:border-blue-500 transition-colors"
            autoFocus
          />
          {error && (
            <p className="mt-2 text-xs text-red-400">{error}</p>
          )}
        </div>

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={() => { onClose(); setCode(""); setError(""); }}
            className="flex-1 py-2.5 text-sm font-medium text-neutral-300 bg-neutral-800 border border-neutral-700 rounded-lg hover:bg-neutral-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleVerify}
            disabled={code.length !== 6 || verifying}
            className="flex-1 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {verifying ? "Verifying..." : "Verify"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Dialog that asks the user for a 6-character TA code to connect to a teaching assistant.
 */
export function ConnectAgentDialog({
  open,
  onClose,
  onConnected,
}: {
  open: boolean;
  onClose: () => void;
  onConnected: (agentId: string, courseName: string) => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);

  if (!open) return null;

  const handleConnect = async () => {
    if (code.length !== 6) {
      setError("Code must be 6 characters");
      return;
    }

    setConnecting(true);
    setError("");

    try {
      const { connectByCode } = await import("@/lib/api");
      const result = await connectByCode(code);
      onConnected(result.agent_id, result.course_name);
      setCode("");
    } catch (err: any) {
      const msg = err?.message || "";
      const lower = msg.toLowerCase();
      if (lower.includes("already own")) {
        setError("You already own this agent.");
      } else if (lower.includes("authentication") || lower.includes("expired session") || lower.includes("401")) {
        setError("Session expired. Please log in again.");
      } else if (lower.includes("no agent found") || lower.includes("404")) {
        setError("No agent found with that code.");
      } else {
        setError(msg || "Something went wrong. Please try again.");
      }
    } finally {
      setConnecting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleConnect();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-sm mx-4 rounded-2xl border border-neutral-700/50 bg-neutral-900 p-6 text-center space-y-5 shadow-2xl">
        {/* Close button */}
        <button
          onClick={() => { onClose(); setCode(""); setError(""); }}
          className="absolute right-3 top-3 w-7 h-7 flex items-center justify-center rounded-lg border border-neutral-700 bg-neutral-800 opacity-70 transition-all hover:opacity-100 hover:bg-neutral-700"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        {/* Title */}
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-white">Connect to a Teaching Assistant</h2>
          <p className="text-sm text-neutral-400">
            Enter the 6-character TA code shared by the creator.
            Students must already be assigned by an administrator.
          </p>
        </div>

        {/* Input */}
        <div>
          <input
            type="text"
            value={code}
            onChange={(e) => {
              const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
              setCode(val);
              setError("");
            }}
            onKeyDown={handleKeyDown}
            placeholder="ABC123"
            maxLength={6}
            className="w-full text-center text-2xl font-mono font-bold tracking-[0.3em] py-3 px-4 rounded-lg bg-neutral-800 border border-neutral-700 text-white placeholder:text-neutral-600 focus:outline-none focus:border-blue-500 transition-colors"
            autoFocus
          />
          {error && (
            <p className="mt-2 text-xs text-red-400">{error}</p>
          )}
        </div>

        {/* Connect button */}
        <button
          onClick={handleConnect}
          disabled={code.length !== 6 || connecting}
          className="w-full py-2.5 text-sm font-medium text-neutral-900 bg-white rounded-lg hover:bg-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {connecting ? "Connecting..." : "Connect"}
        </button>
      </div>
    </div>
  );
}
