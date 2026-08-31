/**
 * Dashboard API client.
 * Talks to the separate Dashboard server (port 8050).
 */

import { DASHBOARD_API_URL } from "./config";

const BASE = `${DASHBOARD_API_URL}/api/dashboard`;

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/${path.replace(/^\/+/, "")}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Dashboard API ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// ── Types ──────────────────────────────────────────────────────────

export interface DashboardAgent {
  id: string;
  agentId?: string;
  name?: string;
  description?: string;
  imageUrl?: string;
  createdAt?: string;
  createdById?: string;
  createdByName?: string;
  courseName?: string;
  courseLevel?: string;
}

export interface AgentListResponse {
  agents: DashboardAgent[];
  count: number;
}

export interface RecentlyActive {
  topic: string;
  status: string;
  last_updated: string;
}

export interface StudentSummary {
  user_id: string;
  agent_id: string;
  total_topics: number;
  learned: number;
  in_progress: number;
  not_started: number;
  pct_complete: number;
  recently_active: RecentlyActive[];
  struggle_areas: string[];
  last_updated: string;
}

export interface DistributionBuckets {
  "0-25%": number;
  "25-50%": number;
  "50-75%": number;
  "75-100%": number;
}

export interface StruggleTopic {
  topic: string;
  count: number;
}

export interface AgentOverview {
  agent_id: string;
  student_count: number;
  avg_pct_complete: number;
  total_topics: number;
  distribution: DistributionBuckets;
  top_struggle_topics: StruggleTopic[];
  students: StudentSummary[];
  usage: UsageStats;
}

export interface UsageStats {
  agent_id: string;
  active_students: number;
  active_teachers: number;
  total_threads: number;
  active_threads: number;
}

export interface TopicEntry {
  topic: string;
  status: string;
  latest_summary: string;
  last_updated: string;
  module: string;
}

export interface StudentDetail {
  user_id: string;
  agent_id: string;
  total_topics: number;
  learned: number;
  in_progress: number;
  not_started: number;
  pct_complete: number;
  topics_by_status: {
    learned: TopicEntry[];
    in_progress: TopicEntry[];
    not_started: TopicEntry[];
  };
  last_updated: string;
}

export interface StudentListResponse {
  agent_name: string;
  students: StudentSummary[];
  count: number;
}

// ── API functions ──────────────────────────────────────────────────

export async function dashboardHealth(): Promise<{ status: string }> {
  return get("health");
}

export async function listDashboardAgents(): Promise<AgentListResponse> {
  return get("agents");
}

export async function getAgentOverview(agentName: string): Promise<AgentOverview> {
  return get(`agents/${encodeURIComponent(agentName)}/overview`);
}

export async function getStudentDetail(
  agentName: string,
  userId: string,
): Promise<StudentDetail> {
  return get(`agents/${encodeURIComponent(agentName)}/students/${encodeURIComponent(userId)}`);
}

// ── Agent ownership ────────────────────────────────────────────────

export async function transferAgentOwnership(
  agentId: string,
  newOwnerId: string,
): Promise<{ status: string; agent_id: string; new_owner_id: string; new_owner_name: string }> {
  const res = await fetch(`${BASE}/agents/${encodeURIComponent(agentId)}/transfer-ownership`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ new_owner_id: newOwnerId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to transfer ownership: ${res.status}`);
  }
  return res.json();
}

// ── Course teachers ────────────────────────────────────────────────

export interface AgentTeacher {
  user_id: string;
  name: string;
  email: string;
  is_owner: boolean;
}

export async function getAgentTeachers(
  agentId: string,
): Promise<{ agent_id: string; owner_id: string; teachers: AgentTeacher[] }> {
  const res = await fetch(`${BASE}/agents/${encodeURIComponent(agentId)}/teachers`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to load teachers: ${res.status}`);
  }
  return res.json();
}

export async function setAgentTeachers(
  agentId: string,
  teacherIds: string[],
): Promise<{ status: string; agent_id: string; teacher_ids: string[] }> {
  const res = await fetch(`${BASE}/agents/${encodeURIComponent(agentId)}/teachers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ teacher_ids: teacherIds }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to save teachers: ${res.status}`);
  }
  return res.json();
}

