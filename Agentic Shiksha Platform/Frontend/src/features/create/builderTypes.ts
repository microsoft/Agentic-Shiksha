// builderTypes.ts
// Shared constants / types / helpers for the builder flow

import { v4 as uuidv4 } from "uuid";
import { FIXED_FIRST_STARTER } from "../../lib/starters";
import type { CourseAvatarOptions } from "../../lib/courseAvatar";

export interface CreateFormState {
  sessionUuid: string;
  courseName: string;
  courseLevel: string;
  courseSpan: string;
  courseNotes: string;
  courseCode: string;
  prerequisites: string[];
  courseUrls: Array<{ url: string; description?: string }>;
  agentImagePreview: string | null;
  agentImageFile: File | null;
  agentAvatar: CourseAvatarOptions | null;
  textbooks: Array<{
    id: string;
    name: string;
    edition: string;
    authors?: string[];
    type: "primary" | "reference";
    description?: string;
    file?: File;
  }>;
  courseDescFile: File | null;
  kbUploads: File[];
  conversationStarters: Array<{ title: string; prompt: string }>;
}

export function createEmptyCreateForm(): CreateFormState {
  return {
    sessionUuid: uuidv4(),
    courseName: "",
    courseLevel: "",
    courseSpan: "",
    courseNotes: "",
    courseCode: "",
    prerequisites: [],
    courseUrls: [],
    agentImagePreview: null,
    agentImageFile: null,
    agentAvatar: null,
    textbooks: [],
    courseDescFile: null,
    kbUploads: [],
    conversationStarters: [
      { title: FIXED_FIRST_STARTER, prompt: FIXED_FIRST_STARTER },
      { title: "How do I check if I know some of the concepts already?", prompt: "How do I check if I know some of the concepts already?" },
      { title: "Give me an example of a simple challenge", prompt: "Give me an example of a simple challenge, and tell me what topics it covers." },
      { title: "Can you explain a threshold concept", prompt: "Can you explain a threshold concept from this course in my preferred language?" },
    ],
  };
}

export const ASSISTED_TEXT_FIELDS = ["courseName", "courseLevel", "courseSpan", "courseNotes", "courseCode"] as const;
export type AssistedTextField = typeof ASSISTED_TEXT_FIELDS[number];
export type CourseFormPatch = Partial<{
  [Field in AssistedTextField]: string | null;
}> & {
  prerequisites?: string[] | null;
  courseUrls?: CreateFormState["courseUrls"] | null;
  textbooks?: Array<Omit<CreateFormState["textbooks"][number], "id" | "file">> | null;
  conversationStarters?: CreateFormState["conversationStarters"] | null;
};

export type CompanionChangedField = keyof CourseFormPatch | "kbUploads";
export type CompanionChanges = { form: CreateFormState; fields: CompanionChangedField[] };

export function companionUpdatedFields(current: CreateFormState, changes: CompanionChanges | null): CompanionChangedField[] {
  if (!changes || changes.form.sessionUuid !== current.sessionUuid) return [];
  return changes.fields.filter(field => current[field] === changes.form[field]);
}

