// src/lib/api.ts
// Subset of the main Frontend api.ts — only directory-related functions
// needed by the Dashboard.

import { DASHBOARD_API_URL } from "./config";

/* ------------------------------ Base + helpers ------------------------------ */

const DASH_BASE = `${(DASHBOARD_API_URL || "").replace(/\/+$/, "")}/api`;

/** Build a URL against the Dashboard backend (port 8050) — general /api/* routes. */
function buildUrl(path: string): string {
  return `${DASH_BASE}/${path.replace(/^\/+/, "")}`;
}

/** Build a URL against the Dashboard backend — /api/dashboard/* routes. */
function buildDashboardUrl(path: string): string {
  return `${DASH_BASE}/dashboard/${path.replace(/^\/+/, "")}`;
}

/**
 * Every Dashboard request goes through this so the HttpOnly session cookie is
 * always sent. The backend authorises directory access from that cookie — it
 * cannot tell an admin from an anonymous visitor without it.
 */
function dashFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, credentials: "include" });
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
  alreadyExists?: boolean;
}

export async function fetchDirectoryUsers(
  role?: string,
  status?: string,
): Promise<DirectoryUser[]> {
  const params = new URLSearchParams();
  if (role) params.set("role", role);
  if (status) params.set("status", status);
  const qs = params.toString();
  const url = buildUrl(`directory${qs ? `?${qs}` : ""}`);
  const res = await dashFetch(url);
  if (!res.ok) throw new Error(`Failed to fetch directory: ${res.status}`);
  return res.json();
}

export async function inviteDirectoryUser(data: {
  email: string;
  name?: string;
  role?: string;
  institute?: string;
  department?: string;
}): Promise<DirectoryUser> {
  const url = buildUrl("directory");
  const res = await dashFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to invite user: ${res.status}`);
  }
  return res.json();
}

export async function updateDirectoryUser(
  userId: string,
  data: { name?: string; role?: string; institute?: string; department?: string },
): Promise<DirectoryUser> {
  const url = buildUrl(`directory/${encodeURIComponent(userId)}`);
  const res = await dashFetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to update user: ${res.status}`);
  }
  return res.json();
}

export async function removeDirectoryUser(userId: string): Promise<void> {
  const url = buildUrl(`directory/${encodeURIComponent(userId)}`);
  const res = await dashFetch(url, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to remove user: ${res.status}`);
  }
}

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
  const res = await dashFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ index }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to switch affiliation: ${res.status}`);
  }
  return res.json();
}

// ── Institution / Department rename & delete ─────────────────

export async function renameDirectoryInstitute(oldName: string, newName: string): Promise<{ updated: number }> {
  const url = buildUrl("directory/institutes/rename");
  const res = await dashFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ old_name: oldName, new_name: newName }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to rename institute: ${res.status}`);
  }
  return res.json();
}

export async function deleteDirectoryInstitute(name: string): Promise<{ cleared: number }> {
  const url = buildUrl("directory/institutes/delete");
  const res = await dashFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to delete institute: ${res.status}`);
  }
  return res.json();
}

export async function renameDirectoryDepartment(institute: string, oldName: string, newName: string): Promise<{ updated: number }> {
  const url = buildUrl("directory/departments/rename");
  const res = await dashFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ institute, old_name: oldName, new_name: newName }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to rename department: ${res.status}`);
  }
  return res.json();
}

export async function deleteDirectoryDepartment(institute: string, department: string): Promise<{ cleared: number }> {
  const url = buildUrl("directory/departments/delete");
  const res = await dashFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ institute, department }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to delete department: ${res.status}`);
  }
  return res.json();
}

// ── Institute / Department Deep Research ──────────────────────

export interface ResearchStatus {
  status: "not_started" | "researching" | "completed" | "failed" | "already_researching" | "cancelled";
  institute?: string;
  department?: string;
  error?: string;
  completed_at?: string;
  research_duration_seconds?: number;
  [key: string]: unknown;
}

export interface BulkResearchItem {
  type: "institute" | "department";
  institute: string;
  department?: string;
}

export async function getBulkResearchStatus(
  items: BulkResearchItem[],
): Promise<Record<string, ResearchStatus>> {
  const url = buildDashboardUrl("directory/research/bulk-status");
  const res = await dashFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error(`Failed to fetch bulk research status: ${res.status}`);
  const data = await res.json();
  return data.statuses;
}

export async function triggerInstituteResearch(name: string, instructions?: string): Promise<ResearchStatus> {
  const url = buildDashboardUrl("directory/institutes/research");
  const res = await dashFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, instructions: instructions || undefined }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to trigger institute research: ${res.status}`);
  }
  return res.json();
}

export async function getInstituteResearch(name: string): Promise<ResearchStatus> {
  const url = buildDashboardUrl(`directory/institutes/research?name=${encodeURIComponent(name)}`);
  const res = await dashFetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to get institute research: ${res.status}`);
  }
  return res.json();
}

export async function triggerDepartmentResearch(institute: string, department: string, instructions?: string): Promise<ResearchStatus> {
  const url = buildDashboardUrl("directory/departments/research");
  const res = await dashFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ institute, department, instructions: instructions || undefined }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to trigger department research: ${res.status}`);
  }
  return res.json();
}

export async function getDepartmentResearch(institute: string, department: string): Promise<ResearchStatus> {
  const url = buildDashboardUrl(`directory/departments/research?institute=${encodeURIComponent(institute)}&department=${encodeURIComponent(department)}`);
  const res = await dashFetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to get department research: ${res.status}`);
  }
  return res.json();
}

export async function cancelInstituteResearch(name: string): Promise<ResearchStatus> {
  const url = buildDashboardUrl(`directory/institutes/research?name=${encodeURIComponent(name)}`);
  const res = await dashFetch(url, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to cancel institute research: ${res.status}`);
  }
  return res.json();
}

export async function cancelDepartmentResearch(institute: string, department: string): Promise<ResearchStatus> {
  const url = buildDashboardUrl(`directory/departments/research?institute=${encodeURIComponent(institute)}&department=${encodeURIComponent(department)}`);
  const res = await dashFetch(url, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to cancel department research: ${res.status}`);
  }
  return res.json();
}
