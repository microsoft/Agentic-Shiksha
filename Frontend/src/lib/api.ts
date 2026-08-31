// lib/api.ts
import {
  API_BASE_URL,
  TEMP_COURSE_AGENT_ID,
} from "./config";
import type {
  AzureAgentRow,
} from "./types";

/* ------------------------------ Base + helpers ------------------------------ */

// Ensure BASE ends with /api (once) and no trailing slash afterwards
function withApiSuffix(base: string): string {
  const trimmed = (base || "").replace(/\/+$/, "");
  if (/\/api$/i.test(trimmed)) return trimmed; // already has /api
  return `${trimmed}/api`;
}

// Full base used for all API calls, e.g. http://localhost:8000/api
const BASE = withApiSuffix(API_BASE_URL);

// Origin part used when backend returns absolute paths like /api/...
// e.g. BASE_ORIGIN = http://localhost:8000
const BASE_ORIGIN = (() => {
  try {
    return new URL(BASE).origin;
  } catch {
    return "";
  }
})();

// Build URL for an API path relative to BASE (/api)
function buildUrl(path: string): string {
  // If caller passed a full URL, don't touch it
  if (/^https?:\/\//i.test(path)) return path;
  return `${BASE}/${path.replace(/^\/+/, "")}`;
}

// Turn any backend-returned URL into an absolute URL that uses the same origin
// Examples:
//   "/api/knowledge/download/..." -> "http://localhost:8000/api/knowledge/download/..."
//   "knowledge/download/..."      -> "http://localhost:8000/api/knowledge/download/..."
//   "http://other/..."            -> stays as-is
/**
 * Converts a relative backend path to an absolute URL using BASE_ORIGIN.
 * Exported for use in components that need to resolve image URLs.
 */
export function absoluteBackendUrl(u: string): string {
  if (!u) return u;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith("/")) {
    // already has /api/... from backend
    return `${BASE_ORIGIN}${u}`;
  }
  // relative path -> treat as API path
  return buildUrl(u);
}

/**
 * Checks whether a URL's host is an Azure Blob Storage host
 * (`<account>.blob.core.windows.net`), by parsing the URL rather than doing
 * a substring match, so arbitrary hosts embedding the domain elsewhere in
 * the URL (path/query) are not misidentified as Azure Blob Storage.
 */
export function isAzureBlobUrl(url: string): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.endsWith(".blob.core.windows.net");
  } catch {
    return false;
  }
}

/**
 * Converts an Azure Blob Storage URL to a proxied URL via our backend.
 * This is needed because blob URLs require authentication.
 * 
 * @param url - The URL to potentially convert
 * @returns Proxied URL if it's a blob URL, otherwise the original URL
 */
export function getBlobProxyUrl(url: string): string {
  if (!url) return url;
  
  // If it's a local blob: URL (from createObjectURL), keep it as-is
  if (url.startsWith('blob:')) return url;
  
  // If it's an Azure Blob Storage URL, proxy it
  // Note: BASE already includes /api, so we just append /blob/proxy
  if (isAzureBlobUrl(url)) {
    // Decode the URL first to handle already-encoded URLs (like spaces as %20)
    // Then encode it properly for the query parameter
    // This prevents double-encoding issues (e.g., %20 becoming %2520)
    try {
      const decodedUrl = decodeURIComponent(url);
      return `${BASE}/blob/proxy?url=${encodeURIComponent(decodedUrl)}`;
    } catch {
      // If decoding fails, use the URL as-is
      return `${BASE}/blob/proxy?url=${encodeURIComponent(url)}`;
    }
  }
  
  // Otherwise return as-is
  return url;
}

function asErrorMessage(x: any): string {
  if (x == null) return "Unknown error";
  if (typeof x === "string") return x;
  if (typeof x.detail === "string") return x.detail;
  if (x.detail && typeof x.detail === "object") {
    try {
      return JSON.stringify(x.detail);
    } catch {
      /* noop */
    }
  }
  if (typeof x.message === "string") return x.message;
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}


export type KBScope = "course" | "exam" | "textbook";

function addKbScopeToAbsoluteUrl(absUrl: string, kbScope: KBScope): string {
  if (!absUrl) return absUrl;
  try {
    const u = new URL(absUrl);
    u.searchParams.set("kb_scope", kbScope);
    return u.toString();
  } catch {
    // if somehow not absolute, just return as-is
    return absUrl;
  }
}


async function parseBody(res: Response) {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try {
      return await res.json();
    } catch {
      /* fallthrough */
    }
  }
  try {
    return await res.text();
  } catch {
    return null;
  }
}

/** JSON/text aware request that throws Error(detail/message/body) on !ok */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(buildUrl(path), {
    ...init,
    credentials: init.credentials ?? "include",
    headers,
  });

  const body = await parseBody(res);

  if (!res.ok) {
    throw new Error(asErrorMessage(body) || `${res.status} ${res.statusText}`);
  }
  return body as T;
}

/** FormData request (no explicit Content-Type) with same error behavior */
async function requestForm<T>(
  path: string,
  form: FormData,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(buildUrl(path), {
    method: "POST",
    body: form,
    credentials: "include",
    ...(init || {}),
    headers: { ...(init.headers || {}) }, // do NOT set Content-Type here
  });

  const body = await parseBody(res);

  if (!res.ok) {
    throw new Error(asErrorMessage(body) || `${res.status} ${res.statusText}`);
  }
  return body as T;
}

// Exported for legacy callers, maps to our robust JSON request
export const api = request;

/* ------------------------------- CCA / CACA -------------------------------- */

/**
 * Start the CCA (Course Conversational Agent) thread.
 * POST /api/cca/start
 */
export function ccaStart(
  teacherOpening: string,
  sessionUuid?: string,
  vectorStoreId?: string | null
) {
  return request<{
    thread_id: string;
    last_reply: string;
    vector_store_id?: string;
  }>("cca/start", {
    method: "POST",
    body: JSON.stringify({
      teacher_opening: teacherOpening,
      session: sessionUuid,
      vector_store_id: vectorStoreId ?? undefined,
      // ccaAgentId: COURSE_CONVERSATIONAL_AGENT_ID, // optional, backend has default
    }),
  });
}

/**
 * Continue the CCA thread.
 * POST /api/cca/step
 */
export function ccaStep(
  threadId: string,
  teacherReply: string,
  sessionUuid?: string,
  vectorStoreId?: string | null
) {
  return request<{
    last_reply: string;
    vector_store_id?: string;
  }>("cca/step", {
    method: "POST",
    body: JSON.stringify({
      thread_id: threadId,
      teacher_reply: teacherReply,
      session: sessionUuid,
      vector_store_id: vectorStoreId ?? undefined,
      // ccaAgentId: COURSE_CONVERSATIONAL_AGENT_ID, // optional
    }),
  });
}

// NOTE: Removed deprecated functions:
// - cacaDraftFromCCA (used /api/caca/draft - removed)
// - approveAndCreateCourseAgent (used /api/caca/approve-create - removed)
// Agent creation now uses createAgentAsync()

/* ------------------------------- CACA (Exam) -------------------------------- */

// Teaching Assistant Creation Agent - Exam mode

export function cacaExamStart(
  teacherOpening: string,
  session: string,
  vectorStoreId: string | null
): Promise<{ thread_id: string; last_reply: string }> {
  return request<{ thread_id: string; last_reply: string }>("caca/start", {
    method: "POST",
    body: JSON.stringify({
      teacher_opening: teacherOpening,
      session,
      vector_store_id: vectorStoreId ?? undefined,
    }),
  });
}

export function cacaExamStep(
  threadId: string,
  teacherReply: string
): Promise<{ last_reply: string }> {
  return request<{ last_reply: string }>("caca/step", {
    method: "POST",
    body: JSON.stringify({
      thread_id: threadId,
      teacher_reply: teacherReply,
    }),
  });
}



// NOTE: Removed syncCcaMarkdown (used /api/knowledge/cca-sync - removed)

/* --------------------------- Agent update / preview ------------------------- */

export function updateTempPreviewAgent(model: string, instructions: string) {
  return request<{ ok: true }>(`agents/${TEMP_COURSE_AGENT_ID}/update`, {
    method: "POST",
    body: JSON.stringify({ model, instructions }),
  });
}

