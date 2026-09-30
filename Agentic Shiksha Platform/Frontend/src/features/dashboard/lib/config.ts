// Teacher Dashboard config — merged into the main Shiksha app.
//
// The teacher-dashboard API is now served by the main backend under
// `/api/teacher-dashboard/*` and authenticated with the shared HttpOnly
// `session` cookie (sent automatically via `credentials: "include"`), so there
// is no bearer token or dev identity to manage here.

import { API_BASE_URL } from "@/lib/config";

/** Base URL of the backend that serves the teacher-dashboard routes. */
export const DASHBOARD_API_URL = API_BASE_URL;

/**
 * Extra request headers. Auth is via the shared session cookie, so no
 * Authorization header is needed — this just passes through any extras.
 */
export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { ...extra };
}
