// Dashboard config — environment variables for the dashboard frontend.

export const DASHBOARD_API_URL =
  import.meta.env.VITE_DASHBOARD_API_URL || "http://localhost:8050";

// Student access is managed by the main Backend, not the analytics backend.
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL?.trim() || "http://localhost:8000")
  .replace(/\/+$/, "")
  .replace(/\/api$/i, "");

export const STUDENT_ASSIGNMENTS_ENABLED =
  import.meta.env.VITE_STUDENT_ASSIGNMENTS_ENABLED === "true";
