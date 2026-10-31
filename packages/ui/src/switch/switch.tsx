import type { ReactNode } from "react";
import { cn } from "../cn.ts";

export interface SwitchProps {
  id?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Visible label, clickable. Omit only when the switch sits in a labelled row — then pass
   *  `aria-label`. */
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  "aria-label"?: string;
  className?: string;
}

/** An on/off setting that applies at once (no Save button) — a checkbox is for forms. */
export function Switch({
  id,
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
  "aria-label": ariaLabel,
  className,
}: SwitchProps) {
  const control = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label ? undefined : ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2",
        checked ? "bg-action" : "bg-border-input",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-block h-5 w-5 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-6" : "translate-x-1",
        )}
      />
    </button>
  );
  if (!label) return <span className={className}>{control}</span>;
  return (
    <label className={cn("flex cursor-pointer items-start gap-3", disabled && "cursor-not-allowed", className)}>
      {control}
      <span className="min-w-0 pt-0.5">
        <span className="block text-sm font-medium text-text">{label}</span>
        {description && <span className="block text-xs text-text-muted">{description}</span>}
      </span>
    </label>
  );
}
