// src/lib/userDirectory.ts
// Central registry of known users and their assigned roles.
//
// Data is fetched from the backend (Cosmos DB users_v1 container)
// via the /api/directory endpoints. The module keeps an in-memory
// cache that is (re-)populated by calling loadDirectory().

import { type UserRole } from "./roles";
import {
  fetchDirectoryUsers,
  inviteDirectoryUser,
  updateDirectoryUser as apiUpdateUser,
  removeDirectoryUser as apiRemoveUser,
  renameDirectoryInstitute as apiRenameInstitute,
  deleteDirectoryInstitute as apiDeleteInstitute,
  renameDirectoryDepartment as apiRenameDepartment,
  deleteDirectoryDepartment as apiDeleteDepartment,
  type DirectoryUser,
} from "./api";

export interface UserEntry {
  /** Unique identifier — matches the OAuth / Azure AD object ID or email */
  id: string;
  /** Display name */
  name: string;
  /** Email address (used as the primary lookup key) */
  email: string;
  /** Assigned role */
  role: UserRole;
  /** Institute / university the user belongs to */
  institute: string;
  /** Department within the institute */
  department: string;
  /** "invited" (allowlisted, not yet logged in) or "active" (has logged in) */
  status?: "invited" | "active";
}

/**
 * In-memory cache of the user directory.
 * Populated by calling `loadDirectory()`.
 */
export const USER_DIRECTORY: UserEntry[] = [];

/** Whether the directory has been loaded at least once. */
let _loaded = false;
/** Promise for in-flight load to avoid duplicate fetches. */
let _loadPromise: Promise<UserEntry[]> | null = null;

/**
 * Map a backend DirectoryUser to the frontend UserEntry shape.
 */
function toUserEntry(d: DirectoryUser): UserEntry {
  return {
    id: d.id || d.userId,
    name: d.name,
    email: d.email,
    role: (d.role || "student") as UserRole,
    institute: d.institute || "",
    department: d.department || "",
    status: d.status,
  };
}

/**
 * Fetch the directory from the backend and refresh the in-memory cache.
 * Safe to call repeatedly — deduplicates concurrent calls.
 */
export async function loadDirectory(): Promise<UserEntry[]> {
  if (_loadPromise) return _loadPromise;

  _loadPromise = (async () => {
    try {
      const raw = await fetchDirectoryUsers();
      const entries = raw.map(toUserEntry);
      // Replace contents of the exported array *in place* so existing
      // references to USER_DIRECTORY stay valid.
      USER_DIRECTORY.length = 0;
      USER_DIRECTORY.push(...entries);
      _loaded = true;
      return USER_DIRECTORY;
    } finally {
      _loadPromise = null;
    }
  })();

  return _loadPromise;
}

/** Whether the cache has been populated at least once. */
export function isDirectoryLoaded(): boolean {
  return _loaded;
}

// ─── Lookup helpers ─────────────────────────────────

/**
 * Find a user entry by email (case-insensitive).
 * Returns `undefined` if not found.
 */
export function findUserByEmail(email: string): UserEntry | undefined {
  const lower = email.toLowerCase();
  return USER_DIRECTORY.find((u) => u.email.toLowerCase() === lower);
}

/**
 * Find a user entry by ID.
 */
export function findUserById(id: string): UserEntry | undefined {
  return USER_DIRECTORY.find((u) => u.id === id);
}

/**
 * Get the role for a given email. Falls back to "student" for unknown users.
 */
export function getRoleForEmail(email: string): UserRole {
  return findUserByEmail(email)?.role ?? "student";
}

/**
 * Get all users with a specific role.
 */
export function getUsersByRole(role: UserRole): UserEntry[] {
  return USER_DIRECTORY.filter((u) => u.role === role);
}

// ─── Standalone institution & department registries ─────────
// These hold institutions/departments that were added independently,
// so they appear even before any user is assigned to them.

const _extraInstitutes: Set<string> = new Set();
/** Map: institute → set of department names */
const _extraDepartments: Map<string, Set<string>> = new Map();

/**
 * Register a new institution (idempotent).
 */
export function addInstitute(name: string): void {
  _extraInstitutes.add(name.trim());
}

/**
 * Register a new department under an institution (idempotent).
 * The institution is auto-registered if it doesn't exist yet.
 */
export function addDepartment(institute: string, department: string): void {
  const inst = institute.trim();
  const dept = department.trim();
  _extraInstitutes.add(inst);
  if (!_extraDepartments.has(inst)) _extraDepartments.set(inst, new Set());
  _extraDepartments.get(inst)!.add(dept);
}

/**
 * Get the list of unique institute names across all users AND the registry.
 */
export function getAllInstitutes(): string[] {
  const fromUsers = USER_DIRECTORY.map((u) => u.institute).filter(Boolean);
  return [...new Set([...fromUsers, ..._extraInstitutes])].filter(Boolean).sort();
}

/**
 * Get the list of unique department names, optionally scoped to an institute.
 * Merges user-derived departments with the standalone registry.
 */
