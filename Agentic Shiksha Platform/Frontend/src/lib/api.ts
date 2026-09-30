// lib/api.ts
import {
  API_BASE_URL,
  TEMP_COURSE_AGENT_ID,
} from "./config";
import type {
  AnswerDepth,
  AzureAgentRow,
  ChatSource,
} from "./types";
import type { CourseFormPatch, courseFormContext } from "@/features/create/builderTypes";
import type { CourseAvatarOptions } from "./courseAvatar";
import { parseCircuitPayload, parseCircuitResult, type CircuitPayload, type CircuitResult, type CircuitSpec } from "./circuit";
import { parseSlideDeck, parseSlidesBlock, PPTX_MIME, type CompleteSlidesBlock, type SlideDeck } from "./slides";
import { isRetiredTool } from "./retiredContent";
import { useUserStore } from "./userStore";
import { parseQuizContent } from "./quizContract";

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
 * Converts an Azure Blob Storage URL to a proxied URL via our backend.
 * This is needed because blob URLs require authentication.
 * 
 * @param url - The URL to potentially convert
 * @returns Proxied URL if it's a blob URL, otherwise the original URL
 */
/**
 * True when `url` is an https URL whose host really is an Azure Blob Storage host.
 * Checking the whole string for ".blob.core.windows.net" would also match a URL that
 * merely contains it, e.g. https://attacker.example/?x=.blob.core.windows.net
 */
export function isAzureBlobUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(".blob.core.windows.net");
  } catch {
    return false;
  }
}

/**
 * Returns a source safe to hand to an <img>. Blocks javascript:/data:text URLs that
 * would otherwise be reinterpreted by the browser.
 */
export function safeImageSrc(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("blob:")) return url;
  if (/^data:image\/(png|jpe?g|gif|webp|avif);/i.test(url)) return url;
  try {
    const u = new URL(url, window.location.origin);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : undefined;
  } catch {
    return undefined;
  }
}

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
  if (Array.isArray(x.detail)) {
    const descriptionError = x.detail.find((issue: any) => issue?.type === "string_too_long"
      && Array.isArray(issue.loc) && issue.loc.length === 3
      && issue.loc[0] === "body" && issue.loc[1] === "form" && issue.loc[2] === "courseNotes");
    const limit = descriptionError?.ctx?.max_length;
    if (typeof limit === "number" && Number.isSafeInteger(limit) && limit > 0) {
      return `The course description exceeds this server's limit of ${limit.toLocaleString("en-US")} characters. Your form has not been changed.`;
    }
    return "Some request fields are invalid or too large. Check the form fields and attachment limits, then retry.";
  }
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

const AGENT_CAPABILITIES = [
  { name: "Course material search", tools: ["search_knowledge_base", "file_search", "azure_ai_search"] },
  { name: "Documents", tools: ["add_document"] },
  { name: "Quizzes", tools: ["add_quiz"] },
  { name: "Challenges", tools: ["add_challenge"] },
  { name: "Diagrams", tools: ["add_tikz_diagram"] },
  { name: "Image generation", tools: ["generate_image", "image_generation"] },
  { name: "Simulation", tools: ["add_circuit"] },
  { name: "Slide presentations", tools: ["add_slides"] },
  { name: "Learning progress", tools: ["get_threshold_concepts", "update_topic_progress"] },
  { name: "Conversation memory", tools: ["memory_search", "memory_search_preview"] },
  { name: "Web search", tools: ["bing_grounding", "bing_custom_search", "bing_custom_search_preview", "web_search", "web_search_preview"] },
  { name: "Code execution", tools: ["code_interpreter"] },
] as const;

export type AgentCapability = typeof AGENT_CAPABILITIES[number]["name"];

function courseInfoScope(): string {
  const { userId, role, isAuthenticated } = useUserStore.getState();
  return JSON.stringify([userId, role, isAuthenticated]);
}

function createCourseInfoCache<Value>() {
  const values = new Map<string, { value: Value; expires: number }>();
  const pending = new Map<string, Promise<Value>>();
  const clear = (agentId?: string) => {
    if (agentId) {
      values.delete(agentId);
      pending.delete(agentId);
    } else {
      values.clear();
      pending.clear();
    }
  };
  useUserStore.subscribe((current, previous) => {
    if (current.userId !== previous.userId || current.role !== previous.role
      || current.isAuthenticated !== previous.isAuthenticated) clear();
  });
  const peek = (agentId: string): Value | null => {
    const cached = values.get(agentId);
    if (cached && cached.expires > Date.now()) return structuredClone(cached.value);
    values.delete(agentId);
    return null;
  };
  const set = (agentId: string, value: Value) => {
    values.delete(agentId);
    values.set(agentId, { value: structuredClone(value), expires: Date.now() + 5 * 60_000 });
    while (values.size > 50) values.delete(values.keys().next().value!);
  };
  const get = (agentId: string, load: () => Promise<Value>, signal?: AbortSignal): Promise<Value> => {
    if (signal?.aborted) return Promise.reject(signal.reason);
    const cached = peek(agentId);
    if (cached !== null) return Promise.resolve(cached);
    let shared = pending.get(agentId);
    if (!shared) {
      const scope = courseInfoScope();
      const request = load().then(value => {
        if (courseInfoScope() !== scope || pending.get(agentId) !== request) {
          throw new Error("Course information changed. Reopen it to load the latest capabilities.");
        }
        set(agentId, value);
        return value;
      }).finally(() => {
        if (pending.get(agentId) === request) pending.delete(agentId);
      });
      pending.set(agentId, request);
      shared = request;
    }
    // Closing one dialog must not cancel a read shared with another subscriber.
    return new Promise<Value>((resolve, reject) => {
      const onAbort = () => reject(signal?.reason);
      signal?.addEventListener("abort", onAbort, { once: true });
      shared.then(value => {
        if (!signal?.aborted) resolve(structuredClone(value));
      }, reject).finally(() => signal?.removeEventListener("abort", onAbort));
    });
  };
  return { peek, get, clear };
}