/**
 * Update any agent's model and/or instructions
 * POST /api/agents/{agent_id}/update
 */
export function updateAgent(agentId: string, model?: string, instructions?: string) {
  return request<{ ok: true }>(`agents/${agentId}/update`, {
    method: "POST",
    body: JSON.stringify({ model, instructions }),
  });
}

/**
 * Regenerate agent instructions via CACA meta-agent + prompt unifier, then update the agent.
 * Calls CACA for both learning and exam prompts, unifies with prompt store, and updates.
 * POST /api/agents/{agent_id}/regenerate-prompt
 */
export function regenerateAndUpdateAgent(
  agentId: string,
  opts: {
    courseName: string;
    courseLevel?: string;
    courseDuration?: string;
    additionalContext?: string;
    courseUrls?: string[];
    model?: string;
  }
) {
  return request<{
    ok: true;
    agent_id: string;
    description: string;
    conversation_starters: string[];
    instructions_length: number;
    learning_prompt_length: number;
    exam_prompt_length: number;
  }>(`agents/${agentId}/regenerate-prompt`, {
    method: "POST",
    body: JSON.stringify(opts),
  });
}

/**
 * Generate a title for a conversation based on the first message exchange.
 * Call this AFTER the first response completes.
 * POST /api/chat/generate-title
 */
export async function generateChatTitle(
  userMessage: string,
  assistantResponse: string,
  agentName?: string
): Promise<{ title: string }> {
  return request<{ title: string }>("chat/generate-title", {
    method: "POST",
    body: JSON.stringify({
      user_message: userMessage,
      assistant_response: assistantResponse,
      agent_name: agentName,
    }),
  });
}

/* -------------------------------- Knowledge -------------------------------- */

export async function uploadCoursePdfs(
  sessionUuid: string,
  pdfs: File[],
  kbScope: KBScope,              // ✅ NEW
  vectorStoreId?: string
): Promise<{ vector_store_id: string }> {
  const form = new FormData();
  form.append("session", sessionUuid);
  form.append("kb_scope", kbScope); // ✅ NEW

  for (const f of pdfs) form.append("files", f);
  if (vectorStoreId) form.append("vector_store_id", vectorStoreId);

  return requestForm<{ vector_store_id: string }>("knowledge/build", form, {
    credentials: "include",
  });
}



export async function uploadKnowledgeFiles(
  sessionUuid: string,
  files: File[],
  kbScope: KBScope,
  indexName?: string,
  descriptions?: Record<string, string>
): Promise<{ index_name: string; name?: string; files_uploaded?: number }> {
  const fd = new FormData();
  fd.append("session", sessionUuid);
  fd.append("kb_scope", kbScope);

  if (indexName) fd.append("index_name", indexName);
  if (descriptions && Object.keys(descriptions).length > 0) {
    fd.append("file_descriptions", JSON.stringify(descriptions));
  }
  for (const f of files) fd.append("files", f, f.name);

  return requestForm<{ index_name: string; name?: string; files_uploaded?: number }>(
    "knowledge/build",
    fd,
    { credentials: "include" }
  );
}





export function attachKnowledgeToAgent(
  index_name: string,
  agent_id: string,
  name: string
) {
  return request<{ ok: true }>("knowledge/attach", {
    method: "POST",
    body: JSON.stringify({ index_name, agent_id, name }),
  });
}

/* -------- Per-Course Index Management -------- */

/**
 * Create a dedicated Azure AI Search index for a course.
 * This creates the full pipeline: datasource, index, skillset, indexer.
 * Call this AFTER uploading files to blob storage via uploadKnowledgeFiles.
 */
export async function createCourseIndex(
  sessionUuid: string,
  kbScope: KBScope = "course"
): Promise<{
  ok: boolean;
  index_name?: string;
  session_uuid: string;
  kb_scope: string;
  message?: string;
}> {
  const fd = new FormData();
  fd.append("session_uuid", sessionUuid);
  fd.append("kb_scope", kbScope);

  return requestForm<{
    ok: boolean;
    index_name?: string;
    session_uuid: string;
    kb_scope: string;
    message?: string;
  }>("knowledge/create-index", fd, { credentials: "include" });
}

/**
 * Delete the Azure AI Search index for a course.
 * Call this when deleting a course/agent.
 */
export async function deleteCourseIndex(
  sessionUuid: string,
  kbScope: KBScope = "course"
): Promise<{
  ok: boolean;
  session_uuid: string;
  kb_scope: string;
  message?: string;
}> {
  const params = new URLSearchParams();
  params.set("session_uuid", sessionUuid);
  params.set("kb_scope", kbScope);

  return request<{
    ok: boolean;
    session_uuid: string;
    kb_scope: string;
    message?: string;
  }>(`knowledge/delete-index?${params.toString()}`, {
    method: "DELETE",
  });
}

/**
 * Update the Azure AI Search index after files have changed.
 * This resets and re-runs the indexer.
 * Call this after adding or deleting files in edit mode.
 */
export async function updateCourseIndex(
  sessionUuid: string,
  kbScope: KBScope = "course"
): Promise<{
  ok: boolean;
  index_name?: string;
  action?: "created" | "updated";
  message?: string;
}> {
  const fd = new FormData();
  fd.append("session_uuid", sessionUuid);
  fd.append("kb_scope", kbScope);

  return requestForm<{
    ok: boolean;
    index_name?: string;
    action?: "created" | "updated";
    message?: string;
  }>("knowledge/update-index", fd, { credentials: "include" });
}

/**
 * Get the status of the indexer for a course index.
 */
export async function getCourseIndexStatus(
  sessionUuid: string,
  kbScope: KBScope = "course"
): Promise<{
  exists: boolean;
  index_name?: string;
  session_uuid: string;
  kb_scope: string;
  status?: Record<string, unknown>;
  message?: string;
}> {
  const params = new URLSearchParams();
  params.set("session_uuid", sessionUuid);
  params.set("kb_scope", kbScope);

  return request<{
    exists: boolean;
    index_name?: string;
    session_uuid: string;
    kb_scope: string;
    status?: Record<string, unknown>;
    message?: string;
  }>(`knowledge/index-status?${params.toString()}`);
}

/* -------- UNIFIED Index Management (Course + Exam in One) -------- */

/**
 * Create a UNIFIED Azure AI Search index for a session.
 * This creates a single index that covers BOTH course/ and exam/ folders
 * under sessions/{sessionUuid}/.
 * 
 * Call this AFTER uploading ALL files (course and exam) to blob storage.
 * This replaces the need for separate createCourseIndex() calls for "course" and "exam".
 */
export async function createUnifiedIndex(
  sessionUuid: string
): Promise<{
  ok: boolean;
  index_name?: string;
  session_uuid: string;
  unified: boolean;
  message?: string;
}> {
  const fd = new FormData();
  fd.append("session_uuid", sessionUuid);

  return requestForm<{
    ok: boolean;
    index_name?: string;
    session_uuid: string;
    unified: boolean;
    message?: string;
  }>("knowledge/create-unified-index", fd, { credentials: "include" });
}

/**
 * Delete the UNIFIED Azure AI Search index for a session.
 * Deletes: indexer, skillset, index, datasource
 */
export async function deleteUnifiedIndex(
  sessionUuid: string
): Promise<{
  ok: boolean;
  session_uuid: string;
  message?: string;
}> {
  const params = new URLSearchParams();
  params.set("session_uuid", sessionUuid);

  return request<{
    ok: boolean;
    session_uuid: string;
    message?: string;
  }>(`knowledge/delete-unified-index?${params.toString()}`, {
    method: "DELETE",
  });
}

/* -------- Knowledge Pipeline Management (Common Index + AzureAISearchTool) -------- */

/**
 * Ensure the common index pipeline exists and trigger the indexer.
 *
 * With the common index approach, this creates 4 shared resources
 * (datasource, index, skillset, indexer) if they don't exist,
 * then triggers the indexer to process any new files.
 *
 * The agent creation flow will use AzureAISearchTool with a
 * session_id filter for per-session data isolation.
 *
 * Call this AFTER uploading files to blob storage.
 */
