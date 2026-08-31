import React from "react";

export function SectionTitle({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <Icon className="h-4 w-4" />
      <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {children}
      </h4>
    </div>
  );
}