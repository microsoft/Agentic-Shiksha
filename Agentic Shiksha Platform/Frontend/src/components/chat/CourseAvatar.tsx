import { cn } from "@/lib/utils";
import { resolveCourseAvatar, type CourseAvatarOptions } from "@/lib/courseAvatar";

export function CourseAvatar({ name, avatar, className }: {
  name: string;
  avatar?: CourseAvatarOptions | null;
  className?: string;
}) {
  const { initials, color } = resolveCourseAvatar(name, avatar);
  const letterCount = initials.match(/[\p{L}\p{N}]/gu)?.length ?? 0;

  return (
    <div
      aria-hidden="true"
      data-testid="course-avatar"
      style={{ color }}
      className={cn(
        "flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-neutral-800 text-3xl font-semibold select-none",
        className,
      )}
    >
      <span className={letterCount > 2 ? "text-[0.8em]" : undefined}>{initials}</span>
    </div>
  );
}
