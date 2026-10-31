import type { ReactNode } from "react";
import { cn } from "../cn.ts";

export interface FilterChipOption<T extends string> {
  value: T;
  label: ReactNode;
  /** A count shown after the label, e.g. how many items wait in that state. */
  count?: number;
}

export interface FilterChipsProps<T extends string> {
  "aria-label": string;
  options: readonly FilterChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/** The status filter above a list (Toutes / À valider / Versés…). One choice at a time. */
export function FilterChips<T extends string>({
  "aria-label": ariaLabel,
  options,
  value,
  onChange,
  className,
}: FilterChipsProps<T>) {
  return (
    <div role="group" aria-label={ariaLabel} className={cn("flex flex-wrap gap-2", className)}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={filterChipClassName(active)}
          >
            {option.label}
            {option.count !== undefined && (
              <span className={cn("tabular-nums", active ? "text-on-action/80" : "text-text-muted")}>{option.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** For a page that renders its own chip buttons (extra content, custom handlers). */
export function filterChipClassName(active: boolean): string {
  return cn(
    "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1",
    active
      ? "border-action bg-action font-semibold text-on-action"
      : "border-border-input bg-surface text-text hover:bg-surface-muted",
  );
}
