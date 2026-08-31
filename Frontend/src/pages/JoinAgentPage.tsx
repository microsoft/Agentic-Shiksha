import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/useAuth";

// Survives the full-page round trip through the identity provider, which router
// state does not, so a logged-out recipient still lands on the right course.
export const PENDING_JOIN_CODE_KEY = "pendingJoinCode";

export default function JoinAgentPage() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useAuth();
  const [error, setError] = useState("");
  const attempted = useRef(false);

  const joinCode = code.trim().toUpperCase();
  const isValidCode = /^[A-Z0-9]{6}$/.test(joinCode);

  useEffect(() => {
    if (isValidCode && !isAuthenticated) {
      sessionStorage.setItem(PENDING_JOIN_CODE_KEY, joinCode);
    }
  }, [isValidCode, isAuthenticated, joinCode]);

  useEffect(() => {
    if (!isValidCode || !isAuthenticated || attempted.current) return;
    attempted.current = true;

    (async () => {
      try {
        const { connectByCode, listAzureAgents } = await import("@/lib/api");
        const { getCourseName } = await import("@/lib/utils");
        const result = await connectByCode(joinCode);
        sessionStorage.removeItem(PENDING_JOIN_CODE_KEY);
        await listAzureAgents(true).catch(() => {});
        toast.success(`Joined "${result.course_name || result.agent_name}"`);
        navigate(`/course/${encodeURIComponent(getCourseName(result.agent_name))}`, { replace: true });
      } catch (err) {
        sessionStorage.removeItem(PENDING_JOIN_CODE_KEY);
        const message = err instanceof Error ? err.message : "";
        const lower = message.toLowerCase();
        // Owners and existing members already have it; drop them straight in.
        if (lower.includes("already own")) {
          navigate("/library", { replace: true });
          return;
        }
        if (lower.includes("no agent found") || lower.includes("404")) {
          setError("This invite link is no longer valid.");
          return;
        }
        setError(message || "Could not join this teaching assistant. Please try again.");
      }
    })();
  }, [isValidCode, isAuthenticated, joinCode, navigate]);

  if (!isValidCode) {
    return <JoinStatus title="Invalid invite link" detail="This link is missing a valid 6-character code." onBack={() => navigate("/library")} />;
  }
  if (isLoading) {
    return <JoinStatus title="Checking your account…" spinner />;
  }
  if (!isAuthenticated) {
    return <Navigate to="/auth" replace />;
  }
  if (error) {
    return <JoinStatus title="Could not join" detail={error} onBack={() => navigate("/library")} />;
  }
  return <JoinStatus title="Joining teaching assistant…" spinner />;
}

function JoinStatus({
  title,
  detail,
  spinner,
  onBack,
}: {
  title: string;
  detail?: string;
  spinner?: boolean;
  onBack?: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950 px-4">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        {spinner && <Loader2 className="h-8 w-8 animate-spin text-neutral-400" />}
        <h1 className="text-lg font-semibold text-white">{title}</h1>
        {detail && <p className="text-sm text-neutral-400">{detail}</p>}
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-neutral-700 bg-neutral-800 px-5 py-2 text-sm font-medium text-neutral-100 transition-colors hover:bg-neutral-700"
          >
            Go to Library
          </button>
        )}
      </div>
    </div>
  );
}
