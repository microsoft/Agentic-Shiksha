import { useState } from "react";
import { dispatchChatQuery } from "@/features/chat/chatQueryEvent";

export default function SuggestedQueriesBlock({
  queries,
  readOnly = false,
}: {
  queries: string[];
  readOnly?: boolean;
}) {
  const [sent, setSent] = useState(false);

  const send = (query: string) => {
    if (sent || readOnly) return;
    setSent(true);
    dispatchChatQuery(query);
  };

  if (queries.length === 0 || sent) return null;

  // No top margin: the parent block list already applies gap spacing.
  return (
    <div className="w-full">
      <p className="mb-2 text-sm font-medium text-neutral-400">Suggestions</p>
      <div className="flex flex-col items-start gap-2">
        {queries.map((query) => (
          <button
            key={query}
            type="button"
            onClick={() => send(query)}
            disabled={sent || readOnly}
            className="max-w-full rounded-xl bg-[#2a2a2a] px-4 py-2.5 text-left text-[13px] text-neutral-200 transition-colors hover:bg-neutral-700 hover:text-neutral-50 disabled:cursor-not-allowed disabled:bg-neutral-800/40 disabled:text-neutral-500"
          >
            {query}
          </button>
        ))}
      </div>
    </div>
  );
}
