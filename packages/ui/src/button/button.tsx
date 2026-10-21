import type { ButtonHTMLAttributes } from "react";
import { cn } from "../cn.ts";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

// Matches the 3 button styles already in use across apps/web (F2-A audit §3/§4) — primary is
// the "bg-zinc-900 text-white hover:bg-zinc-800" pattern (31 occurrences), secondary the
// "border border-zinc-300" pattern (16 occurrences), ghost the discreet "text-only" pattern
// used for e.g. the dashboard logout button.
// V3 identity (2026-10-21): the primary action is saffron with petrol text (white on saffron
// fails contrast); secondary is a quiet outlined surface; ghost stays text-only.
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-primary font-semibold text-on-primary hover:bg-primary-hover",
  secondary: "border border-border-input bg-surface text-text hover:bg-surface-muted",
  ghost: "text-text-muted hover:bg-surface-muted hover:text-text",
};

// The 3 padding scales already in consistent use across apps/web (F2-A audit §4).
const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
  lg: "px-5 py-2.5 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  type = "button",
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-60",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
