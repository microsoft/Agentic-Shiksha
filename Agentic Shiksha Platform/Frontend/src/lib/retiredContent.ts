function isRetiredKind(value: unknown): boolean {
  return typeof value === "string" && /^(?:flashcards?|industrial_trainer)$/i.test(value.trim());
}

/** Presentation-only compatibility checks. Stored records must remain unchanged. */
export function isRetiredAsset(asset: { category?: string; type?: string; content?: string }): boolean {
  return isRetiredKind(asset.category)
    || isRetiredKind(asset.type)
    || isRetiredAssetContent(asset.content);
}

export function isRetiredAssetContent(content?: string): boolean {
  if (!content?.trimStart().startsWith("{")) return false;
  try {
    const payload: unknown = JSON.parse(content);
    if (!payload || typeof payload !== "object") return false;
    const record = payload as Record<string, unknown>;
    if (record.type) return isRetiredKind(record.type);
    if (typeof record.flashcardId === "string") return true;
    return Array.isArray(record.cards)
      && !Array.isArray(record.questions)
      && typeof record.solution !== "string"
      && record.cards.every(card => card && typeof card.front === "string" && typeof card.back === "string");
  } catch {
    return false;
  }
}

export function isRetiredTool(tool: unknown): boolean {
  return tool === "add_flashcard";
}
