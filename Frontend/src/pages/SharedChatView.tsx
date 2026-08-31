// src/pages/SharedChatView.tsx
// Public view for shared chats (read-only, no authentication required)
// Reuses the exact same layout & components as ChatView with input disabled

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { chatApi } from "@/lib/chatApi";
import type { SharedChatResponse } from "@/lib/chatApi";
import { ExternalLink, AlertCircle, X, Download } from "lucide-react";
import { UnifiedChatContainer } from "@/components/chat/UnifiedChatContainer";
import { AssetContent } from "@/components/assets/AssetContent";
import Markdown from "@/components/common/Markdown";
import type { ChatMsg } from "@/features/chat/ChatBubble";
import type { GeneratedDoc } from "@/features/create/markdownUtils";
import type { ClarifyQuestion, ContentBlock, QuizQuestion, FlashCard } from "@/lib/types";

export function SharedChatView() {
  const { shareToken } = useParams<{ shareToken: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SharedChatResponse | null>(null);

  const [openGeneratedDoc, setOpenGeneratedDoc] = useState<GeneratedDoc | null>(null);

  useEffect(() => {
    if (!shareToken) {
      setError("Invalid share link");
      setLoading(false);
      return;
    }

    const fetchSharedChat = async () => {
      try {
        const response = await chatApi.getSharedChat(shareToken);
        setData(response);
      } catch (err: any) {
        console.error("Failed to fetch shared chat:", err);
        setError(err.message || "This chat is no longer available or the link has expired.");
      } finally {
        setLoading(false);
      }
    };

    fetchSharedChat();
  }, [shareToken]);

  const rawMessages = data?.messages ?? [];

  // Parse content blocks from metadata
  const parseContentBlocks = (metadata: Record<string, unknown>): ContentBlock[] | undefined => {
    if (!metadata.contentBlocks || !Array.isArray(metadata.contentBlocks)) return undefined;
    return (metadata.contentBlocks as Array<Record<string, unknown>>).map((b): ContentBlock | null => {
      if (b.type === 'text') return { type: 'text' as const, content: (b.content as string) || '' };
      if (b.type === 'quiz') return { type: 'quiz' as const, quizId: (b.quizId as string) || '', title: (b.title as string) || 'Quiz', assessmentType: b.assessmentType as "concept_inventory" | "practice_quiz" | undefined, thresholdConcept: b.thresholdConcept as string | undefined, questions: (b.questions as QuizQuestion[]) || [] };
      if (b.type === 'flashcard') return { type: 'flashcard' as const, flashcardId: (b.flashcardId as string) || '', title: (b.title as string) || 'Flashcards', cards: (b.cards as FlashCard[]) || [] };
      if (b.type === 'challenge') return { type: 'challenge' as const, challengeId: (b.challengeId as string) || '', title: (b.title as string) || 'Challenge', description: (b.description as string) || '', difficulty: (b.difficulty as string) || 'medium', hints: (b.hints as string[]) || [], solution: (b.solution as string) || '', challengeType: (b.challengeType as string) || 'problem' };
      if (b.type === 'generated_image') return { type: 'generated_image' as const, generatedImageId: (b.generatedImageId as string) || '', title: (b.title as string) || 'Generated image', imageData: (b.imageData as string) || '', imageUrl: (b.imageUrl as string) || '', caption: (b.caption as string) || '', size: (b.size as string) || '', quality: (b.quality as string) || '' };
      if (b.type === 'tikz_image' || b.type === 'sympy_image') return { type: 'tikz_image' as const, tikzImageId: (b.tikzImageId as string) || (b.sympyImageId as string) || '', title: (b.title as string) || 'Diagram', imageData: (b.imageData as string) || '', caption: (b.caption as string) || '', visualizationType: (b.visualizationType as string) || '' };
      if (b.type === 'clarify') return { type: 'clarify' as const, clarifyId: (b.clarifyId as string) || '', questions: (b.questions as ClarifyQuestion[]) || [] };
      if (b.type === 'suggested_queries') return { type: 'suggested_queries' as const, suggestionsId: (b.suggestionsId as string) || '', queries: (b.queries as string[]) || [] };
      if (b.type === 'tool_activity') return { type: 'tool_activity' as const, activityId: (b.activityId as string) || '', label: (b.label as string) || 'Working', done: b.done !== false };
      if (b.type === 'document') return { type: 'document' as const, docId: (b.docId as string) || '', title: (b.title as string) || 'Document' };
      return null;
    }).filter((block): block is ContentBlock => block !== null);
  };

  // Map API messages to ChatMsg format, including all metadata fields
  const chatMessages: ChatMsg[] = useMemo(() => rawMessages.map((msg) => {
    const metadata = (msg.metadata || {}) as Record<string, unknown>;
    return {
      role: msg.role,
      content: msg.content,
      createdAt: msg.createdAt ? new Date(msg.createdAt).getTime() : undefined,
      ...(metadata.generatedDocId ? { generatedDocId: metadata.generatedDocId as string } : {}),
      ...(metadata.generatedDocTitle ? { generatedDocTitle: metadata.generatedDocTitle as string } : {}),
      ...(metadata.generatedDocContent ? { generatedDocContent: metadata.generatedDocContent as string } : {}),
      ...(metadata.docBlockContent ? { docBlockContent: metadata.docBlockContent as string } : {}),
      ...(metadata.contentBlocks ? { contentBlocks: parseContentBlocks(metadata) } : {}),
      ...(metadata.isResearch ? { isResearch: true } : {}),
      ...(metadata.researchStartTime ? { researchStartTime: metadata.researchStartTime as number } : {}),
      ...(metadata.researchEndTime ? { researchEndTime: metadata.researchEndTime as number } : {}),
    };
  }), [rawMessages]);

  // Build a map of docId -> content from messages for doc click
  const handleGeneratedDocClick = useCallback((docId: string) => {
    for (const msg of chatMessages) {
      if (msg.generatedDocId === docId && msg.generatedDocContent) {
        setOpenGeneratedDoc({ id: docId, title: msg.generatedDocTitle || "Document", content: msg.generatedDocContent });
        return;
      }
      if (msg.contentBlocks) {
        const block = msg.contentBlocks.find((b: any) => b.type === "document" && b.docId === docId);
        if (block && msg.generatedDocContent) {
          setOpenGeneratedDoc({ id: docId, title: (block as any).title || msg.generatedDocTitle || "Document", content: msg.generatedDocContent });
          return;
        }
      }
    }
  }, [chatMessages]);

  const handleDocumentDownload = useCallback((docId: string, title: string) => {
    let content: string | undefined;
    for (const msg of chatMessages) {
      if (msg.generatedDocId === docId && msg.generatedDocContent) { content = msg.generatedDocContent; break; }
      if (msg.contentBlocks) {
        const block = msg.contentBlocks.find((b: any) => b.type === "document" && b.docId === docId);
        if (block && msg.generatedDocContent) { content = msg.generatedDocContent; break; }
      }
    }
    if (content) {
      const blob = new Blob([content], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title || 'document'}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }, [chatMessages]);

  // Quizzes and challenges open in the side panel here too, so a shared conversation
  // shows the same launch cards and panel layout as the live chat.
  const handleQuizOpen = useCallback((quiz: {
    quizId: string;
    title: string;
    questions: unknown[];
    assessmentType?: string;
    thresholdConcept?: string;
  }) => {
    setOpenGeneratedDoc({
      id: quiz.quizId,
      title: quiz.title || "Quiz",
      content: JSON.stringify(quiz),
    });
  }, []);

  const handleChallengeOpen = useCallback((challenge: {
    challengeId: string;
    title: string;
    description: string;
    difficulty: string;
    hints?: string[];
    solution: string;
    challengeType?: string;
  }) => {
    setOpenGeneratedDoc({
      id: challenge.challengeId,
      title: challenge.title || "Challenge",
      content: JSON.stringify(challenge),
    });
  }, []);

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
          <p className="text-neutral-400 text-sm">Loading shared chat...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !data) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-neutral-900 rounded-2xl p-8 border border-neutral-800 text-center">
          <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-white mb-2">Chat Not Available</h1>
          <p className="text-neutral-400 mb-6">
            {error || "This shared chat could not be found."}
          </p>
          <Link
            to="/auth"
            className="inline-flex items-center gap-2 px-4 py-2 bg-white text-black rounded-lg font-medium hover:bg-neutral-200 transition-colors"
          >
            Go to Ekalaiva
            <ExternalLink className="h-4 w-4" />
          </Link>
        </div>
      </div>
    );
  }

  const { thread } = data;

  return (
    <div className="h-screen overflow-hidden bg-gradient-to-br from-neutral-950 via-black to-neutral-950">
      {/* Animated background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 -left-1/4 w-1/2 h-1/2 bg-blue-500/3 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 -right-1/4 w-1/2 h-1/2 bg-indigo-500/3 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      <div className="relative h-full flex flex-col">
        {/* Header — same style as ChatView's ChatHeader */}
        <div className="relative flex items-center justify-between px-5 py-3 bg-neutral-900 border-b border-transparent">
          <span className="text-base font-semibold text-neutral-100 truncate max-w-[70%]">
            {thread.title}
          </span>
          <Link
            to="/auth"
            className="h-8 flex items-center gap-1.5 px-3 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-sm shadow-sm shadow-black/10 transition-all"
          >
            Try Shiksha
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>

        {/* Chat area — reuses UnifiedChatContainer with disabled input */}
        <div className="flex-1 min-h-0">
          <UnifiedChatContainer
            messages={chatMessages}
            input=""
            onInputChange={() => {}}
            onSend={() => {}}
            isSending={false}
            isTyping={false}
            disabled={true}
            placeholder="This is a read-only shared conversation"
            showUserActions={false}
            onGeneratedDocClick={handleGeneratedDocClick}
            onDocumentDownload={handleDocumentDownload}
            onQuizOpen={handleQuizOpen}
            onChallengeOpen={handleChallengeOpen}
          />
        </div>
      </div>

      {/* Document viewer panel (read-only) */}
      {openGeneratedDoc && (() => {
        const isStructuredAsset = openGeneratedDoc.content.trim().startsWith("{");
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="relative w-full max-w-3xl max-h-[85vh] bg-neutral-900 border border-neutral-700 rounded-2xl shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800">
              <h2 className="text-lg font-semibold text-neutral-100 truncate">{openGeneratedDoc.title}</h2>
              <div className="flex items-center gap-2">
                {/* Downloading a quiz/challenge would just save its JSON payload. */}
                {!isStructuredAsset && (
                  <button onClick={() => handleDocumentDownload(openGeneratedDoc.id, openGeneratedDoc.title)} className="p-2 rounded-lg hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 transition-colors" title="Download">
                    <Download className="w-4 h-4" />
                  </button>
                )}
                <button onClick={() => setOpenGeneratedDoc(null)} className="p-2 rounded-lg hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {isStructuredAsset ? (
                <AssetContent
                  content={openGeneratedDoc.content}
                  title={openGeneratedDoc.title}
                  id={openGeneratedDoc.id}
                  embedded
                />
              ) : (
                <Markdown>{openGeneratedDoc.content}</Markdown>
              )}
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
