// src/lib/chatApi.ts
// API service for chat persistence with Cosmos DB

import type { Asset } from "./types";

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
}

export interface QuizAssetQuestionInput {
  question: string;
  options: string[];
  correct: number | number[];
  explanation: string;
  targetsMisconception?: string;
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
    userId: string
  ): Promise<{ success: boolean; share_token: string; thread_id: string }> {
    return this.fetch<{ success: boolean; share_token: string; thread_id: string }>(
      `/api/chat/thread/${threadId}/share?user_id=${userId}`,
      { method: "POST" }
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
  ): Promise<{ exists: boolean; assetId: string | null; submittedAt: string | null }> {
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

    return this.fetch<{ assets: Asset[]; total: number }>(`/api/assets?${params}`);
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
    return this.fetch<{ assets: Asset[]; total: number }>(`/api/assets/public${query ? `?${query}` : ""}`);
  }

  // Get a single asset
  async getAsset(assetId: string, userId?: string): Promise<Asset> {
    const params = userId ? `?user_id=${userId}` : "";
    return this.fetch<Asset>(`/api/assets/${assetId}${params}`);
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
