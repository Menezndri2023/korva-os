import type { ButtonHTMLAttributes } from "react";
import { cn } from "../cn.ts";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
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
// Pro identity (2026-10-31): the primary action is petrol (saffron is now a signal, never a
// button); secondary is a quiet outlined surface; ghost stays text-only; danger is for the
// irreversible (suspend, delete).
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-action font-semibold text-on-action hover:bg-action-hover",
  secondary: "border border-border-input bg-surface font-semibold text-text hover:bg-surface-muted",
  ghost: "text-text-muted hover:bg-surface-muted hover:text-text",
  danger: "bg-destructive font-semibold text-white hover:opacity-90",
};

// Minimum heights, so a one-line button and an Input of the same size line up in a row: md is 44 px, the
// minimum comfortable touch target on a phone; sm (36 px) is for dense rows and tables.
const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "min-h-9 px-3 py-1 text-sm",
  md: "min-h-11 px-4 py-2 text-sm",
  lg: "min-h-12 px-5 py-2 text-base",
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