export function applyCourseFormPatch(current: CreateFormState, baseline: CreateFormState, patch: CourseFormPatch) {
  const form = { ...current };
  const applied: Array<keyof CourseFormPatch> = [];
  const skipped: Array<keyof CourseFormPatch> = [];
  if (current.sessionUuid !== baseline.sessionUuid) return { form: current, applied, skipped };

  for (const field of ASSISTED_TEXT_FIELDS) {
    const value = patch[field];
    if (typeof value !== "string" || !value.trim() || value.trim() === current[field]) continue;
    if (current[field] !== baseline[field]) {
      skipped.push(field);
      continue;
    }
    form[field] = value.trim();
    applied.push(field);
  }

  for (const field of ["prerequisites", "courseUrls", "textbooks", "conversationStarters"] as const) {
    const value = patch[field];
    if (!Array.isArray(value) || value.length === 0) continue;
    if (current[field] !== baseline[field]) {
      skipped.push(field);
      continue;
    }
    if (field === "textbooks" && patch.textbooks) {
      const additions = patch.textbooks.filter(book => !current.textbooks.some(existing =>
        existing.name.trim().toLowerCase() === book.name.trim().toLowerCase()
        && existing.edition.trim().toLowerCase() === book.edition.trim().toLowerCase(),
      ));
      if (!additions.length) continue;
      form.textbooks = [...current.textbooks, ...additions.map(book => ({ ...book, id: uuidv4() }))];
    } else if (field === "courseUrls" && patch.courseUrls) {
      const additions = patch.courseUrls.filter(link => !current.courseUrls.some(existing => existing.url === link.url));
      if (!additions.length) continue;
      form.courseUrls = [...current.courseUrls, ...additions];
    } else if (field === "prerequisites" && patch.prerequisites) {
      form.prerequisites = patch.prerequisites.includes("__none__")
        ? ["__none__"]
        : [...new Set([...current.prerequisites.filter(course => course !== "__none__"), ...patch.prerequisites])];
    } else if (field === "conversationStarters" && patch.conversationStarters) {
      form.conversationStarters = patch.conversationStarters;
    }
    if (JSON.stringify(form[field]) !== JSON.stringify(current[field])) applied.push(field);
  }
  return { form, applied, skipped };
}

export function undoCourseFormPatch(current: CreateFormState, before: CreateFormState, after: CreateFormState) {
  if (current.sessionUuid !== after.sessionUuid) return current;
  let form = { ...current };
  for (const field of [...ASSISTED_TEXT_FIELDS, "prerequisites", "courseUrls", "textbooks", "conversationStarters"] as const) {
    if (before[field] !== after[field] && current[field] === after[field]) {
      form = { ...form, [field]: before[field] };
    }
  }
  return form;
}

export function courseFormContext(form: CreateFormState) {
  return {
    courseName: form.courseName, courseLevel: form.courseLevel, courseSpan: form.courseSpan,
    courseNotes: form.courseNotes, courseCode: form.courseCode, prerequisites: form.prerequisites,
    courseUrls: form.courseUrls, conversationStarters: form.conversationStarters,
    textbooks: form.textbooks.map(book => ({
      name: book.name, edition: book.edition, authors: book.authors ?? [],
      type: book.type, description: book.description ?? "",
    })),
  };
}

export const DEFAULT_TEMP_INSTRUCTIONS =
  "Add your Instructions in Configure → Instructions, or chat with the builder and we'll auto-draft a proper prompt.";

export type AgentKind = "course";
export type Phase = "choose" | "setup" | "builder";

// Used to dedupe uploads
export const fileKey = (f: File) => `${f.name}-${f.size}-${f.lastModified}`;

export const FORM_DOCUMENT_LIMIT = 1024 * 1024;
export const FORM_IMAGE_LIMIT = 2 * 1024 * 1024;
export const FORM_MATERIAL_LIMIT = 50 * 1024 * 1024;
export const FORM_ATTACHMENT_LIMIT = 3;

export function formAttachmentKind(file: Pick<File, "name" | "size" | "type">): "document" | "image" | "material" | "unsupported" {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!file.size) return "unsupported";
  if (["png", "jpg", "jpeg", "webp"].includes(extension ?? "")) {
    return file.size <= FORM_IMAGE_LIMIT && ["image/png", "image/jpeg", "image/webp"].includes(file.type) ? "image" : "unsupported";
  }
  if (!["pdf", "doc", "docx", "txt", "md"].includes(extension ?? "") || file.size > FORM_MATERIAL_LIMIT) return "unsupported";
  return extension === "doc" || file.size > FORM_DOCUMENT_LIMIT ? "material" : "document";
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : value >= 10 ? 1 : 2)} ${units[i]}`;
}
