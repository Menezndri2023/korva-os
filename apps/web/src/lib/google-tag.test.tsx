import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { CONSENT_REOPEN_EVENT, GoogleTag, isConversionSendTo, isGoogleTagId, trackSignUp } from "./google-tag";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

const tagScript = () => document.querySelector('script[src*="googletagmanager.com/gtag/js"]');
type W = Window & { dataLayer?: IArguments[]; gtag?: unknown };

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
  delete (window as W).gtag;
  delete (window as W).dataLayer;
});

const events = () => ((window as W).dataLayer ?? []).map((args) => Array.from(args));

describe("GoogleTag", () => {
  it("shows nothing and loads nothing without an id", () => {
    render(<GoogleTag lang="fr" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(tagScript()).toBeNull();
  });

  it("ignores a malformed id instead of loading it", () => {
    render(<GoogleTag tagId="mon-id" lang="fr" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("loads nothing before the visitor answers, then the tag once accepted", () => {
    render(<GoogleTag tagId="AW-123456789" lang="fr" />);
    expect(screen.getByRole("dialog", { name: "Cookies de mesure d'audience" })).toBeInTheDocument();
    expect(tagScript()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Accepter" }));
    expect(tagScript()?.getAttribute("src")).toContain("id=AW-123456789");
    expect(events()).toContainEqual(["config", "AW-123456789", { send_page_view: false }]);
    expect(events().some((e) => e[0] === "event" && e[1] === "page_view")).toBe(true);
    expect(window.localStorage.getItem("korva-consent")).toBe("granted");
  });

  it("loads nothing when declined, and the footer link asks again", () => {
    render(<GoogleTag tagId="G-ABC123" lang="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(tagScript()).toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    act(() => void window.dispatchEvent(new Event(CONSENT_REOPEN_EVENT)));
    expect(screen.getByRole("dialog", { name: "Audience cookies" })).toBeInTheDocument();
  });

  it("sends the sign-up conversion only once the tag is running", () => {
    trackSignUp(); // declined / not loaded: nothing, no crash
    expect(events()).toEqual([]);

    window.localStorage.setItem("korva-consent", "granted");
    render(<GoogleTag tagId="AW-123456789" signupConversion="AW-123456789/AbC-dEf" lang="fr" />);
    trackSignUp();
    expect(events()).toContainEqual(["event", "sign_up", { method: "email" }]);
    expect(events()).toContainEqual(["event", "conversion", { send_to: "AW-123456789/AbC-dEf" }]);
  });
});

describe("id formats", () => {
  it("accepts Google's tag and conversion formats only", () => {
    expect(isGoogleTagId("G-AB12CD34EF")).toBe(true);
    expect(isGoogleTagId("AW-123456789")).toBe(true);
    expect(isGoogleTagId("GT-ABCDEF")).toBe(true);
    expect(isGoogleTagId("UA-1234-1")).toBe(false);
    expect(isGoogleTagId("")).toBe(false);
    expect(isConversionSendTo("AW-123456789/AbC-dEf_1")).toBe(true);
    expect(isConversionSendTo("AW-123456789")).toBe(false);
  });
});
