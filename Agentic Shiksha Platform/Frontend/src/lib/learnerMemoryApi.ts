import { API_BASE_URL } from "./config";

export type MemoryMode = "off" | "shadow" | "authoritative";
export type MemoryConfig = {
  enabled: boolean;
  mode: MemoryMode;
  memory_scope: { tenant_id: string; institute_id: string } | null;
  curriculum_binding: { curriculum_id: string; curriculum_version: string } | null;
  can_manage: boolean;
  revision: string;
};
type MemoryConfigurationResponse = Omit<MemoryConfig, "mode" | "can_manage"> & {
  graph_memory_mode: MemoryMode;
  can_manage?: boolean;
};
export type ConceptStatus = "NOT_ATTEMPTED" | "INSUFFICIENT_EVIDENCE" | "STRUGGLING" | "PROGRESSING" | "MASTERED";
export type MisconceptionStatus = "NOT_ASSESSED" | "INSUFFICIENT_EVIDENCE" | "SUSPECTED" | "PRESENT" | "RESOLVING" | "CLEARED";
export type ThresholdStatus = "NOT_CROSSED" | "CANDIDATE" | "CROSSED";
export type Trend = "UNKNOWN" | "IMPROVING" | "STABLE" | "DECLINING";
export type TransferStatus = "NOT_ATTEMPTED" | "INSUFFICIENT_EVIDENCE" | "FAIL" | "PASS";
export type StateEvidence = {
  state_version?: number;
  confidence?: number;
  trend?: Trend;
  updated_at?: string | null;
  next_revalidation_at?: string | null;
  raw_evidence_count?: number;
  qualifying_evidence_count?: number;
  independent_context_count?: number;
  evidence_ids?: string[];
  observation_ids?: string[];
  reason_codes?: string[];
  policy_version?: string | null;
  curriculum_version?: string | null;
};
export type ConceptState = StateEvidence & { tc_id: string; state: ConceptStatus };
export type MisconceptionState = StateEvidence & { misconception_id: string; state: MisconceptionStatus };
export type ThresholdState = StateEvidence & {
  tc_id: string;
  state: ThresholdStatus;
  required_total?: number;
  required_cleared?: number;
  required_coverage?: number;
  evidence_sufficient?: boolean;
  transfer_state?: TransferStatus;
};
export type LearningProfile = {
  active_tc: string | null;
  strong_tcs: string[];
  weak_tcs: string[];
  candidate_tcs: string[];
  crossed_tcs: string[];
  active_misconceptions: Record<string, { state: MisconceptionStatus; trend: Trend }>;
  unresolved_prerequisites: string[];
  next_recommended_probe: { tc_id: string; misconception_id?: string | null; problem_id?: string | null; reason_code: string } | null;
  learning_trend: Trend;
  updated_at: string | null;
  curriculum_id?: string | null;
  curriculum_version?: string | null;
  policy_version?: string | null;
  snapshot_version?: number;
  next_revalidation_at?: string | null;
  needs_revalidation?: boolean;
};
export type LearnerSnapshot = {
  snapshot_version: number;
  scope?: { curriculum_id: string; curriculum_version: string; course_id: string; student_id: string };
  misconception_states: Record<string, MisconceptionState>;
  concept_states: Record<string, ConceptState>;
  threshold_states: Record<string, ThresholdState>;
  profile?: LearningProfile;
  as_of?: string | null;
  next_revalidation_at?: string | null;
  policy_version?: string | null;
};
export type MemoryFreshness = {
  as_of?: string | null;
  updated_at?: string | null;
  needs_revalidation?: boolean;
  next_revalidation_at?: string | null;
  status?: string;
};
export type LearnerMemory = {
  mode: MemoryMode;
  snapshot: LearnerSnapshot | null;
  profile: LearningProfile | null;
  pending_count: number;
  freshness: MemoryFreshness | string | null;
  processing_receipt?: MemoryProcessingReceipt | null;
};
export type MemoryProcessingReceipt = {
  event_id: string;
  status: "ACCEPTED" | "PENDING" | "PROCESSING" | "RETRY_PENDING" | "COMPLETED" | "FAILED" | "REJECTED" | "SUPERSEDED";
  error_code?: string | null;
  next_retry_at?: string | null;
  attempts?: number;
};
export type GraphNodeType = "COURSE" | "TC" | "MISCONCEPTION" | "CONCEPT_INVENTORY" | "PROBLEM" | "CURRICULUM_VERSION";
export type GraphRelation = "HAS_THRESHOLD" | "PREREQUISITE_OF" | "ASSOCIATED_WITH" | "ASSESSED_BY" | "CONTAINS" | "HAS_PROBLEM" | "TESTS" | "DIAGNOSES" | "HAS_TRANSFER_PROBE";
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type GraphProvenance = { source?: string; source_ref?: string | null; source_content_hash?: string | null; reviewed_aliases?: string[]; review_note?: string | null };
export type CurriculumNode = {
  id: string;
  type: GraphNodeType;
  name: string;
  description?: string;
  active?: boolean;
  definition_version?: string;
  curriculum_id?: string | null;
  curriculum_version?: string | null;
  schema_version?: 1;
  provenance?: GraphProvenance;
  crossing_policy_version?: string | null;
  inventory_version?: string | null;
  assessment_intent?: string | null;
  approved?: boolean;
  problem_version?: string | null;
  family_id?: string | null;
  task_type?: "MULTIPLE_CHOICE" | "SHORT_ANSWER" | "WORKED_PROBLEM" | "TRANSFER" | null;
  prompt?: string | null;
  content_ref?: string | null;
  rubric_id?: string | null;
  rubric_version?: string | null;
  rubric_dimensions?: Array<{ id: string; description?: string; required?: boolean }>;
  assessment_version?: string | null;
  options?: Array<{ key: string; text: string }>;
  correct_key?: string | null;
  diagnostic_approved?: boolean;
  transfer_approved?: boolean;
  catalog_diagnostic_reliability?: number | null;
  requires_reasoning?: boolean;
};
export type CurriculumEdge = {
  id?: string | null;
  source_id: string;
  target_id: string;
  relation: GraphRelation;
  schema_version?: 1;
  curriculum_id?: string | null;
  curriculum_version?: string | null;
  provenance?: GraphProvenance;
  required_for_crossing?: boolean | null;
  threshold_relevance?: "BLOCKING" | "SIGNIFICANT" | "PERIPHERAL" | null;
  pedagogical_priority?: number;
  diagnostic_strength?: number | null;
  evidence_if_correct?: "NO_INFERENCE" | "SUPPORTS" | "CONTRADICTS";
  evidence_if_incorrect?: "NO_INFERENCE" | "SUPPORTS" | "CONTRADICTS";
  reasoning_required?: boolean;
  problem_version?: string | null;
  rubric_version?: string | null;
  assessment_version?: string | null;
  reviewed?: boolean;
  order?: number | null;
  transfer_condition_id?: string | null;
};
export type CurriculumPolicy = {
  version: string;
  teacher_reviewed?: boolean;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  confidence_calibrated?: false;
  [key: string]: JsonValue | undefined;
};
export type CurriculumGraph = {
  tenant_id: string;
  curriculum_id: string;
  version: string;
  institute_ids: string[];
  course_name: string;
  nodes: CurriculumNode[];
  edges: CurriculumEdge[];
  policies: CurriculumPolicy;
  course_ids?: string[];
  status?: "DRAFT" | "PUBLISHED";
  published_ready?: boolean;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  schema_version?: 1;
  provenance?: GraphProvenance;
};
export type CurriculumDraft = { id: string; revision: string | null; graph: CurriculumGraph };
export type GraphPublication = CurriculumDraft;
export type MemoryEvidence = {
  evidence_id?: string;
  id?: string;
  event_id?: string;
  source?: string;
  quote?: string;
  excerpt?: string;
  reasoning?: string | null;
  observed_at?: string | null;
  occurred_at?: string | null;
  answer?: JsonValue;
  problem_id?: string | null;
  untrusted_learner_content?: string;
};
export type MemoryContext = {
  tc_id?: string | null;
  nodes?: CurriculumNode[];
  edges?: CurriculumEdge[];
  evidence?: MemoryEvidence[];
  evidence_ids?: string[];
  reason_codes?: string[];
  complete?: boolean;
  truncated?: boolean;
  snapshot_version?: number;
  active_tc?: string | null;
  bounds_applied?: string[];
  prerequisite_gaps?: Array<{ tc_id: string; action: string; reason: string }>;
  likely_bottlenecks?: Array<{ tc_id: string; certainty: string }>;
};
export type CohortMemory = {
  mode?: MemoryMode;
  student_count: number;
  total_students: number;
  complete: boolean;
  tc_id?: string | null;
  curriculum_version?: string;
  threshold_counts: Record<string, number | Record<string, number>>;
  misconception_counts: Record<string, number | Record<string, number>>;
  concept_counts?: Record<string, number | Record<string, number>>;
  pending_count?: number;
  unassessed_students?: number;
  stale_students?: number;
  next_offset?: number | null;
  offset?: number;
  coverage?: number;
  transfer_counts?: Record<string, Record<string, number>>;
  blockers?: Record<string, Record<string, number>>;
  prerequisite_bottlenecks?: Record<string, Record<string, number>>;
};

