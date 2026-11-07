import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { ErrorReporter } from "./error-reporter";

describe("ErrorReporter", () => {
  it("sends an uncaught error once, with the page's path only", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    window.history.pushState({}, "", "/boutique/track?email=fatou@example.com");
    render(<ErrorReporter endpoint="https://api.test/client-errors" app="storefront" />);
    const error = new Error("boom");
    window.dispatchEvent(new ErrorEvent("error", { error, message: "boom" }));
    window.dispatchEvent(new ErrorEvent("error", { error, message: "boom" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as { path: string; app: string; message: string };
    expect(body).toMatchObject({ app: "storefront", message: "boom", path: "/boutique/track" });
    vi.unstubAllGlobals();
  });
});
