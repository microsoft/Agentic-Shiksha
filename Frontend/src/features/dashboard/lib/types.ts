// src/lib/types.ts

/**
 * Centralized app types for Ekalaiva / Agentic Shiksha UI + storage.
 */

import { randomUuid } from "@/lib/secureId";

export type View = "chat" | "library" | "create" | "edit" | "projectHome" | "assets";

/** Chat roles used across UI + storage */
export type ChatRole = "user" | "assistant" | "system";

/** Research message data embedded in chat */
export type ResearchData = {
  id: string;
  query: string;
  status: "running" | "completed" | "error" | "stopped" | "clarification";
  startTime: number;
  endTime?: number;
  activities: Array<{
    type: "search" | "thinking" | "read";
    content: string;
    url?: string;
    source?: string;
    timestamp: number;
    citations?: Array<{ title: string; url: string }>;
  }>;
  sources: Array<{
    title: string;
    url: string;
    domain: string;
    favicon?: string;
  }>;
  result?: string;
  error?: string;
  searchCount: number;
  // Multi-turn clarification support
  clarificationText?: string;  // Raw MCQ text from agent
  deepResearchThreadId?: string;  // Thread ID for continuing the conversation
};

/** Quiz question for interactive quiz blocks */
export type QuizQuestion = {
  question: string;
  options: string[];
  correct: number | number[]; // 0-based index (or array of indices) of correct answer(s)
  explanation: string;
  targetsMisconception?: string;
};

/** Flashcard for interactive flashcard blocks */
export type FlashCard = {
  front: string;
  back: string;
};

/** Content block types for structured agent responses */
export type ContentBlock = 
  | { type: "text"; content: string; isStreaming?: boolean }
  | { type: "document"; docId: string; title: string; isStreaming?: boolean }
  | { type: "quiz"; quizId: string; title: string; assessmentType?: "concept_inventory" | "practice_quiz"; thresholdConcept?: string; questions: QuizQuestion[] }
  | { type: "flashcard"; flashcardId: string; title: string; cards: FlashCard[] }
  | { type: "challenge"; challengeId: string; title: string; description: string; difficulty: string; hints?: string[]; solution: string; challengeType?: string }
  | { type: "tikz_image"; tikzImageId: string; title: string; imageData: string; caption?: string; visualizationType?: string };

export type EvidenceCitation = {
  ref: string;
  student_ref?: string;
  user_id?: string;
  kind: "concept_inventory" | "threshold_concept" | "topic_progress" | "asset";
  label: string;
  student: string;
  observed_at?: string;
};

/** UI message shape (old ChatMsg) */
export type ChatMsg = { 
  role: Exclude<ChatRole, "system">; 
  content: string;
  createdAt?: number; // ms epoch timestamp for response time calculation
  // Edit tracking - marks if this is the latest version of the message
  isLatest?: boolean; // true = current version, false = replaced by edit
  generatedDocId?: string;
  generatedDocTitle?: string;
  generatedDocContent?: string;  // Document content for persistence
  docBlockContent?: string;  // Text to show after the document block
  // Content blocks for structured responses (message + document sequences)
  contentBlocks?: ContentBlock[];
  // Image attachments
  imageUrls?: string[];  // URLs of images attached to this message
  // Citation sources from agent annotations (URL citations & file citations)
  sources?: Array<{ type?: string; title: string; url?: string; domain?: string; favicon?: string; filename?: string; file_id?: string }>;
  evidenceCitations?: EvidenceCitation[];
  chatSignalsReviewed?: boolean;
  // Research message support
  isResearch?: boolean;
  research?: ResearchData;
  researchStartTime?: number;  // For persisted research messages
  researchEndTime?: number;    // For persisted research messages
  // Retry tracking for message grouping
  messageGroupId?: string;  // Groups user message with its assistant responses
  retryNumber?: number;  // 0 = original, 1+ = retry attempts
  // Token usage from the agent response
  tokenUsage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    rounds: number;
    per_round: Array<{ round: number; tools: string[]; input_tokens: number; output_tokens: number }>;
  };
};

/** Common preview shape for teaching assistants */
export type AgentPreview = {
  name?: string;
  description?: string;
  instructions?: string;
};

export type LacaPreview = AgentPreview;

export type AzureAgentRow = {
  id: string;
  name: string;
  model?: string;
  status?: string;
  description?: string;
  created_by_id?: string;  // Creator's userId for permission checks (normalized design)
  created_by?: string;     // Creator's display name (looked up from users_v1)
  version?: string;
  agentImageUrl?: string;  // Blob storage URL for agent profile image
  course_code?: string;    // Course code (e.g., CS101)
  department_id?: string;  // Department this agent belongs to
};

