import { useEffect, useRef, useState } from "react";
import clsx from "clsx";

const ROW_HEIGHT_PX = 40;
const ROW_GAP_PX = 4;
const VISIBLE_ROWS = 5;
const PANEL_MAX_HEIGHT_PX = ROW_HEIGHT_PX * VISIBLE_ROWS + ROW_GAP_PX * (VISIBLE_ROWS - 1);

export type SectionRailItem = {
  id: string;
  label: string;
};

/**
 * Hovering the rail opens a panel listing every section, matching the chat query rail.
 * `className` must position the rail (fixed/absolute/sticky) since the panel anchors to it.
 */
export function SectionScrollRail({
  items,
  activeIndex,
  onSelect,
  ariaLabel,
  className,
}: {
  items: SectionRailItem[];
  activeIndex: number;
  onSelect: (index: number) => void;
  ariaLabel: string;
  className?: string;
}) {
  const navigationRef = useRef<HTMLElement>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  // Keep the active pill inside the rail without disturbing the page scroll position.
  useEffect(() => {
    const navigation = navigationRef.current;
    const activeButton = navigation?.querySelector<HTMLElement>(
      `[data-section-rail-index="${activeIndex}"]`,
    );
    if (!navigation || !activeButton) return;

    const navigationBounds = navigation.getBoundingClientRect();
    const buttonBounds = activeButton.getBoundingClientRect();
    if (buttonBounds.top < navigationBounds.top) {
      navigation.scrollTop -= navigationBounds.top - buttonBounds.top;
    } else if (buttonBounds.bottom > navigationBounds.bottom) {
      navigation.scrollTop += buttonBounds.bottom - navigationBounds.bottom;
    }
  }, [activeIndex]);

  if (items.length < 2) return null;

  return (
    <div
      className={clsx("w-8", className)}
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
              {items.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(index)}
                  className={clsx(
                    "block h-10 w-full shrink-0 truncate rounded-lg px-3 text-left text-[13px] leading-10 transition-colors",
                    index === activeIndex
                      ? "bg-neutral-700 text-neutral-100"
                      : "text-neutral-300 hover:bg-neutral-700/60",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <nav
        ref={navigationRef}
        aria-label={ariaLabel}
        className="flex max-h-[calc(100vh-9rem)] w-8 flex-col items-center gap-0.5 overflow-y-auto overflow-x-hidden overscroll-contain [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none" }}
      >
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(index)}
            aria-current={index === activeIndex ? "true" : undefined}
            aria-label={`Scroll to ${index + 1}: ${item.label}`}
            data-section-rail-index={index}
            className="group relative flex h-3 w-8 shrink-0 items-center justify-center"
          >
            <span
              aria-hidden="true"
              className={clsx(
                "block rounded-full transition-all duration-300",
                index === activeIndex
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

export default SectionScrollRail;
