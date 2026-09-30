export type ConversationStarter = { title: string; prompt: string };

export const FIXED_FIRST_STARTER = "Why should I learn this course?";

export function updateConversationStarter(
  starters: ConversationStarter[],
  index: number,
  prompt: string,
): ConversationStarter[] {
  return starters.map((starter, starterIndex) =>
    starterIndex === index
      ? { ...starter, prompt, title: prompt.slice(0, 40) }
      : starter
  );
}

export function moveConversationStarter(
  starters: ConversationStarter[],
  fromIndex: number,
  toIndex: number,
): ConversationStarter[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= starters.length ||
    toIndex >= starters.length
  ) {
    return starters;
  }

  const reordered = [...starters];
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);
  return reordered;
}