export class MemoryApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "MemoryApiError";
    this.status = status;
  }
}

const base = `${API_BASE_URL.replace(/\/+$/, "").replace(/\/api$/i, "")}/api`;
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...options, credentials: "include", cache: "no-store",
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
  if (!response.ok) {
    if (response.status === 422) {
      const body: unknown = await response.json().catch(() => null);
      if (body && typeof body === "object" && "detail" in body && typeof body.detail === "string") {
        throw new MemoryApiError(body.detail, response.status);
      }
    }
    throw new MemoryApiError(response.status === 409
      ? "This draft changed on the server. Reload it before saving or publishing."
      : response.status === 401 || response.status === 403
        ? "You do not have access to this course's Graph Memory."
        : response.status === 422
          ? "Graph validation failed. Check the node, edge, transfer and policy definitions before retrying."
          : "Graph Memory could not be loaded or saved. Please retry.", response.status);
  }
  return response.json();
}
const course = (agentId: string) => `/agents/${encodeURIComponent(agentId)}`;
const learner = (agentId: string, studentId: string) => `${course(agentId)}/learners/${encodeURIComponent(studentId)}/memory`;
function configView(value: MemoryConfigurationResponse): MemoryConfig {
  if (!["off", "shadow", "authoritative"].includes(value.graph_memory_mode) || typeof value.enabled !== "boolean" || typeof value.revision !== "string") {
    throw new Error("Invalid course memory configuration.");
  }
  return { ...value, mode: value.graph_memory_mode, can_manage: value.can_manage === true };
}

