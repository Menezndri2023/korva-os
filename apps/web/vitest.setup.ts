import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Testing Library's own auto-cleanup only self-registers when it detects `afterEach` as a
// global (Jest-style). vitest.config.ts deliberately doesn't set test.globals — every test
// file imports afterEach/describe/it/expect explicitly instead — so that auto-detection never
// fires and DOM nodes from one test leak into the next. Registering it here once, explicitly,
// is the minimal fix that doesn't require turning globals on.
afterEach(() => {
  cleanup();
});

// jsdom doesn't implement matchMedia at all (a well-known gap, not a KORVA-specific one) —
// ThemeProvider's system-preference fallback (@/lib/theme-provider.ts) calls it on every
// mount, so any test rendering a dashboard page would otherwise crash before this existed.
// Always reports "no dark preference" — deterministic and irrelevant to what these tests
// actually assert on, since none of them test dark-mode rendering itself (packages/ui's own
// ThemeToggle.test.tsx covers the toggle in isolation).
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