const capabilitiesCache = createCourseInfoCache<AgentCapability[]>();
const circuitStatusCache = createCourseInfoCache<CircuitToolStatus>();
const slidesStatusCache = createCourseInfoCache<SlidesToolStatus>();

export const getCachedAgentCapabilities = capabilitiesCache.peek;
export const getCachedCircuitToolStatus = circuitStatusCache.peek;
export const getCachedSlidesToolStatus = slidesStatusCache.peek;

export function invalidateCourseInfoCache(agentId?: string): void {
  capabilitiesCache.clear(agentId);
  circuitStatusCache.clear(agentId);
  slidesStatusCache.clear(agentId);
}

export async function getAgentCapabilities(agentId: string, signal?: AbortSignal): Promise<AgentCapability[]> {
  return capabilitiesCache.get(agentId, () => loadAgentCapabilities(agentId), signal);
}

async function loadAgentCapabilities(agentId: string): Promise<AgentCapability[]> {
  const data = await request<unknown>(`agents/${encodeURIComponent(agentId)}/details`);
  const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
  if (!isRecord(data) || data.name !== agentId || data.found !== true
    || !isRecord(data.definition) || !Array.isArray(data.definition.tools)) {
    throw new Error("Capabilities could not be verified. Please retry.");
  }
  const tools = new Set<string>();
  for (const tool of data.definition.tools) {
    if (!isRecord(tool) || typeof tool.type !== "string") {
      throw new Error("Capabilities could not be verified. Please retry.");
    }
    if (tool.type === "function") {
      const name = tool.name ?? (isRecord(tool.function) ? tool.function.name : undefined);
      if (typeof name !== "string" || !name.trim()) {
        throw new Error("Capabilities could not be verified. Please retry.");
      }
      tools.add(name);
    } else {
      tools.add(tool.type);
    }
  }
  return AGENT_CAPABILITIES.filter(capability => capability.tools.some(tool => tools.has(tool)))
    .map(capability => capability.name);
}

export async function simulateCircuit(agentId: string, circuit: CircuitSpec, signal?: AbortSignal): Promise<CircuitResult> {
  const response = await request<unknown>(`agents/${encodeURIComponent(agentId)}/circuit/simulate`, {
    method: "POST", body: JSON.stringify({ circuit }), signal,
  });
  const result = parseCircuitResult(response);
  if (!result || result.mode !== circuit.analysis.mode) throw new Error("The simulator returned an incomplete result. Retry the circuit.");
  return result;
}

export type CircuitToolStatus = { enabled: boolean; engine_available: boolean; agent_version: string; update_available?: boolean };

function parseCircuitToolStatus(value: unknown): CircuitToolStatus {
  if (!value || typeof value !== "object" || !("enabled" in value) || typeof value.enabled !== "boolean"
    || !("engine_available" in value) || typeof value.engine_available !== "boolean"
    || !("agent_version" in value) || typeof value.agent_version !== "string" || !value.agent_version
    || ("update_available" in value && typeof value.update_available !== "boolean")) {
    throw new Error("Circuit tool status could not be confirmed. Recheck status.");
  }
  return { enabled: value.enabled, engine_available: value.engine_available, agent_version: value.agent_version,
    update_available: "update_available" in value && value.update_available === true };
}

export function getCircuitToolStatus(agentId: string, signal?: AbortSignal): Promise<CircuitToolStatus> {
  return circuitStatusCache.get(agentId, async () => parseCircuitToolStatus(
    await request<unknown>(`agents/${encodeURIComponent(agentId)}/circuit/tool`),
  ), signal);
}

export async function enableCircuitTool(agentId: string, expectedVersion: string, signal?: AbortSignal): Promise<CircuitToolStatus> {
  const scope = courseInfoScope();
  try {
    const status = parseCircuitToolStatus(await request<unknown>(`agents/${encodeURIComponent(agentId)}/circuit/tool`, {
      method: "POST", body: JSON.stringify({ expected_version: expectedVersion }), signal,
    }));
    if (scope !== courseInfoScope()) throw new Error("Account changed. Reopen Course information.");
    return status;
  } finally {
    invalidateCourseInfoCache(agentId);
  }
}

