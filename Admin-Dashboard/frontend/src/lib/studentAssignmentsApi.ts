import { API_BASE_URL } from "./config";
import { clearDashboardRequests } from "./dashboardRequestCache";

export interface AssignmentStudent {
  user_id: string;
  name: string;
  email: string;
  institute: string;
  department: string;
  status: "active" | "invited" | "unavailable";
}

export interface StudentAssignment {
  agent_id: string;
  student_ids: string[];
  revision: string;
}

export interface StudentRoster extends StudentAssignment {
  students: AssignmentStudent[];
}

export interface CoursePlacement {
  agent_id: string;
  institute: string;
  department: string;
  revision: string;
}

export class StudentAssignmentError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "StudentAssignmentError";
  }
}

async function readResponse(response: Response, operation = "Student assignment"): Promise<unknown> {
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = isRecord(data) && typeof data.detail === "string" ? data.detail : null;
    throw new StudentAssignmentError(
      detail || `${operation} request failed (${response.status}). Please retry.`,
      response.status,
    );
  }
  return data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCoursePlacement(value: unknown, agentId: string): value is CoursePlacement {
  return isRecord(value) && value.agent_id === agentId
    && typeof value.institute === "string" && typeof value.department === "string"
    && Boolean(value.institute) === Boolean(value.department)
    && typeof value.revision === "string" && !!value.revision;
}

export async function getCoursePlacement(agentId: string, signal?: AbortSignal): Promise<CoursePlacement> {
  const response = await fetch(`${API_BASE_URL}/api/agents/${encodeURIComponent(agentId)}/placement`, {
    credentials: "include", cache: "no-store", signal,
  });
  const data = await readResponse(response, "TA department");
  if (!isCoursePlacement(data, agentId)) throw new Error("The TA department could not be verified. Reload before saving.");
  return data;
}

export async function saveCoursePlacement(
  agentId: string, institute: string, department: string, revision: string,
): Promise<CoursePlacement> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/agents/${encodeURIComponent(agentId)}/placement`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ institute: institute.trim(), department: department.trim(), revision }),
    });
    const data = await readResponse(response, "TA department");
    if (!isCoursePlacement(data, agentId) || data.institute !== institute.trim() || data.department !== department.trim()) {
      throw new Error("The department save could not be confirmed. Reload to check the saved placement.");
    }
    return data;
  } finally {
    clearDashboardRequests();
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === "string" && item.length > 0);
}

function isAssignment(value: unknown, agentId: string): value is StudentAssignment {
  return isRecord(value)
    && value.agent_id === agentId
    && isStringArray(value.student_ids)
    && new Set(value.student_ids).size === value.student_ids.length
    && typeof value.revision === "string"
    && value.revision.length > 0;
}

function isStudent(value: unknown): value is AssignmentStudent {
  return isRecord(value)
    && typeof value.user_id === "string" && value.user_id.length > 0
    && typeof value.name === "string"
    && typeof value.email === "string"
    && typeof value.institute === "string"
    && typeof value.department === "string"
    && ["active", "invited", "unavailable"].includes(value.status as string);
}

export async function getStudentRoster(agentId: string, signal: AbortSignal): Promise<StudentRoster> {
  const response = await fetch(`${API_BASE_URL}/api/agents/${encodeURIComponent(agentId)}/students`, {
    credentials: "include",
    cache: "no-store",
    signal,
  });
  const data = await readResponse(response);
  if (!isAssignment(data, agentId) || !("students" in data) || !Array.isArray(data.students)
    || !data.students.every(isStudent)) {
    throw new Error("The student roster response is incomplete. Reload it before making changes.");
  }
  const candidates = new Set(data.students.map(student => student.user_id));
  if (candidates.size !== data.students.length || data.student_ids.some(id => !candidates.has(id))) {
    throw new Error("The student roster response is incomplete. Reload it before making changes.");
  }
  return { ...data, students: data.students };
}

export async function saveStudentRoster(
  agentId: string,
  studentIds: string[],
  revision: string,
): Promise<StudentAssignment> {
  const response = await fetch(`${API_BASE_URL}/api/agents/${encodeURIComponent(agentId)}/students`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ student_ids: studentIds, revision }),
  });
  const data = await readResponse(response);
  if (!isAssignment(data, agentId)) {
    throw new Error("The save could not be confirmed. Reload the roster to check the saved assignments.");
  }
  return data;
}

export async function addCourseMember(
  agentId: string,
  userId: string,
  memberType: "student" | "teacher",
): Promise<void> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/agents/${encodeURIComponent(agentId)}/members`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, member_type: memberType }),
    });
    const data = await readResponse(response, "Course assignment");
    if (!isRecord(data) || data.status !== "ok" || data.agent_id !== agentId
      || data.added !== userId || data.as !== memberType) {
      throw new Error("The course assignment could not be confirmed. Retry to check or complete it.");
    }
  } finally {
    clearDashboardRequests();
  }
}

export async function getStudentAssignmentPermission(signal: AbortSignal): Promise<boolean> {
  // Do not trust the directory's cosmetic admin flags or a persisted browser role.
  const sessionResponse = await fetch(`${API_BASE_URL}/auth/me`, {
    credentials: "include", cache: "no-store", signal,
  });
  if (sessionResponse.status === 401 || sessionResponse.status === 403) return false;
  const session = await readResponse(sessionResponse);
  if (!isRecord(session) || typeof session.id !== "string" || !session.id) return false;

  const profileResponse = await fetch(`${API_BASE_URL}/api/user/${encodeURIComponent(session.id)}`, {
    credentials: "include", cache: "no-store", signal,
  });
  if (profileResponse.status === 401 || profileResponse.status === 403) return false;
  const data = await readResponse(profileResponse);
  if (!isRecord(data) || data.success !== true || !isRecord(data.profile)) return false;
  return data.profile.status === "active"
    && (data.profile.role === "admin" || data.profile.role === "superadmin");
}