export async function createMcpPipeline(
  sessionUuid: string,
  teacherUrls?: string[]
): Promise<{
  ok: boolean;
  session_uuid: string;
  index_name?: string;
  session_filter?: string;
  message?: string;
}> {
  const fd = new FormData();
  fd.append("session_uuid", sessionUuid);

  // Teacher URLs now handled via BingCustomSearchTool on agent
  if (teacherUrls && teacherUrls.length > 0) {
    fd.append("teacher_urls", JSON.stringify(teacherUrls));
  }

  return requestForm<{
    ok: boolean;
    session_uuid: string;
    index_name?: string;
    session_filter?: string;
    message?: string;
  }>("knowledge/create-mcp-pipeline", fd, { credentials: "include" });
}

/**
 * Delete session documents from the common index.
 * Also attempts to clean up any legacy MCP pipeline resources.
 */
export async function deleteMcpPipeline(
  sessionUuid: string
): Promise<{
  ok: boolean;
  session_uuid: string;
  result?: string;
  legacy_cleanup?: Record<string, string>;
  message?: string;
}> {
  const params = new URLSearchParams();
  params.set("session_uuid", sessionUuid);

  return request<{
    ok: boolean;
    session_uuid: string;
    result?: string;
    legacy_cleanup?: Record<string, string>;
    message?: string;
  }>(`knowledge/delete-mcp-pipeline?${params.toString()}`, {
    method: "DELETE",
  });
}

/* -------- Knowledge file listing / deletion (session PDFs / MD / TC) ------- */

export type KnowledgeFile = {
  filename: string;
  size: number;
  download_url: string;
  kind?: string;
};

export type KnowledgeListResponse = {
  files: KnowledgeFile[];
  vector_store_id?: string | null;
};

export async function listKnowledgeFiles(
  session: string,
  kbScope: KBScope,                  // ✅ NEW
  vector_store_id?: string | null
) {
  const params = new URLSearchParams();
  params.set("session", session);
  params.set("kb_scope", kbScope);   // ✅ NEW
  if (vector_store_id) params.set("vector_store_id", vector_store_id);

  const raw = await request<KnowledgeListResponse>(
    `knowledge/list?${params.toString()}`
  );

  return {
    ...raw,
    files: (raw.files || []).map((f) => {
      const abs = absoluteBackendUrl(f.download_url);
      return {
        ...f,
        download_url: addKbScopeToAbsoluteUrl(abs, kbScope), // ✅ NEW
      };
    }),
  };
}


/**
 * Delete a knowledge file (PDF/markdown/TC markdown) for a session.
 * DELETE /api/knowledge/files/{session}/{filename}
 *
 * vector_store_id argument is accepted for call-site compatibility but
 * currently unused by the backend.
 */
export function deleteKnowledgeFile(
  session: string,
  filename: string,
  kbScope: KBScope,                 // ✅ NEW
  _vector_store_id?: string | null
) {
  const safeSession = encodeURIComponent(session);
  const safeFilename = encodeURIComponent(filename);

  return request<{ ok: true }>(
    `knowledge/files/${safeSession}/${safeFilename}?kb_scope=${encodeURIComponent(kbScope)}`,
    { method: "DELETE" }
  );
}


/* --------------------------------- Chatting -------------------------------- */

/**
 * Simple streaming chat that collects the full reply text.
 * Replaces the old non-streaming startAgentChat/continueAgentChat endpoints.
 * Uses the streaming endpoint under the hood but returns a simple { reply, thread_id }.
 */
export async function simpleStreamChat(
  agent_id: string,
  text: string,
  user_id: string,
  thread_id?: string | null,
  signal?: AbortSignal,
  web_search_enabled: boolean = false,
): Promise<{ reply: string; thread_id: string }> {
  let reply = "";
  let resolvedThreadId = thread_id || "";

  await streamAgentChat(
    agent_id,
    text,
    thread_id || null,
    (event) => {
      if (event.type === "thread_id" && event.thread_id) {
        resolvedThreadId = event.thread_id;
      }
    },
    {
      user_id,
      web_search_enabled,
      signal,
      onMessageBlockDelta: (delta) => {
        reply += delta;
      },
      onMessageBlock: (content) => {
        reply += content;
      },
    },
  );

  return { reply, thread_id: resolvedThreadId };
}

// Legacy non-streaming endpoints (kept for backward compatibility)
export function startAgentChat(
  agent_id: string,
  text: string,
  signal?: AbortSignal,
  web_search_enabled: boolean = false
) {
  return request<{ reply: string; thread_id: string }>(
    `agents/${agent_id}/chat/start`,
    { method: "POST", body: JSON.stringify({ text, web_search_enabled }), signal }
  );
}

export function continueAgentChat(
  agent_id: string,
  thread_id: string,
  text: string,
  signal?: AbortSignal,
  web_search_enabled: boolean = false
) {
  return request<{ reply: string }>(`agents/${agent_id}/chat/continue`, {
    method: "POST",
    body: JSON.stringify({ thread_id, text, web_search_enabled }),
    signal,
  });
}

/* --------------------------------- List Agents -------------------------------- */

export interface AgentListItem {
  id: string;
  name: string;
  description?: string;
  model?: string;
  created_at?: number;
}

export async function listAgents(): Promise<AgentListItem[]> {
  return listAzureAgents();
}

/* --------------------------------- Streaming Chat -------------------------------- */

export interface StreamEvent {
  type: "thread_id" | "delta" | "done" | "error" | "document" | "tikz_image" | "generated_image" | "citations" | "research_triggered" | "thinking" | "research_status" | "research_complete" | "clarification_done" | "usage";
  content?: string;
  thread_id?: string;
  error?: string;
  // Document generation fields (from create_document tool)
  title?: string;
  doc_type?: "markdown" | "code" | "html";
  // Research-specific fields
  summary?: string;
  citations?: Array<{ type?: string; url?: string; title?: string; filename?: string; file_id?: string }>;
  status?: string;
  response?: string;
  // Token usage fields
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  rounds?: number;
  per_round?: Array<{ round: number; response_id?: string; tools: string[]; input_tokens: number; output_tokens: number }>;
}

export interface StreamAgentChatOptions {
  /** Required: keys the student's learning state on the backend. */
  user_id: string;
  usage_event_id?: string;
  web_search_enabled?: boolean;
  research_mode?: boolean;
  inject_profile?: boolean;  // If true, backend injects user profile into agent context
  user_profile?: Record<string, string>;  // Inline profile data from frontend cache (avoids Cosmos fetch)
  image_urls?: string[];  // URLs of uploaded images to include in the message
  signal?: AbortSignal;
  onDocument?: (event: { title: string; content: string; doc_type?: string }) => void;
  onDocumentStart?: () => void;
  onDocumentTitle?: (title: string) => void;
  onDocumentDelta?: (delta: string) => void;
  onMessageBlockStart?: () => void;
  onMessageBlockDelta?: (delta: string) => void;
  onMessageBlock?: (content: string) => void;
  onQuizStart?: () => void;
  onQuiz?: (event: {
    title: string;
    assessmentType?: "concept_inventory" | "practice_quiz";
    thresholdConcept?: string;
    questions: Array<{
      question: string;
      options: string[];
      correct: number | number[];
      explanation: string;
      targetsMisconception?: string;
    }>;
  }) => void;
  onFlashcardStart?: () => void;
  onFlashcard?: (event: { title: string; cards: Array<{ front: string; back: string }> }) => void;
  onChallengeStart?: () => void;
  onChallenge?: (event: { title: string; description: string; difficulty: string; hints?: string[]; solution: string; challengeType?: string }) => void;
  onTikzImageStart?: () => void;
  onTikzImage?: (event: { title: string; imageData: string; caption?: string; visualizationType?: string }) => void;
  onGeneratedImageStart?: () => void;
  onGeneratedImage?: (event: { title: string; imageData: string; imageUrl?: string; caption?: string; size?: string; quality?: string }) => void;
  onClarify?: (event: { clarifyId: string; questions: Array<{ question: string; options: string[]; context?: string }> }) => void;
  onSuggestedQueries?: (event: { queries: string[] }) => void;
  /** A block tool failed after its placeholder was drawn. */
  onBlockCancel?: (tool?: string) => void;
  /** Fired when the agent starts any tool, so the UI can name the work. */
  onToolStart?: (tool: string) => void;
  onResearchTriggered?: (event: { query: string }) => void;
  onThinking?: (event: { summary: string; citations?: Array<{ url: string; title?: string }> }) => void;
  onResearchStatus?: (event: { status: string }) => void;
  onResearchComplete?: (event: { response: string; citations?: Array<{ url: string; title?: string }> }) => void;
  onClarificationDone?: () => void;
  onCitations?: (citations: Array<{ type?: string; url?: string; title?: string; filename?: string; file_id?: string }>) => void;
}

