import React from "react";
import clsx from "clsx";
import {
  RotateCcw,
  Pencil,
  FileText,
  HelpCircle,
  Target,
  Copy,
  Check,
  ThumbsUp,
  ThumbsDown,
  MoreHorizontal,
  Download,
  Image as ImageIcon,
  X,
  CornerDownRight,
} from "lucide-react";
import Markdown from "@/components/common/Markdown";
import { Textarea } from "@/components/ui/textarea";
import { getBlobProxyUrl, isAzureBlobUrl } from "@/lib/api";
import type { ChatMsg as BaseChatMsg } from "@/lib/types";
import { useChatStore } from "@/lib/chatStore";
import { chatApi } from "@/lib/chatApi";
import { useUserStore } from "@/lib/userStore";
import QuizBlock from "./QuizBlock";
import FlashcardBlock from "./FlashcardBlock";
import ChallengeBlock from "./ChallengeBlock";
import ClarifyBlock from "./ClarifyBlock";
import SuggestedQueriesBlock from "./SuggestedQueriesBlock";

// Extend the base type with UI-specific fields
export type ChatMsg = BaseChatMsg & {
  createdAt?: number; // ms epoch timestamp
};

/**
 * Text tagged with "Ask TA" is sent as a leading markdown blockquote. User bubbles
 * render as plain text, so it is split back out and shown as its own tag above them.
 */
function splitTaggedQuote(content: string): { quote: string; body: string } {
  if (!content.startsWith(">")) return { quote: "", body: content };

  const lines = content.split("\n");
  const quoteLines: string[] = [];
  let i = 0;
  for (; i < lines.length && lines[i].startsWith(">"); i++) {
    quoteLines.push(lines[i].replace(/^>\s?/, ""));
  }
  while (i < lines.length && lines[i].trim() === "") i++;
  return { quote: quoteLines.join("\n"), body: lines.slice(i).join("\n") };
}

function QuoteTag({ text }: { text: string }) {
  return (
    <div className="mb-2 flex items-start gap-2.5 rounded-2xl border border-white/[0.07] bg-black/25 px-3.5 py-2.5">
      <CornerDownRight className="mt-[3px] h-4 w-4 shrink-0 text-neutral-500" />
      <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-neutral-200">
        {text}
      </p>
    </div>
  );
}

type ChatBubbleProps = ChatMsg & {
  agentId?: string;
  threadId?: string | null;
  showUserActions?: boolean;
  hideActions?: boolean;
  showTimestamp?: boolean;
  /**
   * Called when a *user* message has been edited & saved in-place.
   */
  onEdit?: (newContent: string) => void;
  onGeneratedDocClick?: (docId: string) => void;
  onQuizOpen?: (quiz: {
    quizId: string;
    title: string;
    questions: unknown[];
    assessmentType?: string;
    thresholdConcept?: string;
  }) => void;
  onChallengeOpen?: (challenge: ChallengeSummary) => void;
  onDocumentDownload?: (docId: string, title: string) => void;

  // Retry for the *latest* assistant message
  onAssistantRetry?: () => void;
  
  // Flag to indicate this is a research result (hides retry button)
  isResearchResult?: boolean;
  
  // Sources for linking inline citations in research results
  sources?: Array<{ title: string; url?: string; domain?: string; favicon?: string; filename?: string; file_id?: string }>;
  
  // Response time in milliseconds (for assistant messages)
  responseTimeMs?: number;
  
  // Text to show after the document block
  docBlockContent?: string;

  // Read-only mode (shared chat) — disables interactive features like quiz feedback
  readOnly?: boolean;

  // Suggested queries are only offered on the newest message.
  isLatestMessage?: boolean;
};

function formatMessageTime(timestamp?: number): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatResponseTime(ms?: number): string {
  if (!ms || ms <= 0) return '';
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds <= 0) return '';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}


const quizSubmissionCache = new Map<string, boolean>();
const quizSubmissionRequests = new Map<string, Promise<boolean>>();

function quizStatusKey(userId: string, agentId: string, quizId: string): string {
  return `${userId}:${agentId}:${quizId}`;
}

