import type { ReactNode } from "react";
import { cn } from "../cn.ts";

export interface TabBarProps {
  "aria-label": string;
  className?: string;
  children: ReactNode;
}

/**
 * The row of tabs above a section. The tabs themselves are links (next/link in the app, a plain
 * <a href="#…"> for hash tabs) styled with `tabClassName` — this package stays framework-free.
 * Mark the current one with `aria-current="page"`.
 */
export function TabBar({ "aria-label": ariaLabel, className, children }: TabBarProps) {
  return (
    <nav
      aria-label={ariaLabel}
      className={cn("-mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:px-0", className)}
    >
      {children}
    </nav>
  );
}

/** Saffron underline on the current tab: the signal colour, never a fill. */
export function tabClassName(current: boolean): string {
  return cn(
    "shrink-0 whitespace-nowrap border-b-[3px] px-3 py-2.5 text-sm transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
    current ? "border-primary font-semibold text-text" : "border-transparent text-text-muted hover:text-text",
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  "aria-label": string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/** Two to four mutually exclusive views of the same data (7 jours / 30 jours / 12 mois). */
export function SegmentedControl<T extends string>({
  "aria-label": ariaLabel,
  options,
  value,
  onChange,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn("inline-flex overflow-hidden rounded-lg border border-border-input bg-surface", className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "min-h-9 px-3.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus",
            option.value === value ? "bg-action font-semibold text-on-action" : "text-text-muted hover:bg-surface-muted",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
