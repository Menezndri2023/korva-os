import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.resetModules();
});

function mockResolveDomain(result: { success: true; data: { slug: string } } | { success: false }) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(result),
  }) as unknown as typeof fetch;
}

describe("middleware — custom domain rewrite (Phase E3)", () => {
  it("rewrites a request on a connected custom domain to /:slug, keeping the CSP header", async () => {
    mockResolveDomain({ success: true, data: { slug: "boutique-a" } });
    const { middleware } = await import("./middleware");

    const request = new NextRequest("http://www.masociete.com/catalogue", {
      headers: { host: "www.masociete.com" },
    });
    const response = await middleware(request);

    expect(response.headers.get("x-middleware-rewrite")).toContain("/boutique-a/catalogue");
    expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
  });

  it("lets Google Analytics and Meta Pixel send their hits (loaded only after consent)", async () => {
    mockResolveDomain({ success: false });
    const { middleware } = await import("./middleware");
    const response = await middleware(new NextRequest("http://sites.korvasuite.com/chez-awa"));
    const csp = response.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toMatch(/connect-src [^;]*https:\/\/\*\.google-analytics\.com/);
    expect(csp).toMatch(/connect-src [^;]*https:\/\/www\.facebook\.com/);
  });

  it("rewrites the root path on a custom domain to just /:slug (not /:slug/)", async () => {
    mockResolveDomain({ success: true, data: { slug: "boutique-a" } });
    const { middleware } = await import("./middleware");

    const request = new NextRequest("http://www.masociete.com/", {
      headers: { host: "www.masociete.com" },
    });
    const response = await middleware(request);

    const rewritten = new URL(response.headers.get("x-middleware-rewrite") ?? "");
    expect(rewritten.pathname).toBe("/boutique-a");
  });

  it("does not double the slug when a site link already carries it (/:slug/catalogue)", async () => {
    mockResolveDomain({ success: true, data: { slug: "boutique-a" } });
    const { middleware } = await import("./middleware");

    for (const path of ["/boutique-a/catalogue", "/boutique-a"]) {
      const response = await middleware(
        new NextRequest(`http://www.masociete.com${path}`, { headers: { host: "www.masociete.com" } }),
      );
      expect(new URL(response.headers.get("x-middleware-rewrite") ?? "").pathname).toBe(path);
    }
  });

  it("does not rewrite a request on the platform's own shared host", async () => {
    mockResolveDomain({ success: true, data: { slug: "should-not-be-used" } });
    const { middleware } = await import("./middleware");

    const request = new NextRequest("http://localhost:3001/boutique-a", {
      headers: { host: "localhost:3001" },
    });
    const response = await middleware(request);

    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("falls through without rewriting when the domain isn't connected to any org", async () => {
    mockResolveDomain({ success: false });
    const { middleware } = await import("./middleware");

    const request = new NextRequest("http://unknown-domain.example.com/", {
      headers: { host: "unknown-domain.example.com" },
    });
    const response = await middleware(request);

    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("falls through without throwing when the resolve-domain API call itself fails", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network error")) as unknown as typeof fetch;
    const { middleware } = await import("./middleware");

    const request = new NextRequest("http://www.masociete.com/", {
      headers: { host: "www.masociete.com" },
    });
    const response = await middleware(request);

    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });
});
