import type { ReactNode } from "react";
import { cn } from "../cn.ts";

export interface PageHeaderProps {
  title: string;
  /** One sentence on what the page is for. */
  description?: ReactNode;
  /** The page's main action(s), aligned right on wide screens. */
  actions?: ReactNode;
  className?: string;
}

/** Title, one line of context and the main action — the same top on every dashboard page. */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("mb-6 flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold text-text">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