export async function streamAgentChat(
  agent_id: string,
  text: string,
  thread_id: string | null,
  onEvent: (event: StreamEvent) => void,
  options: StreamAgentChatOptions
): Promise<void> {
  const { 
    web_search_enabled = false, 
    research_mode = false,
    user_id,
    usage_event_id,
    inject_profile,
    user_profile,
    image_urls,
    signal,
    onDocument,
    onDocumentStart,
    onDocumentTitle,
    onDocumentDelta,
    onMessageBlockStart,
    onMessageBlockDelta,
    onMessageBlock,
    onQuizStart,
    onQuiz,
    onFlashcardStart,
    onFlashcard,
    onChallengeStart,
    onChallenge,
    onTikzImageStart,
    onTikzImage,
    onGeneratedImageStart,
    onGeneratedImage,
    onClarify,
    onSuggestedQueries,
    onBlockCancel,
    onToolStart,
    onResearchTriggered,
    onThinking,
    onResearchStatus,
    onResearchComplete,
    onClarificationDone,
    onCitations
  } = options;

  const response = await fetch(`${withApiSuffix(API_BASE_URL)}/agents/${agent_id}/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ 
      text, 
      thread_id: thread_id || null, 
      user_id, 
      usage_event_id,
      inject_profile: inject_profile ?? true,  // Default true for backward compat
      user_profile: user_profile || undefined,  // Inline profile to skip backend Cosmos fetch
      web_search_enabled, 
      research_mode,
      image_urls: image_urls || [],
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Stream request failed: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let currentEventType = "";

  try {
    while (true) {
      // Check if aborted before reading
      if (signal?.aborted) {
        console.log("[streamAgentChat] Abort signal detected, stopping stream");
        break;
      }
      
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      
      // Parse SSE events from buffer
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        // Check if aborted during line processing
        if (signal?.aborted) break;
        
        if (line.startsWith("event: ")) {
          currentEventType = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            
            // Handle research-specific events (via SSE event type)
            if (currentEventType === "research_triggered" && onResearchTriggered) {
              onResearchTriggered(data);
            } else if (currentEventType === "thinking" && onThinking) {
              onThinking(data);
            } else if (currentEventType === "research_status" && onResearchStatus) {
              onResearchStatus(data);
            } else if (currentEventType === "research_complete" && onResearchComplete) {
              onResearchComplete(data);
            } else if (currentEventType === "clarification_done" && onClarificationDone) {
              onClarificationDone();
            } else if (currentEventType === "usage" || data.type === "usage") {
              // Token usage from the agent — dispatch as standard event
              console.log("[streamAgentChat] Token usage received:", data.total_tokens, "tokens,", data.rounds, "rounds");
              onEvent({ ...data, type: "usage" } as StreamEvent);
            } else if ((currentEventType === "citations" || data.type === "citations") && data.citations) {
              // Citation annotations from agent (URL and file citations)
              console.log("[streamAgentChat] Citations received:", data.citations.length);
              if (onCitations) {
                onCitations(data.citations);
              }
              // Also dispatch as a standard event so useAgentChat can handle it
              onEvent({ ...data, type: "citations" } as StreamEvent);
            } else if ((currentEventType === "document_start" || data.type === "document_start") && onDocumentStart) {
              // Document streaming is starting
              console.log("[streamAgentChat] Document streaming started");
              onDocumentStart();
            } else if ((currentEventType === "document_title" || data.type === "document_title") && onDocumentTitle) {
              // Document title received
              console.log("[streamAgentChat] Document title:", data.title);
              onDocumentTitle(data.title || "Untitled Document");
            } else if ((currentEventType === "document_delta" || data.type === "document_delta") && onDocumentDelta) {
              // Document content delta
              onDocumentDelta(data.delta || "");
            } else if ((currentEventType === "document" || data.type === "document") && onDocument) {
              // Handle complete document creation from create_document tool
              // Can come via SSE event type OR via data.type field
              console.log("[streamAgentChat] Document event received:", data);
              onDocument({
                title: data.title || "Untitled Document",
                content: data.content || "",
                doc_type: data.doc_type || "markdown",
              });
            } else if ((currentEventType === "message_block_start" || data.type === "message_block_start") && onMessageBlockStart) {
              // Message block streaming started
              console.log("[streamAgentChat] Message block streaming started");
              onMessageBlockStart();
            } else if ((currentEventType === "message_block_delta" || data.type === "message_block_delta") && onMessageBlockDelta) {
              // Message block content delta
              onMessageBlockDelta(data.delta || "");
            } else if ((currentEventType === "message_block" || data.type === "message_block") && onMessageBlock) {
              // Complete message block from add_message tool
              console.log("[streamAgentChat] Message block received");
              onMessageBlock(data.content || "");
            } else if ((currentEventType === "quiz_start" || data.type === "quiz_start") && onQuizStart) {
              // Quiz streaming is starting
              console.log("[streamAgentChat] Quiz streaming started");
              onQuizStart();
            } else if ((currentEventType === "tool_status" || data.type === "tool_status") && onToolStart) {
              if (data.tool) onToolStart(data.tool);
            } else if ((currentEventType === "tool_status" || data.type === "tool_status") && onToolStart) {
              if (data.tool) onToolStart(data.tool);
            } else if ((currentEventType === "block_cancel" || data.type === "block_cancel") && onBlockCancel) {
              console.warn("[streamAgentChat] Block tool failed:", data.tool);
              onBlockCancel(data.tool);
            } else if ((currentEventType === "quiz" || data.type === "quiz") && onQuiz) {
              // Complete quiz from add_quiz tool
              console.log("[streamAgentChat] Quiz event received:", data);
              onQuiz({
                title: data.title || "Quiz",
                assessmentType: data.assessmentType || "practice_quiz",
                thresholdConcept: data.thresholdConcept,
                questions: data.questions || [],
              });
            } else if ((currentEventType === "flashcard_start" || data.type === "flashcard_start") && onFlashcardStart) {
              // Flashcard streaming is starting
              console.log("[streamAgentChat] Flashcard streaming started");
              onFlashcardStart();
            } else if ((currentEventType === "flashcard" || data.type === "flashcard") && onFlashcard) {
              // Complete flashcard set from add_flashcard tool
              console.log("[streamAgentChat] Flashcard event received:", data);
              onFlashcard({
                title: data.title || "Flashcards",
                cards: data.cards || [],
              });
            } else if ((currentEventType === "challenge_start" || data.type === "challenge_start") && onChallengeStart) {
              // Challenge streaming is starting
              console.log("[streamAgentChat] Challenge streaming started");
              onChallengeStart();
            } else if ((currentEventType === "challenge" || data.type === "challenge") && onChallenge) {
              // Complete challenge from add_challenge tool
              console.log("[streamAgentChat] Challenge event received:", data);
              onChallenge({
                title: data.title || "Challenge",
                description: data.description || "",
                difficulty: data.difficulty || "medium",
                hints: data.hints || [],
                solution: data.solution || "",
                challengeType: data.challenge_type || data.challengeType || "problem",
              });
            } else if ((currentEventType === "clarify" || data.type === "clarify") && onClarify) {
              // Clarifying questions from ask_clarification tool
              onClarify({ clarifyId: data.clarifyId || "", questions: data.questions || [] });
            } else if ((currentEventType === "suggested_queries" || data.type === "suggested_queries") && onSuggestedQueries) {
              // Follow-up suggestions from suggest_next_queries tool
              onSuggestedQueries({ queries: data.queries || [] });
            } else if ((["tikz_image_start", "sympy_image_start"].includes(currentEventType) || ["tikz_image_start", "sympy_image_start"].includes(data.type)) && onTikzImageStart) {
              console.log("[streamAgentChat] TikZ image streaming started");
              onTikzImageStart();
            } else if ((["tikz_image", "sympy_image"].includes(currentEventType) || ["tikz_image", "sympy_image"].includes(data.type)) && onTikzImage) {
              // sympy_image is accepted only for compatibility with older backends.
              console.log("[streamAgentChat] TikZ image event received:", data.title);
              onTikzImage({
                title: data.title || "TikZ Diagram",
                imageData: data.imageData || "",
                caption: data.caption || "",
                visualizationType: data.visualizationType || "",
              });
            } else if ((currentEventType === "generated_image_start" || data.type === "generated_image_start") && onGeneratedImageStart) {
              console.log("[streamAgentChat] Generated image streaming started");
              onGeneratedImageStart();
            } else if ((currentEventType === "generated_image" || data.type === "generated_image") && onGeneratedImage) {
              console.log("[streamAgentChat] Generated image event received:", data.title);
              onGeneratedImage({
                title: data.title || "Generated image",
                imageData: data.imageData || "",
                imageUrl: data.imageUrl || "",
                caption: data.caption || "",
                size: data.size || "",
                quality: data.quality || "",
              });
            } else {
              // Standard events (thread_id, delta, done, error, clarification_done)
              console.log("[streamAgentChat] Dispatching to onEvent:", data.type, "currentEventType:", currentEventType);
              onEvent({ ...data, type: currentEventType || data.type } as StreamEvent);
            }
            
            currentEventType = "";
          } catch {
            // Ignore parse errors for malformed events
          }
        }
      }
    }
  } catch (error) {
    // Handle abort errors gracefully
    if (error instanceof Error && error.name === "AbortError") {
      console.log("[streamAgentChat] Stream aborted by user");
      return; // Clean exit on abort
    }
    throw error; // Re-throw other errors
  } finally {
    reader.releaseLock();
  }
}

/* --------------------------------- Chat Image Upload -------------------------------- */

/**
 * Response from chat image upload
 */
export interface ChatImageUploadResponse {
  success: boolean;
  blob_uri?: string;
  blob_name?: string;
  error?: string;
}

/**
 * Upload a chat image to Azure Blob Storage.
 * Images are stored in: chat-images-v2/{thread_id}/{filename}
 * 
 * @param file - The image file to upload
 * @param threadId - The chat thread ID for organizing images
 * @param agentId - Optional agent ID for context
 * @returns The blob URI for the uploaded image
 */
export async function uploadChatImage(
  file: File,
  threadId: string,
  agentId?: string
): Promise<ChatImageUploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("container", "chat-images-v2");
  
  // Organize by thread_id in the container
  if (threadId) {
    formData.append("user_id", threadId); // Use thread_id as user_id for path organization
  }
  if (agentId) {
    formData.append("agent_id", agentId);
  }

  const response = await fetch(`${withApiSuffix(API_BASE_URL)}/blob/upload`, {
    method: "POST",
    body: formData,
    credentials: "include",
  });

  if (!response.ok) {
    const error = await response.text();
    return { success: false, error: error || `Upload failed: ${response.status}` };
  }

  return response.json();
}

/**
 * Upload multiple chat images to Azure Blob Storage.
 * 
 * @param files - Array of image files to upload
 * @param threadId - The chat thread ID for organizing images
 * @param agentId - Optional agent ID for context
 * @returns Array of blob URIs for the uploaded images
 */
export async function uploadChatImages(
  files: File[],
  threadId: string,
  agentId?: string
): Promise<{ success: boolean; urls: string[]; errors: string[] }> {
  const results = await Promise.allSettled(
    files.map(file => uploadChatImage(file, threadId, agentId))
  );

  const urls: string[] = [];
  const errors: string[] = [];

  results.forEach((result, index) => {
    if (result.status === "fulfilled" && result.value.success && result.value.blob_uri) {
      urls.push(result.value.blob_uri);
    } else {
      const error = result.status === "rejected" 
        ? result.reason?.message || "Unknown error"
        : result.value.error || "Upload failed";
      errors.push(`${files[index].name}: ${error}`);
    }
  });

  return { success: errors.length === 0, urls, errors };
}

/* -------------------------- Azure Foundry: agents --------------------------- */

// Client-side agent cache to avoid repeated API calls (user-scoped)
let agentCache: AzureAgentRow[] | null = null;
let agentCacheTime = 0;
let agentCacheUserId = ""; // Track which user the cache belongs to
const AGENT_CACHE_TTL = 60000; // 60 seconds cache TTL

// Track pending request to prevent duplicate in-flight calls (React StrictMode)
let pendingAgentRequest: Promise<AzureAgentRow[]> | null = null;

/**
 * List Azure agents with client-side caching.
 * @param forceRefresh - If true, bypasses cache and fetches fresh data
 */
export async function listAzureAgents(forceRefresh = false): Promise<AzureAgentRow[]> {
  const now = Date.now();
  
  // Check if invalidation requested force refresh
  const needsForceRefresh = forceRefresh || shouldForceRefresh();

  // Build query parameters — include user_id for role-based scoping
  const qp = new URLSearchParams();
  if (needsForceRefresh) qp.set("force_refresh", "true");
  const { useUserStore } = await import("./userStore");
  const uid = useUserStore.getState().userId;
  if (uid) qp.set("user_id", uid);

  // Invalidate cache if user changed (e.g. switched accounts)
  if (uid && uid !== agentCacheUserId) {
    agentCache = null;
    agentCacheTime = 0;
  }

  // Return cached data if still valid and not forcing refresh
  if (!needsForceRefresh && agentCache !== null && (now - agentCacheTime) < AGENT_CACHE_TTL) {
    return agentCache;
  }

  // If there's already a pending request, wait for it instead of making a new one
  // This prevents duplicate API calls from React StrictMode double-mounting
  if (pendingAgentRequest !== null) {
    return pendingAgentRequest;
  }

  const params = qp.toString() ? `?${qp.toString()}` : "";
  
  // Create the request and track it
  pendingAgentRequest = request<AzureAgentRow[]>(`azure/agents/list${params}`);
  
  try {
    const agents = await pendingAgentRequest;
    
    // Update cache (user-scoped)
    agentCache = agents;
    agentCacheTime = Date.now();
    agentCacheUserId = uid || "";
    
    return agents;
  } finally {
    // Clear pending request regardless of success/failure
    pendingAgentRequest = null;
  }
}

/**
 * Invalidate the agent cache. Call this after create/delete/update operations.
 * Sets a flag to force next fetch to bypass backend cache as well.
 */
let forceNextRefresh = false;

export function invalidateAgentCache(): void {
  agentCache = null;
  agentCacheTime = 0;
  forceNextRefresh = true;  // Force backend refresh on next fetch
}

/**
 * Check if we should force refresh (after invalidation)
 */
export function shouldForceRefresh(): boolean {
  if (forceNextRefresh) {
    forceNextRefresh = false;  // Reset the flag
    return true;
  }
  return false;
}

export async function deleteAzureAgent(agent_id: string) {
  const result = await request<{ ok: true }>(`azure/agents/${agent_id}`, {
    method: "DELETE",
  });
  // Invalidate cache after deletion
  invalidateAgentCache();
  return result;
}

// ── Agent member management ─────────────────────────────────────
export async function getAgentMembers(agentId: string) {
  return request<{ teacherIds: string[]; studentIds: string[] }>(`agents/${agentId}/members`);
}

export async function addAgentMember(
  agentId: string,
  userId: string,
  memberType: "teacher" | "student",
  requesterId: string,
) {
  const result = await request<{ status: string }>(`agents/${agentId}/members?requester_id=${encodeURIComponent(requesterId)}`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId, member_type: memberType }),
  });
  invalidateAgentCache();
  return result;
}

export async function removeAgentMember(
  agentId: string,
  targetUserId: string,
  requesterId: string,
) {
  const result = await request<{ status: string }>(`agents/${agentId}/members/${encodeURIComponent(targetUserId)}?requester_id=${encodeURIComponent(requesterId)}`, {
    method: "DELETE",
  });
  invalidateAgentCache();
  return result;
}

/**
 * Get the course curriculum for an agent.
 * Returns { agent_name, status, course_curriculum, message? }
 */
export async function getAgentCourseCurriculum(agent_name: string): Promise<{
  agent_name: string;
  status: "ready" | "processing" | "not_available";
  course_curriculum: any | null;
  message?: string;
}> {
  return request(`agents/${agent_name}/course-curriculum`);
}

/** Lightweight status-only check (no curriculum payload). */
export async function getAgentCurriculumStatus(agent_name: string): Promise<{
  agent_name: string;
  status: "ready" | "processing" | "not_available";
  message?: string;
}> {
  return request(`agents/${agent_name}/course-curriculum?status_only=true`);
}

export type LearningProgressEntry = {
  status?: "not_started" | "in_progress" | "learned";
  module?: string;
  latest_summary?: string | null;
  last_touched?: string | null;
  last_updated?: string | null;
  misconceptions_addressed?: string[];
  misconception_notes?: Record<string, { note?: string; recorded_at?: string }>;
};

export type LearningProgress = {
  overall?: {
    total_topics?: number;
    learned?: number;
    in_progress?: number;
    not_started?: number;
    percent?: number;
    last_active?: string;
  };
  topics?: Record<string, LearningProgressEntry>;
  objectives?: Record<string, { status?: string; evidence?: string | null }>;
  threshold_concepts?: Record<string, LearningProgressEntry>;
};

/** Per-student progress for a course, used to tick the curriculum panel. */
export async function getAgentLearningProgress(
  agent_name: string,
  user_id: string,
): Promise<{
  agent_name: string;
  user_id: string;
  status: "ok" | "no_state";
  progress?: LearningProgress;
  message?: string;
}> {
  return request(`agents/${agent_name}/progress/${encodeURIComponent(user_id)}`);
}

/**
 * Update the course curriculum for an agent (teacher edit).
 */
export async function updateAgentCourseCurriculum(agent_name: string, course_curriculum: any, commit_message?: string, user_id?: string): Promise<{ status: string; message: string; version_id?: string }> {
  return request(`agents/${agent_name}/course-curriculum`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ course_curriculum, commit_message, user_id }),
  });
}

export async function listCurriculumVersions(agent_name: string): Promise<{ status: string; versions: Array<{ version_id: string; commit_message: string; saved_by: string; saved_at: string }> }> {
  return request(`agents/${agent_name}/course-curriculum/versions`);
}

export async function getCurriculumVersion(agent_name: string, version_id: string): Promise<{ status: string; version: any }> {
  return request(`agents/${agent_name}/course-curriculum/versions/${version_id}`);
}

/* ----------------------------- Misc. utilities ----------------------------- */

export async function checkAgentNameExists(name: string): Promise<boolean> {
  const params = new URLSearchParams({ name });

  const data = await request<{ exists: boolean }>(
    `agents/check-name?${params.toString()}`
  );

  return data.exists;
}

/**
 * Get agent ID by name from the list of Azure agents
 * Returns null if not found
 */
export async function getAgentIdByName(name: string): Promise<string | null> {
  const agents = await listAzureAgents();
  const lowerName = name.toLowerCase();
  const agent = agents.find(a => a.name.toLowerCase() === lowerName);
  return agent?.id || null;
}

import type { CourseChatSession } from "./types";

export async function createCourseChatSession(params: {
  agentId: string;
  agentKind?: "course" | "other";
  agentName?: string;
  sessionUuid?: string;
  courseName?: string;
  title?: string;
}): Promise<CourseChatSession> {
  return request<CourseChatSession>("course-chats/sessions", {
    method: "POST",
    body: JSON.stringify({
      agent_id: params.agentId,
      agent_kind: params.agentKind ?? "course",
       agent_name: params.agentName,
       session_uuid: params.sessionUuid,
       course_name: params.courseName,
       title: params.title,
     }),
   });
}


export async function listCourseChatSessions(params: {
  agentId: string;
  agentKind?: "course" | "other";
  courseName?: string;
}): Promise<CourseChatSession[]> {
  const q = new URLSearchParams({ agent_id: params.agentId });
  if (params.agentKind) q.set("agent_kind", params.agentKind);
  if (params.courseName) q.set("course_name", params.courseName);

  const res = await fetch(`/api/course-chats/sessions?${q.toString()}`);
  if (!res.ok) throw new Error("Failed to list course chat sessions");
  return res.json();
}

export async function loadCourseChat(chatId: string): Promise<CourseChatSession> {
  const res = await fetch(`/api/course-chats/sessions/${chatId}`);
  if (!res.ok) throw new Error("Failed to load chat session");
  return res.json();
}

export async function sendCourseChatMessage(
  chatId: string,
  text: string
): Promise<CourseChatSession> {
  const res = await fetch(`/api/course-chats/sessions/${chatId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error("Failed to send message");
  const data = await res.json();
  return data.session;
}

/* ----------------------------- Agent Setup Details ----------------------------- */

export type AgentSetupDetails = {
  agentId: string;
  agentKind: "course";  // Teaching assistant
  courseName: string;
  courseLevel: string;
  courseDuration: string;
  additionalContext: string;
  courseCode?: string;
  prerequisites?: string[];
  textbooks?: Array<{ id: string; name: string; edition: string; authors?: string[]; type: string; description?: string; }>;
  vectorStoreId?: string | null;
  knowledgeUrls?: Array<{ url: string; description?: string }>;
  agentDescription?: string;  // 300-char description for agent library (generated by builder agent)
  conversationStarters?: Array<string | { title: string; prompt: string }>;  // Starters: {title, prompt} objects or legacy strings
  agentImageUrl?: string | null;  // Azure Blob Storage URL for agent image
  sessionUuid?: string | null;  // Session UUID for KB file storage location
};

/**
 * Upload agent image to Azure Blob Storage
 * POST /api/agents/image/upload
 */
export async function uploadAgentImage(agentId: string, imageFile: File): Promise<{ ok: true; imageUrl: string }> {
  const formData = new FormData();
  formData.append("agent_id", agentId);
  formData.append("image", imageFile);

  return requestForm<{ ok: true; imageUrl: string }>("agents/image/upload", formData);
}

/**
 * Delete agent image from Azure Blob Storage
 * DELETE /api/agents/image/{agent_id}
 */
export async function deleteAgentImage(agentId: string): Promise<{ ok: true; deleted: number }> {
  return request<{ ok: true; deleted: number }>(`agents/image/${agentId}`, {
    method: "DELETE",
  });
}

/**
 * Extract text from a document file (PDF, DOCX, PPTX, or plain text).
 * POST /api/document/extract-text
 */
export async function extractTextFromDocument(file: File): Promise<{ success: boolean; extracted_text?: string; error?: string }> {
  const formData = new FormData();
  formData.append("file", file);

  const url = buildUrl("document/extract-text");
  const res = await fetch(url, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const body = await parseBody(res);
    throw new Error(asErrorMessage(body) || `Extraction failed: ${res.status}`);
  }

  return res.json();
}

/**
 * Create agent directly without builder chat (simplified flow)
 * POST /api/agents/create-direct
 */
export async function createAgentDirect(params: {
  kind: "course";
  name: string;
  description?: string;
  courseName: string;
  courseLevel: string;
  courseDuration: string;
  additionalContext: string;
  model: string;
  createdById?: string;  // Creator's userId for Cosmos DB metadata (normalized design)
}): Promise<{ agent_id: string; name: string; description: string; conversation_starters: string[] }> {
  return request<{ agent_id: string; name: string; description: string; conversation_starters: string[] }>(
    "agents/create-direct",
    {
      method: "POST",
      body: JSON.stringify(params),
    }
  );
}

/**
 * Create agent with parallel processing (async mode)
 * Path 1 (Knowledge) and Path 2 (Agent) run in parallel
 * Path 3 (Attach knowledge) runs after both complete
 * Path 4 (Save metadata) runs in background
 * 
 * POST /api/agents/create-async
 */
export async function createAgentAsync(params: {
  kind: "course" | "learning" | "exam";
  name: string;
  description?: string;
  courseName: string;
  courseLevel?: string;
  courseDuration?: string;
  additionalContext?: string;
  model?: string;
  createdById?: string;
  createdByName?: string;
  // Knowledge processing params
  sessionUuid?: string;
  kbScope?: "course" | "exam";
  indexName?: string;
  // Agent image
  agentImageUrl?: string;
  // Course code (e.g. CS101)
  courseCode?: string;
  // Prerequisites
  prerequisites?: string[];
  // Teacher-curated URLs for focused web search
  courseUrls?: string[];
  // Textbook metadata for course curriculum research
  textbooks?: Array<{ name: string; edition: string; authors?: string[]; type: string; description?: string }>;
  // Department this agent belongs to
  departmentId?: string;
}): Promise<{
  agent_id: string;
  name: string;
  description: string;
  conversation_starters: string[];
  instructions_preview?: string;
  meta_agent_used: string;
  created_by_id: string;
  index_name: string | null;
  knowledge_attached: boolean;
  knowledge_pending?: boolean;  // True if files exist and will be attached in background
  parallel_execution: boolean;
  fast_creation?: boolean;  // Flag indicating fast creation mode
  manage_code?: string;  // 6-char code for teacher edit/delete access
}> {
  return request<{
    agent_id: string;
    name: string;
    description: string;
    conversation_starters: string[];
    instructions_preview?: string;
    meta_agent_used: string;
    created_by_id: string;
    index_name: string | null;
    knowledge_attached: boolean;
    knowledge_pending?: boolean;
    parallel_execution: boolean;
    fast_creation?: boolean;
    manage_code?: string;
  }>("agents/create-async", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

/**
 * Save agent setup details to JSON file
 * POST /api/agents/setup/save
 */
export async function saveAgentSetupDetails(details: AgentSetupDetails): Promise<{ ok: true }> {
  return request<{ ok: true }>("agents/setup/save", {
    method: "POST",
    body: JSON.stringify(details),
  });
}

/**
 * Verify a 6-character manage code for an agent.
 * POST /api/agents/{agentId}/verify-code
 */
export async function verifyManageCode(agentId: string, code: string): Promise<{ verified: boolean }> {
  return request<{ verified: boolean }>(`agents/${agentId}/verify-code`, {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

/**
 * Get the manage code for an agent (creator/admin only).
 * GET /api/agents/{agentId}/manage-code
 */
export async function getManageCode(agentId: string, requesterId: string): Promise<{ manage_code: string }> {
  return request<{ manage_code: string }>(`agents/${agentId}/manage-code?requester_id=${encodeURIComponent(requesterId)}`);
}

/**
 * Connect to an agent using its 6-character manage code.
 * POST /api/agents/connect-by-code
 */
export async function connectByCode(code: string): Promise<{ agent_id: string; course_name: string; agent_name: string }> {
  const result = await request<{ agent_id: string; course_name: string; agent_name: string }>("agents/connect-by-code", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
  invalidateAgentCache();
  return result;
}

/**
 * Fetch agent setup details from JSON file
 * GET /api/agents/setup/{agent_id}
 */
export async function fetchAgentSetupDetails(agentId: string): Promise<AgentSetupDetails | null> {
  try {
    return await request<AgentSetupDetails>(`agents/setup/${agentId}`);
  } catch (error) {
    // Return null if setup details don't exist
    return null;
  }
}

/**
 * Delete agent setup details (called when deleting agent)
 * DELETE /api/agents/setup/{agent_id}
 */
export async function deleteAgentSetupDetails(agentId: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(`agents/setup/${agentId}`, {
    method: "DELETE",
  });
}

/**
 * Fetch personalised conversation starters generated by the teaching assistant itself.
 * GET /api/agents/{agent_id}/conversation-starters?user_id=...
 */
export async function fetchConversationStarters(
  agentId: string,
  userId?: string,
): Promise<{ title: string; prompt: string }[]> {
  try {
    const qs = userId ? `?user_id=${encodeURIComponent(userId)}` : "";
    const res = await request<{ starters: { title: string; prompt: string }[] }>(
      `agents/${agentId}/conversation-starters${qs}`,
    );
    return res.starters ?? [];
  } catch {
    return [];
  }
}

/* -------------------------- Deep Research --------------------------- */

export type DeepResearchResponse = {
  status: "success" | "error";
  response?: string;
  citations?: { title: string; url: string }[];
  error?: string;
};

/**
 * Run a deep research query using Azure AI Foundry's Deep Research tool
 * POST /api/deep-research
 */
export async function runDeepResearch(
  query: string,
  agentName?: string,
  instructions?: string
): Promise<DeepResearchResponse> {
  return request<DeepResearchResponse>("deep-research", {
    method: "POST",
    body: JSON.stringify({
      query,
      agent_name: agentName,
      instructions,
    }),
  });
}

/* -------------------------- Deep Research SSE Streaming --------------------------- */

export type DeepResearchThinkingEvent = {
  summary: string;
  citations: { title: string; url: string }[];
};

export type DeepResearchStatusEvent = {
  status: string;
  message: string;
};

export type DeepResearchCompleteEvent = {
  response: string;
  citations: { title: string; url: string }[];
};

export type DeepResearchErrorEvent = {
  error: string;
};

export type DeepResearchClarificationEvent = {
  response: string;
  thread_id: string;
};

export type DeepResearchStreamCallbacks = {
  onThreadId?: (threadId: string) => void;
  onThinking?: (event: DeepResearchThinkingEvent) => void;
  onStatus?: (event: DeepResearchStatusEvent) => void;
  onClarification?: (event: DeepResearchClarificationEvent) => void;
  onComplete?: (event: DeepResearchCompleteEvent) => void;
  onError?: (error: string) => void;
};

/**
 * Stream deep research results using Server-Sent Events (SSE).
 * Provides real-time thinking tokens and progress updates.
 * 
 * @param query - The research query
 * @param callbacks - Callback functions for different event types
 * @returns A function to abort the stream
 */
export function streamDeepResearch(
  query: string,
  callbacks: DeepResearchStreamCallbacks,
  threadId?: string | null
): () => void {
  const abortController = new AbortController();
  
  const runStream = async () => {
    try {
      const response = await fetch(buildUrl("deep-research/stream"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ query, thread_id: threadId || null }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      if (!response.body) {
        throw new Error("No response body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        
        // Process complete SSE events in buffer
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer
        
        let currentEventType = "";
        
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEventType = line.slice(7).trim();
          } else if (line.startsWith("data: ") && currentEventType) {
            const dataStr = line.slice(6);
            try {
              const data = JSON.parse(dataStr);
              
              switch (currentEventType) {
                case "thread_id":
                  callbacks.onThreadId?.(data.thread_id);
                  break;
                case "thinking":
                  callbacks.onThinking?.(data as DeepResearchThinkingEvent);
                  break;
                case "status":
                  callbacks.onStatus?.(data as DeepResearchStatusEvent);
                  break;
                case "clarification":
                  callbacks.onClarification?.(data as DeepResearchClarificationEvent);
                  break;
                case "complete":
                  callbacks.onComplete?.(data as DeepResearchCompleteEvent);
                  break;
                case "error":
                  callbacks.onError?.((data as DeepResearchErrorEvent).error);
                  break;
              }
            } catch (parseError) {
              console.warn("Failed to parse SSE data:", parseError);
            }
            currentEventType = "";
          }
        }
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        // User cancelled - don't report as error
        return;
      }
      callbacks.onError?.(error instanceof Error ? error.message : "Unknown error");
    }
  };

  runStream();

  // Return abort function
  return () => {
    abortController.abort();
  };
}

// ===================== User Directory API =====================

export interface DirectoryUserAffiliation {
  institute: string;
  department: string;
  role: string;
}

export interface DirectoryUser {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  status: "invited" | "active";
  institute: string;
  department: string;
  authProvider?: string;
  affiliations?: DirectoryUserAffiliation[];
  activeAffiliation?: number;
  affiliationAdded?: boolean;
}

/**
 * Fetch the full user directory from the backend.
 */
export async function fetchDirectoryUsers(
  role?: string,
  status?: string,
): Promise<DirectoryUser[]> {
  const params = new URLSearchParams();
  if (role) params.set("role", role);
  if (status) params.set("status", status);
  const qs = params.toString();
  const url = buildUrl(`directory${qs ? `?${qs}` : ""}`);
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`Failed to fetch directory: ${res.status}`);
  return res.json();
}

/**
 * Invite (allowlist) a new user. Returns the created directory entry.
 */
export async function inviteDirectoryUser(data: {
  email: string;
  name?: string;
  role?: string;
  institute?: string;
  department?: string;
}): Promise<DirectoryUser> {
  const url = buildUrl("directory");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to invite user: ${res.status}`);
  }
  return res.json();
}

/**
 * Update (edit) a user in the directory.
 */
export async function updateDirectoryUser(
  userId: string,
  data: { name?: string; role?: string; institute?: string; department?: string },
): Promise<DirectoryUser> {
  const url = buildUrl(`directory/${encodeURIComponent(userId)}`);
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to update user: ${res.status}`);
  }
  return res.json();
}

/**
 * Remove a user from the directory.
 */
export async function removeDirectoryUser(userId: string): Promise<void> {
  const url = buildUrl(`directory/${encodeURIComponent(userId)}`);
  const res = await fetch(url, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to remove user: ${res.status}`);
  }
}

/**
 * Switch a user's active affiliation by index.
 */
export async function switchUserAffiliation(
  userId: string,
  index: number,
): Promise<{
  id: string;
  institute: string;
  department: string;
  role: string;
  affiliations: DirectoryUserAffiliation[];
  activeAffiliation: number;
}> {
  const url = buildUrl(`directory/${encodeURIComponent(userId)}/switch-affiliation`);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ index }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to switch affiliation: ${res.status}`);
  }
  return res.json();
}

// ── Institution / Department rename & delete ─────────────────

/**
 * Rename an institution across all user records.
 */
export async function renameDirectoryInstitute(oldName: string, newName: string): Promise<{ updated: number }> {
  const url = buildUrl("directory/institutes/rename");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ old_name: oldName, new_name: newName }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to rename institute: ${res.status}`);
  }
  return res.json();
}

/**
 * Delete an institution — clears institute & department on affected users.
 */
export async function deleteDirectoryInstitute(name: string): Promise<{ cleared: number }> {
  const url = buildUrl("directory/institutes/delete");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to delete institute: ${res.status}`);
  }
  return res.json();
}

/**
 * Rename a department within an institution across all user records.
 */
export async function renameDirectoryDepartment(institute: string, oldName: string, newName: string): Promise<{ updated: number }> {
  const url = buildUrl("directory/departments/rename");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ institute, old_name: oldName, new_name: newName }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to rename department: ${res.status}`);
  }
  return res.json();
}

/**
 * Delete a department — clears the department field on affected users.
 */
export async function deleteDirectoryDepartment(institute: string, department: string): Promise<{ cleared: number }> {
  const url = buildUrl("directory/departments/delete");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ institute, department }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to delete department: ${res.status}`);
  }
  return res.json();
}

