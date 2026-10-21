import type { ReactNode } from "react";
import { cn } from "../cn.ts";

export interface EmptyStateProps {
  title: string;
  /** What to do next, in one or two sentences. */
  description?: ReactNode;
  /** The action that fills the empty space. */
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

/** An empty list is an invitation to act: say what belongs here and how to add the first one. */
export function EmptyState({ title, description, action, icon, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      {icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-warning-soft text-warning">
          {icon}
        </div>
      )}
      <p className="font-display text-base font-semibold text-text">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
