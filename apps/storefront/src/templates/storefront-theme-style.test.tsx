import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { StorefrontThemeStyle } from "./storefront-theme-style";
import type { ResolvedStorefrontStyle } from "./palette";

const style: ResolvedStorefrontStyle = {
  background: "#0f172a",
  surface: "#1e293b",
  border: "#334155",
  text: "#f8fafc",
  textMuted: "#94a3b8",
  accent: "#d4a94a",
  accentContrast: "#111827",
  headingFont: "var(--font-poppins)",
  bodyFont: "var(--font-inter)",
};

describe("StorefrontThemeStyle", () => {
  it("ships the theme in the server HTML, under the request's nonce", () => {
    const html = renderToString(<StorefrontThemeStyle style={style} nonce="abc" />);
    expect(html).toContain('nonce="abc"');
    expect(html).toContain("--kt-accent:#d4a94a;");
  });

  it("themes a page mounted by client-side navigation without inserting a <style> CSP would block", () => {
    document.documentElement.removeAttribute("style");
    const { container } = render(<StorefrontThemeStyle style={style} nonce="stale-nonce" />);
    expect(container.querySelector("style")).toBeNull();
    expect(document.documentElement.style.getPropertyValue("--kt-accent")).toBe("#d4a94a");
    expect(document.documentElement.style.getPropertyValue("--kt-font-heading")).toBe("var(--font-poppins)");
  });
});