// ============================================================================
// Institute / Department Deep Research
// ============================================================================

export interface ResearchStatus {
  status: "not_started" | "researching" | "completed" | "failed" | "already_researching" | "cancelled";
  institute?: string;
  department?: string;
  error?: string;
  completed_at?: string;
  research_duration_seconds?: number;
  // Completed institute research has profile, academic_system, campus_life, etc.
  // Completed department research has profile, faculty, facilities, curriculum, research.
  [key: string]: unknown;
}

/**
 * Trigger deep research on an institute (runs 5-15 min in background).
 */
export async function triggerInstituteResearch(name: string, instructions?: string): Promise<ResearchStatus> {
  const url = buildUrl("directory/institutes/research");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ name, instructions: instructions || undefined }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to trigger institute research: ${res.status}`);
  }
  return res.json();
}

/**
 * Get institute research status/results.
 */
export async function getInstituteResearch(name: string): Promise<ResearchStatus> {
  const url = buildUrl(`directory/institutes/research?name=${encodeURIComponent(name)}`);
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to get institute research: ${res.status}`);
  }
  return res.json();
}

/**
 * Trigger deep research on a department (runs 5-15 min in background).
 */
export async function triggerDepartmentResearch(institute: string, department: string, instructions?: string): Promise<ResearchStatus> {
  const url = buildUrl("directory/departments/research");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ institute, department, instructions: instructions || undefined }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to trigger department research: ${res.status}`);
  }
  return res.json();
}

/**
 * Get department research status/results.
 */
export async function getDepartmentResearch(institute: string, department: string): Promise<ResearchStatus> {
  const url = buildUrl(`directory/departments/research?institute=${encodeURIComponent(institute)}&department=${encodeURIComponent(department)}`);
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to get department research: ${res.status}`);
  }
  return res.json();
}

