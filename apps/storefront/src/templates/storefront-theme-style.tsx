import type { ResolvedStorefrontStyle } from "./palette";

/**
 * Renders the organization's resolved theme as CSS custom properties on `:root`, inside one
 * nonce'd `<style>` tag — the only inline style this app ever emits (see middleware.ts's
 * `style-src 'self' 'nonce-...'`). Every template then reads these via static Tailwind classes
 * (see kt-classes.ts) instead of a React `style={{...}}` prop, which a strict `style-src` with no
 * `'unsafe-inline'` would otherwise silently drop in browsers that enforce it.
 *
 * Safe to interpolate directly: `style.background/surface/border/text/textMuted/accent` are
 * either one of our own hardcoded @korva/types palette hex values, or `organization.brandColor`
 * — already validated server-side against `^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$` (see
 * packages/validation/src/organization.ts) before it can ever reach here, so none of these can
 * contain `}` or other characters that would break out of the CSS block. `headingFont`/`bodyFont`
 * are always one of our own fixed `var(--font-...)` strings (see templates/fonts.ts).
 */
export function StorefrontThemeStyle({
  style,
  nonce,
}: {
  style: ResolvedStorefrontStyle;
  nonce?: string;
}) {
  const css = `:root{--kt-bg:${style.background};--kt-surface:${style.surface};--kt-border:${style.border};--kt-text:${style.text};--kt-text-muted:${style.textMuted};--kt-accent:${style.accent};--kt-accent-contrast:${style.accentContrast};--kt-font-heading:${style.headingFont};--kt-font-body:${style.bodyFont};}`;
  return <style nonce={nonce} dangerouslySetInnerHTML={{ __html: css }} />;
}
