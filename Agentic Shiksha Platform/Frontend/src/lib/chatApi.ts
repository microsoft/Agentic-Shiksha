// src/lib/chatApi.ts
// API service for chat persistence with Cosmos DB

import type { Asset, QuizQuestion } from "./types";
import { isRetiredAsset } from "./retiredContent";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

export interface ApiThread {
  id: string;
  userId: string;
  agentId: string;
  name: string;
  // Optional human-friendly title used by UI; may be stored in metadata/backfilled by backend.
  title?: string;
  lastMessageAt: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface ApiMessage {
  id: string;
  threadId: string;
  userId: string;
  role: "user" | "assistant";
  content: string;
  timestamp?: string;  // Used when sending to backend
  createdAt?: string;  // Used when receiving from backend
  metadata?: Record<string, unknown>;
  messageGroupId?: string;  // Groups user message with its assistant responses
  retryNumber?: number;  // 0 = original, 1+ = retry attempts
  imageUrls?: string[];  // URLs to uploaded images
  isLatest?: boolean;  // true = current version, false = replaced by edit
}

export interface SyncRequest {
  userId: string;
  threads: ApiThread[];
  messages: ApiMessage[];
}

export interface SyncResponse {
  success: boolean;
  threadsUpserted: number;
  messagesUpserted: number;
  error?: string;
}

export interface LoadResponse {
  threads: ApiThread[];
  messages: ApiMessage[];
}

export interface QuizAttemptAnswerInput {
  question: string;
  options: string[];
  selected: number[];
  correct: number[];
  reason: string;
  explanation?: string;
  targetsMisconception?: string;
}

export interface FirstQuizAttemptResult {
  created: boolean;
  assetId: string;
  submittedAt: string;
  score: number;
  totalQuestions: number;
  answers?: GradedQuizAnswer[];
  receipt?: QuizProcessingReceipt | null;
}

export interface GradedQuizAnswer {
  question: string;
  problemId?: string;
  options?: string[];
  selectedKeys?: string[];
  selected: number[];
  correct: number[];
  isCorrect: boolean;
  reason: string;
  explanation: string;
}

export interface QuizProcessingReceipt {
  event_id: string;
  status: "ACCEPTED" | "PENDING" | "PROCESSING" | "RETRY_PENDING" | "COMPLETED" | "FAILED" | "REJECTED" | "SUPERSEDED";
  result_snapshot_version?: number | null;
  error_code?: string | null;
}

export type GradedQuizAttempt = FirstQuizAttemptResult & { answers: GradedQuizAnswer[] };
export type FirstQuizAttemptStatus = {
  exists: boolean;
  assetId: string | null;
  submittedAt: string | null;
  score?: number;
  totalQuestions?: number;
  answers?: GradedQuizAnswer[];
  receipt?: QuizProcessingReceipt | null;
};

export type QuizAssetQuestionInput = QuizQuestion;

export function isGradedQuizAttempt(value: unknown): value is GradedQuizAttempt {
  if (!isLearningRecord(value) || typeof value.created !== "boolean"
    || typeof value.score !== "number" || !Number.isInteger(value.score) || value.score < 0
    || typeof value.totalQuestions !== "number" || !Number.isInteger(value.totalQuestions) || value.totalQuestions < 1 || value.score > value.totalQuestions
    || !Array.isArray(value.answers) || value.answers.length !== value.totalQuestions) return false;
  return value.answers.every(answer => isLearningRecord(answer)
    && typeof answer.question === "string" && typeof answer.reason === "string"
    && typeof answer.isCorrect === "boolean" && typeof answer.explanation === "string"
    && (answer.options === undefined || (Array.isArray(answer.options) && answer.options.every(option => typeof option === "string")))
    && Array.isArray(answer.selected) && answer.selected.every(index => Number.isInteger(index) && index >= 0)
    && Array.isArray(answer.correct) && answer.correct.every(index => Number.isInteger(index) && index >= 0));
}

export interface LearnerProgressItem {
  status: "not_started" | "in_progress" | "learned";
  module?: string | null;
  latest_summary?: string | null;
  last_touched?: string | null;
  last_updated?: string | null;
  misconceptions_addressed?: string[];
  misconception_notes?: Record<string, { note?: string; recorded_at?: string | null }>;
}

export interface LearnerLearningProgress {
  topics: Record<string, LearnerProgressItem> | null;
  threshold_concepts: Record<string, LearnerProgressItem> | null;
  objectives: Record<string, {
    status: LearnerProgressItem["status"];
    evidence?: string | null;
  }> | null;
}

export interface LearnerLearningSnapshot {
  user_id: string;
  agent_id: string;
  status: "ok" | "no_state";
  progress: LearnerLearningProgress | null;
  learning_preferences: string[];
}

function isLearningRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isOptionalLearningText(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

function isLearningStatus(value: unknown): value is LearnerProgressItem["status"] {
  return value === "not_started" || value === "in_progress" || value === "learned";
}

function isLearnerProgressItem(value: unknown): value is LearnerProgressItem {
  if (!isLearningRecord(value) || !isLearningStatus(value.status)
    || !["module", "latest_summary", "last_touched", "last_updated"].every(key => isOptionalLearningText(value[key]))) return false;
  if (value.misconceptions_addressed !== undefined && (!Array.isArray(value.misconceptions_addressed)
    || !value.misconceptions_addressed.every(item => typeof item === "string"))) return false;
  return value.misconception_notes === undefined || (isLearningRecord(value.misconception_notes)
    && Object.values(value.misconception_notes).every(note => isLearningRecord(note)
      && (note.note === undefined || typeof note.note === "string") && isOptionalLearningText(note.recorded_at)));
}

function readLearningCollection<T>(value: unknown, check: (item: unknown) => item is T): Record<string, T> | null {
  if (value === null) return null;
  if (!isLearningRecord(value) || !Object.entries(value).every(([name, entry]) => name.trim() && check(entry))) {
    throw new Error("Invalid learner learning data");
  }
  return value as Record<string, T>;
}

function readLearnerLearning(value: unknown, userId: string, agentId: string): LearnerLearningSnapshot {
  if (!isLearningRecord(value) || value.user_id !== userId || value.agent_id !== agentId
    || (value.status !== "ok" && value.status !== "no_state")
    || !Array.isArray(value.learning_preferences)
    || !value.learning_preferences.every(item => typeof item === "string" && item.trim())) {
    throw new Error("Invalid learner learning response");
  }
  let progress: LearnerLearningProgress | null = null;
  if (value.status === "no_state") {
    if (value.progress !== null) throw new Error("Invalid empty learning response");
  } else {
    if (!isLearningRecord(value.progress)) throw new Error("Missing learner learning data");
    progress = {
      topics: readLearningCollection(value.progress.topics, isLearnerProgressItem),
      threshold_concepts: readLearningCollection(value.progress.threshold_concepts, isLearnerProgressItem),
      objectives: readLearningCollection(value.progress.objectives,
        (item): item is NonNullable<LearnerLearningProgress["objectives"]>[string] =>
          isLearningRecord(item) && isLearningStatus(item.status) && isOptionalLearningText(item.evidence)),
    };
  }
  return {
    user_id: userId, agent_id: agentId, status: value.status, progress,
    learning_preferences: value.learning_preferences,
  };
}

class ChatApiService {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE) {
    this.baseUrl = baseUrl;
  }

  private async fetch<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    // Guard against undefined values in endpoint
    if (endpoint.includes("undefined") || endpoint.includes("null")) {
      console.error("[ChatApi] Invalid endpoint with undefined/null:", endpoint);
      throw new Error(`Invalid API endpoint: ${endpoint}`);
    }
    
    const url = `${this.baseUrl}${endpoint}`;
    const headers = new Headers(options.headers);
    if (options.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(url, {
      ...options,
      credentials: "include",
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error ${response.status}: ${errorText}`);
    }

    return response.json();
  }

  async getLearnerLearning(agentId: string, userId: string, signal?: AbortSignal): Promise<LearnerLearningSnapshot> {
    const data = await this.fetch<unknown>(`/api/learner-profile/learning/${encodeURIComponent(agentId)}`, {
      signal, cache: "no-store",
    });
    return readLearnerLearning(data, userId, agentId);
  }

  // Health check
  async checkHealth(): Promise<boolean> {
    try {
      const result = await this.fetch<{ status: string }>("/api/chat/health");
      return result.status === "healthy";
    } catch {
      console.warn("Chat API health check failed");
      return false;
    }
  }

  // Load all chat data for a user
  async loadUserData(userId: string, agentId?: string): Promise<LoadResponse> {
    if (!userId) {
      console.warn("[ChatApi] loadUserData called with undefined userId");
      return { threads: [], messages: [] };
    }
    const params = new URLSearchParams();
    if (agentId) params.set("agent_id", agentId);
    const query = params.toString() ? `?${params.toString()}` : "";
    
    return this.fetch<LoadResponse>(`/api/chat/load/${userId}${query}`);
  }

  // Get threads for a user
  async getThreads(userId: string, agentId?: string): Promise<{ threads: ApiThread[] }> {
    if (!userId) {
      console.warn("[ChatApi] getThreads called with undefined userId");
      return { threads: [] };
    }
    const params = new URLSearchParams();
    if (agentId) params.set("agent_id", agentId);
    const query = params.toString() ? `?${params.toString()}` : "";
    
    return this.fetch<{ threads: ApiThread[] }>(`/api/chat/threads/${userId}${query}`);
  }

  // Get a single thread
  async getThread(threadId: string, userId: string): Promise<{ thread: ApiThread }> {
    if (!userId || !threadId) {
      throw new Error("threadId and userId are required");
    }
    return this.fetch<{ thread: ApiThread }>(
      `/api/chat/thread/${threadId}?user_id=${userId}`
    );
  }

  // Create a new thread
  async createThread(thread: ApiThread): Promise<{ success: boolean; thread: ApiThread }> {
    return this.fetch<{ success: boolean; thread: ApiThread }>("/api/chat/thread", {
      method: "POST",
      body: JSON.stringify(thread),
    });
  }

  // Update a thread
  async updateThread(
    threadId: string,
    userId: string,
    updates: Partial<ApiThread>
  ): Promise<{ success: boolean; thread: ApiThread }> {
    return this.fetch<{ success: boolean; thread: ApiThread }>(
      `/api/chat/thread/${threadId}?user_id=${userId}`,
      {
        method: "PUT",
        body: JSON.stringify(updates),
      }
    );
  }

  // Delete a thread
  async deleteThread(threadId: string, userId: string): Promise<{ success: boolean }> {
    return this.fetch<{ success: boolean }>(
      `/api/chat/thread/${threadId}?user_id=${userId}`,
      { method: "DELETE" }
    );
  }

  // Get messages for a thread with pagination support
  async getMessages(
    threadId: string,
    userId: string,
    options?: {
      limit?: number;
      offset?: number;
      before?: string; // ISO timestamp - get messages older than this
    }
  ): Promise<{ messages: ApiMessage[]; total: number; hasMore: boolean }> {
    const params = new URLSearchParams({ user_id: userId });
    if (options?.limit) params.set("limit", options.limit.toString());
    if (options?.offset) params.set("offset", options.offset.toString());
    if (options?.before) params.set("before", options.before);

    return this.fetch<{ messages: ApiMessage[]; total: number; hasMore: boolean }>(
      `/api/chat/thread/${threadId}/messages?${params.toString()}`
    );
  }

  // Get all messages (helper that fetches without pagination)
  async getAllMessages(
    threadId: string,
    userId: string
  ): Promise<{ messages: ApiMessage[] }> {
    const result = await this.getMessages(threadId, userId);
    return { messages: result.messages };
  }

  // Create a new message
  async createMessage(
    message: ApiMessage
  ): Promise<{ success: boolean; message: ApiMessage }> {
    return this.fetch<{ success: boolean; message: ApiMessage }>("/api/chat/message", {
      method: "POST",
      body: JSON.stringify(message),
    });
  }

  // Delete a message
  async deleteMessage(
    messageId: string,
    userId: string,
    threadId: string
  ): Promise<{ success: boolean }> {
    return this.fetch<{ success: boolean }>(
      `/api/chat/message/${messageId}?user_id=${userId}&thread_id=${threadId}`,
      { method: "DELETE" }
    );
  }

  // Bulk sync threads and messages
  async sync(request: SyncRequest): Promise<SyncResponse> {
    return this.fetch<SyncResponse>("/api/chat/sync", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  // ============================================================================
  // User Profile Operations
  // ============================================================================

  // Get user profile from Cosmos DB
  async getUserProfile(userId: string): Promise<{ success: boolean; profile: UserProfile | null }> {
    if (!userId) {
      console.warn("[ChatApi] getUserProfile called with undefined userId");
      return { success: false, profile: null };
    }
    return this.fetch<{ success: boolean; profile: UserProfile | null }>(`/api/user/${userId}`);
  }

  // Create or update user profile in Cosmos DB
  async updateUserProfile(userId: string, profile: UserProfileUpdate): Promise<{ success: boolean; profile: UserProfile }> {
    if (!userId) {
      throw new Error("userId is required");
    }
    return this.fetch<{ success: boolean; profile: UserProfile }>(`/api/user/${userId}`, {
      method: "PUT",
      body: JSON.stringify(profile),
    });
  }

  // Delete user profile from Cosmos DB
  async deleteUserProfile(userId: string): Promise<{ success: boolean }> {
    if (!userId) {
      throw new Error("userId is required");
    }
    return this.fetch<{ success: boolean }>(`/api/user/${userId}`, { method: "DELETE" });
  }

  // ============================================================================
  // Chat Sharing
  // ============================================================================

  // Create a shareable link for a thread
  async createShareLink(
    threadId: string,
    userId: string,
    messageIds: string[],
    refresh = false,
  ): Promise<{ success: boolean; share_token: string; thread_id: string }> {
    return this.fetch<{ success: boolean; share_token: string; thread_id: string }>(
      `/api/chat/thread/${threadId}/share?user_id=${userId}`,
      { method: "POST", body: JSON.stringify({ message_ids: messageIds, refresh }) }
    );
  }

  // Revoke a shareable link
  async revokeShareLink(threadId: string, userId: string): Promise<{ success: boolean }> {
    return this.fetch<{ success: boolean }>(
      `/api/chat/thread/${threadId}/share?user_id=${userId}`,
      { method: "DELETE" }
    );
  }

  // Get a shared chat by token (public - no auth required)
  async getSharedChat(shareToken: string): Promise<SharedChatResponse> {
    return this.fetch<SharedChatResponse>(`/api/shared/${shareToken}`);
  }

  // ============================================================================
  // Assets / Artifacts
  // ============================================================================

  async saveQuizAsset(input: {
    userId: string;
    quizId: string;
    assessmentInstanceId?: string;
    curriculumVersion?: string;
    title: string;
    agentId: string;
    threadId?: string;
    assessmentType?: "concept_inventory" | "practice_quiz";
    thresholdConcept?: string;
    questions: QuizAssetQuestionInput[];
    tags?: string[];
  }): Promise<{ assetId: string; createdAt: string }> {
    return this.fetch("/api/quiz-assets", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async getFirstQuizAttemptStatus(
    userId: string,
    agentId: string,
    quizId: string,
  ): Promise<FirstQuizAttemptStatus> {
    const params = new URLSearchParams({ userId, agentId });
    return this.fetch(
      `/api/quiz-attempts/${encodeURIComponent(quizId)}/first?${params.toString()}`,
    );
  }

  async submitFirstQuizAttempt(input: {
    userId: string;
    quizId: string;
    title: string;
    agentId: string;
    threadId?: string;
    assessmentType?: "concept_inventory" | "practice_quiz";
    thresholdConcept?: string;
    answers: QuizAttemptAnswerInput[];
  }): Promise<FirstQuizAttemptResult> {
    return this.fetch<FirstQuizAttemptResult>("/api/quiz-attempts/first", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async submitFirstDiagnosticAttempt(input: {
    userId: string;
    agentId: string;
    quizId: string;
    assessmentInstanceId: string;
    curriculumVersion: string;
    event_id: string;
    title: string;
    threadId?: string;
    answers: Array<{ problemId?: string; selected: number[]; reason: string }>;
  }): Promise<GradedQuizAttempt> {
    const result = await this.fetch<unknown>("/api/quiz-attempts/first", {
      method: "POST",
      body: JSON.stringify(input),
    });
    if (!isGradedQuizAttempt(result)) throw new Error("Server grading is not available yet. Retry to retrieve your saved first attempt.");
    return result;
  }

  async appendQuizAgentFeedback(input: {
    userId: string;
    quizId: string;
    agentId: string;
    feedback: string;
  }): Promise<{ assetId: string; updatedAt: string }> {
    return this.fetch(`/api/quiz-attempts/${encodeURIComponent(input.quizId)}/feedback`, {
      method: "POST",
      body: JSON.stringify({
        userId: input.userId,
        agentId: input.agentId,
        feedback: input.feedback,
      }),
    });
  }

  // Create a new asset
  async createAsset(
    userId: string,
    asset: {
      title: string;
      category: string;
      type: string;
      content: string;
      agentId?: string;
      threadId?: string;
      messageId?: string;
      description?: string;
      previewImageUrl?: string;
      isPublic?: boolean;
      tags?: string[];
    }
  ): Promise<Asset> {
    if (isRetiredAsset(asset)) throw new Error("This asset type is no longer supported.");
    return this.fetch<Asset>(`/api/assets?user_id=${userId}`, {
      method: "POST",
      body: JSON.stringify(asset),
    });
  }

  // List user's assets
  async listAssets(
    userId: string,
    options?: {
      category?: string;
      agentId?: string;
      threadId?: string;
      limit?: number;
    }
  ): Promise<{ assets: Asset[]; total: number }> {
    const params = new URLSearchParams({ user_id: userId });
    if (options?.category) params.append("category", options.category);
    if (options?.agentId) params.append("agentId", options.agentId);
    if (options?.threadId) params.append("threadId", options.threadId);
    if (options?.limit) params.append("limit", options.limit.toString());

    const result = await this.fetch<{ assets: Asset[]; total: number }>(`/api/assets?${params}`);
    return { ...result, assets: result.assets.filter(asset => !isRetiredAsset(asset)) };
  }

  // List public assets (inspiration)
  async listPublicAssets(options?: {
    category?: string;
    tags?: string[];
    limit?: number;
  }): Promise<{ assets: Asset[]; total: number }> {
    const params = new URLSearchParams();
    if (options?.category) params.append("category", options.category);
    if (options?.tags?.length) params.append("tags", options.tags.join(","));
    if (options?.limit) params.append("limit", options.limit.toString());

    const query = params.toString();
    const result = await this.fetch<{ assets: Asset[]; total: number }>(`/api/assets/public${query ? `?${query}` : ""}`);
    return { ...result, assets: result.assets.filter(asset => !isRetiredAsset(asset)) };
  }

  // Get a single asset
  async getAsset(assetId: string, userId?: string): Promise<Asset> {
    const params = userId ? `?user_id=${userId}` : "";
    const asset = await this.fetch<Asset>(`/api/assets/${assetId}${params}`);
    if (isRetiredAsset(asset)) throw new Error("This asset is no longer available.");
    return asset;
  }

  // Update an asset
  async updateAsset(
    assetId: string,
    userId: string,
    updates: {
      title?: string;
      description?: string;
      content?: string;
      category?: string;
      type?: string;
      previewImageUrl?: string;
      isPublic?: boolean;
      tags?: string[];
    }
  ): Promise<Asset> {
    return this.fetch<Asset>(`/api/assets/${assetId}?user_id=${userId}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    });
  }

  // Delete an asset
  async deleteAsset(assetId: string, userId: string): Promise<{ success: boolean }> {
    return this.fetch<{ success: boolean }>(`/api/assets/${assetId}?user_id=${userId}`, {
      method: "DELETE",
    });
  }
}

// User profile types
export interface UserProfileAffiliation {
  institute: string;
  department: string;
  role: string;
}

export interface UserProfile {
  id: string;
  userId: string;
  fullName: string;
  displayName: string;
  nickname: string;
  email: string;
  department: string;
  college: string;
  workFunction: string;
  preferences: string;
  customInstructions: string;
  learningProfile: string;
  authProvider: string;
  language: string;
  currentLocation: string;
  interests: string;
  passionateAbout: string;
  onboardingCompleted: boolean;
  role?: string;
  status?: "invited" | "active";
  affiliations?: UserProfileAffiliation[];
  activeAffiliation?: number;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfileUpdate {
  fullName?: string;
  displayName?: string;
  nickname?: string;
  email?: string;
  department?: string;
  college?: string;
  workFunction?: string;
  preferences?: string;
  customInstructions?: string;
  learningProfile?: string;
  authProvider?: string;
  language?: string;
  currentLocation?: string;
  interests?: string;
  passionateAbout?: string;
  onboardingCompleted?: boolean;
}

// Shared chat response (for public viewing)
export interface SharedChatResponse {
  thread: {
    id: string;
    title: string;
    agentId?: string;
    createdAt?: string;
    sharedAt?: string;
  };
  messages: {
    id: string;
    role: "user" | "assistant";
    content: string;
    createdAt?: string;
    metadata?: Record<string, unknown>;
  }[];
}

// Singleton instance
export const chatApi = new ChatApiService();

// Export for testing with different base URLs
export { ChatApiService };