/**
 * Cancel an in-progress institute research.
 */
export async function cancelInstituteResearch(name: string): Promise<ResearchStatus> {
  const url = buildUrl(`directory/institutes/research?name=${encodeURIComponent(name)}`);
  const res = await fetch(url, { method: "DELETE", credentials: "include" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to cancel institute research: ${res.status}`);
  }
  return res.json();
}

/**
 * Cancel an in-progress department research.
 */
export async function cancelDepartmentResearch(institute: string, department: string): Promise<ResearchStatus> {
  const url = buildUrl(`directory/departments/research?institute=${encodeURIComponent(institute)}&department=${encodeURIComponent(department)}`);
  const res = await fetch(url, { method: "DELETE", credentials: "include" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to cancel department research: ${res.status}`);
  }
  return res.json();
}

// ============================================================================
// Department Management API (visibility scoping)
// ============================================================================

export interface Department {
  id: string;
  name: string;
  institutionId?: string;
  institutionName?: string;
  status?: string;
  createdAt?: string;
}

export interface DepartmentMember {
  id: string;
  userId: string;
  fullName?: string;
  displayName?: string;
  email?: string;
  role?: string;
  departments?: string[];
}

/** List all active departments. */
export async function listDepartmentsAdmin(): Promise<Department[]> {
  return request<Department[]>("departments");
}

