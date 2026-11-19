import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { StorefrontLocaleProvider } from "@/lib/storefront-locale";
import SiteError from "./error";

vi.mock("next/navigation", () => ({ useParams: () => ({ slug: "chez-awa" }) }));

describe("SiteError", () => {
  it("reports the crash, offers a retry and the way back, in the site's language", () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const retry = vi.fn();
    render(
      <StorefrontLocaleProvider locale="en">
        <SiteError error={new Error("render crash")} retry={retry} />
      </StorefrontLocaleProvider>,
    );
    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to the site's home" }).getAttribute("href")).toBe("/chez-awa");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as { app: string; message: string };
    expect(body).toMatchObject({ app: "storefront", message: "render crash" });
    vi.unstubAllGlobals();
  });
});
