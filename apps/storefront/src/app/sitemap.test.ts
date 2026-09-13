import { afterEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();
vi.mock("@/lib/public-api-client", () => ({
  publicApiClient: { get: (...args: unknown[]) => getMock(...args) },
}));

describe("sitemap", () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  it("includes every website-enabled tenant slug returned by the API, plus the root page", async () => {
    getMock.mockResolvedValue([
      { slug: "boutique-a", updatedAt: "2026-01-01T00:00:00.000Z" },
      { slug: "boutique-b", updatedAt: "2026-02-02T00:00:00.000Z" },
    ]);
    const { default: sitemap } = await import("./sitemap");

    const entries = await sitemap();

    expect(getMock).toHaveBeenCalledWith("/public-sites/sitemap-entries");
    const urls = entries.map((entry) => entry.url);
    expect(urls).toContain("http://localhost:3001");
    expect(urls).toContain("http://localhost:3001/boutique-a");
    expect(urls).toContain("http://localhost:3001/boutique-b");
    expect(entries).toHaveLength(3);
  });

  it("falls back to just the root page if the API call fails, rather than throwing", async () => {
    getMock.mockRejectedValue(new Error("network error"));
    const { default: sitemap } = await import("./sitemap");

    const entries = await sitemap();

    expect(entries).toHaveLength(1);
    expect(entries[0]?.url).toBe("http://localhost:3001");
  });
});
