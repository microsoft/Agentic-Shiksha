import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { Library, Plus, SquarePen, X, ChevronDown, ChevronRight, Copy, Check, RefreshCw, Download, ArrowRight, Share2, Link as LinkIcon, MoreHorizontal, GraduationCap, Settings, Trash2, Loader2, History, Pencil, KeyRound, Info } from "lucide-react";
import { FaComments } from "react-icons/fa";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import Markdown from "@/components/common/Markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { AssetContent } from "@/components/assets/AssetContent";
import { isConceptInventoryContent, parseAssetPayload } from "@/components/assets/assetPayload";
import type { AssetPayload } from "@/components/assets/assetPayload";
import type { QuizSubmitState } from "@/features/chat/QuizBlock";
import { CHAT_SEND_QUERY_EVENT, ASK_TA_QUOTE_EVENT } from "@/features/chat/chatQueryEvent";
import { AskTASelection } from "@/features/chat/AskTASelection";
import { UnifiedChatContainer } from "@/components/chat/UnifiedChatContainer";
import { ChatHistoryDrawer } from "@/components/chat/ChatHistoryDrawer";
import { ResearchSidePanel } from "@/components/chat/ResearchSidePanel";
import { useAgentChat } from "@/features/chat/useAgentChat";
import { useChatStore } from "@/lib/chatStore";
import { useMessagePagination } from "@/lib/useMessagePagination";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { getCourseName } from "@/lib/utils";
import { useAppContext } from "@/layouts/MainLayout";
import { deleteAzureAgent, getAgentCourseCurriculum, getAgentCurriculumStatus, getAgentLearningProgress, updateAgentCourseCurriculum, listCurriculumVersions, getCurriculumVersion, listAzureAgents, fetchAgentSetupDetails } from "@/lib/api";
import type { LearningProgress, LearningProgressEntry } from "@/lib/api";
import { applyNameGuard } from "@/lib/nameGuard";
import { useUserStore, useCurrentUserId } from "@/lib/userStore";
import { chatApi } from "@/lib/chatApi";
import type { GeneratedDoc } from "@/features/create/markdownUtils";
import { useUserRole } from "@/hooks/useUserRole";
import { ManageCodeVerifyDialog } from "@/components/ManageCodeDialog";
import type { ResearchData } from "@/lib/types";
import type { UploadedFile } from "@/features/create/sharedUI";
import { applyFixedFirstStarter } from "@/lib/starters";

const OPEN_CONCEPT_INVENTORY_FORM_ID = "open-concept-inventory-form";

/* ----------------------------- Asset anchoring ----------------------------- */
/**
 * A saved asset is identified in Cosmos by its own id, but the card rendered in
 * the transcript is keyed by the block id inside the payload (quizId, docId...).
 * Return every id worth trying so the anchor lookup works for both.
 */
function anchorIdsForAsset(asset: { id: string; content: string }): string[] {
  const ids = new Set<string>();
  if (asset.id) ids.add(asset.id);
  const payload = parseAssetPayload(asset.content) as
    | (AssetPayload & { docId?: string; documentId?: string })
    | null;
  if (payload) {
    for (const candidate of [
      payload.quizId,
      payload.flashcardId,
      payload.challengeId,
      payload.docId,
      payload.documentId,
      payload.quiz?.quizId,
      payload.firstAttempt?.quizId,
    ]) {
      if (candidate) ids.add(candidate);
    }
  }
  return [...ids];
}

const ANCHOR_HIGHLIGHT = ["ring-2", "ring-purple-400/70", "ring-offset-2", "ring-offset-neutral-900"];

/* ----------------------------- Curriculum progress ----------------------------- */
type ProgressStatus = "learned" | "in_progress" | "not_started";

function normaliseStatus(status?: string): ProgressStatus {
  if (status === "learned" || status === "in_progress") return status;
  return "not_started";
}

/** Replaces the plain bullet in the curriculum panel with the student's status. */
function ProgressDot({ status }: { status: ProgressStatus }) {
  // All three share one 14px box so the markers line up in a single column.
  const box = "flex h-3.5 w-3.5 items-center justify-center flex-shrink-0";
  if (status === "learned") {
    return (
      <span className={`${box} rounded-full bg-emerald-500`}>
        <Check className="h-2.5 w-2.5 text-neutral-950" strokeWidth={4} />
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span className={box}>
        <span className="w-2 h-2 rounded-full bg-amber-500/80 border border-amber-400/50" />
      </span>
    );
  }
  return (
    <span className={box}>
      <span className="w-2 h-2 rounded-full bg-neutral-600/80 border border-neutral-500/50" />
    </span>
  );
}

function ProgressBadge({ status }: { status: ProgressStatus }) {
  const label = status === "learned" ? "Crossed" : status === "in_progress" ? "In progress" : "Not started";
  const tone = status === "learned"
    ? "bg-emerald-500/15 text-emerald-300"
    : status === "in_progress"
      ? "bg-amber-500/15 text-amber-300"
      : "bg-neutral-800 text-neutral-500";
  return (
    <span className={`text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full leading-none ${tone}`}>
      {label}
    </span>
  );
}


/**
 * Messages stream in asynchronously, so poll briefly for the card before giving
 * up. Returns a cleanup function that stops the polling.
 */
function scrollToAssetAnchor(anchorIds: string[]): () => void {
  if (anchorIds.length === 0) return () => {};
  let cancelled = false;
  const timers = new Set<number>();
  const deadline = Date.now() + 8000;

  const later = (fn: () => void, delay: number) => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (!cancelled) fn();
    }, delay);
    timers.add(id);
  };

  const attempt = () => {
    const target = anchorIds
      .map((id) => document.getElementById(`asset-anchor-${id}`))
      .find((el): el is HTMLElement => Boolean(el));
    if (!target) {
      if (Date.now() < deadline) later(attempt, 200);
      return;
    }
    // The transcript auto-scrolls to the bottom as messages settle, so re-assert
    // the position a few times before it stops fighting us.
    for (const delay of [0, 300, 700, 1200]) {
      later(() => target.scrollIntoView({ behavior: "smooth", block: "center" }), delay);
    }
    target.classList.add(...ANCHOR_HIGHLIGHT);
    later(() => target.classList.remove(...ANCHOR_HIGHLIGHT), 3000);
  };

  later(attempt, 200);
  return () => {
    cancelled = true;
    for (const id of timers) window.clearTimeout(id);
    timers.clear();
  };
}