export function getAllDepartments(institute?: string): string[] {
  const users = institute
    ? USER_DIRECTORY.filter((u) => u.institute === institute)
    : USER_DIRECTORY;
  const fromUsers = users.map((u) => u.department).filter(Boolean);
  let fromRegistry: string[] = [];
  if (institute) {
    fromRegistry = [...(_extraDepartments.get(institute) ?? [])];
  } else {
    for (const depts of _extraDepartments.values()) {
      fromRegistry.push(...depts);
    }
  }
  return [...new Set([...fromUsers, ...fromRegistry])].filter(Boolean).sort();
}

/**
 * Group an array of users by institute → department.
 * Returns a nested map: `{ instituteName: { deptName: UserEntry[] } }`.
 */
export function groupByInstituteDept(
  users: UserEntry[],
): Record<string, Record<string, UserEntry[]>> {
  const grouped: Record<string, Record<string, UserEntry[]>> = {};
  for (const u of users) {
    if (!grouped[u.institute]) grouped[u.institute] = {};
    if (!grouped[u.institute][u.department]) grouped[u.institute][u.department] = [];
    grouped[u.institute][u.department].push(u);
  }
  return grouped;
}

// ─── Mutation helpers (now call the backend API) ────

/**
 * Invite a new user via the backend API and add them to the local cache.
 * Returns the generated ID.
 */
export async function addUser(entry: Omit<UserEntry, "id">): Promise<{ id: string; affiliationAdded?: boolean }> {
  const created = await inviteDirectoryUser({
    email: entry.email,
    name: entry.name,
    role: entry.role,
    institute: entry.institute,
    department: entry.department,
  });
  const newEntry = toUserEntry(created);
  // Update or add to local cache
  const existingIdx = USER_DIRECTORY.findIndex((u) => u.email.toLowerCase() === newEntry.email.toLowerCase());
  if (existingIdx !== -1) {
    // Update existing entry (affiliations may have changed)
    USER_DIRECTORY[existingIdx] = newEntry;
  } else {
    USER_DIRECTORY.push(newEntry);
  }
  return { id: newEntry.id, affiliationAdded: created.affiliationAdded };
}

/**
 * Update a user in the directory via the backend API.
 * Returns the updated entry, or throws on error.
 */
export async function updateUser(
  id: string,
  changes: { name?: string; role?: string; institute?: string; department?: string },
): Promise<UserEntry> {
  const raw = await apiUpdateUser(id, changes);
  const updated = toUserEntry(raw);
  // Patch local cache
  const idx = USER_DIRECTORY.findIndex((u) => u.id === id);
  if (idx !== -1) {
    USER_DIRECTORY[idx] = updated;
  }
  return updated;
}

/**
 * Remove a user from the directory via the backend API.
 * Returns true if a user was removed.
 */
export async function removeUser(id: string): Promise<boolean> {
  try {
    await apiRemoveUser(id);
    const idx = USER_DIRECTORY.findIndex((u) => u.id === id);
    if (idx !== -1) USER_DIRECTORY.splice(idx, 1);
    return true;
  } catch {
    return false;
  }
}

// ─── Institution / Department rename & delete ─────────

/**
 * Rename an institution across all users (backend + local cache).
 */
export async function renameInstitute(oldName: string, newName: string): Promise<number> {
  const { updated } = await apiRenameInstitute(oldName, newName);
  // Patch local cache
  for (const u of USER_DIRECTORY) {
    if (u.institute === oldName) u.institute = newName;
  }
  // Update standalone registry
  _extraInstitutes.delete(oldName);
  _extraInstitutes.add(newName);
  if (_extraDepartments.has(oldName)) {
    const depts = _extraDepartments.get(oldName)!;
    _extraDepartments.delete(oldName);
    _extraDepartments.set(newName, depts);
  }
  return updated;
}

/**
 * Delete an institution — clears institute & department on affected users.
 */
export async function deleteInstitute(name: string): Promise<number> {
  const { cleared } = await apiDeleteInstitute(name);
  // Patch local cache
  for (const u of USER_DIRECTORY) {
    if (u.institute === name) {
      u.institute = "";
      u.department = "";
    }
  }
  _extraInstitutes.delete(name);
  _extraDepartments.delete(name);
  return cleared;
}

/**
 * Rename a department within an institute (backend + local cache).
 */
export async function renameDepartment(institute: string, oldName: string, newName: string): Promise<number> {
  const { updated } = await apiRenameDepartment(institute, oldName, newName);
  // Patch local cache
  for (const u of USER_DIRECTORY) {
    if (u.institute === institute && u.department === oldName) u.department = newName;
  }
  // Update standalone registry
  const deptSet = _extraDepartments.get(institute);
  if (deptSet) {
    deptSet.delete(oldName);
    deptSet.add(newName);
  }
  return updated;
}

/**
 * Delete a department — clears the department field on affected users.
 */
export async function deleteDepartment(institute: string, department: string): Promise<number> {
  const { cleared } = await apiDeleteDepartment(institute, department);
  // Patch local cache
  for (const u of USER_DIRECTORY) {
    if (u.institute === institute && u.department === department) {
      u.department = "";
    }
  }
  const deptSet = _extraDepartments.get(institute);
  if (deptSet) deptSet.delete(department);
  return cleared;
}

