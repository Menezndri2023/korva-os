import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";
import { cn } from "../cn.ts";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

// forwardRef is required, not optional: apps/web's forms use react-hook-form's register(),
// which needs a real ref to the native <input> to work.
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, error = false, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={error || undefined}
      className={cn(
        // Base style unchanged from the pattern already used on every <input> in apps/web
        // (F2-A audit §3/§4) — only the focus/border colors move to tokens.
        "h-11 rounded-lg border bg-surface px-3 text-sm text-text transition-colors placeholder:text-text-muted focus:border-focus focus:outline-none focus:ring-2 focus:ring-primary/40",
        error ? "border-destructive" : "border-border-input",
        className,
      )}
      {...props}
    />
  );
});
