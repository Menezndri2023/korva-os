/**
 * Static Tailwind class names reading the CSS custom properties StorefrontThemeStyle declares on
 * `:root` (`--kt-*`). Literal strings on purpose — Tailwind's content scanner only picks up
 * class names it can see verbatim in source, so these must never be built by string
 * concatenation/interpolation. Use these instead of a React `style={{...}}` prop anywhere a
 * template needs the resolved theme's colors/fonts (see storefront-theme-style.tsx for why).
 */
export const KT = {
  bg: "bg-[var(--kt-bg)]",
  surface: "bg-[var(--kt-surface)]",
  border: "border-[var(--kt-border)]",
  borderAccent: "border-[var(--kt-accent)]",
  text: "text-[var(--kt-text)]",
  textMuted: "text-[var(--kt-text-muted)]",
  accentBg: "bg-[var(--kt-accent)]",
  accentText: "text-[var(--kt-accent)]",
  accentContrastText: "text-[var(--kt-accent-contrast)]",
  headingFont: "[font-family:var(--kt-font-heading)]",
  bodyFont: "[font-family:var(--kt-font-body)]",
} as const;