export type SlidesToolStatus = { enabled: boolean; agent_version: string; update_available?: boolean };

function parseSlidesToolStatus(value: unknown): SlidesToolStatus {
  const status = value as Partial<SlidesToolStatus> | null;
  if (!status || typeof status.enabled !== "boolean" || typeof status.agent_version !== "string" || !status.agent_version
    || (status.update_available !== undefined && typeof status.update_available !== "boolean")) {
    throw new Error("Slide tool status could not be confirmed. Recheck status.");
  }
  return { enabled: status.enabled, agent_version: status.agent_version, ...(status.update_available !== undefined ? { update_available: status.update_available } : {}) };
}

export async function getSlidesToolStatus(agentId: string, signal?: AbortSignal): Promise<SlidesToolStatus> {
  return slidesStatusCache.get(agentId, async () => parseSlidesToolStatus(
    await request<unknown>(`agents/${encodeURIComponent(agentId)}/slides/tool`),
  ), signal);
}

export async function enableSlidesTool(agentId: string, expectedVersion: string, signal?: AbortSignal): Promise<SlidesToolStatus> {
  const scope = courseInfoScope();
  try {
    const status = parseSlidesToolStatus(await request<unknown>(`agents/${encodeURIComponent(agentId)}/slides/tool`, {
      method: "POST", body: JSON.stringify({ expected_version: expectedVersion }), signal,
    }));
    if (scope !== courseInfoScope()) throw new Error("Account changed. Reopen Course information.");
    return status;
  } finally {
    invalidateCourseInfoCache(agentId);
  }
}

export async function exportSlideDeck(agentId: string, deck: SlideDeck, signal?: AbortSignal): Promise<Blob> {
  const normalized = parseSlideDeck(deck);
  if (!agentId.trim() || !normalized) throw new Error("A valid slide deck and its originating TA are required.");
  const response = await fetch(buildUrl(`agents/${encodeURIComponent(agentId)}/slides/export`), {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json", Accept: PPTX_MIME },
    body: JSON.stringify({ deck: normalized }), signal,
  });
  if (!response.ok) throw new Error(asErrorMessage(await parseBody(response)));
  if (response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== PPTX_MIME) {
    throw new Error("The server did not return a PowerPoint file. Please retry.");
  }
  const file = await response.blob();
  if (!file.size) throw new Error("The exported PowerPoint file is empty. Please retry.");
  return file;
}

export async function saveSlideDeck(agentId: string, deck: SlideDeck, signal?: AbortSignal): Promise<{ assetId: string; block: CompleteSlidesBlock }> {
  const normalized = parseSlideDeck(deck);
  if (!agentId.trim() || !normalized) throw new Error("A valid slide deck and its originating TA are required.");
  const scope = courseInfoScope();
  const response = await request<unknown>(`agents/${encodeURIComponent(agentId)}/slides/save`, {
    method: "POST", body: JSON.stringify({ deck: normalized }), signal,
  });
  if (scope !== courseInfoScope()) throw new Error("Your account changed. Reopen the presentation before saving.");
  if (!response || typeof response !== "object" || !("assetId" in response) || typeof response.assetId !== "string" || !response.assetId.trim()
    || !("block" in response)) throw new Error("The server did not confirm a saved presentation. Check Assets before trying again.");
  const block = parseSlidesBlock(response.block);
  if (!block) throw new Error("The saved presentation response was invalid. Check Assets before trying again.");
  return { assetId: response.assetId, block: { ...block, agentId } };
}

export type AzureSlideVoice = { id: string; name: string; language: string };
export type AzureSlideVoices = { available: boolean; voices: AzureSlideVoice[]; detail?: string };

export async function getAzureSlideVoices(agentId: string, signal?: AbortSignal): Promise<AzureSlideVoices> {
  const value = await request<unknown>(`agents/${encodeURIComponent(agentId)}/slides/voices`, { signal });
  if (!value || typeof value !== "object" || !("available" in value) || typeof value.available !== "boolean"
    || !("voices" in value) || !Array.isArray(value.voices)
    || ("detail" in value && value.detail !== undefined && value.detail !== null && typeof value.detail !== "string")) {
    throw new Error("The Azure voice list could not be read. Reload voices to retry.");
  }
  const voices: AzureSlideVoice[] = [];
  for (const voice of value.voices) {
    if (!voice || typeof voice !== "object" || typeof voice.id !== "string" || !voice.id
      || typeof voice.name !== "string" || !voice.name || typeof voice.language !== "string" || !voice.language) {
      throw new Error("The Azure voice list is invalid. Reload voices to retry.");
    }
    voices.push({ id: voice.id, name: voice.name, language: voice.language });
  }
  return { available: value.available, voices, ...("detail" in value && typeof value.detail === "string" ? { detail: value.detail } : {}) };
}

