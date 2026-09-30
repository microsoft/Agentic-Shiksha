import { useId, useRef, useState } from "react";
import { Pencil, Upload } from "lucide-react";
import { CourseAvatar } from "@/components/chat/CourseAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { safeImageSrc } from "@/lib/api";
import { avatarInitialsError, COURSE_AVATAR_COLORS, normalizeAvatarInitials, resolveCourseAvatar, type CourseAvatarOptions } from "@/lib/courseAvatar";

type CourseAvatarEditorProps = {
  name: string;
  value?: CourseAvatarOptions | null;
  onChange: (value: CourseAvatarOptions | null) => void;
  imageUrl?: string | null;
  onSelectImage?: (file: File) => void;
  onClearImage?: () => void;
  disabled?: boolean;
};

export function CourseAvatarEditor({ name, value, onChange, imageUrl, onSelectImage, onClearImage, disabled = false }: CourseAvatarEditorProps) {
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [initials, setInitials] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const initialsError = avatarInitialsError(initials);
  const draft = { initials: initialsError ? value?.initials : normalizeAvatarInitials(initials), color };
  const preview = resolveCourseAvatar(name, draft);
  const imageFailed = !!imageUrl && failedImageUrl === imageUrl;

  function changeOpen(next: boolean) {
    if (next && disabled) return;
    if (next) {
      setInitials(value?.initials ?? "");
      setColor(value?.color ?? null);
      setFileError(null);
    }
    setOpen(next);
  }

  function apply() {
    if (disabled || initialsError) return;
    const customInitials = normalizeAvatarInitials(initials) || null;
    onChange(customInitials || color ? { initials: customInitials, color } : null);
    if (imageUrl) onClearImage?.();
    setOpen(false);
  }

  return (
    <div className="flex max-w-full flex-col items-center gap-2">
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogTrigger asChild>
          <button
            type="button"
            aria-label="Customize course picture"
            disabled={disabled}
            className="group relative h-28 w-28 overflow-hidden rounded-[1.75rem] border border-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {imageUrl && !imageFailed ? (
              <img src={safeImageSrc(imageUrl)} alt="Course picture" className="h-full w-full object-cover" onError={() => setFailedImageUrl(imageUrl)} />
            ) : (
              <CourseAvatar name={name} avatar={value} className="h-full w-full rounded-[1.75rem] text-4xl" />
            )}
            <span className="absolute bottom-1.5 right-1.5 rounded-full bg-neutral-900/90 p-1.5 text-neutral-200">
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          </button>
        </DialogTrigger>
        <DialogContent className="w-[calc(100%-2rem)] max-w-sm max-h-[90vh] overflow-y-auto rounded-xl border-neutral-700 bg-neutral-900 text-neutral-100">
          <DialogHeader>
            <DialogTitle>Customize course picture</DialogTitle>
            <DialogDescription>Choose initials and their color, or upload an image.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3">
            <CourseAvatar name={name} avatar={draft} className="h-24 w-24 text-4xl" />
            <button type="button" disabled={disabled || !onSelectImage} onClick={() => fileInput.current?.click()} className="flex items-center gap-1 text-xs text-neutral-400 hover:text-white focus-visible:outline-blue-400 disabled:opacity-50">
              <Upload className="h-3.5 w-3.5" aria-hidden="true" /> Upload image
            </button>
            <input
              ref={fileInput}
              type="file"
              aria-label="Upload course image"
              accept="image/png,image/jpeg,image/gif,image/webp"
              disabled={disabled || !onSelectImage}
              className="hidden"
              onChange={event => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024) {
                  setFileError("Choose a PNG, JPEG, GIF or WebP image up to 5 MB.");
                  return;
                }
                setFileError(null);
                onSelectImage?.(file);
                setOpen(false);
              }}
            />
            {fileError && <p role="alert" className="text-center text-xs text-red-400">{fileError}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-initials`}>Initials</Label>
            <Input
              id={`${id}-initials`}
              value={initials}
              onChange={event => setInitials(event.target.value)}
              placeholder={resolveCourseAvatar(name).initials}
              maxLength={24}
              aria-invalid={!!initialsError}
              aria-describedby={`${id}-initials-help`}
              className="border-neutral-600 bg-neutral-950"
            />
            <p id={`${id}-initials-help`} className={`text-xs ${initialsError ? "text-red-400" : "text-neutral-400"}`} role={initialsError ? "alert" : undefined}>
              {initialsError || "Up to 3 letters or numbers. Leave blank to follow the course name."}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-color`}>Letter color</Label>
            <div className="flex flex-wrap items-center gap-2">
              {COURSE_AVATAR_COLORS.map(option => (
                <button
                  key={option.name}
                  type="button"
                  aria-label={`${option.name} color`}
                  aria-pressed={preview.color.toLowerCase() === option.color}
                  onClick={() => setColor(option.color)}
                  className="h-8 w-8 rounded-full border-2 border-transparent ring-offset-2 ring-offset-neutral-900 aria-pressed:ring-2 aria-pressed:ring-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                  style={{ backgroundColor: option.color }}
                />
              ))}
              <input id={`${id}-color`} type="color" value={preview.color} onChange={event => setColor(event.target.value)} className="h-8 w-10 cursor-pointer rounded border border-neutral-600 bg-transparent" />
            </div>
          </div>
          <button type="button" onClick={() => { setInitials(""); setColor(null); }} className="justify-self-start text-sm text-neutral-300 underline underline-offset-4 focus-visible:outline-blue-400">
            Reset to automatic
          </button>
          {imageUrl && <p className="text-xs text-neutral-400">Applying initials replaces the selected image. Cancel keeps it unchanged.</p>}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" onClick={apply} disabled={disabled || !!initialsError || (!!imageUrl && !onClearImage)}>Apply changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {imageUrl && <button type="button" disabled={disabled || !onClearImage} onClick={() => { onClearImage?.(); setFileError(null); }} className="text-xs text-neutral-400 hover:text-white focus-visible:outline-blue-400 disabled:opacity-50">Use initials</button>}
      {imageFailed && <p role="alert" className="max-w-xs text-center text-xs text-red-400">The image could not be loaded. Upload a new image or use initials.</p>}
    </div>
  );
}
