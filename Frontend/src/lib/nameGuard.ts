// src/lib/nameGuard.ts
// PII guard: replaces the current user's name with {{user_name}} or
// {{preferred_name}} at send time.

import { useChatStore } from "./chatStore";

/**
 * Collect unique name-parts (≥ 3 chars) from a string.
 */
function nameParts(src: string | undefined): Set<string> {
  const out = new Set<string>();
  if (!src) return out;
  for (const w of src.trim().split(/\s+/)) {
    if (w.length >= 3) out.add(w.toLowerCase());
  }
  return out;
}

/**
 * Build a regex matching one or more adjacent name-parts.
 * Returns null when no usable name-parts exist.
 */
function buildNameGuardRegex(): RegExp | null {
  const { userFullName, userName, userNickname } = useChatStore.getState();
  const parts = new Set<string>();
  for (const src of [userFullName, userName, userNickname]) {
    if (!src) continue;
    for (const word of src.trim().split(/\s+/)) {
      if (word.length >= 3) parts.add(word);
    }
  }
  if (parts.size === 0) return null;
  const escaped = [...parts].map(p => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const group = escaped.join("|");
  return new RegExp(`\\b(?:${group})(?:\\s+(?:${group}))*\\b`, "gi");
}

/**
 * Replace occurrences of the user's name with the appropriate token.
 *
 * - If _every_ word in the match belongs to the preferred name (nickname),
 *   it becomes {{preferred_name}}.
 * - Otherwise it becomes {{user_name}} (full / formal name).
 *
 * Example (fullName = "Varala Nandu Swapnik", nickname = "Swapnik"):
 *   "Swapnik"        → {{preferred_name}}
 *   "Varala Swapnik"  → {{user_name}}
 *   "Nandu"           → {{user_name}}
 */
export function applyNameGuard(text: string): string {
  const re = buildNameGuardRegex();
  if (!re) return text;

  const { userNickname } = useChatStore.getState();
  const preferredParts = nameParts(userNickname);

  return text.replace(re, (match) => {
    // Check if every word in the match is part of the preferred name
    const words = match.trim().split(/\s+/);
    const allPreferred =
      preferredParts.size > 0 &&
      words.every((w) => preferredParts.has(w.toLowerCase()));
    return allPreferred ? "{{preferred_name}}" : "{{user_name}}";
  });
}
