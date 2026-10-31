import type { HTMLAttributes } from "react";
import { cn } from "../cn.ts";

export type NoticeTone = "info" | "warning" | "accent";

export interface NoticeProps extends HTMLAttributes<HTMLDivElement> {
  tone?: NoticeTone;
}

// A message about the whole page or account (trial running, site offline, nothing published) —
// not a field error. The tinted fill is what tells it apart from content.
const TONE_CLASSES: Record<NoticeTone, string> = {
  info: "border-border bg-surface-muted text-text",
  warning: "border-transparent bg-warning-soft text-text",
  accent: "border-transparent bg-action-soft text-text",
};

export function Notice({ tone = "info", className, children, ...props }: NoticeProps) {
  return (
    <div
      role="status"
      className={cn("rounded-xl border px-4 py-3 text-sm leading-relaxed", TONE_CLASSES[tone], className)}
      {...props}
    >
      {children}
    </div>
  );
}
