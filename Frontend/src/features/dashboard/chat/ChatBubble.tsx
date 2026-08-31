// ChatBubble.tsx — Stripped version for Dashboard.
// Normal messages only. No quiz/flashcard/challenge/document/chemistry content blocks.
// All CSS classes match the main Frontend ChatBubble exactly.

import React from "react";
import clsx from "clsx";
import {
  Copy,
  Check,
  ThumbsUp,
  ThumbsDown,
  RotateCcw,
  MoreHorizontal,
  Pencil,
  ClipboardCheck,
  Diamond,
  Layers,
  Shapes,
  Lock,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import Markdown from "@/features/dashboard/components/Markdown";
import type {
  ChatMsg as BaseChatMsg,
  EvidenceCitation,
} from "@/features/dashboard/lib/types";

export type ChatMsg = BaseChatMsg & {
  createdAt?: number;
};

type StudentEvidenceGroup = {
  key: string;
  studentRef: string;
  student: string;
  heading: string;
  citations: EvidenceCitation[];
};

function groupEvidenceByStudent(citations: EvidenceCitation[]): StudentEvidenceGroup[] {
  const groups = new Map<
    string,
    Omit<StudentEvidenceGroup, "heading">
  >();
  citations.forEach((citation) => {
    const studentRef = citation.student_ref || citation.ref.match(/^(S\d+)-/)?.[1] || "";
    const student = citation.student?.trim().replace(/\s+/g, " ") || "Unknown student";
    const key = studentRef || student.toLocaleLowerCase();
    const group = groups.get(key) ?? { key, studentRef, student, citations: [] };
    group.citations.push(citation);
    groups.set(key, group);
  });

  const nameCounts = new Map<string, number>();
  groups.forEach((group) => {
    const normalizedName = group.student.toLocaleLowerCase();
    nameCounts.set(normalizedName, (nameCounts.get(normalizedName) ?? 0) + 1);
  });

  return Array.from(groups.values(), (group) => ({
    ...group,
    heading:
      group.studentRef && (nameCounts.get(group.student.toLocaleLowerCase()) ?? 0) > 1
        ? `${group.student} (${group.studentRef})`
        : group.student,
  }));
}

type ChatBubbleProps = ChatMsg & {
  showUserActions?: boolean;
  hideActions?: boolean;
  showTimestamp?: boolean;
  onEdit?: (newContent: string) => void;
  onAssistantRetry?: () => void;
  onEvidenceNavigate?: (citation: EvidenceCitation) => void;
  isResearchResult?: boolean;
  sources?: Array<{ title: string; url?: string; domain?: string; favicon?: string; filename?: string; file_id?: string }>;
  responseTimeMs?: number;
  readOnly?: boolean;
};

function formatResponseTime(ms?: number): string {
  if (!ms || ms <= 0) return "";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds <= 0) return "";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function ChatBubble({
  role,
  content: rawContent,
  showUserActions,
  hideActions = false,
  onEdit,
  onAssistantRetry,
  onEvidenceNavigate,
  isResearchResult = false,
  sources,
  evidenceCitations,
  chatSignalsReviewed,
  responseTimeMs,
}: ChatBubbleProps) {
  const isUser = role === "user";
  const content = rawContent;

  const [copied, setCopied] = React.useState(false);
  const [evidenceExpanded, setEvidenceExpanded] = React.useState(false);
  const [activeRef, setActiveRef] = React.useState<string>("");
  const [pendingEvidenceJump, setPendingEvidenceJump] = React.useState<{
    ref: string;
    requestId: number;
  } | null>(null);
  const bubbleRef = React.useRef<HTMLDivElement>(null);
  const evidenceTargetsRef = React.useRef(new Map<string, HTMLButtonElement>());
  const evidencePreviewPerStudent = 2;
  const citationCount = evidenceCitations?.length ?? 0;
  const evidenceGroups = React.useMemo(
    () => groupEvidenceByStudent(evidenceCitations ?? []),
    [evidenceCitations],
  );
  const visibleEvidenceGroups = evidenceGroups.map((group) => ({
    ...group,
    visibleCitations: evidenceExpanded
      ? group.citations
      : group.citations.slice(0, evidencePreviewPerStudent),
  }));
  const visibleEvidenceCount = visibleEvidenceGroups.reduce(
    (count, group) => count + group.visibleCitations.length,
    0,
  );
  const hiddenEvidenceCount = Math.max(0, citationCount - visibleEvidenceCount);
  const hasCollapsibleEvidence = evidenceGroups.some(
    (group) => group.citations.length > evidencePreviewPerStudent,
  );

  React.useLayoutEffect(() => {
    if (!pendingEvidenceJump) return;
    const target = evidenceTargetsRef.current.get(pendingEvidenceJump.ref);
    if (!target) return;
    target.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
    target.focus({ preventScroll: true });
  }, [evidenceExpanded, pendingEvidenceJump]);

  // Inline [[S1-TP1]] markers are rendered by Markdown as evidence anchors.
  const handleEvidenceJump = (event: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>(
      'a[href^="#evidence-"]',
    );
    const ref = anchor?.getAttribute("href")?.replace("#evidence-", "");
    if (!ref) return;
    event.preventDefault();
    setEvidenceExpanded(true);
    setActiveRef(ref);
    setPendingEvidenceJump({ ref, requestId: Date.now() });
  };

  const handleReferenceClick = (ref: string) => {
    setActiveRef(ref);
    const inlineCitation = Array.from(
      bubbleRef.current?.querySelectorAll<HTMLAnchorElement>('a[href^="#evidence-"]') ?? [],
    ).find((anchor) => anchor.getAttribute("href") === `#evidence-${ref}`);
    if (!inlineCitation) return;
    inlineCitation.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
    inlineCitation.focus({ preventScroll: true });
  };

  return (
    <div
      ref={bubbleRef}
      className={clsx(
        "mb-5 flex animate-in fade-in slide-in-from-bottom-2 duration-300",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={clsx(
          "flex flex-col items-stretch gap-1.5 group",
          isUser ? "items-end" : "w-full items-start"
        )}
      >
        {/* Message */}
        <div
          className={clsx(
            "max-w-full",
            isUser ? "flex justify-end" : "flex justify-start w-full"
          )}
        >
          <div
            className={clsx(
              "max-w-full",
              isUser
                ? "rounded-2xl rounded-br-sm px-4 py-3 bg-neutral-800 text-neutral-100 shadow-md shadow-black/20 whitespace-pre-wrap break-words"
                : "text-[15px] leading-relaxed text-neutral-200 w-full"
            )}
          >
            {isUser ? (
              <div className="text-[15px] leading-relaxed">{content}</div>
            ) : (
              <div onClick={handleEvidenceJump}>
                <Markdown sources={sources}>{content}</Markdown>
              </div>
            )}
          </div>
        </div>

        {!isUser && ((evidenceCitations?.length ?? 0) > 0 || chatSignalsReviewed) && (
          <section
            aria-label="References"
            className="mt-3 w-full rounded-xl border border-neutral-800 bg-neutral-900/50 p-2.5"
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                References
              </p>
              {citationCount > 0 && (
                <span className="text-[10px] tabular-nums text-neutral-600">
                  {citationCount} {citationCount === 1 ? "source" : "sources"}
                </span>
              )}
            </div>
            <div className="space-y-2.5">
              {visibleEvidenceGroups.map(({ key, heading, citations, visibleCitations }) => (
                <section key={key} aria-label={`${heading} references`}>
                  <div className="mb-1.5 flex items-center gap-2">
                    <p className="min-w-0 truncate text-[10px] font-semibold text-neutral-400">
                      {heading}
                    </p>
                    <span className="text-[10px] tabular-nums text-neutral-600">
                      {citations.length}
                    </span>
                    <span className="h-px min-w-4 flex-1 bg-neutral-800" />
                  </div>
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {visibleCitations.map((citation) => {
                      const config = {
                        concept_inventory: {
                          label: "Concept inventory",
                          icon: ClipboardCheck,
                          iconClass: "text-emerald-400",
                        },
                        threshold_concept: {
                          label: "Threshold concept",
                          icon: Diamond,
                          iconClass: "text-violet-400",
                        },
                        topic_progress: {
                          label: "Topic progress",
                          icon: Layers,
                          iconClass: "text-sky-400",
                        },
                        asset: {
                          label: "Asset",
                          icon: Shapes,
                          iconClass: "text-amber-400",
                        },
                      }[citation.kind];
                      const Icon = config.icon;
                      const date = citation.observed_at
                        ? new Date(citation.observed_at).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })
                        : "No date";
                      return (
                        <button
                          type="button"
                          key={citation.ref}
                          onClick={() =>
                            onEvidenceNavigate
                              ? onEvidenceNavigate(citation)
                              : handleReferenceClick(citation.ref)
                          }
                          ref={(element) => {
                            if (element) evidenceTargetsRef.current.set(citation.ref, element);
                            else evidenceTargetsRef.current.delete(citation.ref);
                          }}
                          title={`${citation.student} · ${config.label} · ${date} · Jump to citation ${citation.ref}`}
                          aria-label={`${citation.student}: ${citation.label}. Jump to citation ${citation.ref}`}
                          className={clsx(
                            "inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-left text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60",
                            activeRef === citation.ref
                              ? "border-emerald-400/60 bg-emerald-500/15 text-emerald-100"
                              : "border-neutral-700 bg-neutral-800/70 text-neutral-300",
                          )}
                        >
                          <Icon
                            className={clsx("h-3.5 w-3.5 shrink-0", config.iconClass)}
                            fill="currentColor"
                            fillOpacity={0.3}
                            aria-hidden
                          />
                          <span className="min-w-0 flex-1 truncate">{citation.label}</span>
                          <span className="shrink-0 text-neutral-500">[{citation.ref}]</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {!evidenceExpanded && hiddenEvidenceCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setEvidenceExpanded(true)}
                    className="inline-flex items-center gap-1 rounded-full border border-neutral-700 bg-neutral-800/40 px-2.5 py-1 text-[11px] font-medium text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-200"
                  >
                    +{hiddenEvidenceCount} more
                    <ChevronDown className="h-3 w-3" />
                  </button>
                )}
                {evidenceExpanded && hasCollapsibleEvidence && (
                  <button
                    type="button"
                    onClick={() => setEvidenceExpanded(false)}
                    className="inline-flex items-center gap-1 rounded-full border border-neutral-700 bg-neutral-800/40 px-2.5 py-1 text-[11px] font-medium text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-200"
                  >
                    Show less
                    <ChevronUp className="h-3 w-3" />
                  </button>
                )}
                {chatSignalsReviewed && (
                  <span
                    title="Recent student chat signals informed the analysis. Chat excerpts are intentionally hidden and cannot be cited."
                    className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/20 bg-sky-500/[0.08] px-2.5 py-1 text-[11px] text-sky-300"
                  >
                    <Lock className="h-3 w-3" />
                    Chat signals reviewed · excerpts hidden
                  </span>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Assistant actions */}
        {!isUser && !hideActions && (
          <div className="mt-2 flex items-center gap-1">
            <button
              type="button"
              className="p-1 hover:bg-neutral-800/40 rounded-md transition-all duration-200"
              title={copied ? "Copied!" : "Copy message"}
              onClick={() => {
                navigator.clipboard.writeText(content || "");
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? (
                <Check className="h-4 w-4 text-white" />
              ) : (
                <Copy className="h-4 w-4 text-neutral-400 hover:text-neutral-200" />
              )}
            </button>
            <button type="button" className="p-1 hover:bg-neutral-800/40 rounded-md transition-all duration-200" title="Good response">
              <ThumbsUp className="h-4 w-4 text-neutral-400 hover:text-neutral-200" />
            </button>
            <button type="button" className="p-1 hover:bg-neutral-800/40 rounded-md transition-all duration-200" title="Bad response">
              <ThumbsDown className="h-4 w-4 text-neutral-400 hover:text-neutral-200" />
            </button>
            {onAssistantRetry && !isResearchResult && (
              <button type="button" onClick={onAssistantRetry} className="p-1 hover:bg-neutral-800/40 rounded-md transition-all duration-200" title="Retry generation">
                <RotateCcw className="h-4 w-4 text-neutral-400 hover:text-neutral-200" />
              </button>
            )}
            <button type="button" className="p-1 hover:bg-neutral-800/40 rounded-md transition-all duration-200" title="More options">
              <MoreHorizontal className="h-4 w-4 text-neutral-400 hover:text-neutral-200" />
            </button>
            <span className="ml-2 text-[11px] text-neutral-400 min-w-[28px]" title={responseTimeMs ? "Response time" : ""}>
              {responseTimeMs ? formatResponseTime(responseTimeMs) : ""}
            </span>
          </div>
        )}

        {/* User actions (copy on hover) */}
        {isUser && showUserActions && (
          <div className="mt-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(content || "");
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="hover:opacity-70 transition-opacity duration-200"
              title={copied ? "Copied!" : "Copy message"}
            >
              {copied ? <Check className="h-4 w-4 text-white" /> : <Copy className="h-4 w-4 text-neutral-400" />}
            </button>
            {onEdit && (
              <button type="button" className="hover:opacity-70 transition-opacity duration-200" title="Edit this message">
                <Pencil className="h-4 w-4 text-neutral-400" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default ChatBubble;
