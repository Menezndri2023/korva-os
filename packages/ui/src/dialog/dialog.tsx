"use client";

import { useEffect, useId } from "react";
import type { ReactNode } from "react";
import { cn } from "../cn.ts";

export interface DialogProps {
  /** Controls visibility. Dialog renders nothing (not even hidden markup) when false, matching
   *  how every hand-rolled overlay in apps/web today is conditionally rendered rather than
   *  hidden via CSS (see dashboard/layout.tsx's `{sidebarOpen && (...)}` / user-menu patterns). */
  open: boolean;
  /** Called on Escape, backdrop click, or a caller-provided close control inside `children`. */
  onClose: () => void;
  /** Optional heading, rendered above `children` and wired to the dialog via aria-labelledby.
   *  Omit for a dialog that supplies its own heading markup in `children`. */
  title?: string;
  children: ReactNode;
  className?: string;
}

// No React portal: packages/ui only declares `react` (peer) + `clsx`/`tailwind-merge` as
// dependencies, and pnpm's per-package node_modules isolation means "react-dom" isn't resolvable
// from here without adding a new dependency to a package three other agents' work sits next to
// this wave. `position: fixed` already escapes normal document flow relative to the viewport
// without needing a portal — the exact same technique dashboard/layout.tsx already uses for its
// mobile sidebar backdrop and user-menu overlay (`fixed inset-0`), so this follows established
// precedent rather than introducing a new pattern.
export function Dialog({ open, onClose, title, children, className }: DialogProps) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-zinc-900/40 backdrop-blur-sm"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={cn(
          "relative w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-xl",
          className,
        )}
      >
        {title && (
          <h2 id={titleId} className="text-lg font-semibold text-text">
            {title}
          </h2>
        )}
        <div className={title ? "mt-4" : undefined}>{children}</div>
      </div>
    </div>
  );
}
