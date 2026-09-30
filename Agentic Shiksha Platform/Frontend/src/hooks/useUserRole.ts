// src/hooks/useUserRole.ts
// Convenience hook for role-based access checks throughout the app.

import { useUserStore } from "@/lib/userStore";
import { hasAccess, getRoleLabel, type UserRole, type Feature } from "@/lib/roles";

/**
 * Hook that exposes the current user's role and permission helpers.
 *
 * Usage:
 *   const { role, can, isStudent, isTeacher, isAdmin } = useUserRole();
 *   if (can("page:dashboard")) { … }
 */
export function useUserRole() {
  const role = useUserStore((s) => s.role);
  const setRole = useUserStore((s) => s.setRole);

  /** Check if the current user has access to a specific feature */
  const can = (feature: Feature): boolean => hasAccess(role, feature);

  /** Check multiple features — returns true if ALL are permitted */
  const canAll = (...features: Feature[]): boolean => features.every((f) => hasAccess(role, f));

  /** Check multiple features — returns true if ANY is permitted */
  const canAny = (...features: Feature[]): boolean => features.some((f) => hasAccess(role, f));

  return {
    role,
    setRole,
    roleLabel: getRoleLabel(role),
    can,
    canAll,
    canAny,
    isStudent: role === "student",
    isTeacher: role === "teacher",
    isAdmin: role === "admin",
  };
}
