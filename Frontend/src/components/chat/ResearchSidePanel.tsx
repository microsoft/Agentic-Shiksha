import * as React from "react";
import { cn } from "@/lib/utils";
import { X, ExternalLink, Globe } from "lucide-react";
import type { ResearchData } from "@/lib/types";

// Extract activity and source item types from ResearchData
type ActivityItem = ResearchData["activities"][number];
type SourceItem = ResearchData["sources"][number];

interface ResearchSidePanelProps {
  isOpen: boolean;
  onClose: () => void;
  research: ResearchData | null;
  initialTab?: TabType;
}

type TabType = "activity" | "sources";

/**
 * Side panel showing research activity and sources (similar to ChatGPT's research panel)
 */
export function ResearchSidePanel({
  isOpen,
  onClose,
  research,
  initialTab = "activity",
}: ResearchSidePanelProps) {
  const [activeTab, setActiveTab] = React.useState<TabType>(initialTab);
  const activityScrollRef = React.useRef<HTMLDivElement>(null);

  // Update activeTab when initialTab changes (when user clicks a different link)
  React.useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const activities = research?.activities || [];
  const sources = research?.sources || [];
  const isResearching = research?.status === "running";

  // Auto-scroll activity to bottom when new items arrive
  React.useEffect(() => {
    if (activityScrollRef.current && activeTab === "activity") {
      activityScrollRef.current.scrollTop = activityScrollRef.current.scrollHeight;
    }
  }, [activities, activeTab]);

  if (!isOpen) return null;

  return (
    <div className="w-[33vw] min-w-[320px] max-w-[480px] border-l border-white/[0.08] bg-neutral-800/80 flex flex-col h-full animate-in slide-in-from-right duration-300 z-20">
      {/* Header with centered tabs */}
      <div className="flex items-center justify-center px-4 py-3 border-b border-white/[0.08] relative">
        <div className="flex items-center gap-1 bg-neutral-700/80 rounded-lg p-1">
          <button
            onClick={() => setActiveTab("activity")}
            className={cn(
              "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
              activeTab === "activity"
                ? "bg-blue-600 text-white"
                : "text-neutral-400 hover:text-neutral-200"
            )}
          >
            Activity
          </button>
          <button
            onClick={() => setActiveTab("sources")}
            className={cn(
              "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
              activeTab === "sources"
                ? "bg-blue-600 text-white"
                : "text-neutral-400 hover:text-neutral-200"
            )}
          >
            Sources
          </button>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="absolute right-4 p-2 rounded-lg hover:bg-neutral-700 text-neutral-400 hover:text-white transition-colors z-10"
          title="Close panel"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "activity" ? (
          <div
            ref={activityScrollRef}
            className="h-full overflow-y-auto px-4 py-3"
          >
            {/* Timeline container */}
            <div className="relative">
              {/* Vertical timeline line - solid blue */}
              <div className="absolute left-[4px] top-2 bottom-2 w-0.5 bg-blue-500/60 rounded-full" />
              
              {/* Activity items */}
              <div className="space-y-4">
                {activities
                  .filter((item) => {
                    // Filter out unwanted activity content
                    const content = item.content.toLowerCase();
                    return !(
                      content.includes('runstatus') ||
                      content.includes('run status') ||
                      content.includes('in_progress') ||
                      content.includes('queued') ||
                      content.includes('starting deep research') ||
                      content.includes('final report') ||
                      content.includes('# ') || // Filter out markdown headings (likely report content)
                      content.includes('## ') ||
                      content.startsWith('title:') ||
                      item.content.length > 500 // Filter out long content (likely report)
                    );
                  })
                  .map((item, index, arr) => (
                    <ActivityItemRow key={index} item={item} isLast={index === arr.length - 1} isActive={isResearching && index === arr.length - 1} />
                  ))}
              </div>
            </div>
            {activities.length === 0 && !isResearching && (
              <div className="text-center text-neutral-500 text-sm py-8">
                No activity yet
              </div>
            )}
          </div>
        ) : (
          <div className="h-full overflow-y-auto px-4 py-3">
            {/* Group sources by domain */}
            {(() => {
              // Group sources by domain and count
              const domainGroups = new Map<string, { source: SourceItem; count: number }>();
              sources.forEach((source) => {
                const existing = domainGroups.get(source.domain);
                if (existing) {
                  existing.count++;
                } else {
                  domainGroups.set(source.domain, { source, count: 1 });
                }
              });
              
              return (
                <>
                  {sources.length > 0 && (
                    <div className={`text-xs mb-3 ${isResearching ? 'text-blue-400 animate-text-shimmer' : 'text-neutral-500'}`}>
                      {isResearching ? "Compiling sources" : "Sources compiled"}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {Array.from(domainGroups.values()).map(({ source, count }, index) => (
                      <SourceChip key={index} source={source} count={count} />
                    ))}
                  </div>
                  {sources.length === 0 && (
                    <div className={`text-center text-sm py-4 ${isResearching ? 'text-blue-400 animate-text-shimmer' : 'text-neutral-500'}`}>
                      {isResearching ? "Compiling sources..." : "No sources found"}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Parse and render markdown-like content:
 * - ### text or **text** → bold heading on its own line
 * - 【N†Text】 or 【N:M†source】 → clickable inline citation link
 * - [text](url) → clickable markdown link
 */
function renderActivityContent(content: string, citations?: Array<{ title: string; url: string }>, isActive: boolean = false): React.ReactNode {
  // Skip empty or whitespace-only content
  if (!content || !content.trim()) return null;

  const parts: React.ReactNode[] = [];
  let keyIndex = 0;

  // Get citation by index (1-based)
  const getCitation = (index: number): { title: string; url: string } | null => {
    if (!citations || citations.length === 0) return null;
    const idx = index - 1;
    if (idx >= 0 && idx < citations.length) {
      return citations[idx];
    }
    return null;
  };

  // Extract search query from Bing URL
  const extractQueryFromUrl = (url: string): string | null => {
    try {
      const urlObj = new URL(url);
      const query = urlObj.searchParams.get('q');
      if (query) return query;
    } catch {
      // Not a valid URL
    }
    return null;
  };

  // Combined pattern for all special elements:
  // 1. 【N†Text】 - simple citation
  // 2. 【N:M†source】 - numbered source citation  
  // 3. [text](url) - markdown link
  const combinedPattern = /【(\d+)(?::(\d+))?†([^】]+)】|\[([^\]]+)\]\(([^)]+)\)/g;

  let lastIndex = 0;
  let match;

  while ((match = combinedPattern.exec(content)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      const textBefore = content.slice(lastIndex, match.index);
      parts.push(...renderHeadingsAndText(textBefore, keyIndex++, isActive));
    }

    if (match[1] !== undefined) {
      // Citation match: 【N†Text】 or 【N:M†source】
      const citationNum = parseInt(match[1], 10);
      const subNum = match[2]; // May be undefined for simple citations
      const citationText = match[3];
      
      // Try to get citation from array
      const citation = getCitation(citationNum);
      
      if (citation && citation.url) {
        // We have citation data from the backend
        const searchQuery = extractQueryFromUrl(citation.url);
        const displayText = searchQuery || citation.title || citationText;
        
        // Add a line break before the citation to put it on its own line
        parts.push(
          <div key={`citation-${keyIndex++}`} className="mt-2">
            <a
              href={citation.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 pl-2 pr-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700/50 text-neutral-300 hover:text-neutral-100 rounded-lg text-xs transition-colors"
              title={searchQuery ? `Search: ${searchQuery}` : citation.title}
            >
              <Globe className="w-3.5 h-3.5 flex-shrink-0 text-neutral-400" />
              <span className="truncate">{displayText.length > 35 ? displayText.slice(0, 35) + '...' : displayText}</span>
            </a>
          </div>
        );
      } else {
        // No citation data - just show the reference number without link
        parts.push(
          <span
            key={`citation-ref-${keyIndex++}`}
            className="inline-flex items-center px-1 py-0.5 bg-neutral-700/50 text-neutral-400 rounded text-xs"
          >
            [{citationNum}{subNum ? `:${subNum}` : ''}]
          </span>
        );
      }
    } else if (match[4] !== undefined && match[5] !== undefined) {
      // Markdown link match: [text](url)
      const linkText = match[4];
      const linkUrl = match[5];
      
      // Extract query from Bing URL if applicable
      const searchQuery = extractQueryFromUrl(linkUrl);
      const displayText = searchQuery || linkText;
      
      // Add a line break before the link to put it on its own line
      parts.push(
        <div key={`link-${keyIndex++}`} className="mt-2">
          <a
            href={linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 pl-2 pr-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700/50 text-neutral-300 hover:text-neutral-100 rounded-lg text-xs transition-colors"
            title={linkUrl}
          >
            <Globe className="w-3.5 h-3.5 flex-shrink-0 text-neutral-400" />
            <span className="truncate">{displayText.length > 35 ? displayText.slice(0, 35) + '...' : displayText}</span>
          </a>
        </div>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last match
  if (lastIndex < content.length) {
    const textAfter = content.slice(lastIndex);
    parts.push(...renderHeadingsAndText(textAfter, keyIndex++, isActive));
  }

  // If nothing matched, just parse headings and text
  if (parts.length === 0) {
    parts.push(...renderHeadingsAndText(content, 0, isActive));
  }

  return parts;
}

/**
 * Convert ### text or **text** to bold heading with spacing before and line break after
 * isActive: if true, apply shimmer to headings only
 */
function renderHeadingsAndText(text: string, baseKey: number, isActive: boolean = false): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Combined pattern for ### heading or **bold** - matches either format
  // Group 1: ### heading text, Group 2: **bold** text
  const headingPattern = /(?:^|\n)###\s*([^\n]+)|(?:\*\*([^*]+)\*\*)/g;
  let lastIndex = 0;
  let match;
  let keyIndex = 0;

  while ((match = headingPattern.exec(text)) !== null) {
    // Add plain text before the match (if not just whitespace)
    if (match.index > lastIndex) {
      const beforeText = text.slice(lastIndex, match.index);
      const trimmedBefore = beforeText.replace(/\s+$/, ''); // Trim trailing whitespace
      if (trimmedBefore) {
        parts.push(<span key={`${baseKey}-text-${keyIndex++}`}>{trimmedBefore}</span>);
        // Add spacer div before the heading for visual separation
        parts.push(<div key={`${baseKey}-spacer-${keyIndex++}`} className="h-3" />);
      }
    }
    
    // Get the heading text from either group
    const headingText = match[1] || match[2];
    
    // Add heading with line break after - shimmer on heading if active
    parts.push(
      <React.Fragment key={`${baseKey}-heading-${keyIndex++}`}>
        <strong className={cn("font-semibold text-white", isActive && "animate-text-shimmer")}>{headingText.trim()}</strong>
        <br />
      </React.Fragment>
    );
    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after heading (trim leading whitespace since we added line break)
  if (lastIndex < text.length) {
    const remainingText = text.slice(lastIndex);
    // Trim leading space after heading since we added a line break
    const trimmedRemaining = remainingText.replace(/^\s+/, '');
    if (trimmedRemaining) {
      parts.push(<span key={`${baseKey}-text-${keyIndex++}`}>{trimmedRemaining}</span>);
    }
  }

  // If nothing matched, check if it's a single short line (likely a heading without description)
  if (parts.length === 0 && text && text.trim()) {
    const trimmedText = text.trim();
    // If it's a short single line (under 60 chars, no period at end), treat as heading
    const isSingleLineHeading = trimmedText.length < 60 && 
                                 !trimmedText.includes('\n') && 
                                 !trimmedText.endsWith('.') &&
                                 !trimmedText.endsWith(',');
    if (isSingleLineHeading) {
      parts.push(
        <strong key={`${baseKey}-heading`} className={cn("font-semibold text-white", isActive && "animate-text-shimmer")}>
          {trimmedText}
        </strong>
      );
    } else {
      parts.push(<span key={`${baseKey}-plain`}>{text}</span>);
    }
  }

  return parts;
}

function ActivityItemRow({ item, isLast = false, isActive = false }: { item: ActivityItem; isLast?: boolean; isActive?: boolean }) {
  // Skip empty content
  const trimmedContent = item.content?.trim();
  if (!trimmedContent) return null;

  // Use the renderActivityContent but also pass citations and isActive for shimmer
  const renderedContent = renderActivityContent(trimmedContent, item.citations, isActive);
  if (!renderedContent) return null;

  return (
    <div className="relative flex items-start gap-3">
      {/* Timeline dot - blue for active/latest, grey otherwise */}
      <div className="flex-shrink-0 mt-1.5">
        <div className={cn(
          "w-2.5 h-2.5 rounded-full",
          isActive ? "bg-blue-500" : "bg-neutral-500"
        )} />
      </div>
      
      {/* Content */}
      <div className="flex-1 min-w-0 pb-1 text-sm">
        <p className="text-neutral-200 leading-relaxed">{renderedContent}</p>
        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-1 text-xs text-blue-400 hover:text-blue-300"
          >
            <ExternalLink className="w-3 h-3" />
            {item.source || item.url}
          </a>
        )}
      </div>
    </div>
  );
}

function SourceChip({ source, count }: { source: SourceItem; count?: number }) {
  // Extract domain for display
  const displayDomain = source.domain.replace(/^www\./, "");

  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-xs text-neutral-300 hover:text-neutral-100 transition-colors"
    >
      {source.favicon ? (
        <img src={source.favicon} alt="" className="w-4 h-4 rounded" />
      ) : (
        <Globe className="w-3.5 h-3.5 text-neutral-500" />
      )}
      <span>{displayDomain}</span>
      {count && count > 1 && (
        <span className="ml-1 px-1.5 py-0.5 bg-neutral-700 rounded text-neutral-400 text-[10px]">
          {count}
        </span>
      )}
    </a>
  );
}

export default ResearchSidePanel;
