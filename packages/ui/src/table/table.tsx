import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "../cn.ts";

export interface TableProps extends HTMLAttributes<HTMLTableElement> {
  /** Read out by screen readers; also the table's accessible name. */
  caption?: ReactNode;
}

/**
 * A data table that scrolls sideways inside its own box on a phone instead of widening the page.
 * Use Th / Td for cells so every table in KORVA has the same rhythm.
 */
export function Table({ caption, className, children, ...props }: TableProps) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full border-collapse text-sm", className)} {...props}>
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

type Align = "left" | "right" | "center";
const ALIGN: Record<Align, string> = { left: "text-left", right: "text-right", center: "text-center" };

export interface ThProps extends ThHTMLAttributes<HTMLTableCellElement> {
  align?: Align;
}

export function Th({ align = "left", className, ...props }: ThProps) {
  return (
    <th
      scope="col"
      className={cn(
        "whitespace-nowrap bg-surface-muted px-4 py-2.5 text-xs font-semibold text-text-muted first:pl-5 last:pr-5",
        ALIGN[align],
        className,
      )}
      {...props}
    />
  );
}

export interface TdProps extends TdHTMLAttributes<HTMLTableCellElement> {
  align?: Align;
  /** Figures: tabular digits so columns line up. */
  numeric?: boolean;
}

export function Td({ align, numeric = false, className, ...props }: TdProps) {
  return (
    <td
      className={cn(
        "border-t border-border px-4 py-3 align-middle first:pl-5 last:pr-5",
        ALIGN[align ?? (numeric ? "right" : "left")],
        numeric && "tabular-nums",
        className,
      )}
      {...props}
    />
  );
}