// ── Feedback ───────────────────────────────────────────────────────

export interface FeedbackItem {
  id: string;
  userId: string;
  sentiment: string | null;
  category: string;
  text: string;
  userName: string;
  userEmail: string;
  imageUrls: string[];
  createdAt: string;
}

export interface FeedbackStats {
  total: number;
  sentiments: Record<string, number>;
  categories: Record<string, number>;
}

export interface FeedbackResponse {
  feedback: FeedbackItem[];
  count: number;
  stats: FeedbackStats;
}

export async function listFeedback(limit = 200): Promise<FeedbackResponse> {
  return get(`feedback?limit=${limit}`);
}

// ── Groundedness / RAG Evaluation ──────────────────────────────────

export interface GroundednessEvaluation {
  id: string;
  sessionId: string;
  messageGroupId: string;
  threadId: string;
  userId: string;
  query: string;
  response: string;
  groundednessScore: number | null;
  groundednessReason: string;
  answerRelevancyScore: number | null;
  answerRelevancyReason: string;
  contextPrecisionScore: number | null;
  contextPrecisionReason: string;
  overallScore: number | null;
  method: string;
  maxScore: number;
  evaluatedAt: string;
  supportedClaims?: string[];
  unsupportedClaims?: string[];
  addressedAspects?: string[];
  missedAspects?: string[];
}

export interface GroundednessScoreDistribution {
  "1-2": number;
  "2-3": number;
  "3-4": number;
  "4-5": number;
}

export interface GroundednessSummary {
  total: number;
  avgFaithfulness: number | null;
  avgAnswerRelevancy: number | null;
  avgContextPrecision: number | null;
  avgOverall: number | null;
  maxScore: number;
  distribution: GroundednessScoreDistribution;
}

export interface GroundednessAllResponse {
  ok: boolean;
  evaluations: GroundednessEvaluation[];
  summary: GroundednessSummary;
}

export async function getAllGroundednessEvaluations(
  limit: number = 200,
): Promise<GroundednessAllResponse> {
  return get(`evaluation/groundedness/all?limit=${limit}`);
}

// ── Courses Overview ───────────────────────────────────────────────

export interface CourseOverviewItem {
  agentId: string;
  course: string;
  institute: string;
  department: string;
  professors: string[];
  activeUsers: number;
  totalUsers: number;
  conversations: number;
  rounds: number;
  totalTokens: number;
}

export interface TokenStats {
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  rounds: number;
  conversations: number;
}

export async function getCoursesOverview(): Promise<{ courses: CourseOverviewItem[]; uniqueTotalUsers: number }> {
  return get("overview/courses");
}

export async function getTokenUsageOverview(): Promise<{ tokens: Record<string, TokenStats> }> {
  return get("overview/tokens");
}

export interface StudentTokenUsage {
  userId: string;
  displayName: string;
  email: string;
  totalTokens: number;
  rounds: number;
}

export async function getTokenUsagePerStudent(agentId?: string): Promise<{ students: StudentTokenUsage[] }> {
  const params = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : "";
  return get(`overview/tokens/per-student${params}`);
}

export interface TodayStats {
  activeStudents: number;
  tokens: number;
  rounds: number;
  newConversations: number;
  startDate: string;
  endDate: string;
}

export async function getPeriodStats(startDate?: string, endDate?: string): Promise<TodayStats> {
  const params = new URLSearchParams();
  if (startDate) params.set("start_date", startDate);
  if (endDate) params.set("end_date", endDate);
  const qs = params.toString();
  return get(`overview/today${qs ? `?${qs}` : ""}`);
}

export interface ImageQuota {
  limits: { medium: number; low: number };
  costPerImageUsd: { medium: number; low: number };
  estimatedWeeklyUsdPerStudent: number;
  estimatedMonthlyUsdPerStudent: number;
}

export async function getImageQuota(): Promise<ImageQuota> {
  return get("image-quota");
}

export async function updateImageQuota(limits: { medium?: number; low?: number }): Promise<ImageQuota> {
  const res = await fetch(`${BASE}/image-quota`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(limits),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Dashboard API ${res.status}: ${body}`);
  }
  return res.json() as Promise<ImageQuota>;
}