export async function synthesizeSlideSpeech(agentId: string, text: string, voice: string, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(buildUrl(`agents/${encodeURIComponent(agentId)}/slides/speech`), {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, voice }), signal,
  });
  if (!response.ok) throw new Error(asErrorMessage(await parseBody(response)));
  if (response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "audio/mpeg") {
    throw new Error("Azure narration did not return an audio file. Select Play to retry.");
  }
  const audio = await response.blob();
  if (!audio.size || audio.size > 2 * 1024 * 1024) throw new Error("Azure narration returned an empty or oversized audio file.");
  return audio;
}

export const MATERIAL_ACCEPT = ".pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.tif,.tiff,.bmp";

export type MaterialPreflight = {
  accepted: boolean;
  max_file_bytes: number;
  max_batch_bytes: number;
  max_files: number;
  max_pdf_pages: number;
  index_part_bytes: number;
  index_part_pages: number;
  extensions: string[];
  files: Array<{
    filename: string;
    accepted: boolean;
    error?: string | null;
    details?: { filename: string; size_bytes: number; pages: number | null; ocr_pages: number; needs_preparation: boolean } | null;
  }>;
};

export type MaterialJobStatus = {
  job_id: string;
  session_uuid: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  progress: "uploading" | "preparing" | "indexing" | "ready" | "failed";
  index_name: string;
  files_uploaded: number;
  ta_status?: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | null;
  ta_error?: string | null;
  files: Array<{
    source_id: string;
    filename: string;
    kb_scope: KBScope;
    status: "uploaded" | "preparing" | "indexing" | "ready" | "failed";
    parts: number;
    error?: string | null;
  }>;
};

export function validateMaterialSelection(files: File[]): string | null {
  if (files.length > 100) return "Select at most 100 files per batch.";
  if (files.reduce((total, file) => total + file.size, 0) > 250 * 1024 * 1024) return "A batch must not exceed 250 MiB.";
  for (const file of files) {
    const extension = `.${file.name.split(".").pop()?.toLowerCase()}`;
    if (!MATERIAL_ACCEPT.split(",").includes(extension)) return `${file.name}: unsupported material format.`;
    const limit = extension === ".pdf" ? 100 * 1024 * 1024 : 16_000_000;
    if (!file.size || file.size > limit) return `${file.name}: files must be nonempty and no larger than ${extension === ".pdf" ? "100 MiB" : "16 MB"}.`;
  }
  return null;
}

export async function preflightMaterials(files: File[], signal?: AbortSignal): Promise<MaterialPreflight> {
  const error = validateMaterialSelection(files);
  if (error) throw new Error(error);
  const form = new FormData();
  files.forEach(file => form.append("files", file, file.name));
  return requestForm<MaterialPreflight>("knowledge/preflight", form, { signal, credentials: "include" });
}

export function createMaterialDraft(requestId: string): Promise<MaterialJobStatus> {
  return request<MaterialJobStatus>("knowledge/drafts", { method: "POST", body: JSON.stringify({ request_id: requestId }) });
}

export function getMaterialJob(jobId: string, signal?: AbortSignal): Promise<MaterialJobStatus> {
  return request<MaterialJobStatus>(`knowledge/jobs/${encodeURIComponent(jobId)}`, { signal });
}

export function processMaterialJob(jobId: string, sourceIds: string[] = []): Promise<MaterialJobStatus> {
  return request<MaterialJobStatus>(`knowledge/jobs/${encodeURIComponent(jobId)}/process`, { method: "POST", body: JSON.stringify({ source_ids: sourceIds }) });
}

export async function waitForMaterialJob(jobId: string, signal: AbortSignal, onStatus?: (status: MaterialJobStatus) => void): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    signal.throwIfAborted();
    const status = await getMaterialJob(jobId, signal);
    onStatus?.(status);
    if (status.progress === "ready") return;
    if (status.progress === "failed") throw new Error("Some materials could not be indexed. Retry the failed files.");
    await new Promise(resolve => window.setTimeout(resolve, 1500));
  }
  throw new Error("Materials are still processing. Their saved status can be checked again without re-uploading.");
}

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

