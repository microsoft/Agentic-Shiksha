// src/lib/userDirectory.ts
// Central registry of known users and their assigned roles.

import { type UserRole } from "./roles";
import { STUDENT_ASSIGNMENTS_ENABLED } from "./config";
import { addCourseMember, getStudentAssignmentPermission, getStudentRoster } from "./studentAssignmentsApi";
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
  type DirectoryUserAffiliation,
} from "./api";

export interface UserEntry {
  id: string;
  userId?: string;
  name: string;
  email: string;
  role: UserRole;
  institute: string;
  department: string;
  status?: "invited" | "active";
  affiliations?: DirectoryUserAffiliation[];
  activeAffiliation?: number;
}

export const USER_DIRECTORY: UserEntry[] = [];

let _loaded = false;
let _loadPromise: Promise<UserEntry[]> | null = null;

function toUserEntry(d: DirectoryUser): UserEntry {
  return {
    id: d.id || d.userId,
    userId: d.userId,
    name: d.name,
    email: d.email,
    role: (d.role || "student") as UserRole,
    institute: d.institute || "",
    department: d.department || "",
    status: d.status,
    affiliations: d.affiliations ?? [],
    activeAffiliation: d.activeAffiliation,
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

export function directoryAffiliations(
  user: Partial<Pick<UserEntry, "institute" | "department" | "affiliations">>,
): Pick<DirectoryUserAffiliation, "institute" | "department">[] {
  const unique = new Map<string, { institute: string; department: string }>();
  for (const affiliation of [
    { institute: user.institute || "", department: user.department || "" },
    ...(user.affiliations ?? []),
  ]) {
    const institute = affiliation.institute.trim();
    const department = affiliation.department.trim();
    const key = JSON.stringify([institute, department]);
    if (!unique.has(key)) unique.set(key, { institute, department });
  }
  return [...unique.values()];
}

export function getAllInstitutes(
  users: readonly Pick<UserEntry, "institute" | "affiliations">[] = USER_DIRECTORY,
): string[] {
  const fromUsers = users.flatMap(user => directoryAffiliations(user).map(affiliation => affiliation.institute));
  return [...new Set([...fromUsers, ..._extraInstitutes])].filter(Boolean).sort();
}

export function getAllDepartments(
  institute?: string,
  directory: readonly Pick<UserEntry, "institute" | "department" | "affiliations">[] = USER_DIRECTORY,
): string[] {
  const affiliations = directory.flatMap(directoryAffiliations);
  const users = institute
    ? affiliations.filter((u) => u.institute === institute)
    : affiliations;
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
  filters: { institute?: string; department?: string; search?: string } = {},
): Record<string, Record<string, UserEntry[]>> {
  const grouped: Record<string, Record<string, UserEntry[]>> = Object.create(null);
  const search = filters.search?.trim().toLowerCase();
  for (const u of users) {
    for (const { institute, department } of directoryAffiliations(u)) {
      if (!institute || !department) continue;
      if (filters.institute && institute !== filters.institute) continue;
      if (filters.department && department !== filters.department) continue;
      if (search && ![u.name, u.email, institute, department].some(value => value.toLowerCase().includes(search))) continue;
      if (!grouped[institute]) grouped[institute] = Object.create(null);
      if (!grouped[institute][department]) grouped[institute][department] = [];
      // Reuse the canonical user so editing a secondary row cannot switch its active affiliation.
      grouped[institute][department].push(u);
    }
  }
  return grouped;
}

export interface DirectoryCourse {
  id: string;
  name: string;
  teachers: { userId: string; email: string }[];
  students: { userId: string; email: string }[];
}

export function groupByCourse(
  users: UserEntry[],
  courses: DirectoryCourse[],
): { id: string | null; name: string; users: UserEntry[] }[] {
  const assigned = new Set<UserEntry>();
  const groups = courses.map(course => {
    const members = users.filter(user => {
      const candidates = user.role === "student" ? course.students : course.teachers;
      return candidates.some(member => member.userId === user.id
        || (!!user.userId && member.userId === user.userId)
        || (!!user.email.trim() && !!member.email.trim()
          && member.email.trim().toLowerCase() === user.email.trim().toLowerCase()));
    });
    members.forEach(user => assigned.add(user));
    return { id: course.id as string | null, name: course.name, users: members };
  }).filter(course => course.users.length > 0)
    .sort((first, second) => first.name.localeCompare(second.name));
  const unassigned = users.filter(user => !assigned.has(user));
  if (unassigned.length > 0) {
    groups.push({ id: null, name: "Unassigned to a course", users: unassigned });
  }
  return groups;
}

// ─── Mutation helpers ────

export async function addUser(entry: Omit<UserEntry, "id">): Promise<{
  id: string; user: UserEntry; affiliationAdded?: boolean; alreadyExists?: boolean;
}> {
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
  return { id: newEntry.id, user: newEntry, affiliationAdded: created.affiliationAdded, alreadyExists: created.alreadyExists };
}

export async function assignUserToCourse(user: UserEntry, courseId: string, role: UserRole): Promise<void> {
  if (!STUDENT_ASSIGNMENTS_ENABLED) {
    throw new Error("Course assignment is not enabled in this dashboard.");
  }
  if (role === "admin") {
    throw new Error("Course assignments are for students and teachers, not administrators.");
  }
  if (user.role !== role) {
    throw new Error(`This user's saved role is ${user.role}, not ${role}. Use the saved role when assigning a course.`);
  }
  const signal = new AbortController().signal;
  if (!await getStudentAssignmentPermission(signal)) {
    throw new Error("Sign in to the main application as an active administrator to assign courses.");
  }
  let userId = user.userId || user.id;
  if (role === "student") {
    const roster = await getStudentRoster(courseId, signal);
    const available = roster.students.filter(student => student.status !== "unavailable");
    const byId = available.filter(student => student.user_id === user.id || student.user_id === user.userId);
    const matches = byId.length ? byId : available.filter(student =>
      !!user.email.trim() && student.email.trim().toLowerCase() === user.email.trim().toLowerCase());
    if (matches.length !== 1) {
      throw new Error("The saved user could not be uniquely matched to an active or invited student. Reload the directory and retry.");
    }
    userId = matches[0].user_id;
  }
  if (!userId) {
    throw new Error("The saved user has no assignment ID. Reload the directory and retry.");
  }
  await addCourseMember(courseId, userId, role);
}

export async function updateUser(
  id: string,
  changes: { name?: string; role?: string; institute?: string; department?: string },
): Promise<UserEntry> {
  const raw = await apiUpdateUser(id, changes);
  const idx = USER_DIRECTORY.findIndex((u) => u.id === id);
  const previous = USER_DIRECTORY[idx];
  const activeAffiliation = previous?.activeAffiliation ?? previous?.affiliations?.findIndex(affiliation =>
    affiliation.institute === previous.institute && affiliation.department === previous.department);
  const updated = toUserEntry({
    ...raw,
    affiliations: raw.affiliations ?? previous?.affiliations?.map((affiliation, index) => index === activeAffiliation
      ? { ...affiliation, institute: raw.institute, department: raw.department, role: raw.role }
      : affiliation),
    activeAffiliation: raw.activeAffiliation ?? activeAffiliation,
  });
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
