import { cn } from "@korva/ui";

/**
 * KORVA's logo. The repo had none — apps/web/public still contained only the five SVGs
 * `create-next-app` ships (next.svg, vercel.svg, file.svg, globe.svg, window.svg), so every
 * page that wanted a logo rendered the string "KORVA OS" in whatever weight was nearby.
 *
 * The glyph is a ledger page: a margin rule down the left, two entry lines, and a third,
 * shorter line standing in for the total. That is literally what the product replaces for most
 * of its customers, and unlike an abstract swoosh it still reads at 16px, which is the size it
 * has to survive as a favicon.
 *
 * Drawn with `currentColor` and no fill so one component serves the ink field (paper-coloured),
 * the paper sections (ink-coloured) and the dashboard chrome, without a second asset or a
 * colour prop.
 */
export function KorvaGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      className={cn("size-6", className)}
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="3.5" />
      <path d="M8 3.75v16.5" />
      <path d="M11.25 9h6.25" />
      <path d="M11.25 12.75h6.25" />
      {/* Shorter than the two above: the total line. */}
      <path d="M11.25 16.5h3.25" />
    </svg>
  );
}

/**
 * Glyph plus wordmark. "OS" is set lighter and a size down rather than in --color-mark: the
 * brand palette reserves that red for marks and totals (see tokens.css), and spending it inside
 * the logo would make every other use of it read as decoration.
 */
export function KorvaWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-baseline gap-2 font-semibold tracking-tight", className)}>
      <KorvaGlyph className="size-5 self-center" />
      <span className="text-[1.0625rem] leading-none">
        KORVA<span className="ml-1 font-normal opacity-70">OS</span>
      </span>
    </span>
  );
}
