import type { HTMLAttributes } from "react";
import { cn } from "../cn.ts";

export type BadgeVariant = "default" | "success" | "warning" | "destructive" | "accent";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

// Colors match the status pills already in apps/web (F2-B.3 audit): default is the plain
// "bg-zinc-100 text-zinc-700" tag pattern (7 occurrences); success/warning are the two real
// status colors observed in catalog.tsx (offer.status) and communication.tsx (conversation
// status). destructive has no current real-world usage anywhere in apps/web today — it's
// included because the API was specified with 4 variants and --color-destructive already
// exists in tokens.css for exactly this purpose, but it is unproven against a real page.
// Text colors use the existing semantic tokens (text-success/text-warning/text-destructive/
// text-badge-text); background tints (green-100/amber-100/red-100) stay plain Tailwind
// utilities because tokens.css has no "muted status background" token today, and adding one
// wasn't demonstrated as strictly necessary — see F2-B.3 report §2 for the reasoning.
//
// default originally read text-text-muted (zinc-500), which matched the comment's own claim
// only by coincidence-of-naming, not by actual color: the F2-B.10 audit found zinc-500 matches
// just 1 of 8 real neutral badges, while zinc-700 (the color this comment always described)
// matches 6 of 8. Fixed in F2-B.11 via a dedicated --color-badge-text token rather than
// changing --color-text-muted itself, since that token is also read by Button's ghost variant.
const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  default: "bg-surface-muted text-badge-text",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  destructive: "bg-destructive-soft text-destructive",
  accent: "bg-action-soft text-action",
};

export function Badge({ variant = "default", className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        VARIANT_CLASSES[variant],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
