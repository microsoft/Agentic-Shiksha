import { useState } from "react";
import { Copy, Check, Key, ShieldCheck, Link2, X } from "lucide-react";

/**
 * Dialog shown to the creator after agent creation — displays the 6-digit manage code.
 */
export function ManageCodeRevealDialog({
  code,
  courseName,
  open,
  onClose,
}: {
  code: string;
  courseName: string;
  open: boolean;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  if (!open) return null;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-sm mx-4 rounded-2xl border border-neutral-700/50 bg-neutral-900 p-6 text-center space-y-5 shadow-2xl">
        {/* Icon */}
        <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center">
          <ShieldCheck className="h-6 w-6 text-emerald-400" />
        </div>

        {/* Title */}
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-white">Agent Manage Code</h2>
          <p className="text-sm text-neutral-400">
            Share this code for <span className="text-neutral-200 font-medium">{courseName}</span>. Any teacher with this code can edit or delete this agent, and any student with this code can use the agent.
          </p>
        </div>

        {/* Code display */}
        <div className="flex items-center justify-center gap-3">
          <div className="flex gap-1.5">
            {code.split("").map((char, i) => (
              <span
                key={i}
                className="w-9 h-11 flex items-center justify-center rounded-lg bg-neutral-800 border border-neutral-700 text-lg font-mono font-bold text-white"
              >
                {char}
              </span>
            ))}
          </div>
          <button
            onClick={handleCopy}
            className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
            title="Copy code"
          >
            {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>

        {/* Warning */}
        <p className="text-xs text-neutral-500">
          You can view this code later from the agent menu.
        </p>

        <button
          onClick={async () => {
            await navigator.clipboard.writeText(`${window.location.origin}/join/${code}`);
            setLinkCopied(true);
            setTimeout(() => setLinkCopied(false), 2000);
          }}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-neutral-700 bg-neutral-800 py-2.5 text-sm font-medium text-neutral-100 transition-colors hover:bg-neutral-700"
        >
          {linkCopied ? <Check className="h-4 w-4 text-emerald-400" /> : <Link2 className="h-4 w-4" />}
          {linkCopied ? "Invite link copied" : "Copy invite link"}
        </button>

        {/* Close button */}
        <button
          onClick={onClose}
          className="w-full py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors"
        >
          Got it
        </button>
      </div>
    </div>
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
