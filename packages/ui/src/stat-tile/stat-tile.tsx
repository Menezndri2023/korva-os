import type { ReactNode } from "react";
import { cn } from "../cn.ts";

export type StatTileTone = "default" | "emphasis";

export interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  /** One line under the figure: the comparison, the breakdown, or a link. */
  hint?: ReactNode;
  /** `positive` / `negative` colour the hint (a trend); leave unset for a neutral note. */
  trend?: "positive" | "negative";
  /** `emphasis`: the one tile on the screen that asks for action (petrol, saffron figure). */
  tone?: StatTileTone;
  className?: string;
}

/** A key figure. Figures use the display face with aligned (tabular) digits. */
export function StatTile({ label, value, hint, trend, tone = "default", className }: StatTileProps) {
  const emphasis = tone === "emphasis";
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-2xl p-5",
        emphasis ? "bg-sidebar text-white" : "border border-border bg-surface",
        className,
      )}
    >
      <span className={cn("text-sm", emphasis ? "text-sidebar-text" : "text-text-muted")}>{label}</span>
      <span
        className={cn(
          "font-display text-2xl font-semibold tabular-nums sm:text-[1.75rem]",
          emphasis ? "text-primary" : "text-text",
        )}
      >
        {value}
      </span>
      {hint && (
        <span
          className={cn(
            "text-sm",
            // On the petrol tile the green and red text tokens are too dark to read: the trend
            // stays light there and says itself through its sign (+12 % / −8 %).
            emphasis && (trend ? "font-medium text-white" : "text-sidebar-text"),
            !emphasis && trend === "positive" && "text-success",
            !emphasis && trend === "negative" && "text-destructive",
            !emphasis && !trend && "text-text-muted",
          )}
        >
          {hint}
        </span>
      )}
    </div>
  );
}
