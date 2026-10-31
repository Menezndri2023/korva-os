import type { HTMLAttributes } from "react";
import { cn } from "../cn.ts";

/** A grey placeholder in the shape of what is loading — calmer than a "Chargement…" line. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-lg bg-surface-muted motion-reduce:animate-none", className)}
      {...props}
    />
  );
}

/** A list of `rows` skeleton lines, announced once to screen readers. */
export function SkeletonList({ rows = 3, label = "Chargement…" }: { rows?: number; label?: string }) {
  return (
    <div role="status" className="space-y-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-10" />
      ))}
    </div>
  );
}
