// src/lib/nameGuard.ts
// PII guard: replaces the current user's name with {{user_name}} at send time.
// Dashboard version — uses userStore instead of chatStore.

import { useUserStore } from "./userStore";

function buildNameGuardRegex(): RegExp | null {
  const { displayName } = useUserStore.getState();
  if (!displayName) return null;
  const parts = new Set<string>();
  for (const word of displayName.trim().split(/\s+/)) {
    if (word.length >= 3) parts.add(word);
  }
  if (parts.size === 0) return null;
  const escaped = [...parts].map(p => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const group = escaped.join("|");
  return new RegExp(`\\b(?:${group})(?:\\s+(?:${group}))*\\b`, "gi");
}

export function applyNameGuard(text: string): string {
  const re = buildNameGuardRegex();
  if (!re) return text;
  return text.replace(re, () => "{{user_name}}");
}
