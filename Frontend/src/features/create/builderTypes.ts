// builderTypes.ts
// Shared constants / types / helpers for the builder flow

export const DEFAULT_TEMP_INSTRUCTIONS =
  "Add your Instructions in Configure → Instructions, or chat with the builder and we'll auto-draft a proper prompt.";

export type AgentKind = "course";
export type Phase = "choose" | "setup" | "builder";

// Used to dedupe uploads
export const fileKey = (f: File) => `${f.name}-${f.size}-${f.lastModified}`;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : value >= 10 ? 1 : 2)} ${units[i]}`;
}
