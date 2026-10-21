// @vitest-environment node
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

function directives(): Map<string, string> {
  const response = middleware(new NextRequest("http://localhost:3000/dashboard"));
  const csp = response.headers.get("Content-Security-Policy") ?? "";
  return new Map(
    csp.split(";").map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name!, values.join(" ")];
    }),
  );
}

describe("dashboard Content-Security-Policy", () => {
  it("lets the dashboard show uploaded photos, typed image addresses and local previews", () => {
    const imgSrc = directives().get("img-src") ?? "";
    // Uploaded photos come from the API's own origin — blocked until 2026-10-21.
    expect(imgSrc).toContain("http://localhost:4000");
    expect(imgSrc).toContain("https:");
    expect(imgSrc).toContain("blob:");
  });

  it("lets the kitchen screen open its live connection to the API", () => {
    expect(directives().get("connect-src")).toContain("ws://localhost:4000");
  });

  it("lets Settings frame the owner's own site for the live preview", () => {
    expect(directives().get("frame-src")).toContain("http://localhost:3001");
  });

  it("still allows no third-party script and no framing of the dashboard itself", () => {
    const all = directives();
    expect(all.get("script-src")).not.toContain("https:");
    expect(all.get("frame-ancestors")).toBe("'none'");
    expect(all.get("object-src")).toBe("'none'");
  });
});