/* ----------------------------- No Agent Empty State ----------------------------- */
function NoAgentSelectedState({ 
  onExplore, 
  onLearnMore 
}: { 
  onExplore?: () => void;
  onLearnMore?: () => void;
}) {
  const { isTeacher, isAdmin } = useUserRole();
  return (
    <div className="flex flex-col items-center justify-center h-full bg-neutral-900 animate-in fade-in duration-500">

      <div className="relative text-center max-w-lg px-6">
        {/* Title */}
        <h1 className="text-4xl font-semibold tracking-tight text-white">
          Welcome to Shiksha
        </h1>

        {/* Description */}
        <p className="mt-4 text-[15px] text-neutral-400 leading-relaxed">
          {isTeacher || isAdmin
            ? "A playful assistant that uses personalized challenges to help your students with threshold concepts in the subject."
            : "A playful assistant that uses personalized challenges to help you cross threshold concepts."}
        </p>

        {/* Action Buttons */}
        <div className="flex items-center justify-center gap-3 mt-8">
          <Button
            onClick={onExplore}
            className="px-5 h-10 bg-white hover:bg-neutral-200 text-neutral-900 font-medium text-sm rounded-lg transition-colors duration-200"
          >
            <Library className="h-4 w-4 mr-2" />
            Explore Agents
          </Button>
          <Button
            onClick={onLearnMore}
            variant="outline"
            className="px-5 h-10 border-neutral-700 hover:border-neutral-600 bg-transparent hover:bg-neutral-800 text-neutral-300 hover:text-white font-medium text-sm rounded-lg transition-colors duration-200"
          >
            <ArrowRight className="h-4 w-4 mr-2" />
            Learn More
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- Chat Header Component ----------------------------- */
function ChatHeader({ 
  agentName, 
  threadTitle,
  onNewChat,
  onShare,
  onInfo,
  onCourseCurriculum,
  onAgentCode,
  onEditAgent,
  onDeleteAgent,
  onMenuOpen,
  onHistoryToggle,
  isScrolled = false,
  hasMessages = false,
  curriculumAvailable = false,
  curriculumStatus = "not_available",
  isHistoryOpen = false,
  isPanelOpen = false,
  isTeacherOrAdmin = false,
}: { 
  agentName: string;
  threadTitle?: string;
  onNewChat?: () => void;
  onShare?: () => void;
  onInfo?: () => void;
  onCourseCurriculum?: () => void;
  onAgentCode?: () => void;
  onEditAgent?: () => void;
  onDeleteAgent?: () => void;
  onMenuOpen?: () => void;
  onHistoryToggle?: () => void;
  isScrolled?: boolean;
  hasMessages?: boolean;
  curriculumAvailable?: boolean;
  curriculumStatus?: "not_available" | "processing" | "ready";
  isHistoryOpen?: boolean;
  isPanelOpen?: boolean;
  isTeacherOrAdmin?: boolean;
}) {
  const courseName = getCourseName(agentName);
  
  return (
    <div className={`relative flex items-center px-5 py-3 bg-neutral-900 transition-all duration-300 ${isScrolled ? 'border-b border-neutral-700/60' : 'border-b border-transparent'}`}>
      {/* Left: Course name */}
      <span className="text-sm font-medium text-neutral-200 truncate max-w-[25%] flex-shrink-0" title={courseName}>
        {courseName}
      </span>
      
      {/* Center: Thread/chat title (absolute so it's always centered) */}
      {threadTitle && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-sm font-medium text-neutral-300 truncate max-w-[40%] pointer-events-auto">
            {threadTitle}
          </span>
        </div>
      )}
      
      {/* Right: Action buttons + Three dot menu (push to end) */}
      <div className="flex items-center gap-1.5 ml-auto">
        {/* Info button - visible only when panel is closed */}
        {!isPanelOpen && (
          <button
            onClick={onInfo}
            className="p-1.5 rounded-md border border-neutral-700 hover:border-neutral-500 hover:bg-neutral-800 text-neutral-400 hover:text-white transition-all"
            title="Course Info"
          >
            <Info className="w-4 h-4" />
          </button>
        )}
        {/* Chat History toggle - visible only when panel is closed */}
        {!isPanelOpen && (
          <button
            onClick={onHistoryToggle}
            className={`p-1.5 rounded-md border transition-all ${
              isHistoryOpen
                ? "bg-neutral-700/60 border-neutral-600 text-white"
                : "border-neutral-700 hover:border-neutral-500 hover:bg-neutral-800 text-neutral-400 hover:text-white"
            }`}
            title="Chat History"
          >
            <FaComments className="w-4 h-4" />
          </button>
        )}
        {/* Share button - visible only when panel is closed */}
        {hasMessages && !isPanelOpen && (
          <button
            onClick={onShare}
            className="p-1.5 rounded-md border border-neutral-700 hover:border-neutral-500 hover:bg-neutral-800 text-neutral-400 hover:text-white transition-all"
            title="Share Chat"
          >
            <Share2 className="w-4 h-4" />
          </button>
        )}
        {/* New Chat button - visible only when panel is closed */}
        {hasMessages && !isPanelOpen && (
          <button
            onClick={onNewChat}
            className="p-1.5 rounded-md border border-neutral-700 hover:border-neutral-500 hover:bg-neutral-800 text-neutral-400 hover:text-white transition-all"
            title="New Chat"
          >
            <SquarePen className="w-4 h-4" />
          </button>
        )}
        {/* Three dot menu */}
        <DropdownMenu onOpenChange={(open) => { if (open) onMenuOpen?.(); }}>
          <DropdownMenuTrigger asChild>
            <button className="p-1.5 rounded-md border border-neutral-700 hover:border-neutral-500 hover:bg-neutral-800 text-neutral-400 hover:text-white transition-all">
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6} className="bg-neutral-900/95 backdrop-blur-xl border border-neutral-700/50 rounded-xl min-w-[190px] p-1">
            {/* Collapsed header actions when panel is open */}
            {isPanelOpen && (
              <>
                <DropdownMenuItem
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-neutral-300 hover:text-white hover:bg-neutral-800/80 cursor-pointer transition-colors"
                  onClick={onInfo}
                >
                  <div className="w-7 h-7 rounded-md bg-neutral-800 flex items-center justify-center flex-shrink-0">
                    <Info className="h-3.5 w-3.5 text-neutral-400" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[13px] font-medium leading-tight">Course Info</span>
                    <span className="text-[10px] text-neutral-500 leading-tight">About this teaching assistant</span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-neutral-300 hover:text-white hover:bg-neutral-800/80 cursor-pointer transition-colors"
                  onClick={onHistoryToggle}
                >
                  <div className="w-7 h-7 rounded-md bg-neutral-800 flex items-center justify-center flex-shrink-0">
                    <FaComments className="h-3.5 w-3.5 text-neutral-400" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[13px] font-medium leading-tight">Chat History</span>
                    <span className="text-[10px] text-neutral-500 leading-tight">View previous conversations</span>
                  </div>
                </DropdownMenuItem>
                {hasMessages && (
                  <DropdownMenuItem
                    className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-neutral-300 hover:text-white hover:bg-neutral-800/80 cursor-pointer transition-colors"
                    onClick={onShare}
                  >
                    <div className="w-7 h-7 rounded-md bg-neutral-800 flex items-center justify-center flex-shrink-0">
                      <Share2 className="h-3.5 w-3.5 text-neutral-400" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[13px] font-medium leading-tight">Share Chat</span>
                      <span className="text-[10px] text-neutral-500 leading-tight">Send this conversation</span>
                    </div>
                  </DropdownMenuItem>
                )}
                {hasMessages && (
                  <DropdownMenuItem
                    className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-neutral-300 hover:text-white hover:bg-neutral-800/80 cursor-pointer transition-colors"
                    onClick={onNewChat}
                  >
                    <div className="w-7 h-7 rounded-md bg-neutral-800 flex items-center justify-center flex-shrink-0">
                      <SquarePen className="h-3.5 w-3.5 text-neutral-400" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[13px] font-medium leading-tight">New Chat</span>
                      <span className="text-[10px] text-neutral-500 leading-tight">Start a fresh conversation</span>
                    </div>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator className="bg-neutral-700/50 my-1" />
              </>
            )}
            <DropdownMenuItem
              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-colors ${
                curriculumAvailable || curriculumStatus === "processing"
                  ? "text-neutral-300 hover:text-white hover:bg-neutral-800/80 cursor-pointer"
                  : "text-neutral-600 cursor-not-allowed opacity-50"
              }`}
              onClick={(curriculumAvailable || curriculumStatus === "processing") ? onCourseCurriculum : undefined}
              onSelect={(curriculumAvailable || curriculumStatus === "processing") ? undefined : (e) => e.preventDefault()}
              title={curriculumStatus === "not_available" ? "No curriculum available — create agent with textbooks to generate" : undefined}
            >
              <div className="w-7 h-7 rounded-md bg-neutral-800 flex items-center justify-center flex-shrink-0 relative">
                {curriculumStatus === "processing" ? (
                  <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin" />
                ) : (
                  <GraduationCap className={`h-3.5 w-3.5 ${curriculumAvailable ? "text-neutral-400" : "text-neutral-600"}`} />
                )}
              </div>
              <div className="flex flex-col">
                <span className="text-[13px] font-medium leading-tight">Course Curriculum</span>
                <span className="text-[10px] text-neutral-500 leading-tight">
                  {curriculumStatus === "processing" ? "Generating…" : curriculumAvailable ? "Syllabus & threshold concepts" : "Not generated yet"}
                </span>
                {curriculumStatus === "processing" && (
                  <div className="mt-1 w-full h-1 rounded-full bg-neutral-700 overflow-hidden">
                    <div className="h-full bg-blue-500/70 rounded-full animate-pulse" style={{ width: "60%" }} />
                  </div>
                )}
              </div>
            </DropdownMenuItem>
            {isTeacherOrAdmin && (
              <>
                <DropdownMenuItem
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-neutral-300 hover:text-white hover:bg-neutral-800/80 cursor-pointer transition-colors"
                  onClick={onAgentCode}
                >
                  <div className="w-7 h-7 rounded-md bg-neutral-800 flex items-center justify-center flex-shrink-0">
                    <KeyRound className="h-3.5 w-3.5 text-neutral-400" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[13px] font-medium leading-tight">TA Code</span>
                    <span className="text-[10px] text-neutral-500 leading-tight">View & share access code</span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-neutral-300 hover:text-white hover:bg-neutral-800/80 cursor-pointer transition-colors"
                  onClick={onEditAgent}
                >
                  <div className="w-7 h-7 rounded-md bg-neutral-800 flex items-center justify-center flex-shrink-0">
                    <Pencil className="h-3.5 w-3.5 text-neutral-400" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[13px] font-medium leading-tight">Edit TA</span>
                    <span className="text-[10px] text-neutral-500 leading-tight">Modify course settings</span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 cursor-pointer transition-colors"
                  onClick={onDeleteAgent}
                >
                  <div className="w-7 h-7 rounded-md bg-red-500/10 flex items-center justify-center flex-shrink-0">
                    <Trash2 className="h-3.5 w-3.5 text-red-400/80" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[13px] font-medium leading-tight">Delete TA</span>
                    <span className="text-[10px] text-red-400/50 leading-tight">Remove this teaching assistant</span>
                  </div>
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/* ----------------------------- Copy Button Component ----------------------------- */
function CopyDropdown({ content }: { content: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const _preferredName = useChatStore((s) => s.userNickname || s.userName);
  const _userFullName = useChatStore((s) => s.userFullName);

  const resolveNames = (text: string) =>
    text
      .replaceAll("`{{preferred_name}}`", _preferredName)
      .replaceAll("{{preferred_name}}", _preferredName)
      .replaceAll("`{{user_name}}`", _userFullName)
      .replaceAll("{{user_name}}", _userFullName);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(resolveNames(content));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex items-center px-3.5 py-1.5 rounded-lg text-xs font-semibold text-neutral-800 bg-white border border-neutral-300 hover:bg-neutral-100 transition-colors"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/* ----------------------------- PDF export ----------------------------- */
// Print styling lives here rather than in the app theme: the chat UI is dark and
// the exported page is white.
const PDF_EXPORT_CSS = `
.pdf-export { font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; line-height: 1.65; font-size: 11pt; }
.pdf-export h1, .pdf-export h2, .pdf-export h3, .pdf-export h4 { font-family: Helvetica, Arial, sans-serif; color: #111; line-height: 1.25; margin: 1.4em 0 0.5em; page-break-after: avoid; }
.pdf-export h1 { font-size: 1.9em; }
.pdf-export h2 { font-size: 1.4em; border-bottom: 1px solid #ddd; padding-bottom: 0.25em; }
.pdf-export h3 { font-size: 1.15em; }
.pdf-export h4 { font-size: 1em; }
.pdf-export p { margin: 0.7em 0; }
.pdf-export ul, .pdf-export ol { margin: 0.7em 0; padding-left: 1.6em; }
.pdf-export li { margin: 0.3em 0; }
.pdf-export li > p { margin: 0.2em 0; }
.pdf-export a { color: #1a4f8a; text-decoration: none; }
.pdf-export blockquote { margin: 0.9em 0; padding: 0.1em 1em; border-left: 3px solid #ccc; color: #444; }
/* !important on code blocks: index.css forces a dark chat theme onto every
   pre/code with !important, which would print as black-on-black. */
.pdf-export code { font-family: 'Courier New', monospace; font-size: 0.88em; background: #f2f2f2 !important; color: #1a1a1a !important; padding: 0.12em 0.35em; border-radius: 3px; }
.pdf-export pre { background: #f6f6f6 !important; color: #1a1a1a !important; border: 1px solid #e2e2e2 !important; border-radius: 4px; padding: 0.9em; overflow: hidden; white-space: pre-wrap; word-wrap: break-word; page-break-inside: avoid; }
.pdf-export pre code, .pdf-export pre code * { background: none !important; color: #1a1a1a !important; }
.pdf-export pre code { padding: 0; font-size: 0.82em; }
.pdf-export table { border-collapse: collapse; width: 100%; margin: 0.9em 0; font-size: 0.9em; page-break-inside: avoid; }
.pdf-export th, .pdf-export td { border: 1px solid #ccc; padding: 0.45em 0.6em; text-align: left; vertical-align: top; }
.pdf-export th { background: #f2f2f2; font-weight: 600; }
.pdf-export hr { border: none; border-top: 1px solid #ccc; margin: 1.5em 0; }
.pdf-export img { max-width: 100%; }
.pdf-export .pdf-title { border-bottom: 2px solid #333; padding-bottom: 0.3em; margin-top: 0; }
`;

function PdfDocument({ title, content }: { title: string; content: string }) {
  return (
    <div className="pdf-export">
      <style>{PDF_EXPORT_CSS}</style>
      <h1 className="pdf-title">{title || "Document"}</h1>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          // In-page anchors are meaningless once exported, so keep the label only.
          a: ({ href, children }) =>
            href?.startsWith("#") ? <>{children}</> : <a href={href}>{children}</a>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/* ----------------------------- Download Button Component ----------------------------- */
function DownloadButton({ content, title }: { content: string; title: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const _preferredName = useChatStore((s) => s.userNickname || s.userName);
  const _userFullName = useChatStore((s) => s.userFullName);

  const resolveNames = (text: string) =>
    text
      .replaceAll("`{{preferred_name}}`", _preferredName)
      .replaceAll("{{preferred_name}}", _preferredName)
      .replaceAll("`{{user_name}}`", _userFullName)
      .replaceAll("{{user_name}}", _userFullName);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleDownloadMd = () => {
    const blob = new Blob([resolveNames(content)], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'document'}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setIsOpen(false);
  };

  const handleDownloadPdf = async () => {
    if (isDownloading) return;
    setIsOpen(false);
    setIsDownloading(true);
    // html2canvas captures a zero-height canvas for anything taken out of normal
    // flow, so keep the page in flow and hide it with a clipping host instead.
    const host = document.createElement('div');
    host.style.cssText = 'height:0;overflow:hidden;';
    const page = document.createElement('div');
    page.style.cssText = 'width:720px;background:#fff;';
    host.appendChild(page);
    let root: ReturnType<typeof import('react-dom/client').createRoot> | null = null;
    try {
      const [{ default: html2pdf }, { createRoot }, { flushSync }] = await Promise.all([
        import('html2pdf.js'),
        import('react-dom/client'),
        import('react-dom'),
      ]);
      document.body.appendChild(host);
      root = createRoot(page);
      flushSync(() => {
        root!.render(<PdfDocument title={title} content={resolveNames(content)} />);
      });
      // An image that fails to load taints the canvas and aborts the whole export,
      // so settle every one first and drop the ones that never arrive.
      await Promise.all(
        Array.from(page.querySelectorAll('img')).map((img) =>
          img.complete && img.naturalWidth > 0
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
                const done = () => resolve();
                img.addEventListener('load', done, { once: true });
                img.addEventListener('error', () => { img.remove(); resolve(); }, { once: true });
                window.setTimeout(() => { img.remove(); resolve(); }, 8000);
              })
        )
      );
      // Assigned first so the runtime-only `pagebreak` option survives the
      // bundled types, which predate it.
      const pdfOptions = {
        margin: [15, 15, 15, 15] as [number, number, number, number],
        filename: `${title || 'document'}.pdf`,
        image: { type: 'jpeg' as const, quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', imageTimeout: 15000 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' as const },
        pagebreak: { mode: ['css', 'avoid-all'] },
      };
      await html2pdf().set(pdfOptions).from(page).save();
    } catch (err) {
      console.error('PDF download failed:', err);
      // Silently swapping formats is why users thought the PDF button was broken.
      toast.error('Could not generate the PDF — downloaded Markdown (.md) instead.');
      handleDownloadMd();
    } finally {
      root?.unmount();
      host.remove();
      setIsDownloading(false);
    }
  };

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={isDownloading}
        aria-busy={isDownloading}
        className="flex items-center rounded-lg bg-neutral-800 border border-neutral-600 transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-neutral-800"
      >
        {isDownloading ? (
          <span className="pl-3 pr-3 py-1.5 flex items-center gap-1.5 text-xs font-medium text-neutral-100">
            <Loader2 className="h-3 w-3 animate-spin text-neutral-400" />
            Preparing…
          </span>
        ) : (
          <>
            <span className="pl-3 pr-2 py-1.5 text-xs font-medium text-neutral-100">Download</span>
            <span className="w-px h-4 bg-neutral-500/60" />
            <span className="pl-1.5 pr-2 py-1.5 flex items-center">
              <ChevronDown className="h-3 w-3 text-neutral-400" />
            </span>
          </>
        )}
      </button>

      {isOpen && !isDownloading && (
        <div className="absolute right-0 top-full mt-1 w-[220px] rounded-lg bg-neutral-800 border border-neutral-700 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-150">
          <button
            onClick={handleDownloadPdf}
            className="w-full px-3 py-2 text-left text-xs text-neutral-200 hover:bg-neutral-700 transition-colors flex items-center gap-2"
          >
            <Download className="h-3.5 w-3.5 text-neutral-400" />
            PDF Document (.pdf)
          </button>
          <button
            onClick={handleDownloadMd}
            className="w-full px-3 py-2 text-left text-xs text-neutral-200 hover:bg-neutral-700 transition-colors flex items-center gap-2"
          >
            <Download className="h-3.5 w-3.5 text-neutral-400" />
            Markdown Document (.md)
          </button>
        </div>
      )}
    </div>
  );
}

/* ----------------------------- Main Chat View ----------------------------- */
export function ChatView() {
  const navigate = useNavigate();
  const params = useParams<{ courseName?: string; threadId?: string }>();
  const appContext = useAppContext();
  
  const {
    courseAgentId,
    courseAgentName,
    pendingMessage,
    setPendingMessage,
    pendingInputText,
    setPendingInputText,
    pendingDeepResearchEnabled,
    setPendingDeepResearchEnabled,
    handleNewChat,
    handleSelectThread,
    setEditingAgentId,
    setEditMode,
    setCourseAgentId,
    setCourseAgentName,
  } = appContext;
  
  // Agent ID comes from context (set when navigating)
  const effectiveAgentId = courseAgentId;
  
  const userId = useUserStore((s) => s.userId);

  // Name token resolver for document panel content
  const _docPreferredName = useChatStore((s) => s.userNickname || s.userName);
  const _docUserFullName = useChatStore((s) => s.userFullName);
  const resolveDocNames = (text: string) =>
    text
      .replaceAll("`{{preferred_name}}`", _docPreferredName)
      .replaceAll("{{preferred_name}}", _docPreferredName)
      .replaceAll("`{{user_name}}`", _docUserFullName)
      .replaceAll("{{user_name}}", _docUserFullName);

  const createThreadForAgent = useChatStore((s) => s.createThreadForAgent);
  const setActiveThread = useChatStore((s) => s.setActiveThread);
  const getOrCreateAgentProject = useChatStore((s) => s.getOrCreateAgentProject);

  // If mounted via /course/:courseName (no threadId), create a thread and redirect
  useEffect(() => {
    if (
      window.location.pathname.startsWith("/course/") &&
      effectiveAgentId &&
      courseAgentName
    ) {
      getOrCreateAgentProject(effectiveAgentId, courseAgentName);
      const newThreadId = createThreadForAgent(effectiveAgentId);
      setActiveThread(newThreadId);
      const courseName = getCourseName(courseAgentName);
      navigate(`/chat/${encodeURIComponent(courseName)}/${newThreadId}`, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveAgentId, courseAgentName]);

  const onExplore = () => navigate("/library");
  const onCreateAgent = () => navigate("/create");
  const onPendingMessageConsumed = () => setPendingMessage(null);

  const { threadId, messages: localMessages, send, stop, editMessage, retry, isStreaming, isWaitingForResponse, activeToolLabel, generatedDocs, refreshDoc, streamingDocContent, continueDeepResearch } = useAgentChat(effectiveAgentId, courseAgentName);
  const activeThreadId = useChatStore((s) => s.activeThreadId);

  // The URL owns which thread is shown. Without this, opening an asset (or any
  // deep link) keeps whatever thread was last active, so the transcript on the
  // left has nothing to do with the asset opened on the right.
  useEffect(() => {
    if (params.threadId && params.threadId !== activeThreadId) {
      setActiveThread(params.threadId);
    }
  }, [params.threadId, activeThreadId, setActiveThread]);

  const activeThread = useChatStore((s) => activeThreadId ? s.threads[activeThreadId] : undefined);
  const routeThreadId = params.threadId ?? null;
  const isRouteConversationReady = !routeThreadId || (
    activeThreadId === routeThreadId
      && (!activeThread?.agentId || activeThread.agentId === effectiveAgentId)
  );
  const shareThread = useChatStore((s) => s.shareThread);

  // Chat history drawer state
  const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState(false);
  const handleDrawerSelectThread = useCallback(
    (threadId: string) => {
      if (effectiveAgentId && courseAgentName) {
        handleSelectThread(threadId, effectiveAgentId, courseAgentName);
      }
    },
    [effectiveAgentId, courseAgentName, handleSelectThread]
  );

  // Share state
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareTokenValue, setShareTokenValue] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  // Delete agent state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Manage agent dialog state
  const [showManageAgent, setShowManageAgent] = useState(false);
  const [manageCodeLoading, setManageCodeLoading] = useState(false);

  // Fetch manage code when dialog opens
  const isAdmin = useUserStore.getState().role === "admin";
  useEffect(() => {
    if (!showManageAgent || !(isMyAgent || isAdmin) || !effectiveAgentId) return;
    setManageCodeLoading(true);
    import("@/lib/api").then(({ getManageCode }) =>
      getManageCode(effectiveAgentId, currentUserId ?? "")
    ).then((data) => {
      setRevealedManageCode(data.manage_code);
    }).catch(() => {
      toast.error("Could not retrieve manage code");
    }).finally(() => setManageCodeLoading(false));
  }, [showManageAgent]);

  // Manage code verification state
  const [showManageCodeVerify, setShowManageCodeVerify] = useState(false);
  const [showManageCodeReveal, setShowManageCodeReveal] = useState(false);
  const [revealedManageCode, setRevealedManageCode] = useState("");

  // Creator check for Edit/Delete permissions — deferred until info panel opens
  const currentUserId = useCurrentUserId();
  const [agentCreatorId, setAgentCreatorId] = useState<string | undefined>(undefined);
  const projects = useChatStore((s) => s.projects);
  const deleteProject = useChatStore((s) => s.deleteProject);
  const agentCreatorFetched = useRef(false);

  const isMyAgent = !agentCreatorId || agentCreatorId === currentUserId;

  // Syllabus state
  const [syllabusOpen, setSyllabusOpen] = useState(false);
  const [askTopic, setAskTopic] = useState<string | null>(null);
  const [syllabusLoading, setSyllabusLoading] = useState(false);
  const [syllabusData, setSyllabusData] = useState<any>(null);
  const [syllabusStatus, setSyllabusStatus] = useState<string>("");
  const [isEditingCurriculum, setIsEditingCurriculum] = useState(false);
  const [editedSyllabusData, setEditedSyllabusData] = useState<any>(null);
  const [isSavingCurriculum, setIsSavingCurriculum] = useState(false);
  const [showCommitDialog, setShowCommitDialog] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [learningProgress, setLearningProgress] = useState<LearningProgress | null>(null);

  // Load conversation starters from setup.json
  const [savedStarters, setSavedStarters] = useState<Array<{ title: string; prompt: string }>>([]);
  // Distinguishes "still fetching" from "fetched, none saved"; without it the generic
  // fallbacks flash on every load and stick permanently when the fetch fails offline.
  const [startersLoaded, setStartersLoaded] = useState(false);
  const [agentSetupInfo, setAgentSetupInfo] = useState<any>(null);
  const [agentRow, setAgentRow] = useState<any>(null);
  const [showInfoDialog, setShowInfoDialog] = useState(false);

  // Deferred creator ID fetch — only when info dialog opens
  useEffect(() => {
    if (!effectiveAgentId || agentCreatorFetched.current) return;
    if (!showInfoDialog) return;
    agentCreatorFetched.current = true;
    listAzureAgents().then((agents) => {
      const match = agents.find((a: any) => a.id === effectiveAgentId);
      if (match) {
        setAgentCreatorId(match.created_by_id);
        setAgentRow(match);
      }
    });
  }, [effectiveAgentId, showInfoDialog]);

  useEffect(() => {
    if (!effectiveAgentId) return;
    let cancelled = false;
    setStartersLoaded(false);
    fetchAgentSetupDetails(effectiveAgentId).then((details) => {
      if (cancelled) return;
      setAgentSetupInfo(details);
      console.log("[ChatView] Setup details conversationStarters:", details?.conversationStarters);
      if (!details?.conversationStarters?.length) return;
      const normalized = details.conversationStarters.map((s: string | { title: string; prompt: string }) => {
        if (typeof s === "string") return { title: s.slice(0, 40), prompt: s };
        return { title: s.title, prompt: s.prompt };
      });
      console.log("[ChatView] Normalized starters:", normalized);
      setSavedStarters(applyFixedFirstStarter(normalized));
    }).catch((err) => {
      console.error("[ChatView] Failed to load setup details:", err);
    }).finally(() => {
      if (!cancelled) setStartersLoaded(true);
    });
    return () => { cancelled = true; };
  }, [effectiveAgentId]);

  // Conversation starters — use saved starters from setup.json, fall back to defaults
  const emptyStateSuggestions = useMemo(() => {
    if (savedStarters.length > 0) {
      return savedStarters
        .filter((s) => s.prompt.trim())
        .map((s) => ({ title: s.prompt.slice(0, 40), description: s.prompt }));
    }
    // Show nothing rather than guessing while the course's own starters are in flight.
    if (!startersLoaded) return [];
    const concepts = syllabusData?.all_threshold_concepts as string[] | undefined;
    const pickedConcept = concepts?.length
      ? concepts[Math.floor(Math.random() * concepts.length)]
      : null;
    const explainDesc = pickedConcept
      ? `Can you explain "${pickedConcept}" in my preferred language?`
      : "Can you explain a threshold concept from this course in my preferred language?";
    return [
      { title: "Why Learn This Course", description: "Why should I learn this course?" },
      { title: "Check my Knowledge", description: "How do I know how much I know about this subject?" },
      { title: "Try a Challenge", description: "Give me an example of a simple challenge, and tell me what topics it covers." },
      { title: "Explain in My Language", description: explainDesc },
    ];
  }, [savedStarters, syllabusData, startersLoaded]);

  // Track backend curriculum status for polling & browser notification
  const [curriculumStatus, setCurriculumStatus] = useState<"not_available" | "processing" | "ready">("not_available");
  // Ref to track previous status for notification logic (avoids stale closure)
  const curriculumStatusRef = useRef<string | null>(null);

  // Reset all course-specific state when switching agents (courses)
  const prevAgentIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (effectiveAgentId === prevAgentIdRef.current) return;
    prevAgentIdRef.current = effectiveAgentId;

    // Reset syllabus / curriculum panel state
    setSyllabusData(null);
    setSyllabusStatus("");
    setSyllabusOpen(false);
    setSyllabusLoading(false);
    setIsEditingCurriculum(false);
    setEditedSyllabusData(null);
    setIsSavingCurriculum(false);
    setShowCommitDialog(false);
    setCommitMessage("");
    setCurriculumStatus("not_available");
    curriculumStatusRef.current = null;
    setCurriculumVersions([]);
    setSelectedVersion(null);
    setPreviousVersionData(null);
    setSelectedVersionLoading(false);
    setExpandedModules(new Set());
    setExpandedConcepts(new Set());
    setSyllabusTab("modules");

    // Reset agent info state
    setAgentCreatorId(undefined);
    agentCreatorFetched.current = false;
    setAgentSetupInfo(null);
    setSavedStarters([]);
    setStartersLoaded(false);

    // Reset panels
    setOpenGeneratedDoc(null);
    setIsDocStreaming(false);
    setIsResearchPanelOpen(false);
    setIsHistoryDrawerOpen(false);
  }, [effectiveAgentId]);

  // Lightweight status check on mount — only polls status, doesn't load full curriculum
  useEffect(() => {
    if (!effectiveAgentId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const check = async () => {
      try {
        const result = await getAgentCurriculumStatus(effectiveAgentId);
        if (cancelled) return;

        const prevStatus = curriculumStatusRef.current;
        const newStatus = result.status as "not_available" | "processing" | "ready";
        curriculumStatusRef.current = newStatus;
        setCurriculumStatus(newStatus);

        if (newStatus === "ready") {
          // Fire browser notification when transitioning to ready
          if (prevStatus && prevStatus !== "ready") {
            if ("Notification" in window && Notification.permission === "granted") {
              new Notification("Course Curriculum Ready", {
                body: `The curriculum for ${getCourseName(courseAgentName)} is now available.`,
                icon: "/logo192.png",
              });
            }
            toast.success("Course curriculum is now available!");
          }
        }

        // Continue polling if not ready yet (every 30s)
        if (newStatus !== "ready" && !cancelled) {
          timer = setTimeout(check, 30_000);
        }
      } catch {
        // Retry on error after delay
        if (!cancelled) timer = setTimeout(check, 30_000);
      }
    };

    // Request notification permission proactively (no-op if already granted/denied)
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    check();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveAgentId]);

  const hasSyllabus = (syllabusData?.syllabus?.length ?? 0) > 0;
  const hasThresholdConcepts = (syllabusData?.all_threshold_concepts?.length ?? 0) > 0;

  const refreshCurriculumAvailability = useCallback(async () => {
    if (!effectiveAgentId) return;
    if (hasSyllabus && hasThresholdConcepts) return; // fully loaded, no need to re-check
    try {
      const result = await getAgentCourseCurriculum(effectiveAgentId);
      if (result.status === "ready" && result.course_curriculum) {
        setSyllabusData(result.course_curriculum);
        setCurriculumStatus("ready");
      } else {
        setCurriculumStatus(result.status as "not_available" | "processing" | "ready");
      }
    } catch {}
  }, [effectiveAgentId, hasSyllabus, hasThresholdConcepts]);

  const [expandedModules, setExpandedModules] = useState<Set<number>>(new Set());
  const [expandedConcepts, setExpandedConcepts] = useState<Set<number>>(new Set());
  const [syllabusTab, setSyllabusTab] = useState<"modules" | "concepts" | "history">("modules");
  const [curriculumVersions, setCurriculumVersions] = useState<Array<{ version_id: string; commit_message: string; saved_by: string; saved_at: string }>>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<any>(null);
  const [previousVersionData, setPreviousVersionData] = useState<any>(null);
  const [selectedVersionLoading, setSelectedVersionLoading] = useState(false);
  const [versionModalTab, setVersionModalTab] = useState<"modules" | "concepts">("modules");
  const [versionExpandedMods, setVersionExpandedMods] = useState<Set<number>>(new Set());
  const [tcPickerModuleIdx, setTcPickerModuleIdx] = useState<number | null>(null);
  const [tcPickerExpanded, setTcPickerExpanded] = useState<Set<number>>(new Set());

  /** Strip markdown links, raw URLs, and leftover parentheses from display text */
  const stripLinks = (text: string): string =>
    text
      .replace(/\[([^\]]*?)\]\([^)]*\)/g, '$1')   // [label](url) → label
      .replace(/\(https?:\/\/[^)]*\)/g, '')           // (https://...) → ""
      .replace(/https?:\/\/\S+/g, '')                  // bare https://... → ""
      .replace(/\s{2,}/g, ' ')                         // collapse whitespace
      .trim();

  /** Strip "Module N:" prefix from titles (the UI already shows a number) */
  const stripModulePrefix = (text: string) => text.replace(/^Module\s+\d+\s*:\s*/i, "");

  const toggleModule = (idx: number) => {
    setExpandedModules(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const handlePrereqClick = (prereq: string) => {
    if (!syllabusData?.syllabus) return;
    const cleaned = stripLinks(prereq).toLowerCase();
    const matchIdx = syllabusData.syllabus.findIndex((mod: any) => {
      const title = stripLinks(mod.title || mod.module || mod.name || "").toLowerCase();
      return title === cleaned || title.includes(cleaned) || cleaned.includes(title);
    });
    if (matchIdx >= 0) {
      setExpandedModules(prev => new Set(prev).add(matchIdx));
      setTimeout(() => {
        const el = document.getElementById(`syllabus-module-${matchIdx}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          // Flash highlight
          el.style.outline = "2px solid rgba(96, 165, 250, 0.7)";
          el.style.outlineOffset = "-2px";
          setTimeout(() => { el.style.outline = ""; el.style.outlineOffset = ""; }, 1500);
        }
      }, 150);
    }
  };

  const toggleConcept = (idx: number) => {
    setExpandedConcepts(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const handleOpenSyllabus = async () => {
    setSyllabusOpen(true);
    setIsHistoryDrawerOpen(false);
    setIsResearchPanelOpen(false);
    setOpenGeneratedDoc(null);
    setIsDocStreaming(false);
    window.dispatchEvent(new Event("sidebar-collapse"));
    if (syllabusData) return;
    if (!effectiveAgentId) return;
    setSyllabusLoading(true);
    try {
      const result = await getAgentCourseCurriculum(effectiveAgentId);
      if (result.course_curriculum) {
        setSyllabusData(result.course_curriculum);
        setCurriculumStatus(result.status as "not_available" | "processing" | "ready");
      } else {
        setSyllabusStatus(result.message || "Course curriculum not available yet.");
      }
    } catch (e: any) {
      setSyllabusStatus(`Failed to load: ${e.message}`);
    } finally {
      setSyllabusLoading(false);
    }
  };

  const handleOpenThresholdConcepts = async () => {
    setSyllabusTab("concepts");
    setSyllabusOpen(true);
    if (syllabusData) return;
    if (!effectiveAgentId) return;
    setSyllabusLoading(true);
    try {
      const result = await getAgentCourseCurriculum(effectiveAgentId);
      if (result.course_curriculum) {
        setSyllabusData(result.course_curriculum);
        setCurriculumStatus(result.status as "not_available" | "processing" | "ready");
      } else {
        setSyllabusStatus(result.message || "Course curriculum not available yet.");
      }
    } catch (e: any) {
      setSyllabusStatus(`Failed to load: ${e.message}`);
    } finally {
      setSyllabusLoading(false);
    }
  };

  // Progress is per student, so refetch whenever the panel opens rather than caching it.
  useEffect(() => {
    if (!syllabusOpen || !effectiveAgentId || !currentUserId) return;
    let cancelled = false;
    getAgentLearningProgress(effectiveAgentId, currentUserId)
      .then((result) => {
        if (!cancelled) setLearningProgress(result.progress ?? null);
      })
      .catch(() => {
        if (!cancelled) setLearningProgress(null);
      });
    return () => {
      cancelled = true;
    };
  }, [syllabusOpen, effectiveAgentId, currentUserId]);

  const progressLookup = useMemo(() => {
    const normalise = (value: string) => value.trim().toLowerCase();
    const index = (entries?: Record<string, LearningProgressEntry>) => {
      const map = new Map<string, LearningProgressEntry & { name: string }>();
      for (const [name, entry] of Object.entries(entries || {})) {
        map.set(normalise(name), { ...entry, name });
      }
      return map;
    };
    const topics = index(learningProgress?.topics);
    const concepts = index(learningProgress?.threshold_concepts);
    // Curriculum labels and recorded names drift (prefixes, punctuation), so
    // fall back to containment before declaring a topic untouched.
    const loose = (map: typeof topics, name: string) => {
      const key = normalise(name);
      const exact = map.get(key);
      if (exact) return exact;
      if (key.length < 4) return undefined;
      for (const [candidate, entry] of map) {
        if (candidate.includes(key) || key.includes(candidate)) return entry;
      }
      return undefined;
    };
    return {
      topic: (name: string) => loose(topics, name),
      concept: (name: string) => loose(concepts, name),
      hasData: topics.size > 0 || concepts.size > 0,
    };
  }, [learningProgress]);

  /** Topics the learner has actually touched, crossed ones first. */
  const coveredTopics = useMemo(() => {
    const entries = Object.entries(learningProgress?.topics || {})
      .map(([name, entry]) => ({ name, status: normaliseStatus(entry?.status) }))
      .filter((t) => t.status !== "not_started");
    return entries.sort((a, b) => {
      if (a.status !== b.status) return a.status === "learned" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [learningProgress]);

  useEffect(() => {
    if (!askTopic) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setAskTopic(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [askTopic]);

  const handleSaveCurriculum = async () => {
    if (!effectiveAgentId || !editedSyllabusData) return;
    const hasEmptyModule = editedSyllabusData.syllabus?.some((mod: any) => {
      const title = (mod.title || mod.module || mod.name || "").replace(/^Module\s+\d+:\s*/i, "").trim();
      return !title;
    });
    if (hasEmptyModule) {
      toast.error("Please fill in all module names before saving.");
      return;
    }
    const hasEmptyFields = editedSyllabusData.syllabus?.some((mod: any, mIdx: number) => {
      const topics = mod.topics || [];
      const los = mod.learning_objectives || [];
      if (topics.length === 0 || los.length === 0) return true;
      const emptyTopic = topics.some((t: string) => !t.trim());
      const emptyLO = los.some((o: string) => !o.trim());
      if (emptyTopic || emptyLO) return true;
      const modTitle = (mod.title || mod.module || mod.name || "").replace(/^Module\s+\d+:\s*/i, "").trim().toLowerCase();
      const modId = mod.module_id || `module-${mIdx}`;
      const hasMappedTC = (editedSyllabusData.all_threshold_concepts || []).some((tcName: string) => {
        const tc = editedSyllabusData[tcName] || {};
        return tc.related_modules?.includes(modId) || (modTitle.length > 3 && tc.related_chapters?.some((ch: string) => {
          const c = ch.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").toLowerCase();
          return c === modTitle || c.includes(modTitle) || modTitle.includes(c);
        }));
      });
      if (!hasMappedTC) return true;
      return false;
    });
    if (hasEmptyFields) {
      toast.error("Each module must have at least one topic, one learning objective, and one threshold concept.");
      return;
    }
    const hasEmptyTC = (editedSyllabusData.all_threshold_concepts || []).some((tcName: string) => !tcName.trim());
    if (hasEmptyTC) {
      toast.error("Please fill in all threshold concept names before saving.");
      return;
    }
    const hasIncompleteTc = (editedSyllabusData.all_threshold_concepts || []).some((tcName: string) => {
      const tc = editedSyllabusData[tcName] || {};
      const def = (tc.definition || tc.description || "").trim();
      const misconceptions = tc.misconceptions || [];
      if (!def) return true;
      if (misconceptions.length === 0) return true;
      if (misconceptions.some((m: any) => !(typeof m === "string" ? m : m.misconception || m.description || "").trim())) return true;
      return false;
    });
    if (hasIncompleteTc) {
      toast.error("Each threshold concept must have a definition and at least one misconception.");
      return;
    }
    // Show commit message dialog
    setCommitMessage("");
    setShowCommitDialog(true);
  };

  const handleConfirmSave = async () => {
    if (!effectiveAgentId || !editedSyllabusData) return;
    if (!commitMessage.trim()) {
      toast.error("Please enter a commit message.");
      return;
    }
    setShowCommitDialog(false);
    setIsSavingCurriculum(true);
    try {
      await updateAgentCourseCurriculum(effectiveAgentId, editedSyllabusData, commitMessage.trim(), userId || "unknown");
      setSyllabusData(editedSyllabusData);
      setIsEditingCurriculum(false);
      setEditedSyllabusData(null);
      setCommitMessage("");
      setCurriculumVersions([]); // invalidate so next History tab click refetches
      toast.success("Curriculum saved successfully");
    } catch (e: any) {
      toast.error(`Failed to save: ${e.message}`);
    } finally {
      setIsSavingCurriculum(false);
    }
  };

  const handleEditAgent = () => {
    if (!effectiveAgentId) return;
    setEditingAgentId(effectiveAgentId);
    setEditMode("simplistic");
    const cName = getCourseName(courseAgentName);
    navigate(`/edit/${encodeURIComponent(cName)}`);
  };

  const chatCourseName = getCourseName(courseAgentName);

  const handleShareChat = async () => {
    if (!activeThreadId) return;
    setIsSharing(true);
    setShareDialogOpen(true);
    try {
      const token = await shareThread(activeThreadId);
      if (token) {
        setShareTokenValue(token);
      } else {
        toast.error("Failed to create share link");
        setShareDialogOpen(false);
      }
    } catch (error) {
      console.error("Failed to share chat:", error);
      toast.error("Failed to create share link");
      setShareDialogOpen(false);
    } finally {
      setIsSharing(false);
    }
  };

  const handleCopyShareLink = async () => {
    if (!shareTokenValue) return;
    const shareUrl = `${window.location.origin}/shared/${shareTokenValue}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch (error) {
      toast.error("Failed to copy link");
    }
  };
  
  // Message pagination - loads all messages from DB
  const {
    messages: paginatedMessages,
    hasMore: hasMoreMessages,
    isLoading: isLoadingMore,
    loadOlderMessages,
    reloadMessages,
  } = useMessagePagination(activeThreadId);
  
  // Track previous streaming state to detect when streaming ends
  const wasStreamingRef = useRef(false);
  
  // When streaming ends, reload messages from backend to get properly filtered results
  // This ensures retry filtering is applied (backend filters out old retry responses)
  // SKIP reload if the last message has contentBlocks (to preserve locally-built blocks)
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming && !isWaitingForResponse) {
      // Check if last message has contentBlocks - if so, skip reload to preserve them
      const lastMsg = localMessages[localMessages.length - 1];
      if (lastMsg?.contentBlocks && lastMsg.contentBlocks.length > 0) {
        console.log("[ChatView] Skipping reload - message has contentBlocks");
        wasStreamingRef.current = false;
        return;
      }
      
      // Skip reload if last message is a research clarification (MCQ) — not persisted to DB
      if (lastMsg?.research && lastMsg.research.status === "clarification") {
        console.log("[ChatView] Skipping reload - research clarification in progress");
        wasStreamingRef.current = false;
        return;
      }
      
      // Streaming just ended - reload from backend after a short delay
      // The delay allows the sync to complete first
      const timer = setTimeout(() => {
        reloadMessages();
      }, 2500); // Slightly longer than SYNC_DEBOUNCE (2000ms)
      return () => clearTimeout(timer);
    }
    wasStreamingRef.current = isStreaming || isWaitingForResponse;
  }, [isStreaming, isWaitingForResponse, reloadMessages, localMessages]);
  
  // Use paginated messages from DB
  // During streaming or waiting for response, prefer local messages to keep UI responsive
  // When loading from DB (isLoadingMore && paginatedMessages empty), show nothing (loading state)
  
  // Helper function to filter messages - keep only the latest assistant response per messageGroupId
  // This prevents showing multiple retry responses
  const filterDuplicateAssistants = <T extends { role: string; messageGroupId?: string; retryNumber?: number; createdAt?: number }>(msgs: T[]): T[] => {
    if (!msgs || msgs.length === 0) return [];
    
    // Step 1: Find the highest retryNumber for each messageGroupId
    const bestRetryByGroup = new Map<string, number>();
    
    for (const msg of msgs) {
      if (msg.role === 'assistant' && msg.messageGroupId) {
        const currentBest = bestRetryByGroup.get(msg.messageGroupId) ?? -1;
        const thisRetry = msg.retryNumber ?? 0;
        if (thisRetry > currentBest) {
          bestRetryByGroup.set(msg.messageGroupId, thisRetry);
        }
      }
    }
    
    // Step 2: Filter messages - keep only the best assistant per group
    // Track which messageGroupIds we've already added an assistant for
    const addedGroupIds = new Set<string>();
    
    const result: T[] = [];
    
    for (const msg of msgs) {
      if (msg.role === 'user') {
        result.push(msg);
      } else if (msg.role === 'assistant') {
        if (msg.messageGroupId) {
          // Has messageGroupId - only keep the best retry for this group
          const bestRetry = bestRetryByGroup.get(msg.messageGroupId) ?? 0;
          const thisRetry = msg.retryNumber ?? 0;
          
          if (thisRetry === bestRetry && !addedGroupIds.has(msg.messageGroupId)) {
            result.push(msg);
            addedGroupIds.add(msg.messageGroupId);
          }
        } else {
          // No messageGroupId - this is a welcome/legacy message, always keep it
          result.push(msg);
        }
      } else {
        // Other message types pass through
        result.push(msg);
      }
    }
    
    return result;
  };

  // Filter local messages to show only the latest assistant response per user message
  const filteredLocalMessages = useMemo(() => {
    return filterDuplicateAssistants(localMessages);
  }, [localMessages]);
  
  // Filter paginated messages the same way (in case backend filtering fails)
  const filteredPaginatedMessages = useMemo(() => {
    return filterDuplicateAssistants(paginatedMessages);
  }, [paginatedMessages]);

  // Check if local messages have fresh content blocks (just finished streaming)
  const hasLocalContentBlocks = useMemo(() => {
    return filteredLocalMessages.some(m => m.contentBlocks && m.contentBlocks.length > 0);
  }, [filteredLocalMessages]);

  // Check if local messages have a research clarification (MCQ) in progress
  const hasResearchClarification = useMemo(() => {
    return filteredLocalMessages.some(m => m.research && m.research.status === "clarification");
  }, [filteredLocalMessages]);

  // Use local messages if streaming/waiting OR if they have content blocks OR research clarification
  // This prevents switching to paginated messages that don't have contentBlocks/research yet
  // For truly empty threads (new chat), skip the loading blank and show empty state immediately
  const localHasMessages = filteredLocalMessages.length > 0;
  const paginatedHasMessages = filteredPaginatedMessages.length > 0;
  const messages = useMemo(() => {
    if (!isRouteConversationReady) return [];
    if (isStreaming || isWaitingForResponse || hasResearchClarification) {
      return filteredLocalMessages;
    }
    // Local messages carry live block state, but localStorage keeps only the most
    // recent few — preferring them once the server has more truncated the history.
    if (hasLocalContentBlocks && filteredLocalMessages.length >= filteredPaginatedMessages.length) {
      return filteredLocalMessages;
    }
    if (isLoadingMore && !localHasMessages && paginatedHasMessages) return [];
    return paginatedHasMessages ? filteredPaginatedMessages : filteredLocalMessages;
  }, [
    filteredLocalMessages,
    filteredPaginatedMessages,
    hasLocalContentBlocks,
    hasResearchClarification,
    isLoadingMore,
    isRouteConversationReady,
    isStreaming,
    isWaitingForResponse,
    localHasMessages,
    paginatedHasMessages,
  ]);

  const [input, setInput] = useState("");
  const [deepResearchEnabled, setDeepResearchEnabled] = useState(false);
  const [isDeepResearching, setIsDeepResearching] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const location = useLocation();
  const [openGeneratedDoc, setOpenGeneratedDoc] = useState<GeneratedDoc | null>(null);
  const [openDocInteractive, setOpenDocInteractive] = useState(false);
  const [quizSubmitState, setQuizSubmitState] = useState<QuizSubmitState>({
    disabled: true,
    label: "Submit",
    visible: true,
  });
  const openDocPayload = openGeneratedDoc
    ? parseAssetPayload(openGeneratedDoc.content)
    : null;
  const openDocQuizPayload = openDocPayload?.quiz ?? openDocPayload;
  const openDocIsQuiz = Array.isArray(openDocQuizPayload?.questions);
  const openDocIsChallenge = Boolean(
    openDocPayload && typeof openDocPayload.solution === "string",
  );
  const openDocIsConceptInventory = openGeneratedDoc
    ? isConceptInventoryContent(openGeneratedDoc.content) || (openDocInteractive && openDocIsQuiz)
    : false;
  // Structured assets are JSON payloads, so downloading or copying them is meaningless.
  const openDocIsStructuredAsset = Boolean(openDocPayload);

  const handleQuizSubmitStateChange = useCallback((nextState: QuizSubmitState) => {
    setQuizSubmitState((currentState) => (
      currentState.disabled === nextState.disabled
      && currentState.label === nextState.label
      && currentState.visible === nextState.visible
        ? currentState
        : nextState
    ));
  }, []);

  useEffect(() => {
    setQuizSubmitState({ disabled: true, label: "Submit", visible: true });
  }, [openGeneratedDoc?.id]);

  // Auto-open asset passed from AssetsView via navigation state
  useEffect(() => {
    const state = location.state as { openAsset?: { id: string; title: string; content: string } } | null;
    if (!state?.openAsset) return;
    const asset = state.openAsset;
    // Match AssetContent's dispatch so a quiz opened from Assets gets the same
    // answerable panel it gets in chat; a submitted attempt stays a read-only review.
    const payload = parseAssetPayload(asset.content);
    const isSubmittedAttempt = Boolean(
      payload?.firstAttempt || payload?.recordType === "concept_inventory_first_attempt",
    );
    const quizPayload = payload?.quiz ?? payload;
    setOpenDocInteractive(
      !isSubmittedAttempt
      && (Array.isArray(quizPayload?.questions) || typeof payload?.solution === "string"),
    );
    setOpenGeneratedDoc(asset);
    window.dispatchEvent(new Event("sidebar-collapse"));
    // Clear the state so it doesn't re-trigger on re-renders
    window.history.replaceState({}, "");

    // The transcript is what gives the asset context, so scroll to the card that
    // produced it. Messages stream in asynchronously, so poll for the anchor.
    const cancel = scrollToAssetAnchor(anchorIdsForAsset(asset));
    return cancel;
  }, [location.state]);
  
  // Document streaming state - tracks if document is streaming from backend
  const [isDocStreaming, setIsDocStreaming] = useState(false);
  
  // Track sidebar collapsed state for responsive layout
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => 
    localStorage.getItem("sidebarCollapsed") === "1"
  );
  
  // Listen for sidebar state changes
  useEffect(() => {
    const handleStorageChange = () => {
      setIsSidebarCollapsed(localStorage.getItem("sidebarCollapsed") === "1");
    };
    window.addEventListener("storage", handleStorageChange);
    // Also poll for changes (since storage event doesn't fire in same window)
    const interval = setInterval(handleStorageChange, 500);
    return () => {
      window.removeEventListener("storage", handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  // Close right panels when sidebar expands
  useEffect(() => {
    const handleSidebarExpand = () => {
      setSyllabusOpen(false);
      setIsHistoryDrawerOpen(false);
      setIsResearchPanelOpen(false);
      setOpenGeneratedDoc(null);
      setIsDocStreaming(false);
    };
    window.addEventListener("sidebar-expand", handleSidebarExpand);
    return () => window.removeEventListener("sidebar-expand", handleSidebarExpand);
  }, []);
  
  // Research side panel state
  const [isResearchPanelOpen, setIsResearchPanelOpen] = useState(false);
  const [selectedResearch, setSelectedResearch] = useState<ResearchData | null>(null);
  const [userClosedPanel, setUserClosedPanel] = useState(false); // Track if user manually closed
  
  // Store draft inputs per thread
  const draftsRef = useRef<Record<string, string>>({});
  const prevThreadIdRef = useRef<string | null>(null);
  const pendingMessageSentRef = useRef<string | null>(null);

  // Save draft when switching away, restore when switching to a thread
  useEffect(() => {
    // Save current draft for previous thread
    if (prevThreadIdRef.current && prevThreadIdRef.current !== activeThreadId) {
      draftsRef.current[prevThreadIdRef.current] = input;
    }
    
    // Restore draft for new thread (or empty if none)
    const savedDraft = activeThreadId ? draftsRef.current[activeThreadId] || "" : "";
    setInput(savedDraft);
    
    prevThreadIdRef.current = activeThreadId;
  }, [activeThreadId, courseAgentId]);

  // Prefill input from pendingInputText (e.g., from conversation starters)
  // This puts the text in the input box for the user to edit before sending
  useEffect(() => {
    if (pendingInputText) {
      setInput(pendingInputText);
      setPendingInputText(null);  // Clear so it doesn't re-trigger
    }
  }, [pendingInputText, setPendingInputText]);

  // Auto-send pending message when ChatView mounts with one (e.g., from library)
  // IMPORTANT: Wait for activeThreadId to be set to prevent duplicate thread creation
  useEffect(() => {
    // Only send if we have a pending message, not streaming, have an agent, 
    // have an active thread (prevents race condition), and haven't already sent this exact message
    if (pendingMessage && !isStreaming && effectiveAgentId && activeThreadId && pendingMessageSentRef.current !== pendingMessage) {
      // Mark this message as sent to prevent duplicate sends
      pendingMessageSentRef.current = pendingMessage;
      const useDeepResearch = pendingDeepResearchEnabled || deepResearchEnabled;
      if (pendingDeepResearchEnabled) {
        setDeepResearchEnabled(true);
      }
      // Send the pending message with the appropriate settings
      if (useDeepResearch) {
        console.log("[ChatView] Sending pending message with deep research enabled");
        send(pendingMessage, false, true, {
          onResearchTriggered: () => setIsDeepResearching(true),
          onResearchComplete: () => setIsDeepResearching(false),
        });
      } else {
        send(pendingMessage);
      }
      // Clear the pending message and flags so they don't re-trigger
      onPendingMessageConsumed?.();
      setPendingDeepResearchEnabled(false);
    }
  }, [pendingMessage, effectiveAgentId, activeThreadId]);

  // Stable ref to always hold the latest `send` — prevents re-registering event listeners
  const sendRef = useRef(send);
  sendRef.current = send;

  // Listen for quiz feedback custom events and send a feedback request to the agent
  const quizFeedbackProcessingRef = useRef(false);
  useEffect(() => {
    const handleQuizFeedback = async (e: Event) => {
      // Prevent duplicate sends (React StrictMode double-mount / rapid re-fires)
      if (quizFeedbackProcessingRef.current) return;
      quizFeedbackProcessingRef.current = true;

      const { quizId, agentId: feedbackAgentId, threadId: feedbackThreadId, title, answers, automatic = false } = (e as CustomEvent).detail as {
        quizId?: string;
        agentId?: string;
        threadId?: string;
        title: string;
        answers: Array<{ question: string; userAnswer: string; reason?: string; correctAnswer: string }>;
        automatic?: boolean;
      };
      try {
        // Build detailed message for the agent (not shown to user)
        const answerLines = answers.map(
          (a, i) => `Q${i + 1}: ${a.question}\n   My answer: ${a.userAnswer}\n   My reasoning: ${a.reason || "(not provided)"}\n   Correct answer: ${a.correctAnswer}`
        ).join("\n");
        const agentMsg = automatic
          ? `First concept inventory submission for "${title}" (this immutable first attempt has been stored):\n\n${answerLines}\n\nGive immediate feedback in a single response. Focus on the student's reasoning, identify misconceptions, and suggest the most useful next step.`
          : `Quiz feedback request for "${title}":\n\n${answerLines}\n\nGive me feedback on my performance in a single response.`;
        const feedbackStartedAt = Date.now();
        await sendRef.current(
          agentMsg,
          false,
          false,
          undefined,
          undefined,
          automatic ? "Concept inventory submitted" : "Feedback",
        );

        if (automatic && quizId && feedbackAgentId && feedbackThreadId) {
          const threadMessages = useChatStore.getState().messagesByThreadId[feedbackThreadId] || [];
          const tutorFeedback = [...threadMessages]
            .reverse()
            .find((message) =>
              message.role === "assistant"
              && (message.createdAt ?? 0) >= feedbackStartedAt
              && message.content.trim()
            )
            ?.content.trim();
          const currentUserId = useUserStore.getState().userId;
          if (tutorFeedback && currentUserId) {
            await chatApi.appendQuizAgentFeedback({
              userId: currentUserId,
              quizId,
              agentId: feedbackAgentId,
              feedback: tutorFeedback,
            });
          }
        }
      } catch (error) {
        console.error("[ChatView] Failed to complete quiz feedback:", error);
      } finally {
        quizFeedbackProcessingRef.current = false;
      }
    };
    const listener = (event: Event) => void handleQuizFeedback(event);
    window.addEventListener("quiz-feedback", listener);
    return () => window.removeEventListener("quiz-feedback", listener);
  }, []); // Empty deps — register once, use ref for latest send

  // Clarify answers and suggested-query clicks are sent as ordinary user messages.
  useEffect(() => {
    const handleChatQuery = (event: Event) => {
      const { text } = (event as CustomEvent).detail as { text?: string };
      const trimmed = (text || "").trim();
      if (!trimmed) return;
      void sendRef.current(trimmed);
    };
    window.addEventListener(CHAT_SEND_QUERY_EVENT, handleChatQuery);
    return () => window.removeEventListener(CHAT_SEND_QUERY_EVENT, handleChatQuery);
  }, []);

  // Listen for research MCQ submit events
  useEffect(() => {
    const handleResearchMCQ = (e: Event) => {
      const { threadId: drThreadId, answersText, researchId } = (e as CustomEvent).detail as {
        threadId: string;
        answersText: string;
        researchId: string;
      };
      console.log("[ChatView] Research MCQ submitted:", { drThreadId, researchId, answersText });
      continueDeepResearch(drThreadId, answersText, researchId);
    };
    window.addEventListener("research-mcq-submit", handleResearchMCQ);
    return () => window.removeEventListener("research-mcq-submit", handleResearchMCQ);
  }, [continueDeepResearch]);

  const [quotedText, setQuotedText] = useState("");

  useEffect(() => {
    const onQuote = (e: Event) => {
      setQuotedText((e as CustomEvent<{ text: string }>).detail.text);
    };
    window.addEventListener(ASK_TA_QUOTE_EVENT, onQuote);
    return () => window.removeEventListener(ASK_TA_QUOTE_EVENT, onQuote);
  }, []);

  const handleSend = async (attachedFiles?: UploadedFile[], overrideText?: string) => {
    const text = applyNameGuard((overrideText ?? input).trim());
    if ((!text && !quotedText && (!attachedFiles || attachedFiles.length === 0)) || isStreaming || isDeepResearching) return;

    // Sent as a markdown blockquote so the agent and the transcript both keep the
    // reference the learner picked out.
    const composed = quotedText
      ? `> ${quotedText.replace(/\n/g, "\n> ")}\n\n${text}`
      : text;
    setQuotedText("");

    console.log("[ChatView] handleSend called", { text, deepResearchEnabled, isStreaming, isDeepResearching });
    console.log("[ChatView] deepResearchEnabled state value:", deepResearchEnabled);

    // Clear draft for this thread since we're sending
    if (activeThreadId) {
      draftsRef.current[activeThreadId] = "";
    }
    
    setInput("");
    
    if (deepResearchEnabled) {
      console.log("[ChatView] Triggering deep research mode - calling send with researchMode=true");
      // Use research mode via normal chat streaming
      // Research data is now tracked inline in messages via useAgentChat
      await send(composed, false, true, {
        onResearchTriggered: () => {
          // Research has been triggered - mark as researching to block input
          setIsDeepResearching(true);
        },
        onResearchComplete: () => {
          // Research complete - allow input again
          setIsDeepResearching(false);
        },
      }, attachedFiles);
      
      // After send completes, reset researching state
      setIsDeepResearching(false);
    } else {
      // Normal send with optional image attachments
      await send(composed, false, false, undefined, attachedFiles);
    }
  };

  // Handle stopping deep research
  const handleStopDeepResearch = useCallback(() => {
    // Stop the streaming via the hook's stop function
    stop();
    setIsDeepResearching(false);
    setDeepResearchEnabled(false);
  }, [stop]);

  // Handle deep research toggle
  const handleDeepResearchToggle = useCallback((enabled: boolean) => {
    console.log("[ChatView] handleDeepResearchToggle called:", enabled);
    setDeepResearchEnabled(enabled);
  }, []);

  const handleMessageEdit = (index: number, newContent: string) => {
    editMessage(index, newContent);
  };

  // Find document content from in-memory message sources
  const findDocInMessages = useCallback((docId: string): GeneratedDoc | null => {
    const allMsgs = [...messages, ...paginatedMessages, ...localMessages];
    for (const msg of allMsgs) {
      if (msg.generatedDocId === docId && msg.generatedDocContent) {
        return {
          id: docId,
          title: msg.generatedDocTitle || "Generated document",
          content: msg.generatedDocContent,
        };
      }
      if (msg.contentBlocks) {
        const block = msg.contentBlocks.find(
          (b: any) => b.type === "document" && b.docId === docId
        );
        if (block && msg.generatedDocContent) {
          return {
            id: docId,
            title: (block as any).title || msg.generatedDocTitle || "Generated document",
            content: msg.generatedDocContent,
          };
        }
      }
    }
    return null;
  }, [messages, paginatedMessages, localMessages]);

  // Handle clicking on a generated document in chat
  // Quizzes open in the side pane; AssetContent re-renders them as a QuizBlock.
  const handleQuizOpen = (quiz: {
    quizId: string;
    title: string;
    questions: unknown[];
    assessmentType?: string;
    thresholdConcept?: string;
  }) => {
    setOpenDocInteractive(true);
    setOpenGeneratedDoc({
      id: quiz.quizId,
      title: quiz.title || "Quiz",
      content: JSON.stringify(quiz),
    });
  };

  const handleChallengeOpen = (challenge: {
    challengeId: string;
    title: string;
    description: string;
    difficulty: string;
    hints?: string[];
    solution: string;
    challengeType?: string;
  }) => {
    setOpenDocInteractive(true);
    setOpenGeneratedDoc({
      id: challenge.challengeId,
      title: challenge.title || "Challenge",
      content: JSON.stringify(challenge),
    });
  };

  const handleGeneratedDocClick = async (docId: string) => {
    setOpenDocInteractive(false);
    console.log(`[ChatView] Opening doc: ${docId}, generatedDocs: ${generatedDocs.length}`);
    let doc = generatedDocs.find((d) => d.id === docId) || findDocInMessages(docId);
    if (doc) {
      setOpenGeneratedDoc(doc);
      setIsHistoryDrawerOpen(false); // Close history when doc opens
      return;
    }

    // Last resort: try to fetch from assets API (documents are auto-saved as assets)
    if (userId && activeThreadId) {
      try {
        const { assets } = await chatApi.listAssets(userId, { threadId: activeThreadId, category: "document" });
        const match = assets.find((a) => a.title && a.content);
        if (match) {
          doc = { id: docId, title: match.title, content: match.content };
          setOpenGeneratedDoc(doc);
          return;
        }
      } catch (err) {
        console.error("[ChatView] Asset recovery failed:", err);
      }
    }

    console.warn(`[ChatView] Document not found: ${docId}. Messages: ${messages.length}, PaginatedMsgs: ${paginatedMessages.length}, LocalMsgs: ${localMessages.length}`);
    toast.error("Document content is unavailable. It may not have been saved correctly.");
  };

  // Handle downloading a generated document from chat
  const handleDocumentDownload = async (docId: string, title: string) => {
    let content = generatedDocs.find((d) => d.id === docId)?.content
      || findDocInMessages(docId)?.content;

    // Asset fallback
    if (!content && userId && activeThreadId) {
      try {
        const { assets } = await chatApi.listAssets(userId, { threadId: activeThreadId, category: "document" });
        content = assets.find((a) => a.content)?.content;
      } catch { /* ignore */ }
    }

    if (content) {
      const resolved = resolveDocNames(content);
      const blob = new Blob([resolved], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title || 'document'}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } else {
      toast.error("Document content is unavailable for download.");
    }
  };

  // State to track which tab to open in the research panel
  const [researchPanelTab, setResearchPanelTab] = useState<"activity" | "sources">("activity");

  // Handle opening research panel for a specific research
  const handleResearchPanelOpen = useCallback((researchId: string, tab?: "activity" | "sources") => {
    // Find the research in messages
    const msg = messages.find((m) => m.research?.id === researchId);
    if (msg?.research) {
      setSelectedResearch(msg.research);
      setResearchPanelTab(tab || "activity"); // Default to activity tab
      setIsResearchPanelOpen(true);
      setUserClosedPanel(false); // Reset flag when user manually opens
      setIsHistoryDrawerOpen(false); // Close history when research opens
      window.dispatchEvent(new Event("sidebar-collapse"));
    }
  }, [messages]);

  // Handle stopping a specific research
  const handleResearchStop = useCallback((researchId: string) => {
    // For now, just stop all research (can be enhanced for parallel later)
    handleStopDeepResearch();
  }, [handleStopDeepResearch]);

  // Close research panel
  const handleResearchPanelClose = useCallback(() => {
    setIsResearchPanelOpen(false);
    setUserClosedPanel(true); // Mark that user manually closed
  }, []);

  // Keep selected research in sync with messages (for live updates in side panel)
  // Also auto-open panel when research is running (unless user manually closed it)
  useEffect(() => {
    // Find any running research in messages
    const runningResearchMsg = messages.find((m) => m.isResearch && m.research?.status === "running");
    
    if (runningResearchMsg?.research) {
      // Auto-open panel and select the running research, but only if user hasn't manually closed it
      setSelectedResearch(runningResearchMsg.research);
      if (!userClosedPanel) {
        setIsResearchPanelOpen(true);
      }
    } else if (selectedResearch && isResearchPanelOpen) {
      // Keep existing selected research in sync
      const msg = messages.find((m) => m.research?.id === selectedResearch.id);
      if (msg?.research && msg.research !== selectedResearch) {
        setSelectedResearch(msg.research);
      }
    }
    
    // Reset userClosedPanel when no research is running (so next research auto-opens)
    if (!runningResearchMsg) {
      setUserClosedPanel(false);
    }
  }, [messages, selectedResearch, isResearchPanelOpen, userClosedPanel]);

  // Track previously opened document ID to detect new documents
  const lastOpenedDocIdRef = useRef<string | null>(null);
  // Track the currently open doc ID via ref to avoid dependency cycle
  const openDocIdRef = useRef<string | null>(null);
  
  // Auto-open new documents only when they are actively being generated (streaming)
  // Do NOT auto-open completed documents loaded from chat history
  // NOTE: openGeneratedDoc is NOT in deps to prevent infinite re-render loop
  // when document deltas arrive rapidly (each delta creates a new generatedDocs array)
  useEffect(() => {
    if (generatedDocs.length > 0) {
      const latestDoc = generatedDocs[generatedDocs.length - 1];
      
      // Check if this is a new document we haven't opened yet
      if (latestDoc.id !== lastOpenedDocIdRef.current) {
        lastOpenedDocIdRef.current = latestDoc.id;
        
        // Only auto-open if the document is actively streaming (being generated right now)
        if (latestDoc.isStreaming) {
          openDocIdRef.current = latestDoc.id;
          setOpenGeneratedDoc(latestDoc);
          setIsDocStreaming(true);
          setIsHistoryDrawerOpen(false); // Close history when doc auto-opens
        }
      } else if (openDocIdRef.current) {
        // Same doc got updated (e.g., complete document arrived with content/title)
        // Only update if the doc panel is already open for this doc
        const currentDoc = generatedDocs.find(d => d.id === openDocIdRef.current);
        if (currentDoc) {
          setOpenGeneratedDoc(currentDoc);
          setIsDocStreaming(currentDoc.isStreaming ?? false);
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generatedDocs]);

  // The panel is keyed to the conversation, so a new or switched thread must not
  // keep the previous one's document on screen.
  useEffect(() => {
    setOpenGeneratedDoc(null);
    setIsDocStreaming(false);
    openDocIdRef.current = null;
    lastOpenedDocIdRef.current = null;
  }, [activeThreadId, effectiveAgentId]);

  // Show empty state if no agent selected
  if (!effectiveAgentId) {
    return <NoAgentSelectedState onExplore={onExplore} onLearnMore={() => navigate('/learn')} />;
  }

  return (
    <div className="h-full overflow-hidden bg-gradient-to-br from-neutral-950 via-black to-neutral-950">
      {/* Animated background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 -left-1/4 w-1/2 h-1/2 bg-blue-500/3 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 -right-1/4 w-1/2 h-1/2 bg-indigo-500/3 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      <div className="relative h-full flex flex-row">
        {/* Left side: header + chat (shrinks to 50% when doc panel is open) */}
        <div
          className={`flex flex-col min-h-0 transition-all duration-300 ${
            openGeneratedDoc || isHistoryDrawerOpen || syllabusOpen ? "w-1/2 flex-none" : "flex-1"
          }`}
        >
          {/* Header */}
          <ChatHeader 
            agentName={courseAgentName}
            threadTitle={activeThread?.title}
            onNewChat={handleNewChat}
            onShare={handleShareChat}
            onInfo={() => setShowInfoDialog(true)}
            onCourseCurriculum={handleOpenSyllabus}
            curriculumAvailable={hasSyllabus && hasThresholdConcepts}
            curriculumStatus={curriculumStatus}
            onMenuOpen={refreshCurriculumAvailability}
            onAgentCode={() => setShowManageAgent(true)}
            onEditAgent={() => {
              if (effectiveAgentId) {
                setEditingAgentId(effectiveAgentId);
                setEditMode("simplistic");
                navigate(`/edit/${encodeURIComponent(chatCourseName)}`);
              }
            }}
            onDeleteAgent={() => setShowDeleteConfirm(true)}
            isTeacherOrAdmin={useUserStore.getState().role !== "student"}
            onHistoryToggle={() => {
              setIsHistoryDrawerOpen((o) => {
                if (!o) {
                  setIsResearchPanelOpen(false); // Close research when history opens
                  setOpenGeneratedDoc(null); // Close doc panel when history opens
                  setIsDocStreaming(false);
                  window.dispatchEvent(new Event("sidebar-collapse"));
                }
                return !o;
              });
            }}
            isScrolled={isScrolled}
            hasMessages={messages.length > 0}
            isHistoryOpen={isHistoryDrawerOpen}
            isPanelOpen={isHistoryDrawerOpen || isResearchPanelOpen || !!openGeneratedDoc || syllabusOpen}
          />

          {/* Main content area - flex row for chat + optional research panel */}
          <div className="flex-1 flex min-h-0">
            {/* Chat Container */}
            <div 
              className="relative flex-1 flex flex-col min-h-0 transition-all duration-300"
              style={{
                ...(isResearchPanelOpen && !openGeneratedDoc ? { width: "calc(100% - 320px)" } : {})
              }}
            >
            <AskTASelection />
            <UnifiedChatContainer
              messages={messages}
              agentId={effectiveAgentId}
              input={input}
              onInputChange={(e) => setInput(e.target.value)}
              onSend={handleSend}
              onStop={stop}
              isSending={isWaitingForResponse || isStreaming}
              isTyping={isStreaming && !isWaitingForResponse}
              statusLabel={activeToolLabel}
              placeholder="Ask anything about the course..."
              emptyStateTitle="What would you like to learn?"
              emptyStateDescription=""
              emptyStateSuggestions={emptyStateSuggestions}
              onSuggestionClick={(suggestion) => {
                handleSend(undefined, suggestion);
              }}
              onGeneratedDocClick={handleGeneratedDocClick}
              onQuizOpen={handleQuizOpen}
              onChallengeOpen={handleChallengeOpen}
              onDocumentDownload={handleDocumentDownload}
              threadId={activeThreadId}
              showUserActions={true}
              onUserMessageEdit={handleMessageEdit}
              onAssistantRetry={retry}
              disabled={false}
              deepResearchEnabled={deepResearchEnabled}
              onDeepResearchToggle={handleDeepResearchToggle}
              showDeepResearchButton={true}
              isDeepResearching={isDeepResearching}
              quotedText={quotedText}
              onClearQuotedText={() => setQuotedText("")}
              onScrollStateChange={setIsScrolled}
              onResearchStop={handleResearchStop}
              onResearchPanelOpen={handleResearchPanelOpen}
              isResearchPanelOpen={isResearchPanelOpen}
              selectedResearchId={selectedResearch?.id}
              hasMoreMessages={hasMoreMessages}
              isLoadingMore={isLoadingMore}
              onLoadMoreMessages={loadOlderMessages}
            />
          </div>

          {/* Research Side Panel - shows activity and sources */}
          <ResearchSidePanel
            isOpen={isResearchPanelOpen}
            onClose={handleResearchPanelClose}
            research={selectedResearch}
            initialTab={researchPanelTab}
          />

          </div>
        </div>

        {/* Chat History Side Panel - 50% width, full height (same level as doc panel) */}
        {isHistoryDrawerOpen && (
          <ChatHistoryDrawer
            agentId={effectiveAgentId}
            activeThreadId={activeThreadId}
            onSelectThread={handleDrawerSelectThread}
            isOpen={isHistoryDrawerOpen}
            onClose={() => setIsHistoryDrawerOpen(false)}
            onNewChat={handleNewChat}
          />
        )}

        {/* Document preview split pane - 50% width, full height when generated doc is open */}
        {openGeneratedDoc && (
          <div className="w-1/2 flex-none border-l border-white/[0.08] bg-neutral-800/80 flex flex-col animate-in slide-in-from-right-5 duration-300">
            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-3 border-b border-white/[0.08]">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white truncate">
                  {openDocIsConceptInventory ? "Concept Inventory" : openGeneratedDoc.title}
                </p>
              </div>
              <div className="flex-shrink-0 flex items-center gap-2">
                {!openDocIsStructuredAsset && (
                  <>
                    <DownloadButton content={openGeneratedDoc.content} title={openGeneratedDoc.title} />
                    <CopyDropdown content={openGeneratedDoc.content} title={openGeneratedDoc.title} />
                  </>
                )}
                {openDocInteractive && openDocIsConceptInventory && quizSubmitState.visible && (
                  <button
                    type="submit"
                    form={OPEN_CONCEPT_INVENTORY_FORM_ID}
                    disabled={quizSubmitState.disabled}
                    className="h-8 rounded-md bg-white px-4 text-xs font-semibold text-neutral-900 transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-500"
                  >
                    {quizSubmitState.label}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setIsDocStreaming(false);
                    setOpenGeneratedDoc(null);
                  }}
                  className="p-1.5 text-neutral-400 hover:text-white border border-neutral-600 rounded-md bg-neutral-800 hover:bg-neutral-700 transition-colors"
                  title="Close document"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Content area */}
            <div
              className={`flex-1 scrollbar-none ${
                openDocInteractive && openDocIsChallenge
                  ? "min-h-0 overflow-hidden"
                  : `pb-10 ${
                    openDocIsConceptInventory
                      ? `overflow-y-auto overflow-x-hidden pl-[50px] pr-[18px] ${openDocInteractive ? "pt-0" : "pt-4"}`
                      : openDocIsStructuredAsset
                        ? "overflow-auto px-5 pt-4"
                        : "overflow-auto px-14 pt-4"
                  }`
              }`}
            >
              {isDocStreaming && streamingDocContent ? (
                <Markdown>{resolveDocNames(streamingDocContent)}</Markdown>
              ) : (
                <AssetContent
                  content={resolveDocNames(openGeneratedDoc.content)}
                  title={openGeneratedDoc.title}
                  id={openGeneratedDoc.id}
                  interactive={openDocInteractive}
                  agentId={effectiveAgentId}
                  threadId={threadId || undefined}
                  quizSubmitFormId={openDocInteractive && openDocIsConceptInventory
                    ? OPEN_CONCEPT_INVENTORY_FORM_ID
                    : undefined}
                  onQuizSubmitStateChange={openDocInteractive && openDocIsConceptInventory
                    ? handleQuizSubmitStateChange
                    : undefined}
                />
              )}
            </div>
          </div>
        )}

      {/* Syllabus Side Panel */}
      {syllabusOpen && (
        <div className="w-1/2 flex-none border-l border-white/[0.08] bg-neutral-800/80 flex flex-col h-full animate-in slide-in-from-right-5 duration-300">
          <div className="flex-shrink-0">
            <div className="px-5 pt-4 pb-3 flex items-center justify-between">
              <p className="text-base font-semibold text-white truncate">
                Course Curriculum
              </p>
              <div className="flex items-center gap-2">
              {syllabusData && curriculumStatus === "ready" && useUserStore.getState().role !== "student" && (
                <div className="flex items-center gap-2">
                  {isEditingCurriculum ? (
                    <>
                      {!isSavingCurriculum && (
                        <button
                          onClick={() => { setIsEditingCurriculum(false); setEditedSyllabusData(null); }}
                          className="h-7 px-3 text-xs rounded-lg border border-neutral-700 text-neutral-400 hover:text-white hover:border-neutral-500 transition-colors"
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        onClick={handleSaveCurriculum}
                        disabled={isSavingCurriculum}
                        className="h-7 px-3 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                      >
                        {isSavingCurriculum && <Loader2 className="h-3 w-3 animate-spin" />}
                        {isSavingCurriculum ? "Saving..." : "Save"}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => { setIsEditingCurriculum(true); setEditedSyllabusData(JSON.parse(JSON.stringify(syllabusData))); }}
                        className="h-7 px-3 text-xs rounded-lg border border-neutral-700 text-neutral-400 hover:text-white hover:border-neutral-500 transition-colors flex items-center gap-1.5"
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </button>
                    </>
                  )}
                </div>
              )}
              <button
                onClick={() => { setSyllabusOpen(false); setIsEditingCurriculum(false); setEditedSyllabusData(null); }}
                className="h-7 w-7 flex items-center justify-center text-neutral-400 hover:text-white border border-neutral-600 rounded-lg bg-neutral-800 hover:bg-neutral-700 transition-colors"
                title="Close"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              </div>
            </div>
            {/* Processing banner */}
            {syllabusData && curriculumStatus === "processing" && (
              <div className="mx-6 mb-2 px-3 py-2.5 rounded-lg bg-blue-950/40 border border-blue-800/40 flex items-center gap-3">
                <Loader2 className="h-4 w-4 text-blue-400 animate-spin flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-blue-300 font-medium">
                    {hasSyllabus ? "Threshold concepts are being generated" : "Syllabus is being generated"}
                  </p>
                  <p className="text-[10px] text-blue-400/70 mt-0.5">
                    {hasSyllabus
                      ? "This uses deep reasoning and may take 10-20 minutes..."
                      : "Structuring your course into modules and topics..."
                    }
                  </p>
                  <div className="mt-1.5 w-full h-1 rounded-full bg-blue-900/50 overflow-hidden">
                    <div
                      className="h-full bg-blue-500/70 rounded-full transition-all duration-500"
                      style={{ width: hasThresholdConcepts ? "90%" : hasSyllabus ? "50%" : "20%" }}
                    />
                  </div>
                </div>
              </div>
            )}
            {syllabusData && (
              <div className="px-6 flex gap-1 border-b border-neutral-800">
                <button
                  onClick={() => setSyllabusTab("modules")}
                  className={`px-4 py-2 text-sm font-medium transition-colors relative ${
                    syllabusTab === "modules"
                      ? "text-white"
                      : "text-neutral-500 hover:text-neutral-300"
                  }`}
                >
                  Syllabus
                  {syllabusTab === "modules" && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white rounded-full" />
                  )}
                </button>
                <button
                  onClick={() => setSyllabusTab("concepts")}
                  className={`px-4 py-2 text-sm font-medium transition-colors relative ${
                    syllabusTab === "concepts"
                      ? "text-white"
                      : "text-neutral-500 hover:text-neutral-300"
                  }`}
                >
                  Threshold Concepts
                  {syllabusTab === "concepts" && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white rounded-full" />
                  )}
                </button>
                {!isEditingCurriculum && (
                  <button
                    onClick={() => {
                      setSyllabusTab(syllabusTab === "history" ? "modules" : "history");
                      if (effectiveAgentId && curriculumVersions.length === 0) {
                        setVersionsLoading(true);
                        listCurriculumVersions(effectiveAgentId).then((res) => {
                          setCurriculumVersions(res.versions || []);
                        }).catch(() => {}).finally(() => setVersionsLoading(false));
                      }
                    }}
                    className={`px-4 py-2 text-sm font-medium transition-colors relative flex items-center gap-1.5 ${
                      syllabusTab === "history"
                        ? "text-white"
                        : "text-neutral-500 hover:text-neutral-300"
                    }`}
                  >
                    Version Control
                    {syllabusTab === "history" && (
                      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white rounded-full" />
                    )}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            {syllabusLoading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-neutral-500" />
                <p className="text-sm text-neutral-500">Loading course curriculum...</p>
              </div>
            ) : syllabusData ? (
              <>
                {syllabusTab === "modules" && (
                  <div className="space-y-4">
                    {syllabusData.course_name && (
                      <div>
                        <h3 className="text-base font-semibold text-neutral-200">{stripLinks(syllabusData.course_name)}</h3>
                        {syllabusData.course_level && (
                          <p className="text-xs text-neutral-500 mt-0.5">Level: {syllabusData.course_level}</p>
                        )}
                      </div>
                    )}
                    {!isEditingCurriculum && learningProgress?.overall && (
                      <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-4 py-3">
                        <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">Your progress</p>
                        {coveredTopics.length > 0 ? (
                          <>
                            <div className="flex items-center justify-between mt-2 mb-2">
                              <div className="h-1.5 flex-1 rounded-full bg-neutral-800 overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-emerald-500 transition-all"
                                  style={{ width: `${Math.min(100, Math.max(0, learningProgress.overall.percent ?? 0))}%` }}
                                />
                              </div>
                              <p className="ml-3 text-xs text-neutral-400 whitespace-nowrap">
                                {learningProgress.overall.learned ?? 0} of {learningProgress.overall.total_topics ?? 0} topics
                              </p>
                            </div>
                            <div className="mt-3">
                              <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">
                                Topics covered
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {coveredTopics.map((topic) => (
                                  <button
                                    key={topic.name}
                                    type="button"
                                    onClick={() => setAskTopic(topic.name)}
                                    className="inline-flex items-center gap-1.5 rounded-full border border-neutral-700/70 bg-neutral-800/60 px-2.5 py-1 text-[11px] text-neutral-200 transition-colors hover:border-neutral-500 hover:bg-neutral-700/60"
                                  >
                                    <ProgressDot status={topic.status} />
                                    {topic.name}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </>
                        ) : (
                          <p className="mt-2 text-xs text-neutral-400">
                            You're ready to begin—pick any of the{" "}
                            {learningProgress.overall.total_topics ?? 0} topics below and start learning.
                          </p>
                        )}
                      </div>
                    )}
                    {syllabusData.syllabus && syllabusData.syllabus.length > 0 ? (
                      <div className="space-y-2">
                        {(isEditingCurriculum ? editedSyllabusData.syllabus : syllabusData.syllabus).map((mod: any, idx: number) => (
                          <div key={idx} id={`syllabus-module-${idx}`} className="rounded-lg border border-neutral-800 overflow-hidden">
                            <button
                              className="w-full flex items-center justify-between px-4 py-3 hover:bg-neutral-800/60 transition-colors text-left"
                              onClick={() => toggleModule(idx)}
                            >
                              <span className="text-sm font-medium text-neutral-200 flex items-center gap-2">
                                <span className="text-sm text-neutral-500 font-mono w-6">{idx + 1}.</span>
                                {isEditingCurriculum ? (
                                  <input
                                    type="text"
                                    value={stripModulePrefix(mod.title || mod.module || mod.name || "")}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => {
                                      const updated = { ...editedSyllabusData };
                                      updated.syllabus = [...updated.syllabus];
                                      updated.syllabus[idx] = { ...updated.syllabus[idx], title: `Module ${idx + 1}: ${e.target.value}` };
                                      setEditedSyllabusData(updated);
                                    }}
                                    className="bg-neutral-800 border border-neutral-700 rounded px-2 py-0.5 text-sm text-neutral-200 w-full focus:outline-none focus:border-blue-500"
                                    placeholder="Module Name"
                                  />
                                ) : (
                                  stripModulePrefix(stripLinks(mod.title || mod.module || mod.name || `Module ${idx + 1}`))
                                )}
                              </span>
                              <div className="flex items-center gap-1.5">
                                {isEditingCurriculum && (
                                  <span
                                    role="button"
                                    onClick={(e) => { e.stopPropagation(); const updated = { ...editedSyllabusData }; updated.syllabus = updated.syllabus.filter((_: any, i: number) => i !== idx); setEditedSyllabusData(updated); }}
                                    className="p-1 rounded hover:bg-red-900/30 text-neutral-600 hover:text-red-400 transition-colors"
                                    title="Remove module"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </span>
                                )}
                                {expandedModules.has(idx) ? (
                                  <ChevronDown className="h-4 w-4 text-neutral-500 flex-shrink-0" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 text-neutral-500 flex-shrink-0" />
                                )}
                              </div>
                            </button>
                            {expandedModules.has(idx) && (
                              <div className="px-4 pb-4 pt-2 border-t border-neutral-800/60 space-y-3">
                                {isEditingCurriculum ? (
                                  <div className="space-y-3">
                                    <div>
                                      <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">Topics</p>
                                      <div className="space-y-1.5">
                                        {(mod.topics || []).map((topic: string, tIdx: number) => (
                                          <div key={tIdx} className="flex items-center justify-between px-4 py-2.5 rounded-lg border border-neutral-800 bg-neutral-900">
                                            <input
                                              type="text"
                                              value={topic}
                                              onChange={(e) => {
                                                const updated = { ...editedSyllabusData };
                                                updated.syllabus = [...updated.syllabus];
                                                const newTopics = [...(updated.syllabus[idx].topics || [])];
                                                newTopics[tIdx] = e.target.value;
                                                updated.syllabus[idx] = { ...updated.syllabus[idx], topics: newTopics };
                                                setEditedSyllabusData(updated);
                                              }}
                                              className="bg-blend flex-1 border-none text-xs text-neutral-300 placeholder:text-neutral-300 focus:outline-none outline-none shadow-none p-0"
                                              placeholder="Enter topic..."
                                            />
                                            <button
                                              type="button"
                                              onClick={() => {
                                                const updated = { ...editedSyllabusData };
                                                updated.syllabus = [...updated.syllabus];
                                                const newTopics = [...(updated.syllabus[idx].topics || [])];
                                                newTopics.splice(tIdx, 1);
                                                updated.syllabus[idx] = { ...updated.syllabus[idx], topics: newTopics };
                                                setEditedSyllabusData(updated);
                                              }}
                                              className="text-neutral-500 hover:text-red-400 transition-colors flex-shrink-0 ml-3"
                                            >
                                              <X className="h-3.5 w-3.5" />
                                            </button>
                                          </div>
                                        ))}
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setEditedSyllabusData((prev: any) => {
                                              const existing = prev.syllabus[idx].topics || [];
                                              if (existing.some((t: string) => !t.trim())) return prev;
                                              const updated = JSON.parse(JSON.stringify(prev));
                                              updated.syllabus[idx].topics = [...updated.syllabus[idx].topics, ""];
                                              return updated;
                                            });
                                          }}
                                          className="w-full py-2.5 text-xs text-neutral-400 hover:text-white border border-dashed border-neutral-700 hover:border-neutral-500 rounded-lg bg-transparent cursor-pointer transition-colors flex items-center justify-center gap-1.5"
                                        >
                                          <Plus className="h-3.5 w-3.5" />
                                          Add Topic
                                        </button>
                                      </div>
                                    </div>
                                    <div>
                                      <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">Learning Objectives</p>
                                      <div className="space-y-1.5">
                                        {(mod.learning_objectives || []).map((obj: string, oIdx: number) => (
                                          <div key={oIdx} className="flex items-center justify-between px-4 py-2.5 rounded-lg border border-neutral-800 bg-neutral-900">
                                            <input
                                              type="text"
                                              value={obj}
                                              onChange={(e) => {
                                                const updated = { ...editedSyllabusData };
                                                updated.syllabus = [...updated.syllabus];
                                                const newObjs = [...(updated.syllabus[idx].learning_objectives || [])];
                                                newObjs[oIdx] = e.target.value;
                                                updated.syllabus[idx] = { ...updated.syllabus[idx], learning_objectives: newObjs };
                                                setEditedSyllabusData(updated);
                                              }}
                                              className="bg-blend flex-1 border-none text-xs text-neutral-300 placeholder:text-neutral-300 focus:outline-none outline-none shadow-none p-0"
                                              placeholder="Enter learning objective..."
                                            />
                                            <button
                                              type="button"
                                              onClick={() => {
                                                const updated = { ...editedSyllabusData };
                                                updated.syllabus = [...updated.syllabus];
                                                const newObjs = [...(updated.syllabus[idx].learning_objectives || [])];
                                                newObjs.splice(oIdx, 1);
                                                updated.syllabus[idx] = { ...updated.syllabus[idx], learning_objectives: newObjs };
                                                setEditedSyllabusData(updated);
                                              }}
                                              className="text-neutral-500 hover:text-red-400 transition-colors flex-shrink-0 ml-3"
                                            >
                                              <X className="h-3.5 w-3.5" />
                                            </button>
                                          </div>
                                        ))}
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setEditedSyllabusData((prev: any) => {
                                              const existing = prev.syllabus[idx].learning_objectives || [];
                                              if (existing.some((o: string) => !o.trim())) return prev;
                                              const updated = JSON.parse(JSON.stringify(prev));
                                              updated.syllabus[idx].learning_objectives = [...updated.syllabus[idx].learning_objectives, ""];
                                              return updated;
                                            });
                                          }}
                                          className="w-full py-2.5 text-xs text-neutral-400 hover:text-white border border-dashed border-neutral-700 hover:border-neutral-500 rounded-lg bg-transparent cursor-pointer transition-colors flex items-center justify-center gap-1.5"
                                        >
                                          <Plus className="h-3.5 w-3.5" />
                                          Add Learning Objective
                                        </button>
                                      </div>
                                    </div>
                                    <div>
                                      <p className="text-xs font-semibold text-amber-400/70 uppercase tracking-wider mb-1.5">Threshold Concepts</p>
                                      {tcPickerModuleIdx === idx && (
                                        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onClick={() => setTcPickerModuleIdx(null)}>
                                          <div className="bg-neutral-900 border border-neutral-700 rounded-xl w-full max-w-lg max-h-[70vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                                            <div className="px-5 py-4 border-b border-neutral-800 flex items-center justify-between">
                                              <h4 className="text-sm font-semibold text-neutral-100">Select Threshold Concepts</h4>
                                              <button type="button" onClick={() => setTcPickerModuleIdx(null)} className="w-7 h-7 flex items-center justify-center rounded-lg border border-neutral-700 bg-neutral-800 opacity-70 hover:opacity-100 hover:bg-neutral-700 transition-all">
                                                <X className="h-3.5 w-3.5" />
                                              </button>
                                            </div>
                                            <div className="overflow-y-auto flex-1 p-3 space-y-1.5">
                                              {(() => {
                                                const modTitle = stripLinks(mod.title || mod.module || mod.name || "").toLowerCase();
                                                const modId = mod.module_id || `module-${idx}`;
                                                const allTcs = editedSyllabusData.all_threshold_concepts || [];
                                                return allTcs.length > 0 ? allTcs.map((tcName: string, tcIdx: number) => {
                                                  const tc = editedSyllabusData[tcName] || {};
                                                  const isMapped = tc.related_modules?.includes(modId) || (modTitle.length > 3 && tc.related_chapters?.some((ch: string) => {
                                                    const c = stripLinks(ch).toLowerCase();
                                                    return c === modTitle || c.includes(modTitle) || modTitle.includes(c);
                                                  }));
                                                  const isExpanded = tcPickerExpanded.has(tcIdx);
                                                  return (
                                                    <div key={tcIdx} className={`rounded-lg border overflow-hidden ${isMapped ? "border-neutral-600 bg-neutral-800/70" : "border-neutral-800"}`}>
                                                      <div className="flex items-center gap-3 px-4 py-3">
                                                        <div
                                                          role="button"
                                                          className="flex-shrink-0 p-1 cursor-pointer"
                                                          onClick={(e) => {
                                                            e.stopPropagation();
                                                            const updated = JSON.parse(JSON.stringify(editedSyllabusData));
                                                            const currentTc = updated[tcName] || {};
                                                            const currentModTitle = stripLinks(mod.title || mod.module || mod.name || "");
                                                            if (isMapped) {
                                                              if (currentTc.related_chapters) {
                                                                const mt = currentModTitle.toLowerCase();
                                                                currentTc.related_chapters = currentTc.related_chapters.filter((ch: string) => {
                                                                  const c = stripLinks(ch).toLowerCase();
                                                                  return !(c === mt || c.includes(mt) || mt.includes(c));
                                                                });
                                                              }
                                                              if (currentTc.related_modules) {
                                                                currentTc.related_modules = currentTc.related_modules.filter((m: string) => m !== modId);
                                                              }
                                                            } else {
                                                              if (!currentTc.related_chapters) currentTc.related_chapters = [];
                                                              currentTc.related_chapters = [...currentTc.related_chapters, currentModTitle];
                                                            }
                                                            updated[tcName] = currentTc;
                                                            setEditedSyllabusData(updated);
                                                          }}
                                                        >
                                                          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${isMapped ? "bg-blue-600 border-blue-600" : "border-neutral-500 bg-transparent hover:border-neutral-300"}`}>
                                                            {isMapped && <Check className="h-3.5 w-3.5 text-white" />}
                                                          </div>
                                                        </div>
                                                        <button
                                                          type="button"
                                                          className="flex-1 min-w-0 text-left"
                                                          onClick={() => {
                                                            setTcPickerExpanded(prev => {
                                                              const next = new Set(prev);
                                                              if (next.has(tcIdx)) next.delete(tcIdx);
                                                              else next.add(tcIdx);
                                                              return next;
                                                            });
                                                          }}
                                                        >
                                                          <span className="text-sm font-medium text-neutral-200">
                                                            {stripLinks(tcName)}
                                                          </span>
                                                          {!isExpanded && (tc.definition || tc.description) && (
                                                            <p className="text-xs text-neutral-500 mt-1 line-clamp-1">{tc.definition || tc.description}</p>
                                                          )}
                                                        </button>
                                                        <button
                                                          type="button"
                                                          className="flex-shrink-0 p-1 hover:bg-neutral-800 rounded transition-colors"
                                                          onClick={() => {
                                                            setTcPickerExpanded(prev => {
                                                              const next = new Set(prev);
                                                              if (next.has(tcIdx)) next.delete(tcIdx);
                                                              else next.add(tcIdx);
                                                              return next;
                                                            });
                                                          }}
                                                        >
                                                          {isExpanded ? (
                                                            <ChevronDown className="h-4 w-4 text-neutral-500" />
                                                          ) : (
                                                            <ChevronRight className="h-4 w-4 text-neutral-500" />
                                                          )}
                                                        </button>
                                                      </div>
                                                      {isExpanded && (
                                                        <div className="px-4 pb-3 pt-1 border-t border-neutral-800/60 ml-11 space-y-2">
                                                          {(tc.definition || tc.description) && (
                                                            <div>
                                                              <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1">Definition</p>
                                                              <p className="text-xs text-neutral-400 leading-relaxed">{tc.definition || tc.description}</p>
                                                            </div>
                                                          )}
                                                          {tc.misconceptions && tc.misconceptions.length > 0 && (
                                                            <div>
                                                              <p className="text-[10px] font-semibold text-red-400/70 uppercase tracking-wider mb-1">Common Misconceptions</p>
                                                              <div className="space-y-1">
                                                                {tc.misconceptions.map((m: any, mIdx: number) => (
                                                                  <div key={mIdx} className="flex items-start gap-2">
                                                                    <div className="w-1.5 h-1.5 rounded-full bg-neutral-600 mt-1.5 flex-shrink-0" />
                                                                    <span className="text-xs text-neutral-400">{typeof m === "string" ? m : m.misconception || m.description || JSON.stringify(m)}</span>
                                                                  </div>
                                                                ))}
                                                              </div>
                                                            </div>
                                                          )}
                                                        </div>
                                                      )}
                                                    </div>
                                                  );
                                                }) : (
                                                  <p className="text-xs text-neutral-500 text-center py-6">No threshold concepts available.</p>
                                                );
                                              })()}
                                            </div>
                                            <div className="px-5 py-3 border-t border-neutral-800">
                                              <button
                                                type="button"
                                                onClick={() => setTcPickerModuleIdx(null)}
                                                className="w-full py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
                                              >
                                                Done
                                              </button>
                                            </div>
                                          </div>
                                        </div>
                                      )}
                                      <div className="space-y-1.5">
                                        {(editedSyllabusData.all_threshold_concepts || []).map((tcName: string, tcIdx: number) => {
                                          const tc = editedSyllabusData[tcName] || {};
                                          const modTitle = stripLinks(mod.title || mod.module || mod.name || "").toLowerCase();
                                          const modId = mod.module_id || `module-${idx}`;
                                          const isMapped = tc.related_modules?.includes(modId) || (modTitle.length > 3 && tc.related_chapters?.some((ch: string) => {
                                            const c = stripLinks(ch).toLowerCase();
                                            return c === modTitle || c.includes(modTitle) || modTitle.includes(c);
                                          }));
                                          if (!isMapped) return null;
                                          return (
                                            <div
                                              key={tcIdx}
                                              className="flex items-center justify-between px-4 py-2.5 rounded-lg border border-neutral-800 bg-neutral-900/50"
                                            >
                                              <span className="text-xs text-amber-300 leading-snug">{stripLinks(tcName)}</span>
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  const updated = { ...editedSyllabusData };
                                                  const currentTc = { ...(updated[tcName] || {}) };
                                                  const currentModTitle = stripLinks(mod.title || mod.module || mod.name || "");
                                                  if (currentTc.related_chapters) {
                                                    currentTc.related_chapters = currentTc.related_chapters.filter((ch: string) => {
                                                      const c = stripLinks(ch).toLowerCase();
                                                      return !(c === modTitle || c.includes(modTitle) || modTitle.includes(c));
                                                    });
                                                  }
                                                  if (currentTc.related_modules) {
                                                    currentTc.related_modules = currentTc.related_modules.filter((m: string) => m !== modId);
                                                  }
                                                  updated[tcName] = currentTc;
                                                  setEditedSyllabusData(updated);
                                                }}
                                                className="text-neutral-500 hover:text-red-400 transition-colors flex-shrink-0 ml-3"
                                              >
                                                <X className="h-3.5 w-3.5" />
                                              </button>
                                            </div>
                                          );
                                        })}
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => { setTcPickerExpanded(new Set()); setTcPickerModuleIdx(idx); }}
                                        className="w-full py-2.5 text-xs text-neutral-400 hover:text-white border border-dashed border-neutral-700 hover:border-neutral-500 rounded-lg bg-transparent cursor-pointer transition-colors flex items-center justify-center gap-1.5 mt-2"
                                      >
                                        <Plus className="h-3.5 w-3.5" />
                                        Add Threshold Concept
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                <div className="grid grid-cols-2 gap-4">
                                  {Array.isArray(mod.topics) && mod.topics.length > 0 && (
                                    <div>
                                      <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">Topics</p>
                                      <div className="ml-2 space-y-1.5">
                                        {mod.topics.map((topic: string, tIdx: number) => {
                                          const topicName = stripLinks(typeof topic === "string" ? topic : (topic as any).title || (topic as any).name || JSON.stringify(topic));
                                          const entry = progressLookup.topic(topicName);
                                          const status = normaliseStatus(entry?.status);
                                          return (
                                            <div key={tIdx} className="flex items-start gap-2">
                                              {/* Matches the link's leading-5 so the dot centres on the first line. */}
                                              <span className="flex h-5 items-center"><ProgressDot status={status} /></span>
                                              <div className="min-w-0 flex-1">
                                                <button
                                                  type="button"
                                                  onClick={() => setAskTopic(topicName)}
                                                  className={`text-left text-xs leading-5 underline decoration-dotted decoration-neutral-600 underline-offset-4 transition-colors hover:text-white hover:decoration-neutral-300 ${status === "learned" ? "text-neutral-200" : "text-neutral-300"}`}
                                                >
                                                  {topicName}
                                                </button>
                                                {entry?.latest_summary && (
                                                  <p className="text-[11px] text-neutral-500 leading-relaxed mt-0.5">
                                                    {entry.latest_summary}
                                                  </p>
                                                )}
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
                                  {Array.isArray(mod.learning_objectives) && mod.learning_objectives.length > 0 && (
                                    <div>
                                      <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">Learning Objectives</p>
                                      <div className="ml-2 space-y-1.5">
                                        {mod.learning_objectives.map((obj: string, oIdx: number) => (
                                          <div key={oIdx} className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-emerald-500/50 border border-emerald-400/40 flex-shrink-0" />
                                            <span className="text-xs text-neutral-300">{stripLinks(obj)}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                                )}
                                {mod.prerequisites && mod.prerequisites.length > 0 && (
                                  <div className="flex flex-col gap-1.5 pt-3 mt-1 border-t border-neutral-800/40">
                                    <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">Prerequisites</span>
                                    <div className="flex flex-wrap gap-2">
                                      {mod.prerequisites.map((prereq: string, pIdx: number) => {
                                        const cleaned = stripLinks(prereq).toLowerCase();
                                        const isLinked = syllabusData?.syllabus?.some((m: any) => {
                                          const t = stripLinks(m.title || m.module || m.name || "").toLowerCase();
                                          return t === cleaned || t.includes(cleaned) || cleaned.includes(t);
                                        });
                                        return (
                                          <span
                                            key={pIdx}
                                            onClick={isLinked ? () => handlePrereqClick(prereq) : undefined}
                                            className={`inline-flex items-center px-3 py-1.5 rounded-lg text-[11px] shadow-sm shadow-black/15 ${
                                              isLinked
                                                ? "text-blue-300 bg-neutral-800 hover:bg-neutral-700 cursor-pointer transition-colors"
                                                : "text-neutral-100 bg-neutral-800"
                                            }`}
                                          >
                                            {stripModulePrefix(stripLinks(prereq))}
                                          </span>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                                {!isEditingCurriculum && (() => {
                                  const modId = mod.module_id || "";
                                  const modTitle = stripLinks(mod.title || mod.module || mod.name || "").toLowerCase();
                                  const matchingTCs = (syllabusData?.all_threshold_concepts || []).filter((tcName: string) => {
                                    const tc = syllabusData[tcName];
                                    // Primary: match by module_id
                                    if (modId && tc?.related_modules?.includes(modId)) return true;
                                    // Fallback: match by title string
                                    if (modTitle.length <= 3) return false;
                                    return tc?.related_chapters?.some((ch: string) => {
                                      const c = stripLinks(ch).toLowerCase();
                                      return c === modTitle || c.includes(modTitle) || modTitle.includes(c);
                                    });
                                  });
                                  if (matchingTCs.length === 0) return null;
                                  return (
                                    <div className="flex flex-col gap-1.5 pt-3 mt-1 border-t border-neutral-800/40">
                                      <span className="text-[10px] font-semibold text-amber-400/70 uppercase tracking-wider">Threshold Concepts</span>
                                      <div className="flex flex-wrap gap-2">
                                        {matchingTCs.map((tcName: string, tcIdx: number) => (
                                          <span
                                            key={tcIdx}
                                            onClick={() => {
                                              setSyllabusTab("concepts");
                                              const cIdx = syllabusData.all_threshold_concepts.indexOf(tcName);
                                              if (cIdx >= 0) {
                                                setExpandedConcepts(prev => new Set(prev).add(cIdx));
                                                setTimeout(() => {
                                                  const el = document.getElementById(`threshold-concept-${cIdx}`);
                                                  if (el) {
                                                    el.scrollIntoView({ behavior: "smooth", block: "center" });
                                                    el.style.outline = "2px solid rgba(251, 191, 36, 0.6)";
                                                    el.style.outlineOffset = "-2px";
                                                    setTimeout(() => { el.style.outline = ""; el.style.outlineOffset = ""; }, 1500);
                                                  }
                                                }, 200);
                                              }
                                            }}
                                            className="inline-flex items-center px-3 py-1.5 rounded-lg text-[11px] text-amber-300 bg-neutral-800 hover:bg-neutral-700 cursor-pointer transition-colors shadow-sm shadow-black/15"
                                          >
                                            {stripLinks(tcName)}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  );
                                })()}
                              </div>
                            )}
                          </div>
                        ))}
                        {isEditingCurriculum && (
                          <button
                            onClick={() => {
                              const updated = { ...editedSyllabusData };
                              updated.syllabus = [...(updated.syllabus || []), { title: "New Module", topics: [], learning_objectives: [] }];
                              setEditedSyllabusData(updated);
                            }}
                            className="w-full py-2.5 text-xs text-neutral-400 hover:text-white border border-dashed border-neutral-700 hover:border-neutral-500 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Add Module
                          </button>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-neutral-500 text-center py-8">No modules available in the course curriculum.</p>
                    )}
                  </div>
                )}

                {syllabusTab === "concepts" && (
                  <div className="space-y-3">
                    <div className="mb-4">
                      <h3 className="text-base font-semibold text-neutral-100">Threshold Concepts</h3>
                      <p className="text-xs text-neutral-500 mt-1">Concepts that are transformative, troublesome, irreversible, integrative, and bounded — once understood, they fundamentally change how a learner perceives the subject.</p>
                    </div>
                    {(() => {
                      const data = isEditingCurriculum ? editedSyllabusData : syllabusData;
                      const tcList = data?.all_threshold_concepts || [];
                      return tcList.length > 0 ? (
                      <div className="space-y-2">
                        {tcList.map((tcName: string, idx: number) => {
                          const tc = data[tcName] || {};
                          const conceptProgress = progressLookup.concept(tcName);
                          const conceptStatus = normaliseStatus(conceptProgress?.status);
                          const addressed = new Set(
                            (conceptProgress?.misconceptions_addressed || []).map((m) => m.trim().toLowerCase()),
                          );
                          return (
                          <div key={idx} id={`threshold-concept-${idx}`} className="rounded-lg border border-neutral-800 overflow-hidden">
                            <button
                              className="w-full flex items-center justify-between px-4 py-3 hover:bg-neutral-800/60 transition-colors text-left"
                              onClick={() => toggleConcept(idx)}
                            >
                              <div className="flex-1 min-w-0">
                                <span className="text-sm font-medium text-neutral-200 flex items-center gap-2">
                                  <span className="text-sm text-neutral-500 font-mono w-6">{idx + 1}.</span>
                                  {isEditingCurriculum ? (
                                    <input
                                      type="text"
                                      value={tcName}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => {
                                        const updated = { ...editedSyllabusData };
                                        const oldName = updated.all_threshold_concepts[idx];
                                        const newName = e.target.value;
                                        updated.all_threshold_concepts = [...updated.all_threshold_concepts];
                                        updated.all_threshold_concepts[idx] = newName;
                                        if (updated[oldName]) {
                                          updated[newName] = updated[oldName];
                                          delete updated[oldName];
                                        }
                                        setEditedSyllabusData(updated);
                                      }}
                                      className="bg-neutral-800 border border-neutral-700 rounded px-2 py-0.5 text-sm text-neutral-200 w-full focus:outline-none focus:border-blue-500"
                                    />
                                  ) : (
                                    stripLinks(tcName)
                                  )}
                                </span>
                                {!isEditingCurriculum && (tc.definition || tc.description) && !expandedConcepts.has(idx) && (
                                  <p className="text-xs text-neutral-500 mt-1 ml-8 line-clamp-1">{tc.definition || tc.description}</p>
                                )}
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                {!isEditingCurriculum && (
                                  <div className="flex flex-col items-end gap-1">
                                    {/* The card header is itself a button, so this cannot be one too. */}
                                    <span
                                      role="button"
                                      tabIndex={0}
                                      onClick={(e) => { e.stopPropagation(); setAskTopic(stripLinks(tcName)); }}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          setAskTopic(stripLinks(tcName));
                                        }
                                      }}
                                      className="rounded-md border border-neutral-700 px-2 py-0.5 text-[11px] font-medium text-neutral-300 transition-colors hover:border-neutral-500 hover:bg-neutral-800 hover:text-white"
                                    >
                                      Ask TA
                                    </span>
                                    <ProgressBadge status={conceptStatus} />
                                  </div>
                                )}
                                {isEditingCurriculum && (
                                  <span
                                    role="button"
                                    onClick={(e) => { e.stopPropagation(); const updated = { ...editedSyllabusData }; const removedName = updated.all_threshold_concepts[idx]; updated.all_threshold_concepts = updated.all_threshold_concepts.filter((_: any, i: number) => i !== idx); delete updated[removedName]; setEditedSyllabusData(updated); }}
                                    className="p-1 rounded hover:bg-red-900/30 text-neutral-600 hover:text-red-400 transition-colors"
                                    title="Remove threshold concept"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </span>
                                )}
                                {expandedConcepts.has(idx) ? (
                                  <ChevronDown className="h-4 w-4 text-neutral-500" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 text-neutral-500" />
                                )}
                              </div>
                            </button>
                            {expandedConcepts.has(idx) && (
                              <div className="px-4 pb-4 pt-2 border-t border-neutral-800/60 space-y-3">
                                {isEditingCurriculum ? (
                                  <div className="space-y-3">
                                    <div>
                                      <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">Definition</p>
                                      <textarea
                                        value={tc.definition || tc.description || ""}
                                        onChange={(e) => {
                                          const updated = { ...editedSyllabusData };
                                          const currentTcName = updated.all_threshold_concepts[idx];
                                          updated[currentTcName] = { ...updated[currentTcName], definition: e.target.value, description: e.target.value };
                                          setEditedSyllabusData(updated);
                                        }}
                                        className="w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-2 text-xs text-neutral-300 focus:outline-none focus:border-blue-500 min-h-[60px] resize-y"
                                      />
                                    </div>
                                    <div>
                                      <p className="text-xs font-semibold text-red-400/70 uppercase tracking-wider mb-1.5">Misconceptions</p>
                                      <div className="space-y-1.5">
                                        {(tc.misconceptions || []).map((m: any, mIdx: number) => {
                                          const mText = typeof m === "string" ? m : m.misconception || m.description || "";
                                          return (
                                            <div key={mIdx} className="flex items-center justify-between px-4 py-2.5 rounded-lg border border-neutral-800 bg-neutral-900">
                                              <input
                                                type="text"
                                                value={mText}
                                                onChange={(e) => {
                                                  const updated = { ...editedSyllabusData };
                                                  const currentTcName = updated.all_threshold_concepts[idx];
                                                  const newMisconceptions = [...(updated[currentTcName].misconceptions || [])];
                                                  newMisconceptions[mIdx] = e.target.value;
                                                  updated[currentTcName] = { ...updated[currentTcName], misconceptions: newMisconceptions };
                                                  setEditedSyllabusData(updated);
                                                }}
                                                className="bg-blend flex-1 border-none text-xs text-neutral-300 placeholder:text-neutral-300 focus:outline-none outline-none shadow-none p-0"
                                                placeholder="Enter misconception..."
                                              />
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  const updated = { ...editedSyllabusData };
                                                  const currentTcName = updated.all_threshold_concepts[idx];
                                                  const newMisconceptions = [...(updated[currentTcName].misconceptions || [])];
                                                  newMisconceptions.splice(mIdx, 1);
                                                  updated[currentTcName] = { ...updated[currentTcName], misconceptions: newMisconceptions };
                                                  setEditedSyllabusData(updated);
                                                }}
                                                className="text-neutral-500 hover:text-red-400 transition-colors flex-shrink-0 ml-3"
                                              >
                                                <X className="h-3.5 w-3.5" />
                                              </button>
                                            </div>
                                          );
                                        })}
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setEditedSyllabusData((prev: any) => {
                                              const currentTcName = prev.all_threshold_concepts[idx];
                                              const existing = prev[currentTcName]?.misconceptions || [];
                                              if (existing.some((m: any) => !(typeof m === "string" ? m : m.misconception || m.description || "").trim())) return prev;
                                              const updated = JSON.parse(JSON.stringify(prev));
                                              updated[currentTcName].misconceptions = [...(updated[currentTcName].misconceptions || []), ""];
                                              return updated;
                                            });
                                          }}
                                          className="w-full py-2.5 text-xs text-neutral-400 hover:text-white border border-dashed border-neutral-700 hover:border-neutral-500 rounded-lg bg-transparent cursor-pointer transition-colors flex items-center justify-center gap-1.5"
                                        >
                                          <Plus className="h-3.5 w-3.5" />
                                          Add Misconception
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                {tc.description && (
                                  <p className="text-xs text-neutral-400 leading-relaxed">{tc.description}</p>
                                )}
                                {conceptProgress?.latest_summary && (
                                  <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2">
                                    <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1">What the tutor recorded</p>
                                    <p className="text-xs text-neutral-300 leading-relaxed">{conceptProgress.latest_summary}</p>
                                    {conceptProgress.last_updated && (
                                      <p className="text-[10px] text-neutral-600 mt-1">
                                        {new Date(conceptProgress.last_updated).toLocaleString()}
                                      </p>
                                    )}
                                  </div>
                                )}
                                {tc.misconceptions && tc.misconceptions.length > 0 && (
                                  <div>
                                    <p className="text-[10px] font-semibold text-red-400/70 uppercase tracking-wider mb-1.5">Common Misconceptions</p>
                                    <div className="space-y-1.5">
                                      {tc.misconceptions.map((m: any, mIdx: number) => {
                                        const mText = typeof m === "string" ? m : m.misconception || m.description || JSON.stringify(m);
                                        const isAddressed = addressed.has(String(mText).trim().toLowerCase());
                                        const note = conceptProgress?.misconception_notes?.[mText]?.note;
                                        return (
                                          <div key={mIdx} className="flex items-start gap-2">
                                            <span className="mt-1">
                                              <ProgressDot status={isAddressed ? "learned" : "not_started"} />
                                            </span>
                                            <div className="min-w-0">
                                              <span className={`text-xs ${isAddressed ? "text-neutral-300 line-through decoration-neutral-600" : "text-neutral-400"}`}>
                                                {mText}
                                              </span>
                                              {isAddressed && note && (
                                                <p className="text-[11px] text-emerald-300/70 leading-relaxed mt-0.5 no-underline">
                                                  {note}
                                                </p>
                                              )}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                          );
                        })}
                        {curriculumStatus === "processing" && (
                          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-blue-950/30 border border-blue-900/30 mt-3">
                            <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin flex-shrink-0" />
                            <p className="text-xs text-blue-400">More threshold concepts are being generated...</p>
                          </div>
                        )}
                        {isEditingCurriculum && (
                          <button
                            onClick={() => {
                              const updated = { ...editedSyllabusData };
                              const newName = `New Threshold Concept ${(updated.all_threshold_concepts?.length || 0) + 1}`;
                              updated.all_threshold_concepts = [...(updated.all_threshold_concepts || []), newName];
                              updated[newName] = { definition: "", description: "", misconceptions: [] };
                              setEditedSyllabusData(updated);
                            }}
                            className="w-full py-2.5 text-xs text-neutral-400 hover:text-white border border-dashed border-neutral-700 hover:border-neutral-500 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Add Threshold Concept
                          </button>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-neutral-500 text-center py-8">
                        {curriculumStatus === "processing"
                          ? "Threshold concepts are still being generated..."
                          : "No threshold concepts available in the course curriculum."
                        }
                      </p>
                    );
                    })()}
                  </div>
                )}
                {syllabusTab === "history" && (
                  <div className="space-y-3">
                    <div className="mb-4">
                      <h3 className="text-base font-semibold text-neutral-100">Version Control</h3>
                      <p className="text-xs text-neutral-500 mt-1">Previous saves of the course curriculum.</p>
                    </div>
                    {versionsLoading ? (
                      <div className="flex flex-col items-center justify-center py-12 gap-3">
                        <Loader2 className="h-6 w-6 animate-spin text-neutral-500" />
                        <p className="text-xs text-neutral-500">Loading versions...</p>
                      </div>
                    ) : curriculumVersions.length > 0 ? (
                      <div className="space-y-2">
                        {curriculumVersions.map((v, idx) => (
                          <button
                            key={v.version_id}
                            onClick={async () => {
                              if (!effectiveAgentId) return;
                              setSelectedVersionLoading(true);
                              setPreviousVersionData(null);
                              try {
                                const res = await getCurriculumVersion(effectiveAgentId, v.version_id);
                                setSelectedVersion({ ...v, data: res.version });
                                // Load previous version (next in list) for diff
                                const prevVersion = curriculumVersions[idx + 1];
                                if (prevVersion) {
                                  const prevRes = await getCurriculumVersion(effectiveAgentId, prevVersion.version_id);
                                  setPreviousVersionData(prevRes.version);
                                } else {
                                  setPreviousVersionData(null);
                                }
                              } catch { toast.error("Failed to load version"); }
                              finally { setSelectedVersionLoading(false); }
                            }}
                            className="w-full text-left rounded-lg border border-neutral-800 px-4 py-3 hover:bg-neutral-800/60 transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-white font-mono font-semibold flex-shrink-0">v{curriculumVersions.length - idx}</span>
                              <span className="text-sm text-neutral-200 italic truncate">{v.commit_message || "No message"}</span>
                            </div>
                            <div className="flex items-center gap-3 mt-1.5">
                              <span className="text-[11px] text-neutral-500">{new Date(v.saved_at).toLocaleString()}</span>
                              <span className="text-[11px] text-neutral-600">by {v.saved_by === "system" ? "System" : v.saved_by}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-neutral-500 text-center py-8">No version history yet. Save the curriculum to create the first version.</p>
                    )}
                    {/* Selected version modal */}
                    {(selectedVersionLoading || selectedVersion) && createPortal(
                      <div className="fixed inset-0 z-[9999] flex items-center justify-center">
                        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { setSelectedVersion(null); setPreviousVersionData(null); }} />
                        <div className="relative w-full max-w-lg max-h-[80vh] flex flex-col rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                          {selectedVersionLoading ? (
                            <div className="flex flex-col items-center justify-center py-12 gap-3 p-6">
                              <Loader2 className="h-6 w-6 animate-spin text-neutral-500" />
                              <p className="text-xs text-neutral-500">Loading version...</p>
                            </div>
                          ) : selectedVersion && (() => {
                      const vData = selectedVersion.data?.curriculum || selectedVersion.data || {};
                      const pData = previousVersionData?.curriculum || previousVersionData || {};
                      const vSyllabus: any[] = vData.syllabus || [];
                      const pSyllabus: any[] = pData.syllabus || [];
                      const getModName = (m: any) => m.title || m.module || m.name || "";
                      const getTopics = (m: any) => (m.topics || []).map((t: any) => typeof t === "string" ? t : t.name || t.topic || "");
                      const getLOs = (m: any) => (m.learning_objectives || m.learningObjectives || []).map((lo: any) => typeof lo === "string" ? lo : lo.name || lo.objective || "");
                      const getModTCs = (m: any, data: any) => {
                        // First check per-module field
                        if (m.threshold_concepts?.length || m.thresholdConcepts?.length) {
                          return (m.threshold_concepts || m.thresholdConcepts || []).map((tc: any) => typeof tc === "string" ? tc : tc.name || tc.concept || "");
                        }
                        // Otherwise map from top-level all_threshold_concepts via related_modules/related_chapters
                        const allTCs: string[] = data.all_threshold_concepts || [];
                        const modTitle = getModName(m).replace(/^Module\s+\d+:\s*/i, "").trim().toLowerCase();
                        const modId = m.module_id || "";
                        return allTCs.filter((tcName: string) => {
                          const tc = data[tcName] || {};
                          if (modId && tc.related_modules?.includes(modId)) return true;
                          if (modTitle.length > 3 && tc.related_chapters?.some((ch: string) => {
                            const c = ch.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").toLowerCase();
                            return c === modTitle || c.includes(modTitle) || modTitle.includes(c);
                          })) return true;
                          return false;
                        });
                      };
                      const pModNames = pSyllabus.map(getModName);
                      const vModNames = vSyllabus.map(getModName);
                      const vTCs: string[] = vData.all_threshold_concepts || [];
                      const pTCs: string[] = pData.all_threshold_concepts || [];

                      // Combine: current modules + removed modules (that were in prev but not current)
                      const removedMods = pSyllabus.filter((m: any) => !vModNames.includes(getModName(m)));

                      return (
                        <>
                          {/* Sticky header */}
                          <div className="sticky top-0 z-10 bg-neutral-900 px-6 pt-4 pb-0 space-y-1 border-b border-neutral-800 rounded-t-xl">
                            <div className="flex items-center justify-between">
                              <p className="text-sm font-medium text-neutral-200">"{selectedVersion.commit_message}"</p>
                              <div className="flex items-center gap-2">
                                {useUserStore.getState().role !== "student" && (
                                  <button
                                    onClick={() => {
                                      const curriculum = selectedVersion.data?.curriculum || selectedVersion.data;
                                      setEditedSyllabusData(JSON.parse(JSON.stringify(curriculum)));
                                      setIsEditingCurriculum(true);
                                      setSyllabusTab("modules");
                                      setSelectedVersion(null);
                                      toast.success("Version loaded into editor \u2014 save to apply.");
                                    }}
                                    className="h-7 px-3 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors"
                                  >
                                    Restore
                                  </button>
                                )}
                                <button
                                  onClick={() => { setSelectedVersion(null); setPreviousVersionData(null); setVersionExpandedMods(new Set()); setVersionModalTab("modules"); }}
                                  className="h-7 w-7 flex items-center justify-center text-neutral-400 hover:text-white border border-neutral-600 rounded-lg bg-neutral-800 hover:bg-neutral-700 transition-colors"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                            <div className="flex items-center gap-3 text-[11px] text-neutral-500">
                              <span>v{curriculumVersions.findIndex((cv) => cv.version_id === selectedVersion.version_id) >= 0 ? curriculumVersions.length - curriculumVersions.findIndex((cv) => cv.version_id === selectedVersion.version_id) : "?"}</span>
                              <span>{new Date(selectedVersion.saved_at).toLocaleString()}</span>
                              <span>by {selectedVersion.saved_by}</span>
                            </div>
                            {/* Tabs */}
                            <div className="flex gap-1">
                              <button
                                onClick={() => setVersionModalTab("modules")}
                                className={`px-4 py-2 text-sm font-medium transition-colors relative ${versionModalTab === "modules" ? "text-white" : "text-neutral-500 hover:text-neutral-300"}`}
                              >
                                Syllabus
                                {versionModalTab === "modules" && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white rounded-full" />}
                              </button>
                              <button
                                onClick={() => setVersionModalTab("concepts")}
                                className={`px-4 py-2 text-sm font-medium transition-colors relative ${versionModalTab === "concepts" ? "text-white" : "text-neutral-500 hover:text-neutral-300"}`}
                              >
                                Threshold Concepts
                                {versionModalTab === "concepts" && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white rounded-full" />}
                              </button>
                            </div>
                          </div>

                          {/* Scrollable content */}
                          <div className="overflow-y-auto flex-1 px-6 py-4" style={{ scrollbarWidth: "none" }}>
                          {/* Syllabus tab */}
                          {versionModalTab === "modules" && (
                            <div className="space-y-2">
                              {vData.course_name && (
                                <div className="mb-3">
                                  <h3 className="text-base font-semibold text-neutral-200">{vData.course_name}</h3>
                                  {vData.course_level && <p className="text-xs text-neutral-500 mt-0.5">Level: {vData.course_level}</p>}
                                </div>
                              )}
                              {/* Current modules */}
                              {vSyllabus.map((mod: any, i: number) => {
                                const modName = getModName(mod);
                                const isNew = !pModNames.includes(modName);
                                const pMod = pSyllabus.find((pm: any) => getModName(pm) === modName);
                                const currentTopics = getTopics(mod);
                                const prevTopics = pMod ? getTopics(pMod) : [];
                                const currentLOs = getLOs(mod);
                                const prevLOs = pMod ? getLOs(pMod) : [];
                                const currentModTCs = getModTCs(mod, vData);
                                const prevModTCs = pMod ? getModTCs(pMod, pData) : [];
                                const isExpanded = versionExpandedMods.has(i);
                                const hasAdded = isNew || currentTopics.some((t: string) => !prevTopics.includes(t)) || currentLOs.some((lo: string) => !prevLOs.includes(lo)) || currentModTCs.some((tc: string) => !prevModTCs.includes(tc));
                                const hasRemoved = !isNew && (prevTopics.some((t: string) => !currentTopics.includes(t)) || prevLOs.some((lo: string) => !currentLOs.includes(lo)) || prevModTCs.some((tc: string) => !currentModTCs.includes(tc)));
                                const borderClass = hasAdded ? "border-green-700/50" : hasRemoved ? "border-red-700/40" : "border-neutral-800";
                                return (
                                  <div key={i} className={`rounded-lg border overflow-hidden ${borderClass}`}>
                                    <button
                                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-neutral-800/60 transition-colors text-left"
                                      onClick={() => setVersionExpandedMods(prev => { const next = new Set(prev); if (next.has(i)) next.delete(i); else next.add(i); return next; })}
                                    >
                                      <span className="text-sm font-medium flex items-center gap-2 text-neutral-200">
                                        <span className="text-sm text-neutral-500 font-mono w-6">{i + 1}.</span>
                                        {modName}
                                      </span>
                                      {isExpanded ? <ChevronDown className="h-4 w-4 text-neutral-500" /> : <ChevronRight className="h-4 w-4 text-neutral-500" />}
                                    </button>
                                    {isExpanded && (
                                      <div className="px-4 pb-4 pt-2 border-t border-neutral-800/60 space-y-1.5">
                                        <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">Topics</p>
                                        {/* Topics in this version */}
                                        {currentTopics.map((t: string, ti: number) => {
                                          const isAdded = !prevTopics.includes(t);
                                          return (
                                            <div key={ti} className="flex items-center gap-2">
                                              <div className={`w-2 h-2 rounded-full flex-shrink-0 ml-0.5 ${isAdded ? "bg-green-500/80 border border-green-400/50" : "bg-neutral-600/80 border border-neutral-500/50"}`} />
                                              <span className={`text-xs ${isAdded ? "text-green-300" : "text-neutral-300"}`}>{t}</span>
                                            </div>
                                          );
                                        })}
                                        {/* Removed topics (in prev but not current) */}
                                        {prevTopics.filter((t: string) => !currentTopics.includes(t)).map((t: string, ti: number) => (
                                          <div key={`rm-${ti}`} className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-red-500/80 border border-red-400/50 flex-shrink-0 ml-0.5" />
                                            <span className="text-xs text-red-400 line-through">{t}</span>
                                          </div>
                                        ))}
                                        {/* Learning Objectives */}
                                        {currentLOs.length > 0 && (
                                          <>
                                            <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1.5 mt-3">Learning Objectives</p>
                                            {currentLOs.map((lo: string, li: number) => {
                                              const isAddedLO = !prevLOs.includes(lo);
                                              return (
                                                <div key={`lo-${li}`} className="flex items-center gap-2">
                                                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ml-0.5 ${isAddedLO ? "bg-green-500/80 border border-green-400/50" : "bg-neutral-600/80 border border-neutral-500/50"}`} />
                                                  <span className={`text-xs ${isAddedLO ? "text-green-300" : "text-neutral-300"}`}>{lo}</span>
                                                </div>
                                              );
                                            })}
                                            {prevLOs.filter((lo: string) => !currentLOs.includes(lo)).map((lo: string, li: number) => (
                                              <div key={`rm-lo-${li}`} className="flex items-center gap-2">
                                                <div className="w-2 h-2 rounded-full bg-red-500/80 border border-red-400/50 flex-shrink-0 ml-0.5" />
                                                <span className="text-xs text-red-400 line-through">{lo}</span>
                                              </div>
                                            ))}
                                          </>
                                        )}
                                        {/* Threshold Concepts */}
                                        {(currentModTCs.length > 0 || prevModTCs.filter((tc: string) => !currentModTCs.includes(tc)).length > 0) && (
                                          <>
                                            <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1.5 mt-3">Threshold Concepts</p>
                                            {currentModTCs.map((tc: string, tci: number) => {
                                              const isAddedTC = !prevModTCs.includes(tc);
                                              return (
                                                <div key={`tc-${tci}`} className="flex items-center gap-2">
                                                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ml-0.5 ${isAddedTC ? "bg-green-500/80 border border-green-400/50" : "bg-neutral-600/80 border border-neutral-500/50"}`} />
                                                  <span className={`text-xs ${isAddedTC ? "text-green-300" : "text-neutral-300"}`}>{tc}</span>
                                                </div>
                                              );
                                            })}
                                            {prevModTCs.filter((tc: string) => !currentModTCs.includes(tc)).map((tc: string, tci: number) => (
                                              <div key={`rm-tc-${tci}`} className="flex items-center gap-2">
                                                <div className="w-2 h-2 rounded-full bg-red-500/80 border border-red-400/50 flex-shrink-0 ml-0.5" />
                                                <span className="text-xs text-red-400 line-through">{tc}</span>
                                              </div>
                                            ))}
                                          </>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                              {/* Removed modules */}
                              {removedMods.map((mod: any, i: number) => (
                                <div key={`rm-${i}`} className="rounded-lg border border-red-700/40 overflow-hidden">
                                  <button
                                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-neutral-800/60 transition-colors text-left"
                                    onClick={() => setVersionExpandedMods(prev => { const next = new Set(prev); const key = 1000 + i; if (next.has(key)) next.delete(key); else next.add(key); return next; })}
                                  >
                                    <span className="text-sm font-medium text-red-400 flex items-center gap-2">
                                      <span className="text-sm text-red-400 font-mono w-6">{i + 1}.</span>
                                      {getModName(mod)}
                                    </span>
                                    {versionExpandedMods.has(1000 + i) ? <ChevronDown className="h-4 w-4 text-neutral-500" /> : <ChevronRight className="h-4 w-4 text-neutral-500" />}
                                  </button>
                                  {versionExpandedMods.has(1000 + i) && (
                                    <div className="px-4 pb-4 pt-2 border-t border-neutral-800/60 space-y-1.5">
                                      <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">Topics (removed)</p>
                                      {getTopics(mod).map((t: string, ti: number) => (
                                        <div key={ti} className="flex items-center gap-2">
                                          <div className="w-2 h-2 rounded-full bg-red-500/80 border border-red-400/50 flex-shrink-0 ml-0.5" />
                                          <span className="text-xs text-red-400">{t}</span>
                                        </div>
                                      ))}
                                      {getLOs(mod).length > 0 && (
                                        <>
                                          <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1.5 mt-3">Learning Objectives (removed)</p>
                                          {getLOs(mod).map((lo: string, li: number) => (
                                            <div key={`lo-${li}`} className="flex items-center gap-2">
                                              <div className="w-2 h-2 rounded-full bg-red-500/80 border border-red-400/50 flex-shrink-0 ml-0.5" />
                                              <span className="text-xs text-red-400">{lo}</span>
                                            </div>
                                          ))}
                                        </>
                                      )}
                                      {getModTCs(mod, pData).length > 0 && (
                                        <>
                                          <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1.5 mt-3">Threshold Concepts (removed)</p>
                                          {getModTCs(mod, pData).map((tc: string, tci: number) => (
                                            <div key={`tc-${tci}`} className="flex items-center gap-2">
                                              <div className="w-2 h-2 rounded-full bg-red-500/80 border border-red-400/50 flex-shrink-0 ml-0.5" />
                                              <span className="text-xs text-red-400">{tc}</span>
                                            </div>
                                          ))}
                                        </>
                                      )}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Threshold Concepts tab */}
                          {versionModalTab === "concepts" && (
                            <div className="space-y-2">
                              {vTCs.map((tcName: string, i: number) => {
                                const isAdded = !pTCs.includes(tcName);
                                const tcDetails = vData[tcName] || {};
                                const isExpanded = versionExpandedMods.has(2000 + i);
                                return (
                                  <div key={i} className={`rounded-lg border overflow-hidden ${isAdded ? "border-green-700/50" : "border-neutral-800"}`}>
                                    <button
                                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-neutral-800/60 transition-colors text-left"
                                      onClick={() => setVersionExpandedMods(prev => { const next = new Set(prev); const key = 2000 + i; if (next.has(key)) next.delete(key); else next.add(key); return next; })}
                                    >
                                      <span className="text-sm font-medium flex items-center gap-2 text-neutral-200">
                                        <span className="text-sm text-neutral-500 font-mono w-6">{i + 1}.</span>
                                        {tcName}
                                      </span>
                                      {isExpanded ? <ChevronDown className="h-4 w-4 text-neutral-500" /> : <ChevronRight className="h-4 w-4 text-neutral-500" />}
                                    </button>
                                    {isExpanded && (
                                      <div className="px-4 pb-4 pt-2 border-t border-neutral-800/60 space-y-3">
                                        {tcDetails.description && (
                                          <p className="text-xs text-neutral-400 leading-relaxed">{tcDetails.description}</p>
                                        )}
                                        {(tcDetails.misconceptions || tcDetails.common_misconceptions)?.length > 0 && (
                                          <div>
                                            <p className="text-[10px] font-semibold text-red-400/70 uppercase tracking-wider mb-1.5">Common Misconceptions</p>
                                            <div className="space-y-1.5">
                                              {(tcDetails.misconceptions || tcDetails.common_misconceptions).map((m: any, mi: number) => (
                                                <div key={mi} className="flex items-center gap-2">
                                                  <div className="w-2 h-2 rounded-full bg-neutral-600/80 border border-neutral-500/50 flex-shrink-0" />
                                                  <span className="text-xs text-neutral-400">
                                                    {typeof m === "string" ? m : m.misconception || m.description || JSON.stringify(m)}
                                                  </span>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        )}
                                        {!tcDetails.description && !(tcDetails.misconceptions || tcDetails.common_misconceptions)?.length && (
                                          <p className="text-xs text-neutral-500 italic">No details available for this concept.</p>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                              {/* Removed TCs */}
                              {pTCs.filter((t: string) => !vTCs.includes(t)).map((tcName: string, i: number) => {
                                const tcDetails = pData[tcName] || {};
                                const isExpanded = versionExpandedMods.has(3000 + i);
                                return (
                                  <div key={`rm-${i}`} className="rounded-lg border border-red-700/40 overflow-hidden">
                                    <button
                                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-neutral-800/60 transition-colors text-left"
                                      onClick={() => setVersionExpandedMods(prev => { const next = new Set(prev); const key = 3000 + i; if (next.has(key)) next.delete(key); else next.add(key); return next; })}
                                    >
                                      <span className="text-sm font-medium text-red-400 flex items-center gap-2">
                                        <span className="text-sm text-red-400 font-mono w-6">{i + 1}.</span>
                                        {tcName}
                                      </span>
                                      {isExpanded ? <ChevronDown className="h-4 w-4 text-neutral-500" /> : <ChevronRight className="h-4 w-4 text-neutral-500" />}
                                    </button>
                                    {isExpanded && (
                                      <div className="px-4 pb-4 pt-2 border-t border-neutral-800/60 space-y-3">
                                        {tcDetails.description && (
                                          <p className="text-xs text-red-300/80 leading-relaxed">{tcDetails.description}</p>
                                        )}
                                        {(tcDetails.misconceptions || tcDetails.common_misconceptions)?.length > 0 && (
                                          <div>
                                            <p className="text-[10px] font-semibold text-red-400/70 uppercase tracking-wider mb-1.5">Common Misconceptions</p>
                                            <div className="space-y-1.5">
                                              {(tcDetails.misconceptions || tcDetails.common_misconceptions).map((m: any, mi: number) => (
                                                <div key={mi} className="flex items-center gap-2">
                                                  <div className="w-2 h-2 rounded-full bg-red-600/60 border border-red-500/50 flex-shrink-0" />
                                                  <span className="text-xs text-red-300/80">
                                                    {typeof m === "string" ? m : m.misconception || m.description || JSON.stringify(m)}
                                                  </span>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        )}
                                        {!tcDetails.description && !(tcDetails.misconceptions || tcDetails.common_misconceptions)?.length && (
                                          <p className="text-xs text-neutral-500 italic">No details available for this concept.</p>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          </div>
                        </>
                      );
                    })()}
                        </div>
                      </div>,
                      document.body
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                <GraduationCap className="h-10 w-10 text-neutral-700" />
                <p className="text-sm text-neutral-500">{syllabusStatus || "No course curriculum available."}</p>
                <p className="text-xs text-neutral-600 max-w-sm">
                  Course curriculum is generated automatically when you create an agent with textbooks.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
      </div>

      {/* Ask-the-assistant confirmation for a curriculum topic */}
      {askTopic && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150"
          onClick={() => setAskTopic(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ask-topic-title"
            className="w-full max-w-md overflow-hidden rounded-2xl border border-neutral-700/60 bg-neutral-900 shadow-2xl animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 pt-6 pb-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 id="ask-topic-title" className="text-base font-semibold text-neutral-100">
                    Start this topic?
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-neutral-500">
                    Your assistant will pick this up and guide you through it.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setAskTopic(null)}
                  aria-label="Close"
                  className="-mr-1.5 -mt-1 shrink-0 rounded-lg p-1.5 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-4 rounded-xl border border-neutral-800 bg-neutral-950/70 px-4 py-3 text-sm font-medium text-neutral-200">
                {askTopic}
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-neutral-800 bg-neutral-950/40 px-6 py-4">
              <button
                type="button"
                onClick={() => setAskTopic(null)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const topic = askTopic;
                  setAskTopic(null);
                  setSyllabusOpen(false);
                  handleSend(undefined, `Teach me about "${topic}".`);
                }}
                className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-neutral-200"
              >
                Ask TA
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TA Code Dialog */}
      <Dialog open={showManageAgent} onOpenChange={setShowManageAgent}>
        <DialogContent className="bg-neutral-900 border-neutral-800 sm:max-w-[380px] p-0 overflow-hidden">
          <div className="px-5 pt-5 pb-0">
            <DialogHeader>
              <DialogTitle className="text-neutral-100 text-lg">TA Code</DialogTitle>
              <DialogDescription className="text-neutral-500 text-sm">
                {chatCourseName}
              </DialogDescription>
            </DialogHeader>
          </div>

          {/* Code Section */}
          {(isMyAgent || useUserStore.getState().role === "admin") && (
            <div className="mx-5 mb-4 rounded-xl bg-neutral-800/30 border border-neutral-700/40 p-3">
              {manageCodeLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-neutral-500" />
                </div>
              ) : revealedManageCode ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-center gap-2">
                    {revealedManageCode.split("").map((char, i) => (
                      <span key={i} className="w-10 h-12 flex items-center justify-center rounded-lg bg-neutral-900/80 border border-neutral-600/50 text-xl font-mono font-bold text-white shadow-sm">{char}</span>
                    ))}
                  </div>
                  <p className="text-[11px] text-neutral-500 text-center leading-relaxed">Share this code with other teachers to give them full access to this teaching assistant.</p>
                  <button
                    className="w-full py-2 text-xs font-medium text-neutral-300 hover:text-white bg-neutral-700/40 hover:bg-neutral-700/70 border border-neutral-600/30 rounded-lg transition-all duration-200"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(revealedManageCode);
                        toast.success("TA code copied!");
                      } catch {
                        toast.error("Failed to copy");
                      }
                    }}
                  >
                    <Copy className="inline h-3.5 w-3.5 mr-1.5 -mt-0.5" />
                    Copy Code
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Manage Code Verify Dialog – gate before delete */}
      <ManageCodeVerifyDialog
        open={showManageCodeVerify}
        onClose={() => setShowManageCodeVerify(false)}
        onVerified={() => {
          setShowManageCodeVerify(false);
          setShowDeleteConfirm(true);
        }}
        agentId={effectiveAgentId ?? ""}
        action="delete"
      />

      {/* Manage Code Reveal Dialog – for creator viewing the code */}
      {showManageCodeReveal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="relative w-full max-w-sm mx-4 rounded-2xl border border-neutral-700/50 bg-neutral-900 p-6 text-center space-y-5 shadow-2xl">
            <h2 className="text-lg font-semibold text-white">Agent Manage Code</h2>
            <p className="text-sm text-neutral-400">Share this code with other teachers who need to manage this agent.</p>
            <div className="flex items-center justify-center gap-1.5">
              {revealedManageCode.split("").map((char, i) => (
                <span key={i} className="w-9 h-11 flex items-center justify-center rounded-lg bg-neutral-800 border border-neutral-700 text-lg font-mono font-bold text-white">{char}</span>
              ))}
            </div>
            <button onClick={() => setShowManageCodeReveal(false)} className="w-full py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors">Close</button>
          </div>
        </div>
      )}

      {/* Commit Message Dialog — portaled to body to escape Radix Dialog focus trap */}
      {showCommitDialog && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60" style={{ pointerEvents: 'auto' }} onClick={() => setShowCommitDialog(false)}>
          <div className="bg-neutral-900 border border-neutral-700 rounded-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-neutral-100 mb-3">Save Curriculum</h3>
            <p className="text-xs text-neutral-400 mb-3">Enter a commit message describing your changes:</p>
            <input
              type="text"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && commitMessage.trim()) handleConfirmSave(); }}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-blue-500 placeholder:text-neutral-500"
              placeholder="e.g. Added Module 12, updated TCs..."
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowCommitDialog(false)}
                className="px-3 py-1.5 text-xs rounded-lg border border-neutral-700 text-neutral-400 hover:text-white hover:border-neutral-500 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSave}
                disabled={!commitMessage.trim()}
                className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Course Info Dialog */}
      <Dialog open={showInfoDialog} onOpenChange={setShowInfoDialog}>
        <DialogContent className="bg-neutral-900 border-neutral-800 sm:max-w-md p-0 gap-0 overflow-hidden [&>button]:top-2 [&>button]:right-3">
          {/* Separator line */}
          <div className="border-t border-neutral-800 mt-[2.75rem]" />

          {/* Scrollable content */}
          <div className="overflow-y-auto max-h-[70vh] px-6 pt-5 pb-5">
            {/* Graduation cap icon */}
            <div className="flex justify-center mb-5">
              <div className="w-20 h-20 rounded-2xl bg-neutral-800 border border-neutral-700 flex items-center justify-center">
                <GraduationCap className="w-10 h-10 text-neutral-300" />
              </div>
            </div>

            {/* Course name */}
            <h2 className="text-2xl font-bold text-white text-center mb-3">
              {chatCourseName || "Course Info"}
            </h2>

            {/* Description */}
            {(agentSetupInfo?.agentDescription || agentRow?.description) && (
              <p className="text-neutral-400 text-center text-sm leading-relaxed mb-2">
                {agentSetupInfo?.agentDescription || agentRow?.description}
              </p>
            )}

            {/* Course details */}
            {(() => {
              const teachers: string[] = agentRow?.teachers?.length
                ? agentRow.teachers
                : agentRow?.created_by
                  ? [agentRow.created_by]
                  : [];
              // "__none__" is the stored placeholder for an empty list.
              const prerequisites: string[] = (agentSetupInfo?.prerequisites || []).filter(
                (p: string) => p && !/^_*none_*$/i.test(p.trim()),
              );
              const rows: Array<[string, string]> = [
                ["Institution", agentRow?.institution || ""],
                ["Subject code", agentSetupInfo?.courseCode || agentRow?.course_code || ""],
                ["Degree", agentSetupInfo?.courseLevel || agentRow?.course_level || ""],
                ["Duration", agentSetupInfo?.courseDuration || ""],
                [teachers.length > 1 ? "Teachers" : "Teacher", teachers.join(", ")],
                ["Prerequisites", prerequisites.length ? prerequisites.join(", ") : "None"],
              ];
              const filled = rows.filter(([, value]) => value);
              if (filled.length === 0) return null;
              return (
                <div className="mt-4">
                  <h3 className="mb-2 text-sm font-semibold text-neutral-200">Course details</h3>
                  <div className="divide-y divide-neutral-800 rounded-xl border border-neutral-800">
                    {filled.map(([label, value]) => (
                      <div key={label} className="flex gap-3 px-3 py-2">
                        <span className="w-28 shrink-0 text-xs text-neutral-500">{label}</span>
                        <span className="min-w-0 flex-1 text-xs text-neutral-200">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Agent Confirmation Dialog */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="bg-neutral-900 border-neutral-800 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-neutral-100">Delete "{chatCourseName}"?</DialogTitle>
            <DialogDescription className="text-neutral-400">
              This will permanently delete the teaching assistant and all its data. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              className="px-4 py-2 rounded-lg text-sm font-medium text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
              onClick={() => setShowDeleteConfirm(false)}
              disabled={isDeleting}
            >
              Cancel
            </button>
            <button
              className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
              disabled={isDeleting}
              onClick={async () => {
                if (!effectiveAgentId) return;
                setIsDeleting(true);
                const toastId = toast.loading(`Deleting '${chatCourseName}'...`);
                try {
                  await deleteAzureAgent(effectiveAgentId);
                  const courseProject = Object.values(projects).find(p => p.agentId === effectiveAgentId);
                  if (courseProject) deleteProject(courseProject.id);
                  setCourseAgentId(null);
                  setCourseAgentName("");
                  toast.success(`Deleted '${chatCourseName}' successfully`, { id: toastId });
                  setShowDeleteConfirm(false);
                  navigate("/library");
                } catch (e: any) {
                  toast.error(`Failed to delete: ${e.message}`, { id: toastId });
                } finally {
                  setIsDeleting(false);
                }
              }}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* Share Chat Dialog */}
      <Dialog open={shareDialogOpen} onOpenChange={(open) => {
        setShareDialogOpen(open);
        if (!open) {
          setShareTokenValue(null);
          setShareCopied(false);
        }
      }}>
        <DialogContent className="bg-neutral-900 border-neutral-800 sm:max-w-md overflow-hidden [&>*]:min-w-0 gap-3 pb-5">
          <DialogHeader>
            <DialogTitle className="text-neutral-100 flex items-center gap-2">
              <Share2 className="h-4 w-4" />
              Share
            </DialogTitle>
            <DialogDescription className="text-neutral-400">
              Anyone with this link can view this chat (read-only).
            </DialogDescription>
          </DialogHeader>
          
          <div className="w-full overflow-hidden">
            {isSharing ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
              </div>
            ) : shareTokenValue ? (
              <div className="space-y-2.5 w-full overflow-hidden">
                <div className="p-3 bg-neutral-800 rounded-lg w-full overflow-hidden" style={{ maxWidth: '100%' }}>
                  <div className="flex items-center gap-2 overflow-hidden">
                    <LinkIcon className="h-4 w-4 text-neutral-400 flex-shrink-0" />
                    <span className="text-sm text-neutral-300 block overflow-hidden text-ellipsis whitespace-nowrap" style={{ maxWidth: 'calc(100% - 24px)' }}>
                      {window.location.origin}/shared/{shareTokenValue}
                    </span>
                  </div>
                </div>
                <button
                  onClick={handleCopyShareLink}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-neutral-200 text-black hover:bg-neutral-300 transition-colors"
                >
                  {shareCopied ? (
                    <>
                      <Check className="h-4 w-4" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" />
                      Copy Link
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div className="text-center py-4 text-neutral-400">
                Failed to create share link
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}