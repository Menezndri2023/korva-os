import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { ErrorReporter, reportClientError } from "./error-reporter";

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

  it("adds Next's digest, the key to the server's log line for a server-rendering crash", () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const error = Object.assign(new Error("An error occurred in the Server Components render"), { digest: "4242" });
    reportClientError("https://api.test/client-errors", "web", error);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as { message: string };
    expect(body.message).toBe("An error occurred in the Server Components render [digest 4242]");
    vi.unstubAllGlobals();
  });
});
