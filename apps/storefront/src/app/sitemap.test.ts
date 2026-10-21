import { afterEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();
vi.mock("@/lib/server-api", () => ({
  serverApi: { get: (...args: unknown[]) => getMock(...args) },
}));

describe("sitemap", () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  it("includes every website-enabled tenant slug returned by the API — not the root, which redirects", async () => {
    getMock.mockResolvedValue([
      { slug: "boutique-a", updatedAt: "2026-01-01T00:00:00.000Z" },
      { slug: "boutique-b", updatedAt: "2026-02-02T00:00:00.000Z" },
    ]);
    const { default: sitemap } = await import("./sitemap");

    const entries = await sitemap();

    expect(getMock).toHaveBeenCalledWith("/public-sites/sitemap-entries");
    const urls = entries.map((entry) => entry.url);
    expect(urls).toEqual(["http://localhost:3001/boutique-a", "http://localhost:3001/boutique-b"]);
  });

  it("is empty, rather than throwing, if the API call fails", async () => {
    getMock.mockRejectedValue(new Error("network error"));
    const { default: sitemap } = await import("./sitemap");

    expect(await sitemap()).toEqual([]);
  });
});
