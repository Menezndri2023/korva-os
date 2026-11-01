import { cn } from "@korva/ui";

/**
 * KORVA's logo: a cowrie shell (cauri), chosen by the owner on 2026-11-01. The cowrie was the
 * currency of West African trade for centuries — exchange and prosperity, recognised at a glance
 * by the people KORVA serves — and no other business software could wear it.
 *
 * Drawn in fixed colours, not currentColor: the shell is saffron and its opening petrol on every
 * background (petrol sidebar, white page, dark mode), which is what keeps it recognisable. At
 * small sizes (`compact`) the teeth go and the opening thickens, so it still reads at 16px.
 */
export function KorvaGlyph({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <svg viewBox="0 0 48 48" className={cn("size-6", className)} aria-hidden="true">
      <ellipse cx="24" cy="24" rx="14" ry="19" fill="#f2a33a" />
      <path
        d="M24 8.5c-2.4 5-2.4 26 0 31"
        fill="none"
        stroke="#0f3b42"
        strokeWidth={compact ? 5 : 3.2}
        strokeLinecap="round"
      />
      {!compact && (
        <g stroke="#0f3b42" strokeWidth="2.4" strokeLinecap="round">
          <path d="M19.6 16h2.4" />
          <path d="M19.2 24h2.6" />
          <path d="M19.6 32h2.4" />
          <path d="M26 16h2.4" />
          <path d="M26.2 24h2.6" />
          <path d="M26 32h2.4" />
        </g>
      )}
    </svg>
  );
}

/** The cowrie on its petrol tile: the app-icon form (administration, sign-in screens). */
export function KorvaTile({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#0f3b42]", className)}
    >
      <KorvaGlyph className="size-[70%]" />
    </span>
  );
}

/**
 * Cowrie plus wordmark. "OS" is set lighter and a size down so the name reads KORVA first.
 */
export function KorvaWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <KorvaGlyph className="size-8" />
      <span className="font-display text-[1.125rem] font-bold leading-none">
        KORVA<span className="ml-1 font-normal opacity-70">OS</span>
      </span>
    </span>
  );
}
