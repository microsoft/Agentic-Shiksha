import { toast } from "sonner";
import { generateChatTitle, getCourseFollowups } from "@/lib/api";
import { chatApi } from "@/lib/chatApi";
import { computeProfileHash, useChatStore } from "@/lib/chatStore";
import { logger } from "@/lib/loggingService";
import { getCourseName } from "@/lib/utils";
import type { ChatMessage, ChatMsg, ResearchData } from "@/lib/types";
import type { GeneratedDoc } from "@/features/create/markdownUtils";
import { hasTurnContent, persistedTurnMessage, type ChatTurnState } from "./chatTurnReducer";

export interface ChatTurnPersistence {
  setSession(sessionId: string): void;
  saveCompletedSlides(state: ChatTurnState): void;
  commit(state: ChatTurnState): void;
  complete(state: ChatTurnState, signal: AbortSignal): Promise<string[] | undefined>;
  reportFailure(error: unknown): void;
}

export function snapshotChatContext(localThreadId: string) {
  const state = useChatStore.getState();
  const sessionId = state.threads[localThreadId]?.context?.sessionUuid ?? null;
  const injectProfile = sessionId ? state.shouldInjectProfile(localThreadId) : true;
  return {
    sessionId, injectProfile, profileHash: computeProfileHash(state),
    userProfile: injectProfile ? {
      displayName: state.userName || "", nickname: state.userNickname || "",
      fullName: state.userFullName || "", workFunction: state.userWorkFunction || "",
      preferences: state.userPreferences || "", customInstructions: state.userCustomInstructions || "",
      learningProfile: state.userLearningProfile || "", department: state.userDepartment || "",
      college: state.userCollege || "", language: state.userLanguage || "",
      currentLocation: state.userCurrentLocation || "", interests: state.userInterests || "",
      passionateAbout: state.userPassionateAbout || "",
    } : undefined,
  };
}

export function restoreChatHistory(stored: ChatMessage[], activeResearch?: ResearchData | null): {
  messages: ChatMsg[];
  documents: GeneratedDoc[];
} {
  const messages: ChatMsg[] = stored.filter(message => message.role !== "system").map(message => {
    if (message.role === "system") throw new Error("System messages cannot be displayed in chat.");
    const { id: _id, ...visible } = message;
    return { ...visible, role: message.role };
  });
  if (activeResearch?.status === "running" && !messages.some(message => message.isResearch && message.research?.id === activeResearch.id)) {
    messages.push({ role: "assistant", content: "", isResearch: true, research: activeResearch, createdAt: activeResearch.startTime });
  }
  const documents: GeneratedDoc[] = [];
  for (const message of stored) {
    if (message.generatedDocId && message.generatedDocContent) {
      documents.push({
        id: message.generatedDocId, title: message.generatedDocTitle || "Generated document",
        content: message.generatedDocContent, messageGroupId: message.messageGroupId,
      });
    }
  }
  return { messages, documents };
}

