"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
import type { ResolvedStorefrontStyle } from "./palette";

function themeVariables(style: ResolvedStorefrontStyle): [string, string][] {
  return [
    ["--kt-bg", style.background],
    ["--kt-surface", style.surface],
    ["--kt-border", style.border],
    ["--kt-text", style.text],
    ["--kt-text-muted", style.textMuted],
    ["--kt-accent", style.accent],
    ["--kt-accent-contrast", style.accentContrast],
    ["--kt-font-heading", style.headingFont],
    ["--kt-font-body", style.bodyFont],
  ];
}

const subscribeNever = () => () => {};

/**
 * Puts the organization's resolved theme on `:root` as CSS custom properties, read by every
 * template through static Tailwind classes (see kt-classes.ts).
 *
 * Two mechanisms, because the strict `style-src 'self' 'nonce-…'` (middleware.ts) only lets ONE
 * of them work at each moment:
 * - In the server HTML, a `<style>` carrying the request's nonce, so the first paint is already
 *   themed.
 * - In the browser, the same values set through the CSSOM (`style.setProperty`), which CSP does
 *   not govern. This is the one that matters after a client-side navigation: the RSC payload of
 *   the next page carries a NEW nonce that the document's policy (fixed at the first load) does
 *   not know, so a freshly inserted `<style>` was blocked — and a customer coming back to the
 *   shop from the sign-in page, the account area or order tracking saw it with no colours and no
 *   fonts at all, until a full reload.
 *
 * So the `<style>` is rendered only while hydrating the server's HTML (where it already exists
 * and its nonce is valid), never inserted fresh.
 *
 * Safe to interpolate: the values are our own palette hex values or `organization.brandColor`,
 * validated server-side against `^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$`, and our own fixed
 * `var(--font-...)` strings (templates/fonts.ts) — none can break out of the CSS block.
 */
export function StorefrontThemeStyle({
  style,
  nonce,
}: {
  style: ResolvedStorefrontStyle;
  nonce?: string;
}) {
  const variables = themeVariables(style);
  const css = `:root{${variables.map(([name, value]) => `${name}:${value};`).join("")}}`;
  // true on the server and while hydrating its HTML, false for anything mounted afterwards.
  const fromServerHtml = useSyncExternalStore(
    subscribeNever,
    () => false,
    () => true,
  );

  useLayoutEffect(() => {
    const root = document.documentElement.style;
    for (const [name, value] of themeVariables(style)) root.setProperty(name, value);
    // `css` captures every value of `style`; depending on the object itself would re-run on
    // each render of the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [css]);

  return fromServerHtml ? <style nonce={nonce} dangerouslySetInnerHTML={{ __html: css }} /> : null;
}
