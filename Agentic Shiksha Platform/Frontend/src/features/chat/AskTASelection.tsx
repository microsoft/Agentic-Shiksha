import { useCallback, useEffect, useRef, useState } from "react";
import { dispatchAskTAQuote } from "./chatQueryEvent";

type Anchor = { top: number; left: number };

const MAX_QUOTE_LENGTH = 2000;

/**
 * Floating "Ask TA" button for text selected inside a chat message.
 * Only elements marked with `data-ask-ta` are eligible, so selections in the
 * composer, sidebar or other UI never trigger it.
 */
export function AskTASelection() {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [copied, setCopied] = useState(false);
  const selectedTextRef = useRef("");

  const hide = useCallback(() => {
    selectedTextRef.current = "";
    setCopied(false);
    setAnchor(null);
  }, []);

  useEffect(() => {
    const readSelection = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        hide();
        return;
      }

      const text = selection.toString().trim();
      if (!text) {
        hide();
        return;
      }

      const range = selection.getRangeAt(0);
      const node = range.commonAncestorContainer;
      const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
      if (!element?.closest("[data-ask-ta]")) {
        hide();
        return;
      }

      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        hide();
        return;
      }

      selectedTextRef.current = text.slice(0, MAX_QUOTE_LENGTH);
      setAnchor({
        top: Math.max(8, rect.top - 44),
        left: Math.min(Math.max(8, rect.left + rect.width / 2), window.innerWidth - 8),
      });
    };

    // Selection is not final until the drag ends, so read it after the release.
    const onPointerUp = () => window.setTimeout(readSelection, 0);
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.shiftKey || e.key.startsWith("Arrow")) window.setTimeout(readSelection, 0);
    };

    document.addEventListener("mouseup", onPointerUp);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("mouseup", onPointerUp);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [hide]);

  if (!anchor) return null;

  return (
    <div
      // Keeps the selection alive: mousedown would otherwise collapse it before onClick.
      onMouseDown={(e) => e.preventDefault()}
      style={{ top: anchor.top, left: anchor.left }}
      className="fixed z-50 -translate-x-1/2 flex items-center overflow-hidden rounded-xl border border-neutral-600 bg-neutral-800 shadow-lg shadow-black/40"
    >
      <button
        type="button"
        onClick={() => {
          dispatchAskTAQuote(selectedTextRef.current);
          window.getSelection()?.removeAllRanges();
          hide();
        }}
        className="px-3.5 py-1.5 text-[13px] font-medium text-neutral-100 transition-colors hover:bg-neutral-700"
      >
        Ask TA
      </button>
      <span className="w-px self-stretch bg-neutral-600" />
      <button
        type="button"
        aria-label="Copy selected text"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(selectedTextRef.current);
            setCopied(true);
            window.setTimeout(hide, 900);
          } catch {
            hide();
          }
        }}
        className="px-3.5 py-1.5 text-[13px] font-medium text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-neutral-100"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
