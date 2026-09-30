export type CourseAvatarOptions = {
  initials?: string | null;
  color?: string | null;
};

export const COURSE_AVATAR_COLORS = [
  { name: "Blue", color: "#60a5fa" },
  { name: "Violet", color: "#a78bfa" },
  { name: "Emerald", color: "#34d399" },
  { name: "Rose", color: "#fb7185" },
  { name: "Cyan", color: "#22d3ee" },
  { name: "Amber", color: "#fbbf24" },
] as const;

export function normalizeAvatarInitials(value: string): string {
  return value.trim().toUpperCase().normalize("NFC");
}

export function avatarInitialsError(value: string): string | null {
  const normalized = normalizeAvatarInitials(value);
  return normalized && !/^(?:[\p{L}\p{N}]\p{M}*){1,3}$/u.test(normalized)
    ? "Use up to 3 letters or numbers, or leave blank for automatic initials."
    : null;
}

function firstLetters(word: string, count: number) {
  return (word.match(/[\p{L}\p{N}]\p{M}*/gu) ?? []).slice(0, count).join("");
}

export function resolveCourseAvatar(name: string, avatar?: CourseAvatarOptions | null) {
  const words = name.normalize("NFC").toUpperCase().match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu) ?? [];
  const automaticInitials = (words.length > 1
    ? words.slice(0, 2).map(word => firstLetters(word, 1)).join("")
    : firstLetters(words[0] ?? "", 2)) || "TA";
  const colorKey = words.join(" ");
  let hash = 0;
  for (let index = 0; index < colorKey.length; index++) {
    hash = (hash * 31 + colorKey.charCodeAt(index)) | 0;
  }
  const customInitials = normalizeAvatarInitials(avatar?.initials ?? "");
  const error = avatarInitialsError(customInitials);
  if (error) throw new Error(error);
  if (avatar?.color && !/^#[0-9a-f]{6}$/i.test(avatar.color)) {
    throw new Error("Course avatar color must be a six-digit hex color.");
  }
  return {
    initials: customInitials || automaticInitials,
    color: avatar?.color || COURSE_AVATAR_COLORS[Math.abs(hash) % COURSE_AVATAR_COLORS.length].color,
  };
}