/** Get a single department by ID. */
export async function getDepartmentById(deptId: string): Promise<Department> {
  return request<Department>(`departments/${encodeURIComponent(deptId)}`);
}

/** Create a new department (admin only). */
export async function createDepartmentAdmin(dept: { id: string; name: string; institutionId?: string; institutionName?: string }): Promise<Department> {
  return request<Department>("departments", {
    method: "POST",
    body: JSON.stringify(dept),
  });
}

/** Update a department (admin only). */
export async function updateDepartmentAdmin(deptId: string, updates: { name?: string; institutionId?: string; institutionName?: string }): Promise<Department> {
  return request<Department>(`departments/${encodeURIComponent(deptId)}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });
}

/** Delete (soft-delete) a department (admin only). */
export async function deleteDepartmentAdmin(deptId: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`departments/${encodeURIComponent(deptId)}`, {
    method: "DELETE",
  });
}

/** List members of a department. */
export async function listDepartmentMembersAdmin(deptId: string): Promise<DepartmentMember[]> {
  return request<DepartmentMember[]>(`departments/${encodeURIComponent(deptId)}/members`);
}

/** Add a user to a department (admin only). */
export async function addDepartmentMemberAdmin(deptId: string, userId: string): Promise<{ success: boolean; departments: string[] }> {
  return request<{ success: boolean; departments: string[] }>(`departments/${encodeURIComponent(deptId)}/members`, {
    method: "POST",
    body: JSON.stringify({ userId }),
  });
}

/** Remove a user from a department (admin only). */
export async function removeDepartmentMemberAdmin(deptId: string, userId: string): Promise<{ success: boolean; departments: string[] }> {
  return request<{ success: boolean; departments: string[] }>(`departments/${encodeURIComponent(deptId)}/members/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
}

/** Get all departments a user belongs to. */
export async function getUserDepartmentsApi(userId: string): Promise<Department[]> {
  return request<Department[]>(`users/${encodeURIComponent(userId)}/departments`);
}
