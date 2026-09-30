// src/lib/roles.ts
// Role-based access control (RBAC) configuration for EKALAIVA Shiksha
//
// Three user roles: student, teacher, admin
// Each role has a set of features they can access.
// Admin has access to everything.

export type UserRole = "student" | "teacher" | "admin";

/** Individual feature flags that can be toggled per role */
export type Feature =
  // Navigation / Pages
  | "page:home"           // Chat home page
  | "page:library"        // Agent/course library
  | "page:assets"         // Assets / artifacts viewer
  | "page:create"         // Create new teaching assistant
  | "page:edit"           // Edit existing teaching assistant
  | "page:course"         // Course project home
  | "page:dashboard"      // Instructor / admin dashboard
  | "page:settings"       // Settings page
  | "page:help"           // Help page
  | "page:learn"          // Learn more page
  // Chat features
  | "chat:send"           // Send messages in chat
  | "chat:edit"           // Edit sent messages
  | "chat:share"          // Share chat threads
  | "chat:web-search"     // Use web search tool
  | "chat:deep-research"  // Use deep research tool
  | "chat:voice-input"    // Speech-to-text input
  | "chat:attachments"    // Attach files to messages
  // Course management
  | "course:create"       // Create new courses
  | "course:edit"         // Edit existing courses
  | "course:delete"       // Delete courses
  | "course:syllabus"     // View course syllabus
  // Dashboard & Analytics
  | "dashboard:view"      // View the dashboard
  | "dashboard:students"  // View student progress
  | "dashboard:analytics" // View analytics & groundedness
  | "dashboard:chat"      // Chat within dashboard
  // User management
  | "user:manage"         // Manage other users (admin only)
  | "user:feedback"       // Submit feedback
  | "user:settings"       // Access settings page;

/**
 * Permissions matrix — defines which features each role can access.
 * Admin inherits everything (handled via the `hasAccess` helper).
 */
const ROLE_PERMISSIONS: Record<UserRole, Set<Feature>> = {
  student: new Set<Feature>([
    // Pages
    "page:home",
    "page:library",
    "page:assets",
    "page:course",
    "page:settings",
    "page:help",
    "page:learn",
    // Chat
    "chat:send",
    "chat:edit",
    "chat:share",
    "chat:web-search",
    "chat:deep-research",
    "chat:voice-input",
    "chat:attachments",
    // Course (view only)
    "course:syllabus",
    // User
    "user:feedback",
    "user:settings",
  ]),

  teacher: new Set<Feature>([
    // Everything a student can do, plus…
    "page:home",
    "page:library",
    "page:assets",
    "page:create",
    "page:edit",
    "page:course",
    "page:dashboard",
    "page:settings",
    "page:help",
    "page:learn",
    // Chat
    "chat:send",
    "chat:edit",
    "chat:share",
    "chat:web-search",
    "chat:deep-research",
    "chat:voice-input",
    "chat:attachments",
    // Course management
    "course:create",
    "course:edit",
    "course:syllabus",
    // Dashboard & Analytics (teacher-scoped to their own courses)
    "dashboard:view",
    "dashboard:students",
    "dashboard:analytics",
    "dashboard:chat",
    // User
    "user:feedback",
    "user:settings",
  ]),

  admin: new Set<Feature>([
    // Admin gets every feature
    "page:home",
    "page:library",
    "page:assets",
    "page:create",
    "page:edit",
    "page:course",
    "page:dashboard",
    "page:settings",
    "page:help",
    "page:learn",
    "chat:send",
    "chat:edit",
    "chat:share",
    "chat:web-search",
    "chat:deep-research",
    "chat:voice-input",
    "chat:attachments",
    "course:create",
    "course:edit",
    "course:delete",
    "course:syllabus",
    "dashboard:view",
    "dashboard:students",
    "dashboard:analytics",
    "dashboard:chat",
    "user:manage",
    "user:feedback",
    "user:settings",
  ]),
};

/**
 * Check whether a given role has access to a feature.
 */
export function hasAccess(role: UserRole, feature: Feature): boolean {
  return ROLE_PERMISSIONS[role]?.has(feature) ?? false;
}

/**
 * Get all features available to a role.
 */
export function getFeaturesForRole(role: UserRole): Feature[] {
  return Array.from(ROLE_PERMISSIONS[role] ?? []);
}

/**
 * Get a human-readable label for a role.
 */
export function getRoleLabel(role: UserRole): string {
  switch (role) {
    case "student": return "Student";
    case "teacher": return "Teacher";
    case "admin":   return "Admin";
  }
}

/**
 * All available roles (useful for dropdowns, etc.)
 */
export const ALL_ROLES: UserRole[] = ["student", "teacher", "admin"];

/**
 * Default role for new users.
 */
export const DEFAULT_ROLE: UserRole = "student";
