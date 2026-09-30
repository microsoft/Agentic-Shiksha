import * as React from "react";
import { cn } from "@/lib/utils";
import { Square, CheckCircle2, AlertCircle, StopCircle } from "lucide-react";
import type { ResearchData } from "@/lib/types";

type TabType = "activity" | "sources";

interface ResearchMessageCardProps {
  research: ResearchData;
  onStop?: () => void;
  onOpenPanel?: (tab?: TabType) => void;
  isPanelOpen?: boolean;
  className?: string;
}

/**
 * Inline research message card - ChatGPT-style design with progress bar.
 * Shows dynamic status text and source count while running.
 */
export function ResearchMessageCard({
  research,
  onStop,
  onOpenPanel,
  isPanelOpen = false,
  className,
}: ResearchMessageCardProps) {
  const [showStopConfirm, setShowStopConfirm] = React.useState(false);
  const isRunning = research.status === "running";
  const isCompleted = research.status === "completed";
  const isError = research.status === "error";
  const isStopped = research.status === "stopped";
  const isClarification = research.status === "clarification";

  // Calculate duration
  const duration = React.useMemo(() => {
    const endTime = research.endTime || Date.now();
    const seconds = Math.floor((endTime - research.startTime) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }, [research.startTime, research.endTime, research.status]);

  // Get dynamic status text from latest activity (like ChatGPT)
  const statusData = React.useMemo(() => {
    if (isCompleted) return { heading: "Research completed", description: "" };
    if (isError) return { heading: "Research failed", description: "" };
    if (isStopped) return { heading: "Research stopped", description: "" };
    if (isClarification) return { heading: "Clarifying research scope", description: "Answer the questions below" };
    if (!isRunning) return { heading: "Research", description: "" };
    
    const lastActivity = research.activities[research.activities.length - 1];
    if (!lastActivity) return { heading: "Starting Research...", description: "" };
    
    // For search activities, show "Searching" with the query from the activity or research query
    if (lastActivity.type === "search") {
      // Try to extract query from the activity source or URL
      let searchQuery = lastActivity.source || research.query;
      if (searchQuery.length > 35) {
        searchQuery = searchQuery.substring(0, 32) + "...";
      }
      return { heading: `Searching "${searchQuery}"`, description: "" };
    }
    
    // Use the actual activity content as status (like ChatGPT does)
    let content = lastActivity.content;
    
    // Remove citation patterns like 【1†Bing Search】 or 【83:11†source】
    if (content) {
      content = content.replace(/【[^】]*】/g, '').trim();
    }
    
    if (content) {
      // Extract heading and description from markdown content like **Heading** - rest of text
      const boldMatch = content.match(/\*\*([^*]+)\*\*\s*[-–:]?\s*(.*)/s);
      if (boldMatch) {
        const heading = boldMatch[1].trim();
        let description = boldMatch[2]?.trim() || "";
        // Truncate description to ~40 chars
        if (description.length > 40) {
          description = description.substring(0, 37) + "...";
        }
        return { heading, description };
      }
      
      // Or extract ### heading with description
      const headingMatch = content.match(/^###?\s*(.+?)(?:\s*[-–:]\s*(.*))?$/s);
      if (headingMatch) {
        const heading = headingMatch[1].trim();
        let description = headingMatch[2]?.trim() || "";
        // Truncate description to ~40 chars
        if (description.length > 40) {
          description = description.substring(0, 37) + "...";
        }
        return { heading, description };
      }
      
      // If content is short enough, use it directly as heading
      if (content.length <= 50) {
        return { heading: content, description: "" };
      }
      // Otherwise split it
      return { heading: content.substring(0, 30) + "...", description: content.substring(30, 60) + "..." };
    }
    
    // Fallback based on type - show the research query for search activities
    const truncatedQuery = research.query.length > 30 
      ? research.query.substring(0, 27) + "..." 
      : research.query;
    
    switch (lastActivity.type) {
      case "read": return { heading: "Reading sources...", description: "" };
      case "thinking": return { heading: "Analyzing...", description: "" };
      default: return { heading: `Searching "${truncatedQuery}"`, description: "" };
    }
  }, [research.activities, research.query, isRunning, isCompleted, isError, isStopped]);

  // Check if we're in the starting phase (no activities yet)
  const isStarting = isRunning && research.activities.length === 0;

  // Calculate progress (based on activities, rough estimate)
  const progress = React.useMemo(() => {
    if (!isRunning) return 100;
    // More gradual progress based on activity count
    const activityProgress = Math.min(research.activities.length * 5, 90);
    return Math.max(5, activityProgress);
  }, [research.activities.length, isRunning]);

  const sourceCount = research.sources.length;

  return (
    <div className={cn("w-full max-w-[48rem] mx-auto", className)}>
      {/* Research card - ChatGPT style */}
      <div
        className={cn(
          "rounded-2xl border border-neutral-700/40 transition-all duration-200 shadow-md shadow-black/20 bg-neutral-800",
          isError && "bg-red-900/20 border-red-700/40",
          isStopped && "bg-neutral-800"
        )}
      >
        <div className="px-4 py-3">
          {/* Header row: Status text + Source count */}
          <div className="flex items-center justify-between gap-4 mb-1">
            {/* Dynamic status text - single line with ellipsis - opens Activity tab */}
            <button
              onClick={() => onOpenPanel?.("activity")}
              className={cn(
                "flex-1 min-w-0 text-[15px] truncate text-left hover:opacity-80 transition-opacity cursor-pointer",
                isRunning && "animate-text-shimmer",
                isCompleted && "text-neutral-300",
                isError && "text-red-400",
                isStopped && "text-neutral-400"
              )}
            >
              <span className="font-semibold">{statusData.heading}</span>
            </button>
            
            {/* Source count - always show when running, opens sources tab */}
            {isRunning && (
              <button
                onClick={() => onOpenPanel?.("sources")}
                className="text-[15px] text-blue-400 hover:text-blue-300 transition-colors whitespace-nowrap shrink-0"
              >
                {sourceCount} source{sourceCount !== 1 ? 's' : ''}
              </button>
            )}
          </div>
          
          {/* Description line - shows description below heading */}
          {isRunning && statusData.description && (
            <div className="text-sm text-neutral-400 italic truncate mb-2 pl-0.5 animate-text-shimmer">
              {statusData.description}
            </div>
          )}
          
          {/* Progress bar row */}
          <div className="flex items-center gap-3">
            {/* Progress bar container */}
            <div className="flex-1 h-1.5 bg-neutral-700/50 rounded-full overflow-hidden">
              {/* Animated progress indicator */}
              <div 
                className={cn(
                  "h-full rounded-full transition-all duration-700 ease-out relative",
                  isRunning && "bg-neutral-300",
                  isCompleted && "bg-neutral-400",
                  isError && "bg-red-500",
                  isStopped && "bg-amber-500/70"
                )}
                style={{ width: `${progress}%` }}
              />
            </div>
            
            {/* Stop button - only when running */}
            {isRunning && onStop && (
              <button
                onClick={() => setShowStopConfirm(true)}
                className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-neutral-700/80 hover:bg-neutral-600 border border-neutral-600/40 text-white transition-all hover:scale-105"
                title="Stop research"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            )}
            
            {/* Completed/Error/Stopped icons */}
            {isCompleted && (
              <CheckCircle2 className="w-5 h-5 text-neutral-400 flex-shrink-0" />
            )}
            {isError && (
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
            )}
            {isStopped && (
              <Square className="w-4 h-4 fill-amber-500/60 text-amber-500/60 flex-shrink-0" />
            )}
          </div>
        </div>
      </div>
      
      {/* Stats below card when stopped only (completed stats now shown inline with Final Report) */}
      {isStopped && (
        <div className="flex items-center gap-2 mt-2 px-1">
          <span className="text-sm font-medium italic text-neutral-400">{duration}</span>
          {research.activities.length > 0 && (
            <button
              onClick={() => onOpenPanel?.("activity")}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-neutral-800 border border-neutral-700/60 text-sm text-neutral-400 hover:text-neutral-300 hover:bg-neutral-700/80 hover:border-neutral-600 transition-all"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              thoughts
            </button>
          )}
          {sourceCount > 0 && (
            <button
              onClick={() => onOpenPanel?.("sources")}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-neutral-800 border border-neutral-700/60 text-sm text-neutral-400 hover:text-neutral-300 hover:bg-neutral-700/80 hover:border-neutral-600 transition-all"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              sources
            </button>
          )}
        </div>
      )}
      
      {/* Stop confirmation dialog */}
      {showStopConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-neutral-800 border border-neutral-600 rounded-xl p-5 max-w-sm mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-white mb-2">Stop Research?</h3>
            <p className="text-neutral-400 text-sm mb-4">
              Are you sure you want to stop this research? The current progress will be saved but no new information will be gathered.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowStopConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-neutral-300 hover:text-white bg-neutral-700 hover:bg-neutral-600 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowStopConfirm(false);
                  onStop?.();
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors"
              >
                Stop
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ResearchMessageCard;
