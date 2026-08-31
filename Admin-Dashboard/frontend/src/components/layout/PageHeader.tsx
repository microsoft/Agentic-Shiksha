// src/components/layout/PageHeader.tsx
import * as React from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title?: string;
  leftContent?: React.ReactNode;
  children?: React.ReactNode;
  showBorder?: boolean;
  sticky?: boolean;
  className?: string;
}

export function PageHeader({ 
  title, 
  leftContent,
  children, 
  showBorder = false,
  sticky = true,
  className 
}: PageHeaderProps) {
  return (
    <div 
      className={cn(
        "flex items-center justify-between gap-4 px-6 h-14 bg-neutral-900 transition-all duration-300",
        sticky && "sticky top-0 z-30",
        showBorder ? "border-b border-neutral-700/60" : "border-b border-transparent",
        className
      )}
    >
      {leftContent || (title && <h1 className="text-[1.25rem] font-semibold text-neutral-100">{title}</h1>)}
      {children || <div className="h-10" />}
    </div>
  );
}