/** Agent kind - simplified to single teaching assistant type */
export type AgentKind = "course";

/** Mode type kept for backward compatibility */
export type Mode = AgentKind;

/** Builder thread classification (for chat history + restore) */
export type BuilderKind = "tca_builder" | "eca_builder" | "preview";

export type ChatContext = {
  projectId: string; // e.g. "my-project-1"
  mode: Mode; // "course" (teaching assistant)
  courseSlug: string; // e.g. "discrete_structures"
  agentName: string; // e.g. "Threshold Concept Agent"

  // ✅ added for history + restore
  sessionUuid?: string;
  builderKind?: BuilderKind;

  // ✅ optional course metadata (lets you restore Setup fields after refresh)
  courseName?: string;
  courseLevel?: string;
  courseSpan?: string;
  courseNotes?: string;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number; // ms epoch

  // ✅ Edit tracking - marks if this is the latest version of the message
  isLatest?: boolean; // true = current version, false = replaced by edit

  // ✅ Image attachments for user messages
  imageUrls?: string[];

  // ✅ generated-doc support (so doc preview works even after refresh)
  generatedDocId?: string;
  generatedDocTitle?: string;
  generatedDocContent?: string; // stored (capped) in localStorage
  docBlockContent?: string; // Text to show after the document block
  
  // ✅ Content blocks for structured responses (message + document sequences)
  contentBlocks?: ContentBlock[];
  
  // ✅ Research message support (for persistence)
  isResearch?: boolean;
  research?: ResearchData;
  researchStartTime?: number;  // For persisted research messages
  researchEndTime?: number;    // For persisted research messages
  
  // ✅ Retry tracking for message grouping
  messageGroupId?: string;  // Groups user message with its assistant responses
  retryNumber?: number;  // 0 = original, 1+ = retry attempts
};

export type BuilderChat = {
  id: string; // local id
  kind: AgentKind; // "course" (teaching assistant)
  title: string; // shown in left sidebar
  azureThreadId: string | null; // TCA/ECA thread id
  messages: ChatMsg[]; // chat transcript
  updatedAt: number; // ms epoch, for sorting
};

/**
 * Safe local id generator, backed by the Web Crypto API.
 */
export const newLocalId = (): string => randomUuid();

export type ChatThread = {
  id: string;
  title: string;
  agentId?: string; // linked Azure agent ID
  userId?: string; // owner of this thread
  shareToken?: string; // token for public sharing (read-only access)
  createdAt: number; // ms epoch
  updatedAt: number; // ms epoch
  context: ChatContext;
};

export type Project = {
  id: string;
  name: string;
  agentId?: string; // linked Azure agent ID
  agentName?: string; // display name (course name)
  agentKind?: AgentKind; // "course" (teaching assistant)
  userId?: string; // owner of this project
  createdAt: number; // ms epoch
  updatedAt: number; // ms epoch
};

/** If you still need your backend DB types, keep them separate */
export type CourseChatMessage = {
  id: string;
  chat_id: string;
  role: ChatRole;
  content: string;
  created_at: string;
};

export type CourseChatSession = {
  id: string;
  session_uuid?: string | null;
  course_name?: string | null;
  course_slug?: string | null;
  agent_kind: Mode | "other";
  agent_id: string;
  agent_name?: string | null;
  title: string;
  azure_thread_id?: string | null;
  created_at: string;
  updated_at: string;
  messages: CourseChatMessage[];
};

// ============================================================================
// Asset (Artifact) Types - Chat-generated content and student creations
// ============================================================================

/** Asset category for filtering */
export type AssetCategory = 
  | "all"
  | "document"
  | "quiz"
  | "flashcard"
  | "challenge"
  | "diagram"
  | "summary"
  | "code"
  | "visualization"
  | "other";

/** Asset type - what kind of content it is */
export type AssetType = 
  | "html"        // Interactive HTML/CSS/JS
  | "markdown"    // Markdown document
  | "code"        // Code snippet
  | "mermaid"     // Mermaid diagram
  | "svg"         // SVG image
  | "json"        // JSON data (flashcards, quiz, etc.)
  | "text";       // Plain text

/** Asset data */
export type Asset = {
  id: string;
  userId: string;              // Owner
  agentId?: string;            // Which agent generated it (optional)
  threadId?: string;           // Which thread it was generated in (optional)
  title: string;
  description?: string;
  category: AssetCategory;
  type: AssetType;
  content: string;             // The actual content (HTML, markdown, code, etc.)
  previewImageUrl?: string;    // Optional preview thumbnail
  isPublic?: boolean;          // Whether visible in inspiration gallery
  tags?: string[];             // Optional tags for filtering
  createdAt: string;           // ISO timestamp
  updatedAt: string;           // ISO timestamp
};