function getQuizSubmissionStatus(userId: string, agentId: string, quizId: string): Promise<boolean> {
  const key = quizStatusKey(userId, agentId, quizId);
  const cached = quizSubmissionCache.get(key);
  if (typeof cached === "boolean") return Promise.resolve(cached);
  const pending = quizSubmissionRequests.get(key);
  if (pending) return pending;
  const request = chatApi.getFirstQuizAttemptStatus(userId, agentId, quizId)
    .then((result) => {
      quizSubmissionCache.set(key, result.exists);
      return result.exists;
    })
    .finally(() => quizSubmissionRequests.delete(key));
  quizSubmissionRequests.set(key, request);
  return request;
}

function QuizLaunchCard({
  quiz,
  agentId,
  readOnly,
  onOpen,
}: {
  quiz: {
    quizId: string;
    title: string;
    questions: unknown[];
    assessmentType?: string;
    thresholdConcept?: string;
  };
  agentId?: string;
  readOnly?: boolean;
  onOpen: (quiz: {
    quizId: string;
    title: string;
    questions: unknown[];
    assessmentType?: string;
    thresholdConcept?: string;
  }) => void;
}) {
  const userId = useUserStore((state) => state.userId);
  const markerKey = userId && agentId
    ? `ekalaiva.quiz-started.v1:${quizStatusKey(userId, agentId, quiz.quizId)}`
    : "";
  const [started, setStarted] = React.useState(
    () => Boolean(markerKey && localStorage.getItem(markerKey) === "1"),
  );
  const [submitted, setSubmitted] = React.useState(false);

  React.useEffect(() => {
    setStarted(Boolean(markerKey && localStorage.getItem(markerKey) === "1"));
  }, [markerKey]);

  React.useEffect(() => {
    if (readOnly || !userId || !agentId || !quiz.quizId) return;
    let cancelled = false;
    getQuizSubmissionStatus(userId, agentId, quiz.quizId)
      .then((exists) => {
        if (!cancelled) setSubmitted(exists);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [agentId, quiz.quizId, readOnly, userId]);

  React.useEffect(() => {
    if (readOnly || !userId || !agentId || !quiz.quizId) return;
    const handleSubmitted = (event: Event) => {
      const detail = (event as CustomEvent<{
        quizId?: string;
        agentId?: string;
        automatic?: boolean;
      }>).detail;
      if (
        detail?.automatic
        && detail.quizId === quiz.quizId
        && detail.agentId === agentId
      ) {
        quizSubmissionCache.set(quizStatusKey(userId, agentId, quiz.quizId), true);
        setSubmitted(true);
      }
    };
    window.addEventListener("quiz-feedback", handleSubmitted);
    return () => window.removeEventListener("quiz-feedback", handleSubmitted);
  }, [agentId, quiz.quizId, readOnly, userId]);

  const actionLabel = readOnly || submitted
    ? "Open"
    : started
      ? "In progress"
      : "Start";

  return (
    <div
      id={`asset-anchor-${quiz.quizId}`}
      className="flex items-center gap-4 w-full rounded-xl bg-neutral-900 border border-neutral-700/50 px-4 py-3"
    >
      <div className="flex items-center gap-4 flex-1 min-w-0">
        <div className="w-12 h-12 rounded-lg bg-purple-500/15 flex items-center justify-center shrink-0">
          <HelpCircle className="h-6 w-6 text-purple-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white truncate">
            {quiz.title || "Quiz"}
          </p>
          <p className="text-xs text-neutral-500">
            {quiz.assessmentType === "concept_inventory" ? "Concept inventory" : "Quiz"}{" "}
            · {quiz.questions?.length ?? 0}{" "}
            {(quiz.questions?.length ?? 0) === 1 ? "question" : "questions"}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setStarted(true);
          if (markerKey) localStorage.setItem(markerKey, "1");
          onOpen(quiz);
        }}
        className="px-8 py-2.5 rounded-lg border border-neutral-600 text-sm font-medium text-white hover:bg-neutral-700 transition-colors shrink-0"
      >
        {actionLabel}
      </button>
    </div>
  );
}

type ChallengeSummary = {
  challengeId: string;
  title: string;
  description: string;
  difficulty: string;
  hints?: string[];
  solution: string;
  challengeType?: string;
};

function ChallengeLaunchCard({
  challenge,
  agentId,
  readOnly,
  onOpen,
}: {
  challenge: ChallengeSummary;
  agentId?: string;
  readOnly?: boolean;
  onOpen: (challenge: ChallengeSummary) => void;
}) {
  const userId = useUserStore((state) => state.userId);
  const difficulty = (challenge.difficulty || "medium").trim();
  const markerKey = userId && agentId
    ? `ekalaiva.challenge-started.v1:${userId}:${agentId}:${challenge.challengeId}`
    : "";
  const [started, setStarted] = React.useState(
    () => Boolean(markerKey && localStorage.getItem(markerKey) === "1"),
  );

  React.useEffect(() => {
    setStarted(Boolean(markerKey && localStorage.getItem(markerKey) === "1"));
  }, [markerKey]);

  const actionLabel = readOnly || started ? "Open" : "Start";

  return (
    <div
      id={`asset-anchor-${challenge.challengeId}`}
      className="flex items-center gap-4 w-full rounded-xl bg-neutral-900 border border-neutral-700/50 px-4 py-3"
    >
      <div className="flex items-center gap-4 flex-1 min-w-0">
        <div className="w-12 h-12 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0">
          <Target className="h-6 w-6 text-amber-300" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white truncate">
            {challenge.title || "Challenge"}
          </p>
          <p className="text-xs text-neutral-500">
            Challenge · <span className="capitalize">{difficulty}</span>
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setStarted(true);
          if (markerKey) localStorage.setItem(markerKey, "1");
          onOpen(challenge);
        }}
        className="px-8 py-2.5 rounded-lg border border-neutral-600 text-sm font-medium text-white hover:bg-neutral-700 transition-colors shrink-0"
      >
        {actionLabel}
      </button>
    </div>
  );
}

