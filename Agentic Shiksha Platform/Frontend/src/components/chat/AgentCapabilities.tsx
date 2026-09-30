import { useEffect, useId, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import {
  getAgentCapabilities, getCachedAgentCapabilities, getCachedCircuitToolStatus,
  getCachedSlidesToolStatus, getCircuitToolStatus, getSlidesToolStatus,
  type AgentCapability, type CircuitToolStatus, type SlidesToolStatus,
} from "@/lib/api";
import { useUserStore } from "@/lib/userStore";
import { CircuitToolControl } from "@/features/chat/CircuitBlock";
import { SlidesToolControl } from "@/features/chat/SlidesBlock";

type CapabilityResult = {
  scope: string;
  capabilities: AgentCapability[];
  error: string | null;
  circuit: CircuitToolStatus | null;
  circuitError: string | null;
  slides: SlidesToolStatus | null;
  slidesError: string | null;
};

function cachedResult(agentId: string, scope: string, canManage: boolean): CapabilityResult | null {
  const capabilities = getCachedAgentCapabilities(agentId);
  const circuit = canManage ? getCachedCircuitToolStatus(agentId) : null;
  const slides = canManage ? getCachedSlidesToolStatus(agentId) : null;
  if (!capabilities || (canManage && (!circuit || !slides))) return null;
  return { scope, capabilities, error: null, circuit, circuitError: null, slides, slidesError: null };
}

function loadError(failure: unknown): string {
  return failure instanceof Error ? failure.message : "Capabilities could not be loaded. Please retry.";
}

export function AgentCapabilities({ agentId, canManage }: { agentId: string; canManage: boolean }) {
  const headingId = useId();
  const account = useUserStore(state => JSON.stringify([state.userId, state.role, state.isAuthenticated]));
  const scope = JSON.stringify([account, agentId, canManage]);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<CapabilityResult | null>(() => cachedResult(agentId, scope, canManage));
  const current = result?.scope === scope ? result : null;

  useEffect(() => {
    const cached = cachedResult(agentId, scope, canManage);
    if (cached) {
      setResult(cached);
      return;
    }
    const controller = new AbortController();
    setResult(null);
    Promise.allSettled([
      getAgentCapabilities(agentId, controller.signal),
      canManage ? getCircuitToolStatus(agentId, controller.signal) : Promise.resolve(null),
      canManage ? getSlidesToolStatus(agentId, controller.signal) : Promise.resolve(null),
    ]).then(([capabilities, circuit, slides]) => {
      if (controller.signal.aborted) return;
      setResult({
        scope,
        capabilities: capabilities.status === "fulfilled" ? capabilities.value : [],
        error: capabilities.status === "rejected" ? loadError(capabilities.reason) : null,
        circuit: circuit.status === "fulfilled" ? circuit.value : null,
        circuitError: circuit.status === "rejected" ? loadError(circuit.reason) : null,
        slides: slides.status === "fulfilled" ? slides.value : null,
        slidesError: slides.status === "rejected" ? loadError(slides.reason) : null,
      });
    });
    return () => controller.abort();
  }, [agentId, scope, canManage, attempt]);

  const capabilities = current?.capabilities.filter(capability =>
    !canManage || (capability !== "Simulation" && capability !== "Slide presentations")) ?? [];

  return (
    <section aria-labelledby={headingId} className="mt-4">
      <h3 id={headingId} className="mb-2 text-sm font-semibold text-neutral-200">Capabilities</h3>
      {!current && (
        <p role="status" className="mb-2 flex items-center gap-2 text-xs text-neutral-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading capabilities...
        </p>
      )}
      {current?.error && (
        <div role="alert" className="mb-2 space-y-1 text-xs text-amber-300">
          <p>{current.error}</p>
          <button type="button" className="underline underline-offset-2" onClick={() => setAttempt(value => value + 1)}>
            Retry capabilities
          </button>
        </div>
      )}
      {current && !current.error && current.capabilities.length === 0 && !canManage && (
        <p className="text-xs text-neutral-400">No supported capabilities are listed for this TA.</p>
      )}
      <ul aria-label="Agent capabilities" className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs text-neutral-200">
        {capabilities.map(capability => (
          <li key={capability} className="flex min-w-0 items-start gap-2">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" aria-hidden="true" />
            <span className="min-w-0 break-words">{capability}</span>
          </li>
        ))}
        {canManage && current && (
          <>
            <li className="min-w-0 has-[button]:col-span-2"><CircuitToolControl key={`circuit:${scope}`} agentId={agentId} initialStatus={current.circuit} initialError={current.circuitError} /></li>
            <li className="min-w-0 has-[button]:col-span-2"><SlidesToolControl key={`slides:${scope}`} agentId={agentId} initialStatus={current.slides} initialError={current.slidesError} /></li>
          </>
        )}
      </ul>
    </section>
  );
}
