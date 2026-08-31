// src/lib/userDirectory.ts
// Central registry of known users and their assigned roles.

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
  id: string;
  name: string;
  email: string;
  role: UserRole;
  institute: string;
  department: string;
  status?: "invited" | "active";
}

export const USER_DIRECTORY: UserEntry[] = [];

let _loaded = false;
let _loadPromise: Promise<UserEntry[]> | null = null;

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

export async function loadDirectory(): Promise<UserEntry[]> {
  if (_loadPromise) return _loadPromise;

  _loadPromise = (async () => {
    try {
      const raw = await fetchDirectoryUsers();
      const entries = raw.map(toUserEntry);
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

export function isDirectoryLoaded(): boolean {
  return _loaded;
}

// ─── Lookup helpers ─────────────────────────────────

export function findUserByEmail(email: string): UserEntry | undefined {
  const lower = email.toLowerCase();
  return USER_DIRECTORY.find((u) => u.email.toLowerCase() === lower);
}

export function findUserById(id: string): UserEntry | undefined {
  return USER_DIRECTORY.find((u) => u.id === id);
}

export function getRoleForEmail(email: string): UserRole {
  return findUserByEmail(email)?.role ?? "student";
}

export function getUsersByRole(role: UserRole): UserEntry[] {
  return USER_DIRECTORY.filter((u) => u.role === role);
}

// ─── Standalone institution & department registries ─────────

const _extraInstitutes: Set<string> = new Set();
const _extraDepartments: Map<string, Set<string>> = new Map();

export function addInstitute(name: string): void {
  _extraInstitutes.add(name.trim());
}

export function addDepartment(institute: string, department: string): void {
  const inst = institute.trim();
  const dept = department.trim();
  _extraInstitutes.add(inst);
  if (!_extraDepartments.has(inst)) _extraDepartments.set(inst, new Set());
  _extraDepartments.get(inst)!.add(dept);
}

export function getAllInstitutes(): string[] {
  const fromUsers = USER_DIRECTORY.map((u) => u.institute).filter(Boolean);
  return [...new Set([...fromUsers, ..._extraInstitutes])].filter(Boolean).sort();
}

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

// ─── Mutation helpers ────

export async function addUser(entry: Omit<UserEntry, "id">): Promise<{ id: string; affiliationAdded?: boolean; alreadyExists?: boolean }> {
  const created = await inviteDirectoryUser({
    email: entry.email,
    name: entry.name,
    role: entry.role,
    institute: entry.institute,
    department: entry.department,
  });
  const newEntry = toUserEntry(created);
  const existingIdx = USER_DIRECTORY.findIndex((u) => u.email.toLowerCase() === newEntry.email.toLowerCase());
  if (existingIdx !== -1) {
    USER_DIRECTORY[existingIdx] = newEntry;
  } else {
    USER_DIRECTORY.push(newEntry);
  }
  return { id: newEntry.id, affiliationAdded: created.affiliationAdded, alreadyExists: created.alreadyExists };
}

export async function updateUser(
  id: string,
  changes: { name?: string; role?: string; institute?: string; department?: string },
): Promise<UserEntry> {
  const raw = await apiUpdateUser(id, changes);
  const updated = toUserEntry(raw);
  const idx = USER_DIRECTORY.findIndex((u) => u.id === id);
  if (idx !== -1) USER_DIRECTORY[idx] = updated;
  return updated;
}

export async function removeUser(id: string): Promise<boolean> {
  // Errors propagate: swallowing them made a failed delete look identical to a
  // successful one, leaving the row in the directory with nothing reported.
  await apiRemoveUser(id);
  const idx = USER_DIRECTORY.findIndex((u) => u.id === id);
  if (idx !== -1) USER_DIRECTORY.splice(idx, 1);
  return true;
}

// ─── Institution / Department rename & delete ─────────

export async function renameInstitute(oldName: string, newName: string): Promise<number> {
  const { updated } = await apiRenameInstitute(oldName, newName);
  for (const u of USER_DIRECTORY) {
    if (u.institute === oldName) u.institute = newName;
  }
  _extraInstitutes.delete(oldName);
  _extraInstitutes.add(newName);
  if (_extraDepartments.has(oldName)) {
    const depts = _extraDepartments.get(oldName)!;
    _extraDepartments.delete(oldName);
    _extraDepartments.set(newName, depts);
  }
  return updated;
}

export async function deleteInstitute(name: string): Promise<number> {
  const { cleared } = await apiDeleteInstitute(name);
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

export async function renameDepartment(institute: string, oldName: string, newName: string): Promise<number> {
  const { updated } = await apiRenameDepartment(institute, oldName, newName);
  for (const u of USER_DIRECTORY) {
    if (u.institute === institute && u.department === oldName) u.department = newName;
  }
  const deptSet = _extraDepartments.get(institute);
  if (deptSet) {
    deptSet.delete(oldName);
    deptSet.add(newName);
  }
  return updated;
}

export async function deleteDepartment(institute: string, department: string): Promise<number> {
  const { cleared } = await apiDeleteDepartment(institute, department);
  for (const u of USER_DIRECTORY) {
    if (u.institute === institute && u.department === department) {
      u.department = "";
    }
  }
  const deptSet = _extraDepartments.get(institute);
  if (deptSet) deptSet.delete(department);
  return cleared;
}
