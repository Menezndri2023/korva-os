// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

describe("visitorAddress", () => {
  it("takes the address Caddy recorded: the right-most X-Forwarded-For entry", async () => {
    const { visitorAddress } = await import("./server-api");
    // A visitor can prepend anything; only what the relay appended is trustworthy.
    expect(visitorAddress("1.2.3.4, 203.0.113.7")).toBe("203.0.113.7");
    expect(visitorAddress("203.0.113.7")).toBe("203.0.113.7");
  });

  it("forwards nothing when there is no visitor address", async () => {
    const { visitorAddress } = await import("./server-api");
    expect(visitorAddress(null)).toBeUndefined();
    expect(visitorAddress("")).toBeUndefined();
  });
});
