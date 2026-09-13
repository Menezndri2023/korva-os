import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Testing Library's own auto-cleanup only self-registers when it detects `afterEach` as a
// global (Jest-style). vitest.config.mts deliberately doesn't set test.globals — every test
// file imports afterEach/describe/it/expect explicitly instead — so that auto-detection never
// fires and DOM nodes from one test leak into the next. Registering it here once, explicitly,
// is the minimal fix that doesn't require turning globals on. Mirrors apps/web's own setup;
// no matchMedia shim is needed here since the storefront has no dark-mode toggle.
afterEach(() => {
  cleanup();
});
