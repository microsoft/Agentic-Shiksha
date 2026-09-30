import type { ChatSource } from "./types";

export type CourseMaterialSource = ChatSource & {
  type: "course_material";
  citation_id: string;
  filename: string;
  url: string;
  excerpt: string;
};

export function isCourseMaterialSource(source: ChatSource): source is CourseMaterialSource {
  return source.type === "course_material"
    && typeof source.citation_id === "string" && /^course-[a-f0-9]{24}$/.test(source.citation_id)
    && typeof source.filename === "string" && source.filename.length > 0 && source.filename.length <= 255
    && typeof source.excerpt === "string" && source.excerpt.length > 0 && source.excerpt.length <= 4000
    && typeof source.url === "string" && validMaterialUrl(source.url, source.filename);
}

function validMaterialUrl(value: string, filename: string): boolean {
  if (!value.startsWith("/api/agents/")) return false;
  try {
    const address = new URL(value, "https://example.invalid");
    return address.origin === "https://example.invalid"
      && /^\/api\/agents\/[^/]+\/course-materials\/file$/.test(address.pathname)
      && address.searchParams.get("filename") === filename
      && ["course", "exam", "textbook"].includes(address.searchParams.get("kb_scope") || "");
  } catch {
    return false;
  }
}

export function sourceKey(source: ChatSource): string {
  return source.citation_id || source.url || source.file_id || source.title;
}

export function normalizeSources(value: unknown): ChatSource[] {
  if (!Array.isArray(value)) return [];
  const sources: ChatSource[] = [];
  const seen = new Set<string>();
  for (const item of value.slice(0, 40)) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Record<string, unknown>;
    let source: ChatSource;
    if (candidate.type === "course_material") {
      if (!isCourseMaterialSource(candidate as ChatSource)) continue;
      const page = candidate.page_number;
      source = {
        type: "course_material", citation_id: candidate.citation_id as string,
        title: candidate.filename as string, filename: candidate.filename as string,
        url: candidate.url as string, excerpt: candidate.excerpt as string,
        page_number: typeof page === "number" && Number.isInteger(page) && page > 0 ? page : null,
        section: typeof candidate.section === "string" ? candidate.section.slice(0, 1000) : null,
        truncated: candidate.truncated === true,
      };
    } else if (candidate.type === "file") {
      const filename = typeof candidate.filename === "string" ? candidate.filename.slice(0, 255) : undefined;
      const fileId = typeof candidate.file_id === "string" ? candidate.file_id : undefined;
      source = { type: "file", title: filename || fileId || "Document", filename, file_id: fileId };
    } else {
      if (typeof candidate.url !== "string") continue;
      try {
        const address = new URL(candidate.url);
        if (!["https:", "http:"].includes(address.protocol) || address.username || address.password) continue;
        source = {
          type: "url", title: typeof candidate.title === "string" ? candidate.title.slice(0, 500) : address.hostname,
          url: address.href, domain: address.hostname,
        };
      } catch {
        continue;
      }
    }
    const key = sourceKey(source);
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(source);
  }
  return sources;
}