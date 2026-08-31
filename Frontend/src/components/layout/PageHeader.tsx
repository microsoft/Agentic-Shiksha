// src/components/layout/PageHeader.tsx
// Reusable page header component with consistent styling

import * as React from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title?: string; // Optional title (left side)
  leftContent?: React.ReactNode; // Custom left side content (e.g., Back button)
  centerContent?: React.ReactNode; // Centred content (e.g., section switcher)
  children?: React.ReactNode; // Right side content (buttons, menus, etc.)
  showBorder?: boolean; // Show bottom border line
  sticky?: boolean; // Make header sticky (default: true for backward compat)
  className?: string;
}

export function PageHeader({ 
  title, 
  leftContent,
  centerContent,
  children, 
  showBorder = false,
  sticky = true,
  className 
}: PageHeaderProps) {
  return (
    <div 
      className={cn(
        "relative flex items-center justify-between gap-4 px-6 h-14 bg-neutral-900 transition-all duration-300",
        sticky && "sticky top-0 z-30",
        showBorder ? "border-b border-neutral-700/60" : "border-b border-transparent",
        className
      )}
    >
      {/* Left side: title or custom content */}
      {leftContent || (title && <h1 className="text-[1.25rem] font-semibold text-neutral-100">{title}</h1>)}
      {centerContent && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          {centerContent}
        </div>
      )}
      {/* Right side: children or empty placeholder */}
      {children || <div className="h-10" />}
    </div>
  );
}
