import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { CONSENT_REOPEN_EVENT, SiteTracking } from "./site-tracking";

vi.mock("next/navigation", () => ({ usePathname: () => "/chez-awa" }));

const gaScript = () => document.querySelector('script[src*="googletagmanager.com/gtag/js"]');
const metaScript = () => document.querySelector('script[src*="connect.facebook.net"]');

// This test environment has no Web Storage: a small in-memory one stands in.
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  };
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  document.head.querySelectorAll("script").forEach((s) => s.remove());
  const w = window as unknown as Record<string, unknown>;
  delete w.gtag;
  delete w.fbq;
  delete w._fbq;
  delete w.dataLayer;
});
afterEach(() => vi.restoreAllMocks());

describe("SiteTracking", () => {
  it("loads nothing before the visitor answers, then both trackers once accepted", () => {
    render(<SiteTracking slug="chez-awa" googleAnalyticsId="G-ABC123" metaPixelId="1234567890" />);
    expect(screen.getByRole("dialog", { name: "Cookies de mesure d'audience" })).toBeInTheDocument();
    expect(gaScript()).toBeNull();
    expect(metaScript()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Accepter" }));
    expect(gaScript()).not.toBeNull();
    expect(metaScript()).not.toBeNull();
    expect(window.localStorage.getItem("korva-consent:chez-awa")).toBe("granted");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("loads nothing when the visitor declines, and remembers it", () => {
    render(<SiteTracking slug="chez-awa" googleAnalyticsId="G-ABC123" />);
    fireEvent.click(screen.getByRole("button", { name: "Refuser" }));
    expect(gaScript()).toBeNull();
    expect(window.localStorage.getItem("korva-consent:chez-awa")).toBe("denied");
  });

  it("does not ask again, but the footer link reopens the choice", () => {
    window.localStorage.setItem("korva-consent:chez-awa", "denied");
    render(<SiteTracking slug="chez-awa" metaPixelId="1234567890" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event(CONSENT_REOPEN_EVENT));
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("asks nothing on a site without tracking ids", () => {
    const { container } = render(<SiteTracking slug="chez-awa" />);
    expect(container).toBeEmptyDOMElement();
  });
});