export function createChatTurnPersistence(context: {
  localThreadId: string;
  agentId: string;
  agentName?: string;
  agentKind: "learning" | "exam";
  userId: string;
  userText: string;
  injectProfile: boolean;
  profileHash: string;
}): ChatTurnPersistence {
  const { localThreadId, agentId, agentName, userId, userText } = context;
  let savedMessageId: string | undefined;
  let completed = false;
  const savedSlides = new Set<string>();
  const courseSlug = () => useChatStore.getState().threads[localThreadId]?.context?.courseSlug ||
    (agentName ? getCourseName(agentName) : "");
  const tags = () => courseSlug() ? [`course:${courseSlug()}`] : [];

  function reportFailure(error: unknown) {
    console.error("[chat] Request failed:", error);
    logger.logChatFailed({
      threadId: localThreadId, agentId, userMessage: userText,
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
  }

  function commit(turn: ChatTurnState) {
    if (!hasTurnContent(turn)) return;
    const store = useChatStore.getState();
    if (!store.threads[localThreadId]) return; // Deleted/account-cleared conversations are no longer ours.
    const message = persistedTurnMessage(turn);
    if (savedMessageId) {
      const index = store.messagesByThreadId[localThreadId]?.findIndex(item => item.id === savedMessageId) ?? -1;
      if (index >= 0) store.updateMessageAt(localThreadId, index, message);
      return;
    }
    store.appendMessage(localThreadId, message);
    savedMessageId = useChatStore.getState().messagesByThreadId[localThreadId]?.at(-1)?.id;
  }

  function saveLearningAssets(turn: ChatTurnState) {
    if (!userId) return;
    for (const doc of turn.phase === "completed" ? turn.documents.slice(0, 1) : turn.documents) {
      if (!doc.content) continue;
      void chatApi.createAsset(userId, {
        title: doc.title || "Untitled Document", category: "document", type: "markdown",
        content: doc.content, agentId, threadId: localThreadId,
        description: `Generated by ${agentName || "Agent"}`, tags: tags(),
      }).catch(error => console.error("[chat] Failed to save document asset:", error));
    }
    for (const block of turn.blocks) {
      if (block.type === "quiz" && block.questions.length) {
        void chatApi.saveQuizAsset({
          userId, quizId: block.quizId, assessmentInstanceId: block.assessmentInstanceId,
          curriculumVersion: block.curriculumVersion, title: block.title || "Quiz", agentId,
          threadId: localThreadId, assessmentType: block.assessmentType,
          thresholdConcept: block.thresholdConcept, questions: block.questions, tags: tags(),
        }).catch(error => console.error("[chat] Failed to save quiz asset:", error));
      } else if (turn.phase === "completed" && block.type === "challenge" && block.description) {
        void chatApi.createAsset(userId, {
          title: block.title || "Challenge", category: "challenge", type: "json",
          content: JSON.stringify({
            challengeId: block.challengeId, title: block.title, description: block.description,
            difficulty: block.difficulty, hints: block.hints, solution: block.solution, challengeType: block.challengeType,
          }),
          agentId, threadId: localThreadId,
          description: `${block.difficulty || "medium"} ${block.challengeType || "problem"} challenge \u2014 generated by ${agentName || "Agent"}`,
          tags: tags(),
        }).catch(error => console.error("[chat] Failed to save challenge asset:", error));
      }
    }
  }

  return {
    reportFailure,
    commit,
    setSession(sessionId) {
      useChatStore.getState().setThreadSessionUuid(localThreadId, sessionId);
    },
    saveCompletedSlides(turn) {
      if (!userId) return;
      for (const block of turn.blocks) {
        if (block.type !== "slides" || !block.deck || savedSlides.has(block.slidesId)) continue;
        savedSlides.add(block.slidesId);
        const { isStreaming: _isStreaming, ...savedBlock } = block;
        void chatApi.createAsset(userId, {
          title: block.title, category: "document", type: "json", content: JSON.stringify(savedBlock),
          agentId, threadId: localThreadId,
          description: `${block.deck.slides.length} slides \u2014 generated by ${agentName || "Agent"}`, tags: tags(),
        }).catch(() => toast.error("The slides remain in this chat, but saving to Assets failed. Please try again later."));
      }
    },
    async complete(turn, signal) {
      if (completed) return;
      completed = true;
      if (hasTurnContent(turn)) saveLearningAssets(turn);
      if (turn.phase !== "completed") return;
      if (context.injectProfile) useChatStore.getState().setProfileHashForThread(localThreadId, context.profileHash);
      logger.logMessageReceived({
        threadId: localThreadId, agentId, agentName: agentName || "Unknown",
        agentKind: context.agentKind, content: turn.accumulatedContent, messageIndex: -1,
      });
      if (!hasTurnContent(turn)) return;
      const thread = useChatStore.getState().threads[localThreadId];
      const title = thread?.title.toLowerCase() || "";
      if (thread && userText && (!title || title === "new chat" || title === "new conversation" || title.startsWith("chat ") || title.startsWith("untitled chat"))) {
        void generateChatTitle(userText, turn.message.content.slice(0, 500), agentName)
          .then(({ title }) => useChatStore.getState().renameThread(localThreadId, title))
          .catch(error => {
            console.error("[chat] Title generation failed:", error);
            useChatStore.getState().renameThread(localThreadId, userText.split(" ").slice(0, 5).join(" "));
          });
      }
      if (!turn.message.content.trim() || turn.blocks.some(block => block.type === "suggested_queries") || signal.aborted) return;
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(abort, 10_000);
      try {
        const queries = await getCourseFollowups(agentId, userText, turn.message.content, controller.signal);
        const store = useChatStore.getState();
        if (controller.signal.aborted || store.activeThreadId !== localThreadId ||
          store.messagesByThreadId[localThreadId]?.at(-1)?.id !== savedMessageId) return;
        return queries;
      } catch (error) {
        if (!controller.signal.aborted) console.warn("[chat] Follow-up suggestions unavailable:", error);
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
      }
    },
  };
}
