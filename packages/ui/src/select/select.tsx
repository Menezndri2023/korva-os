import { forwardRef } from "react";
import type { SelectHTMLAttributes } from "react";
import { cn } from "../cn.ts";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
}

// Mirrors Input's shape exactly (same base classes, same `error` prop, same forwardRef
// requirement for react-hook-form's register()) rather than inventing a separate options-array
// API: every one of the 17 files using a raw <select> today already builds its <option> list
// itself (static arrays, query results mapped to options, a disabled placeholder option, a
// hidden sibling <input> for a linked field, ...) — forcing all of that through a generic
// `options` prop would either lose functionality or just reimplement children-passing badly.
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, error = false, children, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      aria-invalid={error || undefined}
      className={cn(
        // Same base style as every hand-rolled <select> in apps/web today (rounded-md border
        // px-3 py-2 text-sm) plus Input's focus/border token wiring, so migrating a page from a
        // raw <select> to this component is a drop-in visual no-op.
        "rounded-lg border bg-surface px-3 py-2 text-sm text-text transition-colors placeholder:text-text-muted focus:border-focus focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60",
        error ? "border-destructive" : "border-border-input",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
});
