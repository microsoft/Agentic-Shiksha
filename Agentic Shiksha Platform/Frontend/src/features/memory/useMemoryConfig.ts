import { useCallback, useEffect, useState } from "react";
import { learnerMemoryApi, type MemoryConfig } from "@/lib/learnerMemoryApi";

export function useMemoryConfig(agentId: string | null | undefined) {
  const [result, setResult] = useState<{ agentId: string; config: MemoryConfig | null; error: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (!agentId) return;
    const controller = new AbortController();
    learnerMemoryApi.getConfig(agentId, controller.signal)
      .then(config => { if (!controller.signal.aborted) setResult({ agentId, config, error: "" }); })
      .catch(() => { if (!controller.signal.aborted) setResult({ agentId, config: null, error: "Graph Memory availability could not be checked." }); });
    return () => controller.abort();
  }, [agentId, revision]);
  const current = result?.agentId === agentId ? result : null;
  return { config: current?.config ?? null, error: current?.error ?? "", loading: Boolean(agentId && !current), refresh };
}