export const learnerMemoryApi = {
  getConfig: async (agentId: string, signal?: AbortSignal) =>
    configView(await request<MemoryConfigurationResponse>(`${course(agentId)}/memory/config`, { signal })),
  setConfig: async (agentId: string, config: Pick<MemoryConfig, "mode" | "memory_scope" | "curriculum_binding" | "revision">) =>
    configView(await request<MemoryConfigurationResponse>(`${course(agentId)}/memory/config`, { method: "PUT", body: JSON.stringify({
      graph_memory_mode: config.mode, memory_scope: config.memory_scope, curriculum_binding: config.curriculum_binding, revision: config.revision,
    }) })),
  getMemory: async (agentId: string, studentId: string, signal?: AbortSignal): Promise<LearnerMemory> => {
    const value = await request<LearnerSnapshot & { mode: MemoryMode; pending_count: number; freshness: MemoryFreshness | string | null; processing_receipt?: MemoryProcessingReceipt | null }>(learner(agentId, studentId), { signal });
    if (!Number.isInteger(value.snapshot_version) || !Number.isInteger(value.pending_count) || value.pending_count < 0
      || !["shadow", "authoritative"].includes(value.mode)
      || !value.concept_states || !value.threshold_states || !value.misconception_states
      || (value.scope && (value.scope.course_id !== agentId || value.scope.student_id !== studentId))) {
      throw new Error("Invalid learner memory response.");
    }
    return { mode: value.mode, snapshot: value, profile: value.profile || null, pending_count: value.pending_count, freshness: value.freshness, processing_receipt: value.processing_receipt };
  },
  getContext: (agentId: string, studentId: string, tcId: string, signal?: AbortSignal, mode: "ta" | "individual" = "ta") =>
    request<MemoryContext>(`${learner(agentId, studentId)}/context?${new URLSearchParams({ tc_id: tcId, mode })}`, { signal }),
  getEvidence: (agentId: string, studentId: string, evidenceId: string, signal?: AbortSignal) =>
    request<MemoryEvidence>(`${learner(agentId, studentId)}/evidence/${encodeURIComponent(evidenceId)}`, { signal }),
  getCohort: (agentId: string, tcId: string, signal?: AbortSignal, offset = 0) =>
    request<CohortMemory>(`/teacher-dashboard/memory/cohorts/${encodeURIComponent(agentId)}?${new URLSearchParams({ ...(tcId ? { tc_id: tcId } : {}), offset: String(offset) })}`, { signal }),
  retryProcessing: (agentId: string, studentId: string, eventId: string) =>
    request<MemoryProcessingReceipt>(`${learner(agentId, studentId)}/recomputations`, { method: "POST", body: JSON.stringify({ event_id: eventId }) }),
  getDraft: (agentId: string, signal?: AbortSignal) =>
    request<CurriculumDraft>(`${course(agentId)}/course-curriculum/graph`, { signal }),
  saveDraft: (agentId: string, graph: CurriculumGraph, expectedRevision: string | null) =>
    request<CurriculumDraft>(`${course(agentId)}/course-curriculum/graph`, {
      method: "PUT", body: JSON.stringify({ graph, expected_revision: expectedRevision }),
    }),
  importExistingCurriculum: (agentId: string, version: string, expectedRevision: string | null) =>
    request<CurriculumDraft>(`${course(agentId)}/course-curriculum/graph/import`, {
      method: "POST", body: JSON.stringify({ curriculum_version: version, expected_revision: expectedRevision }),
    }),
  publish: (agentId: string, draft: CurriculumDraft, courseRevision: string, idempotencyKey: string) =>
    request<GraphPublication>(`${course(agentId)}/course-curriculum/publish`, {
      method: "POST", body: JSON.stringify({
        curriculum_version: draft.graph.version, expected_revision: draft.revision,
        expected_course_revision: courseRevision, event_id: idempotencyKey, reviewed: true,
      }),
    }),
};