/** Renders a SymPy-generated physics/mechanics diagram (always server-side PNG) */
function TikzImageBlock({ block, setPreviewImage }: { block: any; setPreviewImage: (url: string) => void }) {  return (
    <div>
      <div className="flex justify-center">
        {block.imageData ? (
          <button
            type="button"
            onClick={() => setPreviewImage(`data:image/png;base64,${block.imageData}`)}
            className="cursor-zoom-in inline-flex justify-center"
          >
            <img
              src={`data:image/png;base64,${block.imageData}`}
              alt={block.title || "Physics diagram"}
              className="rounded-lg object-contain"
              style={{ maxWidth: "420px", maxHeight: "340px" }}
            />
          </button>
        ) : (
          <div className="flex items-center justify-center h-20 text-neutral-500 text-sm">
            Generating diagram...
          </div>
        )}
      </div>
      {block.caption && (
        <p className="mt-4 mx-20 text-xs text-neutral-400 leading-relaxed">
          {block.caption}
        </p>
      )}
    </div>
  );
}

function GeneratedImageBlock({ block, setPreviewImage }: { block: any; setPreviewImage: (url: string) => void }) {
  // Live turns carry base64; reloaded ones carry a signed blob URL instead.
  const src = block.imageData
    ? `data:image/png;base64,${block.imageData}`
    : block.imageUrl || "";
  return (
    <div>
      <div className="flex justify-center">
        {src ? (
          <button
            type="button"
            onClick={() => setPreviewImage(src)}
            className="cursor-zoom-in block w-full"
          >
            <img
              src={src}
              alt={block.title || "Generated image"}
              className="block h-auto w-full rounded-xl"
            />
          </button>
        ) : (
          // 3:2 matches the tool's locked 1536x1024 output, so the layout does not
          // shift when the real image lands.
          <div
            role="status"
            aria-label="Generating image"
            className="shimmer relative aspect-[3/2] w-full overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900"
          >
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <ImageIcon className="h-7 w-7 animate-pulse text-neutral-700" />
              <span className="text-xs text-neutral-500">Generating image…</span>
            </div>
          </div>
        )}
      </div>
      {block.caption && (
        <p className="mt-3 mx-8 text-center text-xs text-neutral-400 leading-relaxed">
          {block.caption}
        </p>
      )}
    </div>
  );
}

