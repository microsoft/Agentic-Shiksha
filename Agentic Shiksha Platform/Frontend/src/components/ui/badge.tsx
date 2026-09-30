import * as React from "react";

// Badge component with multiple variants
export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "destructive" | "outline" | "success" | "warning";
}

export function Badge({

  className = "",
  variant = "default",
  ...props
}: BadgeProps) {
  const getVariantStyles = () => {
    switch (variant) {
      case "secondary":
        return "border-transparent bg-neutral-100 text-neutral-900 hover:bg-neutral-100/80";
      case "destructive":
        return "border-transparent bg-red-500 text-white hover:bg-red-500/80";
      case "outline":
        return "text-neutral-100 border-neutral-200";
      case "success":
        return "border-transparent bg-green-500 text-white hover:bg-green-500/80";
      case "warning":
        return "border-transparent bg-yellow-500 text-white hover:bg-yellow-500/80";
      default:
        return "border-transparent bg-neutral-900 text-neutral-50 hover:bg-neutral-900/80";
    }
  };

  const baseStyles = "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-950 focus:ring-offset-2";
  
  return (
    <div
      className={`${baseStyles} ${getVariantStyles()} ${className}`}
      {...props}
    />
  );
}