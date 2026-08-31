/**
 * Teacher Dashboard API client.
 * Talks to the main backend at /api/teacher-dashboard.
 * Every call is scoped to the authenticated teacher's own courses and
 * authenticated with the shared HttpOnly session cookie.
 */

import { DASHBOARD_API_URL, authHeaders } from "./config";

const BASE = `${DASHBOARD_API_URL}/api/teacher-dashboard`;
const pendingGets = new Map<string, Promise<unknown>>();
const GET_DEDUP_WINDOW_MS = 2000;

async function get<T>(path: string): Promise<T> {
  const url = `${BASE}/${path.replace(/^\/+/, "")}`;
  const pending = pendingGets.get(url);
  if (pending) return pending as Promise<T>;

  const request = (async () => {
    const res = await fetch(url, { credentials: "include", headers: authHeaders() });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Teacher API ${res.status}: ${body}`);
    }
    return res.json() as Promise<T>;
  })();

  pendingGets.set(url, request);
  try {
    const result = await request;
    setTimeout(() => {
      if (pendingGets.get(url) === request) pendingGets.delete(url);
    }, GET_DEDUP_WINDOW_MS);
    return result;
  } catch (error) {
    if (pendingGets.get(url) === request) pendingGets.delete(url);
    throw error;
  }
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
  teacherIds?: string[];
  courseName?: string;
  courseLevel?: string;
  courseCode?: string;
  courseDuration?: string;
  sessionUuid?: string;
}

export interface AgentListResponse {
  agents: DashboardAgent[];
  count: number;
}

export interface TeacherProfile {
  id: string;
  role: string;
  name: string;
  email: string;
  institute: string;
  department: string;
}

export interface CourseSummary {
  agentId: string;
  name: string;
  studentCount: number;
  activeStudentCount?: number;
  avgPctComplete: number;
  totalTokens: number;
  activeThreads: number;
}

export interface TeacherSummary {
  teacherId: string;
  courseCount: number;
  agentIds: string[];
  totalStudents: number;
  activeStudents?: number;
  avgPctComplete: number;
  totalTokens: number;
  totalThreads: number;
  activeThreads: number;
  courses: CourseSummary[];
}

export interface RecentlyActive {
  topic: string;
  status: string;
  last_updated: string;
}

export interface StudentSummary {
  user_id: string;
  display_name?: string;
  agent_id: string;
  total_topics: number;
  learned: number;
  in_progress: number;
  not_started: number;
  pct_complete: number;
  recently_active: RecentlyActive[];
  struggle_areas: string[];
  concepts_total?: number;
  concepts_learned?: number;
  concepts_in_progress?: number;
  concepts_not_started?: number;
  concepts_pct_complete?: number;
  explored?: number;
  assets?: number;
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

export interface UsageStats {
  agent_id: string;
  total_students?: number;
  active_students: number;
  active_teachers: number;
  total_threads: number;
  active_threads: number;
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

export interface TopicEntry {
  topic: string;
  status: string;
  latest_summary: string;
  last_updated: string;
  module: string;
}

export interface Misconception {
  misconception: string;
  why_wrong?: string;
}

export interface ConceptEntry {
  concept: string;
  status: string;
  misconceptions_addressed: string[];
  last_updated: string;
  description?: string;
  why_threshold?: string;
  misconceptions?: Misconception[];
  related_chapters?: string[];
}

export interface SyllabusModuleProgress {
  module_id: string;
  title: string;
  topics: { topic: string; status: string; latest_summary?: string }[];
  learned: number;
  learning_objectives: string[];
  prerequisites: string[];
  concepts: { concept: string; status: string }[];
}

export interface StudentDetail {
  user_id: string;
  display_name?: string;
  email?: string;
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
  concepts_by_status?: {
    learned: ConceptEntry[];
    in_progress: ConceptEntry[];
    not_started: ConceptEntry[];
  };
  total_concepts?: number;
  concepts_learned?: number;
  concepts_in_progress?: number;
  concepts_pct_complete?: number;
  syllabus?: SyllabusModuleProgress[];
  off_plan_topics?: TopicEntry[];
  last_updated: string;
}

export interface StudentAsset {
  id: string;
  title: string;
  description: string;
  category: string;
  type: string;
  tags: string[];
  thread_id: string;
  preview_image_url: string;
  created_at: string;
  updated_at: string;
}

export interface StudentAssetDetail {
  id: string;
  title: string;
  description: string;
  category: string;
  type: string;
  content: string;
  created_at: string;
}

export interface CurriculumConcept {
  concept: string;
  description: string;
  why_threshold: string;
  misconceptions: string[];
  related_chapters: string[];
}

export interface CurriculumModule {
  module_id: string;
  title: string;
  topics: string[];
  learning_objectives: string[];
  prerequisites: string[];
  concepts: string[];
}

export interface CourseCurriculum {
  agent_id: string;
  threshold_concepts: CurriculumConcept[];
  syllabus: CurriculumModule[];
  total_concepts: number;
  total_topics: number;
}

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

export interface StudentTokenUsage {
  userId: string;
  displayName: string;
  email: string;
  totalTokens: number;
  rounds: number;
}

export type UsageGranularity = "day" | "week" | "month";

export interface TokenUsagePoint {
  periodStart: string;
  periodEnd: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cumulativeInputTokens: number;
  cumulativeOutputTokens: number;
  cumulativeTokens: number;
}

export interface TokenUsageDistributionBand {
  key: "light" | "typical" | "high";
  label: string;
  studentCount: number;
  studentPercentage: number;
}

export interface TokenUsageAnalytics {
  startDate: string;
  endDate: string;
  granularity: UsageGranularity;
  scope: "course" | "all_courses";
  usageSource: "cosmos" | "foundry";
  sourceResponses: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  activeStudents: number;
  trackedResponses: number;
  totalResponses: number;
  coveragePct: number;
  series: TokenUsagePoint[];
  dailySeries: TokenUsagePoint[];
  distribution: TokenUsageDistributionBand[];
  distributionSuppressed: boolean;
  minimumDistributionStudents: number;
}

export type LearningActivityMetric = "threshold_crossings" | "assets_created";

export interface LearningActivityPoint {
  periodStart: string;
  periodEnd: string;
  count: number;
  cumulativeCount: number;
}

export interface LearningActivityAnalytics {
  metric: LearningActivityMetric;
  startDate: string;
  endDate: string;
  granularity: UsageGranularity;
  scope: "course" | "all_courses";
  totalEvents: number;
  activeStudents: number;
  activeCourses: number;
  activeDays: number;
  series: LearningActivityPoint[];
  dailySeries: LearningActivityPoint[];
  distribution: TokenUsageDistributionBand[];
  distributionSuppressed: boolean;
  minimumDistributionStudents: number;
}

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

export interface FeedbackResponse {
  feedback: FeedbackItem[];
  count: number;
}

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
}

export interface GroundednessSummary {
  total: number;
  avgFaithfulness: number | null;
  avgAnswerRelevancy: number | null;
  avgContextPrecision: number | null;
  avgOverall: number | null;
  maxScore: number;
}

export interface GroundednessResponse {
  ok: boolean;
  evaluations: GroundednessEvaluation[];
  summary: GroundednessSummary;
}

// ── API functions ──────────────────────────────────────────────────

export async function dashboardHealth(): Promise<{ status: string }> {
  return get("health");
}

export async function whoami(): Promise<TeacherProfile> {
  return get("me");
}

export async function getTeacherSummary(): Promise<TeacherSummary> {
  return get("summary");
}

export async function listDashboardAgents(): Promise<AgentListResponse> {
  return get("agents");
}

export async function getAgentOverview(agentId: string): Promise<AgentOverview> {
  return get(`agents/${encodeURIComponent(agentId)}/overview`);
}

export async function getCourseCurriculum(agentId: string): Promise<CourseCurriculum> {
  return get(`agents/${encodeURIComponent(agentId)}/curriculum`);
}

export async function getStudentDetail(
  agentId: string,
  userId: string,
): Promise<StudentDetail> {
  return get(
    `agents/${encodeURIComponent(agentId)}/students/${encodeURIComponent(userId)}`,
  );
}

export async function getStudentAssets(
  agentId: string,
  userId: string,
): Promise<{ assets: StudentAsset[] }> {
  return get(
    `agents/${encodeURIComponent(agentId)}/students/${encodeURIComponent(userId)}/assets`,
  );
}

export async function getStudentAsset(
  agentId: string,
  userId: string,
  assetId: string,
): Promise<StudentAssetDetail> {
  return get(
    `agents/${encodeURIComponent(agentId)}/students/${encodeURIComponent(userId)}/assets/${encodeURIComponent(assetId)}`,
  );
}

export async function getCoursesOverview(): Promise<{
  courses: CourseOverviewItem[];
  uniqueTotalUsers: number;
}> {
  return get("overview/courses");
}

export async function getTokenUsageOverview(): Promise<{ tokens: unknown[] }> {
  return get("overview/tokens");
}

export async function getTokenUsagePerStudent(
  agentId?: string,
): Promise<{ students: StudentTokenUsage[] }> {
  const params = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : "";
  return get(`overview/tokens/per-student${params}`);
}

export async function getTokenUsageAnalytics({
  agentId,
  startDate,
  endDate,
  granularity,
}: {
  agentId?: string;
  startDate: string;
  endDate: string;
  granularity: UsageGranularity;
}): Promise<TokenUsageAnalytics> {
  const params = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
    granularity,
  });
  if (agentId) params.set("agent_id", agentId);
  return get(`usage/analytics?${params.toString()}`);
}

export async function getLearningActivityAnalytics({
  metric,
  agentId,
  startDate,
  endDate,
  granularity,
}: {
  metric: LearningActivityMetric;
  agentId?: string;
  startDate: string;
  endDate: string;
  granularity: UsageGranularity;
}): Promise<LearningActivityAnalytics> {
  const params = new URLSearchParams({
    metric,
    start_date: startDate,
    end_date: endDate,
    granularity,
  });
  if (agentId) params.set("agent_id", agentId);
  return get(`activity/analytics?${params.toString()}`);
}

export async function listFeedback(limit = 200): Promise<FeedbackResponse> {
  return get(`feedback?limit=${limit}`);
}

export async function getTeacherGroundedness(): Promise<GroundednessResponse> {
  return get("evaluation/groundedness");
}

export async function getAgentGroundedness(
  agentId: string,
): Promise<GroundednessResponse> {
  return get(`evaluation/groundedness/agent/${encodeURIComponent(agentId)}`);
}
