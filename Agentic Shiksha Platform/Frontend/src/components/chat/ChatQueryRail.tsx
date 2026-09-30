import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import type { ChatMsg } from "@/features/chat/ChatBubble";

const QUERY_ROW_HEIGHT_PX = 40;
const QUERY_ROW_GAP_PX = 4;
const VISIBLE_QUERY_ROWS = 5;
const MIN_QUERIES_FOR_RAIL = 3;
const PANEL_MAX_HEIGHT_PX =
  QUERY_ROW_HEIGHT_PX * VISIBLE_QUERY_ROWS + QUERY_ROW_GAP_PX * (VISIBLE_QUERY_ROWS - 1);

type ChatQuery = {
  messageIndex: number;
  text: string;
};

export function ChatQueryRail({
  messages,
  scrollContainerRef,
}: {
  messages: ChatMsg[];
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const navigationRef = useRef<HTMLElement>(null);
  const [activePosition, setActivePosition] = useState(0);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  const queries = useMemo<ChatQuery[]>(() => {
    const collected: ChatQuery[] = [];
    messages.forEach((message, messageIndex) => {
      if (message.role !== "user") return;
      const text = (message.content || "").trim();
      if (text) collected.push({ messageIndex, text });
    });
    return collected;
  }, [messages]);

  const scrollToQuery = useCallback(
    (messageIndex: number) => {
      const container = scrollContainerRef.current;
      const target = container?.querySelector<HTMLElement>(
        `[data-chat-user-index="${messageIndex}"]`,
      );
      if (!container || !target) return;

      const offset = target.getBoundingClientRect().top
        - container.getBoundingClientRect().top
        + container.scrollTop;
      container.scrollTop = Math.max(0, offset - 16);
    },
    [scrollContainerRef],
  );

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || queries.length < MIN_QUERIES_FOR_RAIL) return;

    const syncActiveQuery = () => {
      const remainingScroll = container.scrollHeight
        - container.clientHeight
        - container.scrollTop;
      if (remainingScroll <= 2) {
        setActivePosition(queries.length - 1);
        return;
      }

      const activationTop = container.getBoundingClientRect().top + 24;
      let nextPosition = 0;
      queries.forEach((query, position) => {
        const target = container.querySelector<HTMLElement>(
          `[data-chat-user-index="${query.messageIndex}"]`,
        );
        if (target && target.getBoundingClientRect().top <= activationTop) {
          nextPosition = position;
        }
      });
      setActivePosition(nextPosition);
    };

    syncActiveQuery();
    container.addEventListener("scroll", syncActiveQuery, { passive: true });
    return () => container.removeEventListener("scroll", syncActiveQuery);
  }, [queries, scrollContainerRef]);

  // Keep the active pill inside the rail without disturbing the chat scroll position.
  useEffect(() => {
    const navigation = navigationRef.current;
    const activeButton = navigation
      ?.querySelector<HTMLElement>(`[data-chat-query-position="${activePosition}"]`);
    if (!navigation || !activeButton) return;

    const navigationBounds = navigation.getBoundingClientRect();
    const buttonBounds = activeButton.getBoundingClientRect();
    if (buttonBounds.top < navigationBounds.top) {
      navigation.scrollTop -= navigationBounds.top - buttonBounds.top;
    } else if (buttonBounds.bottom > navigationBounds.bottom) {
      navigation.scrollTop += buttonBounds.bottom - navigationBounds.bottom;
    }
  }, [activePosition]);

  if (queries.length < MIN_QUERIES_FOR_RAIL) return null;

  return (
    <div
      className="absolute right-3 top-1/2 z-20 -translate-y-1/2"
      onMouseEnter={() => setIsPanelOpen(true)}
      onMouseLeave={() => setIsPanelOpen(false)}
    >
      {isPanelOpen && (
        // pr-3 (not mr-3) so the gap to the rail stays hoverable and the panel doesn't close mid-travel.
        <div className="absolute right-full top-1/2 -translate-y-1/2 pr-3">
          <div className="w-72 overflow-hidden rounded-xl border border-white/10 bg-neutral-800 p-1 shadow-xl shadow-black/50">
            <div
              className="flex flex-col gap-1 overflow-y-auto overscroll-contain"
              style={{
                maxHeight: PANEL_MAX_HEIGHT_PX,
                scrollbarWidth: "thin",
                scrollbarColor: "rgb(115 115 115) transparent",
              }}
            >
              {queries.map((query, position) => (
                <button
                  key={query.messageIndex}
                  type="button"
                  onClick={() => scrollToQuery(query.messageIndex)}
                  className={clsx(
                    "block h-10 w-full shrink-0 truncate rounded-lg px-3 text-left text-[13px] leading-10 transition-colors",
                    position === activePosition
                      ? "bg-neutral-700 text-neutral-100"
                      : "text-neutral-300 hover:bg-neutral-700/60",
                  )}
                >
                  {query.text}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <nav
        ref={navigationRef}
        aria-label="Your queries"
        className="flex max-h-[calc(100vh-16rem)] w-8 flex-col items-center gap-0.5 overflow-y-auto overflow-x-hidden overscroll-contain [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none" }}
      >
        {queries.map((query, position) => (
          <button
            key={query.messageIndex}
            type="button"
            onClick={() => scrollToQuery(query.messageIndex)}
            aria-current={position === activePosition ? "true" : undefined}
            aria-label={`Scroll to your query ${position + 1}: ${query.text}`}
            data-chat-query-position={position}
            className="group relative flex h-3 w-8 shrink-0 items-center justify-center"
          >
            <span
              aria-hidden="true"
              className={clsx(
                "block rounded-full transition-all duration-300",
                position === activePosition
                  ? "h-1.5 w-8 bg-white"
                  : "h-1 w-5 bg-neutral-600 group-hover:bg-neutral-400",
              )}
            />
          </button>
        ))}
      </nav>
    </div>
  );
}

export default ChatQueryRail;
