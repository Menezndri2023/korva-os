import { forwardRef } from "react";
import type { ReactNode, TextareaHTMLAttributes } from "react";
import { cn } from "../cn.ts";

export interface FieldProps {
  /** The control's id — the label points at it, and the help/error text describes it. */
  id: string;
  label: ReactNode;
  /** One line under the control: what it is for, or the expected format. */
  help?: ReactNode;
  /** Replaces the help text and turns the line red. Pass `error` to the control too. */
  error?: ReactNode;
  /** Shown after the label in muted text, e.g. "(facultatif)". */
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * Label + control + one line of help or error, so every form in KORVA reads the same. The
 * control itself (Input, Select, Textarea) is passed as children with the same `id`; give it
 * `aria-describedby={fieldDescriptionId(id)}` when there is help or an error to read out.
 */
export function Field({ id, label, help, error, hint, className, children }: FieldProps) {
  const line = error ?? help;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-semibold text-text">
        {label}
        {hint && <span className="font-normal text-text-muted"> {hint}</span>}
      </label>
      {children}
      {line && (
        <p
          id={fieldDescriptionId(id)}
          className={cn("text-xs", error ? "text-destructive" : "text-text-muted")}
          role={error ? "alert" : undefined}
        >
          {line}
        </p>
      )}
    </div>
  );
}

export function fieldDescriptionId(id: string): string {
  return `${id}-description`;
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, error = false, rows = 3, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={error || undefined}
      className={cn(
        "rounded-lg border bg-surface px-3 py-2.5 text-sm leading-relaxed text-text transition-colors placeholder:text-text-muted focus:border-focus focus:outline-none focus:ring-2 focus:ring-primary/40",
        error ? "border-destructive" : "border-border-input",
        className,
      )}
      {...props}
    />
  );
});
