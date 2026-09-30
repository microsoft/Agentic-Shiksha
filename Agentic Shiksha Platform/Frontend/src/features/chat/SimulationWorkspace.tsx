import { useState } from "react";
import CircuitBlock from "./CircuitBlock";
import { circuitExample } from "@/lib/circuitExamples";
import type { CircuitContentBlock } from "@/lib/circuit";
import { prefixedId } from "@/lib/secureId";

export default function SimulationWorkspace({
  block, agentId, threadId, readOnly = false, embedded = false,
}: {
  block?: CircuitContentBlock;
  agentId?: string;
  threadId?: string | null;
  readOnly?: boolean;
  embedded?: boolean;
}) {
  const [example] = useState<CircuitContentBlock>(() => {
    const circuit = circuitExample("dol");
    return { type: "circuit", circuitId: prefixedId("simulation"), title: circuit.title, circuit };
  });

  return <CircuitBlock block={block ?? example} agentId={agentId} threadId={threadId} readOnly={readOnly} embedded={embedded} />;
}
