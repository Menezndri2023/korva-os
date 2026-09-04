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
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-zinc-900 text-text-primary shadow-sm hover:bg-zinc-800 hover:shadow",
  secondary: "border border-border-input text-text hover:bg-surface-muted",
  ghost: "text-text-muted hover:bg-surface-muted",
};

// The 3 padding scales already in consistent use across apps/web (F2-A audit §4).
const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "px-2 py-1.5 text-sm",
  md: "px-3 py-2 text-sm",
  lg: "px-4 py-2 text-sm",
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
        "inline-flex items-center justify-center rounded-md font-medium transition-colors disabled:opacity-60",
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
