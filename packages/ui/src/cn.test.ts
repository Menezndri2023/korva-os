import { describe, it, expect } from "vitest";
import { cn } from "./cn.ts";

describe("cn", () => {
  it("concatenates simple class names", () => {
    expect(cn("px-2", "text-sm")).toBe("px-2 text-sm");
  });

  it("drops falsy values", () => {
    expect(cn("text-zinc-500", false && "text-red-500", undefined, null, "")).toBe(
      "text-zinc-500",
    );
  });

  it("resolves a conflicting Tailwind utility, keeping the last one", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
