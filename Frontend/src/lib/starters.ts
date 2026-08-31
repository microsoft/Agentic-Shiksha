export type ConversationStarter = { title: string; prompt: string };

export const FIXED_FIRST_STARTER = "Why should I learn this course?";

// The first starter is fixed and not editable, so it is derived rather than trusted
// from storage: courses created earlier still have an outdated one persisted, and
// the locked field leaves no way to correct it by hand.
export function applyFixedFirstStarter(starters: ConversationStarter[]): ConversationStarter[] {
  const fixed = { title: FIXED_FIRST_STARTER, prompt: FIXED_FIRST_STARTER };
  return starters.length > 0 ? [fixed, ...starters.slice(1)] : [fixed];
}

export function applyFixedFirstStarterText(starters: string[]): string[] {
  return starters.length > 0
    ? [FIXED_FIRST_STARTER, ...starters.slice(1)]
    : [FIXED_FIRST_STARTER];
}