export class ApiRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
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
    throw new ApiRequestError(asErrorMessage(body) || `${res.status} ${res.statusText}`, res.status);
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
  }).finally(() => invalidateCourseInfoCache(agentId));
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
  }).finally(() => invalidateCourseInfoCache(agentId));
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
  descriptions?: Record<string, string>,
  agentName?: string
): Promise<MaterialJobStatus> {
  const fd = new FormData();
  fd.append("session", sessionUuid);
  fd.append("kb_scope", kbScope);
  if (agentName) fd.append("agent_name", agentName);

  if (indexName) fd.append("index_name", indexName);
  if (descriptions && Object.keys(descriptions).length > 0) {
    fd.append("file_descriptions", JSON.stringify(descriptions));
  }
  for (const f of files) fd.append("files", f, f.name);

  return requestForm<MaterialJobStatus>(
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

export type CourseIndexStatus = {
  ok: boolean;
  operation_id: string;
  status: "indexing" | "ready" | "failed" | "changed";
  expected_files: number;
  indexed_files: number;
  message: string;
};

export async function updateCourseIndex(
  agentName: string,
  sessionUuid: string,
  kbScope: KBScope = "course",
  signal?: AbortSignal,
): Promise<CourseIndexStatus> {
  const fd = new FormData();
  fd.append("agent_name", agentName);
  fd.append("session_uuid", sessionUuid);
  fd.append("kb_scope", kbScope);

  return requestForm<CourseIndexStatus>("knowledge/update-index", fd, { signal });
}

export async function getCourseIndexStatus(
  agentName: string,
  operationId: string,
  signal?: AbortSignal,
): Promise<CourseIndexStatus> {
  const params = new URLSearchParams({ agent_name: agentName, operation_id: operationId });
  return request<CourseIndexStatus>(`knowledge/index-status?${params.toString()}`, { signal });
}

export async function getCourseFollowups(
  agentName: string, question: string, answer: string, signal: AbortSignal,
): Promise<string[]> {
  const result = await request<{ queries: string[] }>(`agents/${encodeURIComponent(agentName)}/chat/suggestions`, {
    method: "POST", signal,
    body: JSON.stringify({ question: question.slice(0, 16000), answer: answer.slice(0, 12000) }),
  });
  if (!Array.isArray(result.queries) || result.queries.length !== 3
    || result.queries.some(query => typeof query !== "string" || !query.trim() || query.length > 160)
    || new Set(result.queries.map(query => query.trim().toLowerCase())).size !== 3) {
    throw new Error("Invalid course suggestions");
  }
  return result.queries.map(query => query.trim());
}

export async function waitForCourseIndexReady(
  agentName: string,
  operationId: string,
  signal: AbortSignal,
  onProgress: (status: CourseIndexStatus) => void,
): Promise<CourseIndexStatus> {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const status = await getCourseIndexStatus(agentName, operationId, signal);
    if (status.operation_id !== operationId) throw new Error("Indexing request changed. Retry the update.");
    onProgress(status);
    if (status.ok && status.status === "ready") return status;
    if (!status.ok || status.status !== "indexing") {
      throw new Error(status.message || "Course indexing failed. Retry the update.");
    }
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(new DOMException("Indexing wait cancelled", "AbortError"));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, 1500);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  throw new Error("Files are uploaded, but indexing is not confirmed yet. Retry the update shortly.");
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
  source_id?: string | null;
};

export type KnowledgeListResponse = {
  files: KnowledgeFile[];
  vector_store_id?: string | null;
};

export async function listKnowledgeFiles(
  session: string,
  kbScope: KBScope,                  // ✅ NEW
  vector_store_id?: string | null,
  agentName?: string
) {
  const params = new URLSearchParams();
  params.set("session", session);
  params.set("kb_scope", kbScope);   // ✅ NEW
  if (vector_store_id) params.set("vector_store_id", vector_store_id);

  const raw = await request<KnowledgeListResponse>(
    agentName
      ? `agents/${encodeURIComponent(agentName)}/course-materials?kb_scope=${encodeURIComponent(kbScope)}`
      : `knowledge/list?${params.toString()}`
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

export function removeManagedMaterial(agentName: string, sourceId: string, kbScope: KBScope): Promise<MaterialJobStatus> {
  const params = new URLSearchParams({ source_id: sourceId, kb_scope: kbScope });
  return request<MaterialJobStatus>(`agents/${encodeURIComponent(agentName)}/course-materials/file?${params}`, { method: "DELETE" });
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
  answer_depth: AnswerDepth = "balanced",
  turnOptions?: Pick<StreamAgentChatOptions, "event_id" | "supersedes_event_id" | "onContextStatus">,
): Promise<{ reply: string; thread_id: string }> {
  let reply = "";
  let resolvedThreadId = thread_id || "";
  let streamError: string | undefined;

  await streamAgentChat(
    agent_id,
    text,
    thread_id || null,
    (event) => {
      if (event.type === "thread_id" && event.thread_id) {
        resolvedThreadId = event.thread_id;
      } else if (event.type === "error") {
        streamError = event.error || "Failed to get response";
      }
    },
    {
      user_id,
      ...turnOptions,
      web_search_enabled,
      answer_depth,
      signal,
      onMessageBlockDelta: (delta) => {
        reply += delta;
      },
      onMessageBlock: (content) => {
        reply += content;
      },
    },
  );

  if (streamError) throw new Error(streamError);
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
  citations?: Array<Partial<ChatSource>>;
  status?: string;
  response?: string;
  // Token usage fields
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  rounds?: number;
  per_round?: Array<{ round: number; response_id?: string; tools: string[]; input_tokens: number; output_tokens: number }>;
}

export type ChatContextStatus = "preparing" | "ready";

export interface StreamAgentChatOptions {
  /** Required: keys the student's learning state on the backend. */
  user_id: string;
  usage_event_id?: string;
  event_id?: string;
  supersedes_event_id?: string;
  web_search_enabled?: boolean;
  research_mode?: boolean;
  answer_depth?: AnswerDepth;
  inject_profile?: boolean;  // If true, backend injects user profile into agent context
  user_profile?: Record<string, string>;  // Inline profile data from frontend cache (avoids Cosmos fetch)
  image_urls?: string[];  // URLs of uploaded images to include in the message
  signal?: AbortSignal;
  onContextStatus?: (status: ChatContextStatus) => void;
  onDocument?: (event: { title: string; content: string; doc_type?: string }) => void;
  onDocumentStart?: () => void;
  onDocumentTitle?: (title: string) => void;
  onDocumentDelta?: (delta: string) => void;
  onMessageBlockStart?: () => void;
  onMessageBlockDelta?: (delta: string) => void;
  onMessageBlock?: (content: string) => void;
  onQuizStart?: () => void;
  onQuiz?: (event: import("./types").QuizContent) => void;
  onChallengeStart?: () => void;
  onChallenge?: (event: { title: string; description: string; difficulty: string; hints?: string[]; solution: string; challengeType?: string }) => void;
  onTikzImageStart?: () => void;
  onTikzImage?: (event: { title: string; imageData: string; caption?: string; visualizationType?: string }) => void;
  onGeneratedImageStart?: () => void;
  onGeneratedImage?: (event: { title: string; imageData: string; imageUrl?: string; caption?: string; size?: string; quality?: string }) => void;
  onCircuitStart?: () => void;
  onCircuit?: (event: CircuitPayload) => void;
  onSlidesStart?: () => void;
  onSlides?: (event: CompleteSlidesBlock) => void;
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
  onClarificationDone?: (clarifyId?: string) => void;
  onCitations?: (citations: Array<Partial<ChatSource>>) => void;
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
    answer_depth = "balanced",
    user_id,
    usage_event_id,
    event_id,
    supersedes_event_id,
    inject_profile,
    user_profile,
    image_urls,
    signal,
    onContextStatus,
    onDocument,
    onDocumentStart,
    onDocumentTitle,
    onDocumentDelta,
    onMessageBlockStart,
    onMessageBlockDelta,
    onMessageBlock,
    onQuizStart,
    onQuiz,
    onChallengeStart,
    onChallenge,
    onTikzImageStart,
    onTikzImage,
    onGeneratedImageStart,
    onGeneratedImage,
    onCircuitStart,
    onCircuit,
    onSlidesStart,
    onSlides,
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
      event_id,
      supersedes_event_id,
      inject_profile: inject_profile ?? true,  // Default true for backward compat
      user_profile: user_profile || undefined,  // Inline profile to skip backend Cosmos fetch
      web_search_enabled, 
      research_mode,
      answer_depth,
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
            if (
              [currentEventType, data.type].some(type =>
                typeof type === "string" && (type === "flashcard" || type.startsWith("flashcard_")))
              || isRetiredTool(data.tool)
            ) continue;
            
            // Handle research-specific events (via SSE event type)
            if (currentEventType === "research_triggered" && onResearchTriggered) {
              onResearchTriggered(data);
            } else if (currentEventType === "thinking" && onThinking) {
              onThinking(data);
            } else if (currentEventType === "research_status" && onResearchStatus) {
              onResearchStatus(data);
            } else if (currentEventType === "research_complete" && onResearchComplete) {
              onResearchComplete(data);
            } else if ((currentEventType === "clarification_done" || data.type === "clarification_done") && onClarificationDone) {
              onClarificationDone(typeof data.clarifyId === "string" ? data.clarifyId : undefined);
            } else if (currentEventType === "context_status" || data.type === "context_status") {
              if (data.status === "preparing" || data.status === "ready") {
                onContextStatus?.(data.status);
              } else {
                console.warn("[streamAgentChat] Ignoring invalid context status");
              }
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
              const quiz = parseQuizContent(data);
              if (quiz) onQuiz(quiz);
              else onBlockCancel?.("add_quiz");
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
            } else if (currentEventType === "circuit_start" || data.type === "circuit_start") {
              onCircuitStart?.();
            } else if (currentEventType === "circuit" || data.type === "circuit") {
              const payload = parseCircuitPayload(data);
              if (payload) onCircuit?.(payload);
              else onBlockCancel?.("add_circuit");
            } else if (currentEventType === "slides_start" || data.type === "slides_start") {
              onSlidesStart?.();
            } else if (currentEventType === "slides" || data.type === "slides") {
              const payload = { ...data, type: "slides" };
              // Conversation IDs belong to the SSE envelope, not the saved slide block.
              delete payload.thread_id;
              delete payload.conversation_id;
              const block = parseSlidesBlock(payload);
              if (block) onSlides?.(block);
              else onBlockCancel?.("add_slides");
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
let pendingAgentRequest: { key: string; promise: Promise<AzureAgentRow[]> } | null = null;
let agentCacheGeneration = 0;

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
  const account = useUserStore.getState();
  const uid = account.userId;
  const scope = `${uid || ""}:${account.role || ""}`;
  if (!uid) {
    agentCache = null;
    agentCacheUserId = "";
    return [];
  }
  if (uid) qp.set("user_id", uid);

  // Invalidate cache if user changed (e.g. switched accounts)
  if (scope !== agentCacheUserId) {
    agentCache = null;
    agentCacheTime = 0;
  }

  // Return cached data if still valid and not forcing refresh
  if (account.role !== "student" && !needsForceRefresh && agentCache !== null && (now - agentCacheTime) < AGENT_CACHE_TTL) {
    return agentCache;
  }

  // If there's already a pending request, wait for it instead of making a new one
  // This prevents duplicate API calls from React StrictMode double-mounting
  const generation = agentCacheGeneration;
  const requestKey = `${scope}:${generation}`;
  if (pendingAgentRequest?.key === requestKey) {
    return pendingAgentRequest.promise;
  }

  const params = qp.toString() ? `?${qp.toString()}` : "";
  
  // Create the request and track it
  const promise = request<AzureAgentRow[]>(`azure/agents/list${params}`).then(agents => {
    const current = useUserStore.getState();
    if (`${current.userId || ""}:${current.role || ""}` !== scope) return [];
    if (generation === agentCacheGeneration) {
      agentCache = agents;
      agentCacheTime = Date.now();
      agentCacheUserId = scope;
    }
    return agents;
  });
  pendingAgentRequest = { key: requestKey, promise };
  
  try {
    return await promise;
  } finally {
    // Clear pending request regardless of success/failure
    if (pendingAgentRequest?.promise === promise) pendingAgentRequest = null;
  }
}

/**
 * Invalidate the agent cache. Call this after create/delete/update operations.
 * Sets a flag to force next fetch to bypass backend cache as well.
 */
let forceNextRefresh = false;

export function invalidateAgentCache(): void {
  invalidateCourseInfoCache();
  agentCacheGeneration += 1;
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
export type CurriculumState = "ready" | "processing" | "not_available" | "failed";

export type CurriculumResponse = {
  agent_name: string;
  status: CurriculumState;
  course_curriculum?: any | null;
  can_retry?: boolean;
  message?: string;
};

export async function getAgentCourseCurriculum(agent_name: string, signal?: AbortSignal): Promise<CurriculumResponse> {
  return request(`agents/${encodeURIComponent(agent_name)}/course-curriculum`, { signal });
}

/** Lightweight status-only check (no curriculum payload). */
export async function getAgentCurriculumStatus(agent_name: string, signal?: AbortSignal): Promise<CurriculumResponse> {
  return request(`agents/${encodeURIComponent(agent_name)}/course-curriculum?status_only=true`, { signal });
}

export function retryAgentCurriculum(agent_name: string, signal?: AbortSignal): Promise<CurriculumResponse> {
  return request(`agents/${encodeURIComponent(agent_name)}/course-curriculum/retry`, {
    method: "POST", body: JSON.stringify({}), signal,
  });
}

export const SYLLABUS_LANGUAGES = {
  te: "Telugu", hi: "Hindi", ta: "Tamil", kn: "Kannada", ml: "Malayalam", mr: "Marathi",
  bn: "Bengali", gu: "Gujarati", pa: "Punjabi", ur: "Urdu", or: "Odia", as: "Assamese",
} as const;

export type SyllabusLanguage = keyof typeof SYLLABUS_LANGUAGES;
export type SyllabusTranslationStyle = "pure" | "mixed";
export type SyllabusTranslationSummary = {
  language: SyllabusLanguage;
  style: SyllabusTranslationStyle;
  source_hash: string;
  created_at: string;
  instructions_hash?: string;
};
export type SyllabusTranslation = SyllabusTranslationSummary & { translations: Record<string, string> };
export type SyllabusTranslationCatalog = {
  source_hash: string;
  translations: SyllabusTranslationSummary[];
  default_instructions: string;
  max_instructions_length: number;
};

export function listSyllabusTranslations(agentId: string) {
  return request<SyllabusTranslationCatalog>(`agents/${encodeURIComponent(agentId)}/course-curriculum/translations`);
}

export function getSyllabusTranslation(agentId: string, language: SyllabusLanguage, style: SyllabusTranslationStyle, sourceHash: string, instructionsHash = "default") {
  const params = new URLSearchParams({ source_hash: sourceHash });
  if (instructionsHash !== "default") params.set("instructions_hash", instructionsHash);
  return request<SyllabusTranslation>(`agents/${encodeURIComponent(agentId)}/course-curriculum/translations/${language}/${style}?${params}`);
}

export function createSyllabusTranslation(agentId: string, language: SyllabusLanguage, style: SyllabusTranslationStyle, sourceHash: string, instructions?: string) {
  return request<SyllabusTranslation>(`agents/${encodeURIComponent(agentId)}/course-curriculum/translations`, {
    method: "POST",
    body: JSON.stringify({ language, style, source_hash: sourceHash, instructions }),
  });
}

export type LearnerProfile = {
  customInstructions: string;
  updatedAt: string | null;
};

function parseLearnerProfile(value: unknown): LearnerProfile {
  if (!value || typeof value !== "object"
    || !("customInstructions" in value) || typeof value.customInstructions !== "string"
    || !("updatedAt" in value) || (value.updatedAt !== null && typeof value.updatedAt !== "string")) {
    throw new Error("Invalid learner profile response");
  }
  return { customInstructions: value.customInstructions, updatedAt: value.updatedAt };
}

export async function getLearnerProfile(): Promise<LearnerProfile> {
  return parseLearnerProfile(await request<unknown>("learner-profile"));
}

export async function updateLearnerProfile(customInstructions: string): Promise<LearnerProfile> {
  return parseLearnerProfile(await request<unknown>("learner-profile", {
    method: "PUT",
    body: JSON.stringify({ customInstructions }),
  }));
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
  return request(`agents/${encodeURIComponent(agent_name)}/progress/${encodeURIComponent(user_id)}`);
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

export function fillCourseForm(
  text: string,
  form: ReturnType<typeof courseFormContext>,
  availablePrerequisites: Array<{ id: string; name: string }>,
  signal: AbortSignal,
  conversation: {
    history: Array<{ role: "user" | "assistant"; text: string }>;
    allowEdits: boolean;
    attachments?: Array<{ name: string; contentType: string; data: string }>;
  },
) {
  return request<{ message: string; fields: CourseFormPatch }>("course-form/assist", {
    method: "POST",
    body: JSON.stringify({ text, form, availablePrerequisites, ...conversation }),
    signal,
  });
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
  agentAvatar?: CourseAvatarOptions | null;
  sessionUuid?: string | null;  // Session UUID for KB file storage location
  materialJobId?: string | null;
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

export type CreatedCourse = {
  agent_id: string;
  name: string;
  description: string;
  conversation_starters: Array<{ title: string; prompt: string }>;
  index_name: string;
  knowledge_attached: boolean;
  knowledge_pending: boolean;
  materials_job_id: string;
  materials_status: string;
  manage_code: string;
};

export type CourseCreationStatus = {
  job_id: string;
  status: "NOT_STARTED" | "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  progress: "not_started" | "preparing" | "creating" | "saving" | "created";
  course_name?: string | null;
  materials_status: string;
  error?: string | null;
  result?: CreatedCourse | null;
};

export function getCourseCreation(jobId: string, signal?: AbortSignal): Promise<CourseCreationStatus> {
  return request<CourseCreationStatus>(`agents/creation-jobs/${encodeURIComponent(jobId)}`, { signal });
}

export function retryCourseCreation(jobId: string): Promise<CourseCreationStatus> {
  return request<CourseCreationStatus>(`agents/creation-jobs/${encodeURIComponent(jobId)}/retry`, { method: "POST" });
}

export async function waitForCourseCreation(jobId: string, onStatus?: (status: CourseCreationStatus) => void, signal?: AbortSignal): Promise<CreatedCourse> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    signal?.throwIfAborted();
    const status = await getCourseCreation(jobId, signal);
    signal?.throwIfAborted();
    onStatus?.(status);
    if (status.status === "COMPLETED" && status.result) return status.result;
    if (status.status === "FAILED") throw new Error(status.error || "TA creation failed. Resume the saved job to retry.");
    if (status.status === "NOT_STARTED") throw new Error(status.error || "TA creation was not submitted. Return to the form to submit it.");
    await new Promise(resolve => window.setTimeout(resolve, 1500));
  }
  throw new Error("TA creation is still running. Its progress has been saved; resume this job to check again.");
}

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
  agentAvatar?: CourseAvatarOptions | null;
  // Course code (e.g. CS101)
  courseCode?: string;
  // Prerequisites
  prerequisites?: string[];
  // Teacher-curated URLs for focused web search
  courseUrls?: string[];
  // Textbook metadata for course curriculum research
  textbooks?: Array<{ name: string; edition: string; authors?: string[]; type: string; description?: string }>;
  conversationStarters?: Array<{ title: string; prompt: string }>;
  // Department this agent belongs to
  departmentId?: string;
}, onStatus?: (status: CourseCreationStatus) => void, signal?: AbortSignal): Promise<CreatedCourse> {
  const status = await request<CourseCreationStatus>("agents/create-async", {
    method: "POST",
    body: JSON.stringify(params),
    signal,
  });
  signal?.throwIfAborted();
  onStatus?.(status);
  if (status.status === "COMPLETED" && status.result) return status.result;
  return waitForCourseCreation(status.job_id, onStatus, signal);
}

/**
 * Save agent setup details to JSON file
 * POST /api/agents/setup/save
 */
export async function saveAgentSetupDetails(details: AgentSetupDetails): Promise<{ ok: true }> {
  return request<{ ok: true }>("agents/setup/save", {
    method: "POST",
    body: JSON.stringify(details),
  }).finally(() => invalidateCourseInfoCache(details.agentId));
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
 * Open an agent by code, joining only when access is not already available.
 * POST /api/agents/connect-by-code
 */
export async function connectByCode(code: string): Promise<{ agent_id: string; course_name: string; agent_name: string; already_joined: boolean }> {
  const result = await request<{ agent_id: string; course_name: string; agent_name: string; already_joined: boolean }>("agents/connect-by-code", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
  if (!result.already_joined) invalidateAgentCache();
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
