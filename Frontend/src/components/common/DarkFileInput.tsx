// DarkFileInput.tsx
import React, { useRef } from "react";

export function DarkFileInput({
  multiple,
  accept,
  onChange,
  fullWidth = true,
  label = "Upload",
  className = "",
}: {
  multiple?: boolean;
  accept?: string;
  onChange: (files: File[]) => void;
  fullWidth?: boolean;   // ✅ new
  label?: string;        // ✅ optional
  className?: string;    // ✅ optional
}) {
  const ref = useRef<HTMLInputElement | null>(null);

  return (
    <div className={`${fullWidth ? "w-full" : ""} ${className}`}>
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          onChange(files);
          e.currentTarget.value = "";
        }}
      />

      <button
        type="button"
        onClick={() => ref.current?.click()}
        className={`
          ${fullWidth ? "w-full" : "w-auto"}
          h-[2.125rem] rounded-xl px-[1.125rem]
          bg-neutral-800/60 border border-white/40 text-white text-[0.8125rem]
          hover:border-white/60
          shadow-md shadow-black/30
          inline-flex items-center justify-center gap-1.5
          transition-all duration-200
        `}
      >
        {label}
      </button>
    </div>
  );
}
