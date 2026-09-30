import { useEffect, useState } from "react";
import { STUDENT_ASSIGNMENTS_ENABLED } from "./config";
import { getStudentAssignmentPermission } from "./studentAssignmentsApi";
import { useUserStore } from "./userStore";

export function useStudentAssignmentAccess(enabled: boolean) {
  const available = enabled && STUDENT_ASSIGNMENTS_ENABLED;
  const account = useUserStore(state => `${state.userId}:${state.role}:${state.isAuthenticated}`);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    account: string;
    allowed: boolean;
    error: boolean;
  } | null>(null);

  useEffect(() => {
    setResult(null);
    if (!available) return;
    const controller = new AbortController();
    getStudentAssignmentPermission(controller.signal)
      .then(allowed => {
        if (!controller.signal.aborted) setResult({ account, allowed, error: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ account, allowed: false, error: true });
      });
    return () => controller.abort();
  }, [available, account, attempt]);

  const current = available && result?.account === account ? result : null;
  return {
    allowed: current?.allowed ?? false,
    loading: available && !current,
    error: current?.error ?? false,
    retry: () => setAttempt(value => value + 1),
  };
}