function ChatBubble({
  role,
  content: rawContent,
  agentId,
  threadId,
  createdAt,
  generatedDocId,
  generatedDocTitle,
  docBlockContent,
  contentBlocks,
  imageUrls,
  showUserActions,
  hideActions = false,
  showTimestamp = true,
  onEdit,
  onGeneratedDocClick,
  onQuizOpen,
  onChallengeOpen,
  onDocumentDownload,
  onAssistantRetry,
  isResearchResult = false,
  sources,
  responseTimeMs,
  tokenUsage,
  readOnly,
  isLatestMessage = true,
}: ChatBubbleProps) {
  const isUser = role === "user";

  // Expand name tokens back to real names for display.
  // Strip backtick wrapping (LLM often formats placeholders as `{{…}}`).
  const _userFullName = useChatStore((s) => s.userFullName || s.userName);
  const _preferredName = useChatStore((s) => s.userNickname || s.userName);
  const resolveName = (text: string) =>
    text
      .replaceAll("`{{preferred_name}}`", _preferredName)
      .replaceAll("{{preferred_name}}", _preferredName)
      .replaceAll("`{{user_name}}`", _userFullName)
      .replaceAll("{{user_name}}", _userFullName);
  const content = resolveName(rawContent);
  const { quote: taggedQuote, body: userBody } = isUser
    ? splitTaggedQuote(content ?? "")
    : { quote: "", body: content ?? "" };

  // Apply name resolution to content blocks too (add_message tool output)
  const resolvedContentBlocks = contentBlocks
    ?.filter((block) => block.type !== "document" || Boolean(block.docId))
    .map((block) => ({
      ...block,
      content: "content" in block && block.content ? resolveName(block.content) : (block as any).content,
      description: (block as any).description ? resolveName((block as any).description) : (block as any).description,
    }));

  // Check if we have content blocks or the old doc pattern.
  // tool_activity blocks annotate the turn, they don't carry the reply, so they
  // must not switch the bubble into block-only rendering and hide `content`.
  // Finished steps are dropped so only the step in progress is ever on screen.
  // Split filters: the first is an inferred type predicate, so `done` narrows here.
  const activityBlocks = (resolvedContentBlocks ?? [])
    .filter((block) => block.type === "tool_activity")
    .filter((block) => !block.done);
  // Activity is pushed as soon as a tool starts, which would otherwise place it
  // above replies that finished later. Render it after the content instead.
  const orderedBlocks = [
    ...(resolvedContentBlocks ?? []).filter((block) => block.type !== "tool_activity"),
    ...activityBlocks,
  ];
  const hasContentBlocks =
    !!resolvedContentBlocks &&
    resolvedContentBlocks.some((block) => block.type !== "tool_activity");
  const isDocBubble = !isUser && (!!generatedDocId || hasContentBlocks || activityBlocks.length > 0);

  const [isEditing, setIsEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(content);
  const [copied, setCopied] = React.useState(false);
  const [previewImage, setPreviewImage] = React.useState<string | null>(null);

  // keep draft in sync if content changes externally
  React.useEffect(() => {
    if (!isEditing) {
      setDraft(content);
    }
  }, [content, isEditing]);

  const handleSaveEdit = () => {
    const trimmed = draft.trim();
    if (!trimmed || !onEdit) {
      setIsEditing(false);
      setDraft(content);
      return;
    }
    onEdit(trimmed);
    setIsEditing(false);
  };

  return (
    <div
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
        {/* Image attachments displayed ABOVE the user message bubble */}
        {isUser && imageUrls && imageUrls.length > 0 && (
          <div className="flex flex-wrap gap-2 justify-end mb-1">
            {imageUrls.map((url, idx) => {
              const displayUrl = getBlobProxyUrl(url);
              console.log('[ChatBubble] Rendering image:', { 
                originalUrl: url, 
                displayUrl,
                urlType: url?.startsWith('blob:') ? 'blob:' : isAzureBlobUrl(url) ? 'azure' : 'other',
              });
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setPreviewImage(displayUrl)}
                  className="relative w-20 h-20 rounded-xl overflow-hidden border border-neutral-700 hover:border-neutral-500 transition-colors shadow-lg"
                >
                  <img
                    src={displayUrl}
                    alt={`Attached image ${idx + 1}`}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      console.error('[ChatBubble] Image load error:', { 
                        displayUrl, 
                        originalUrl: url,
                        error: e 
                      });
                    }}
                    onLoad={() => console.log('[ChatBubble] Image loaded successfully:', displayUrl)}
                  />
                </button>
              );
            })}
          </div>
        )}
        
        {/* Tagged selection, shown as its own element above the message */}
        {isUser && taggedQuote && <QuoteTag text={taggedQuote} />}

        {/* Message */}
        {(!isUser || isEditing || userBody.trim()) && (
        <div
          className={clsx(
            "max-w-full",
            isUser ? "flex justify-end" : "flex justify-start w-full"
          )}
        >
          <div
            data-ask-ta={isUser ? undefined : ""}
            className={clsx(
              "max-w-full",
              isUser
                ? // USER: neutral bubble with soft shadow
                  "rounded-2xl rounded-br-sm px-4 py-3 bg-neutral-800 text-neutral-100 shadow-md shadow-black/20 whitespace-pre-wrap break-words"
                : // ASSISTANT: clean text, full width for doc cards
                  "text-[15px] leading-relaxed text-neutral-200 w-full"
            )}
          >
            {isUser ? (
              isEditing ? (
                <div className="space-y-3 p-4 rounded-2xl bg-gradient-to-br from-neutral-900/95 via-neutral-900/90 to-neutral-900/95 backdrop-blur-xl border border-white/10 shadow-2xl">
                  <Textarea
                    autoFocus
                    rows={3}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSaveEdit();
                      }
                    }}
                    className="w-full bg-neutral-800/60 border border-white/10 rounded-xl text-sm placeholder:text-neutral-400 resize-none focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500/50 transition-all duration-200"
                    style={{ color: '#ffffff', caretColor: '#ffffff', WebkitTextFillColor: '#ffffff' }}
                  />
                  <div className="flex justify-end gap-2 text-sm">
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditing(false);
                        setDraft(content);
                      }}
                      className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-neutral-100 border border-white/10 hover:border-white/20 transition-all duration-200 font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveEdit}
                      className="px-4 py-2 rounded-lg bg-gradient-to-r from-blue-500 via-blue-600 to-indigo-600 hover:from-blue-400 hover:via-blue-500 hover:to-indigo-500 text-white border border-blue-400/30 shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30 transition-all duration-200 font-medium"
                    >
                      Send
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-[15px] leading-relaxed">{userBody}</div>
              )
            ) : isDocBubble ? (
              <div className="flex flex-col gap-3">
                {/* Render content blocks if available */}
                {hasContentBlocks ? (
                  orderedBlocks.map((block, idx) => (
                    <div key={idx}>
                      {block.type === "text" ? (
                        <div>
                          <Markdown sources={sources}>{block.content}</Markdown>
                        </div>
                      ) : block.type === "tool_activity" ? (
                        <p
                          className={clsx(
                            "text-[15px] leading-snug text-neutral-500",
                            !block.done && "animate-pulse",
                          )}
                        >
                          {block.label}
                          {block.done ? "" : "…"}
                        </p>
                      ) : block.type === "quiz" ? (
                        onQuizOpen ? (
                          <QuizLaunchCard
                            quiz={{
                              quizId: block.quizId,
                              title: block.title,
                              questions: block.questions,
                              assessmentType: block.assessmentType,
                              thresholdConcept: block.thresholdConcept,
                            }}
                            agentId={agentId}
                            readOnly={readOnly}
                            onOpen={onQuizOpen}
                          />
                        ) : (
                          <QuizBlock
                            quizId={block.quizId}
                            title={block.title}
                            questions={block.questions}
                            assessmentType={block.assessmentType}
                            thresholdConcept={block.thresholdConcept}
                            agentId={agentId}
                            threadId={threadId || undefined}
                            readOnly={readOnly}
                          />
                        )
                      ) : block.type === "flashcard" ? (
                        <FlashcardBlock
                          flashcardId={block.flashcardId}
                          title={block.title}
                          cards={block.cards}
                        />
                      ) : block.type === "challenge" ? (
                        onChallengeOpen ? (
                          <ChallengeLaunchCard
                            challenge={{
                              challengeId: block.challengeId,
                              title: block.title,
                              description: block.description,
                              difficulty: block.difficulty,
                              hints: block.hints,
                              solution: block.solution,
                              challengeType: block.challengeType,
                            }}
                            agentId={agentId}
                            readOnly={readOnly}
                            onOpen={onChallengeOpen}
                          />
                        ) : (
                          <ChallengeBlock
                            challengeId={block.challengeId}
                            title={block.title}
                            description={block.description}
                            difficulty={block.difficulty}
                            hints={block.hints}
                            solution={block.solution}
                            challengeType={block.challengeType}
                          />
                        )
                      ) : block.type === "tikz_image" ? (
                        <TikzImageBlock block={block} setPreviewImage={setPreviewImage} />
                      ) : block.type === "generated_image" ? (
                        <GeneratedImageBlock block={block} setPreviewImage={setPreviewImage} />
                      ) : block.type === "clarify" ? (
                        <ClarifyBlock
                          clarifyId={block.clarifyId}
                          questions={block.questions}
                          createdAt={createdAt}
                          readOnly={readOnly}
                        />
                      ) : block.type === "suggested_queries" ? (
                        isLatestMessage ? (
                          <SuggestedQueriesBlock queries={block.queries} readOnly={readOnly} />
                        ) : null
                      ) : (
                        <div
                          id={`asset-anchor-${block.docId}`}
                          className="flex items-center gap-4 w-full rounded-xl bg-neutral-900 border border-neutral-700/50 px-4 py-3"
                        >
                          <div className="flex items-center gap-4 flex-1 min-w-0">
                            <div className="w-12 h-12 rounded-lg bg-cyan-500/15 flex items-center justify-center shrink-0">
                              <FileText className="h-6 w-6 text-cyan-400" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-white truncate">
                                {block.title || "Document"}
                              </p>
                              <p className="text-xs text-neutral-500">
                                Document · MD
                              </p>
                            </div>
                          </div>
                          {/* Open button */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onGeneratedDocClick?.(block.docId);
                            }}
                            className="px-8 py-2.5 rounded-lg border border-neutral-600 text-sm font-medium text-white hover:bg-neutral-700 transition-colors shrink-0"
                          >
                            Open
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  /* Fallback: Old pattern with single doc */
                  <>
                    {/* Before document text */}
                    <div>
                      <Markdown sources={sources}>{content}</Markdown>
                    </div>

                    {/* doc chip below text */}
                    {generatedDocId && onGeneratedDocClick && (
                      <div className="flex items-center gap-4 w-full rounded-xl bg-neutral-900 border border-neutral-700/50 px-4 py-3">
                        {/* Icon + text (non-clickable) */}
                        <div className="flex items-center gap-4 flex-1 min-w-0">
                          <div className="w-12 h-12 rounded-lg bg-cyan-500/15 flex items-center justify-center shrink-0">
                            <FileText className="h-6 w-6 text-cyan-400" />
                          </div>
                          {/* Text content */}
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-white truncate">
                              {generatedDocTitle ?? "Generated document"}
                            </p>
                            <p className="text-xs text-neutral-500">
                              Document · MD
                            </p>
                          </div>
                        </div>
                        {/* Open button */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onGeneratedDocClick?.(generatedDocId);
                          }}
                          className="px-8 py-2.5 rounded-lg border border-neutral-600 text-sm font-medium text-white hover:bg-neutral-700 transition-colors shrink-0"
                        >
                          Open
                        </button>
                      </div>
                    )}
                    
                    {/* Document block follow-up text */}
                    {docBlockContent && (
                      <div>
                        <Markdown sources={sources}>{docBlockContent}</Markdown>
                      </div>
                    )}

                    {/* Tool activity trails the reply so the running one sits at the live edge. */}
                    {activityBlocks.map((block, idx) => (
                      <p
                        key={`activity-${idx}`}
                        className={clsx(
                          "text-[15px] leading-snug text-neutral-500",
                          !block.done && "animate-pulse",
                        )}
                      >
                        {block.label}
                        {block.done ? "" : "…"}
                      </p>
                    ))}
                  </>
                )}
              </div>
            ) : (
              <Markdown sources={sources}>{content}</Markdown>
            )}
          </div>
        </div>
        )}

        {/* Assistant actions (copy / thumbs / retry only if latest / more) - always visible */}
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
            <button
              type="button"
              className="p-1 hover:bg-neutral-800/40 rounded-md transition-all duration-200"
              title="Good response"
            >
              <ThumbsUp className="h-4 w-4 text-neutral-400 hover:text-neutral-200" />
            </button>
            <button
              type="button"
              className="p-1 hover:bg-neutral-800/40 rounded-md transition-all duration-200"
              title="Bad response"
            >
              <ThumbsDown className="h-4 w-4 text-neutral-400 hover:text-neutral-200" />
            </button>

            {/* Retry ONLY if parent passed handler (i.e., latest assistant) and not a research result */}
            {onAssistantRetry && !isResearchResult && (
              <button
                type="button"
                onClick={onAssistantRetry}
                className="p-1 hover:bg-neutral-800/40 rounded-md transition-all duration-200"
                title="Retry generation"
              >
                <RotateCcw className="h-4 w-4 text-neutral-400 hover:text-neutral-200" />
              </button>
            )}

            <button
              type="button"
              className="p-1 hover:bg-neutral-800/40 rounded-md transition-all duration-200"
              title="More options"
            >
              <MoreHorizontal className="h-4 w-4 text-neutral-400 hover:text-neutral-200" />
            </button>

            {/* Response time indicator - always reserve space, show value when available */}
            <span 
              className="ml-2 text-[11px] text-neutral-400 min-w-[28px]" 
              title={typeof responseTimeMs === 'number' && responseTimeMs > 0 ? "Response time" : ""}
            >
              {typeof responseTimeMs === 'number' && responseTimeMs > 0 ? formatResponseTime(responseTimeMs) : ''}
            </span>
            {/* Token usage indicator */}
            {tokenUsage && tokenUsage.total_tokens > 0 && (
              <span
                className="ml-1 text-[11px] text-neutral-400"
                title={`Tokens: ${tokenUsage.input_tokens} in / ${tokenUsage.output_tokens} out (${tokenUsage.rounds} round${tokenUsage.rounds !== 1 ? 's' : ''})`}
              >
                · {tokenUsage.total_tokens >= 1000 ? `${(tokenUsage.total_tokens / 1000).toFixed(1)}k` : tokenUsage.total_tokens} tokens
              </span>
            )}
          </div>
        )}

        {/* User actions: copy and edit on hover - only when showUserActions is true */}
        {isUser && !isEditing && showUserActions && (
          <div className="mt-2 flex items-center gap-1">
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
              {copied ? (
                <Check className="h-4 w-4 text-white" />
              ) : (
                <Copy className="h-4 w-4 text-neutral-400" />
              )}
            </button>
            {onEdit && (
              <button
                type="button"
                onClick={() => {
                  setDraft(content);
                  setIsEditing(true);
                }}
                className="hover:opacity-70 transition-opacity duration-200"
                title="Edit this message"
              >
                <Pencil className="h-4 w-4 text-neutral-400" />
              </button>
            )}
          </div>
        )}
      </div>
      
      {/* Image Preview Modal */}
      {previewImage && (
        <div 
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100]"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <img
              src={previewImage}
              alt="Preview"
              className="max-w-full max-h-[85vh] object-contain rounded-lg"
            />
            <button
              type="button"
              onClick={() => setPreviewImage(null)}
              className="absolute -top-3 -right-3 bg-neutral-800 hover:bg-neutral-700 rounded-full p-1.5 transition-colors"
            >
              <X className="h-5 w-5 text-white" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default ChatBubble;