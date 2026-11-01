import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAuthStore } from "./auth-store";
import { getRefreshedAccessToken } from "./api-client";

/**
 * "Voir son tableau de bord" in the browser: the view lives in the tab's memory only. It must
 * never overwrite the session this browser has saved (the administrator's own, or the owner's on
 * a shared computer), and never be refreshed into whatever session the cookie holds.
 */
describe("read-only administration view", () => {
  const writes: string[] = [];

  beforeEach(() => {
    writes.length = 0;
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: (name: string) => writes.push(name),
      removeItem: (name: string) => writes.push(`remove:${name}`),
    });
  });

  it("keeps the view in memory, never in the saved session, even after it is closed", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    useAuthStore.getState().enterViewMode({
      accessToken: "view-token",
      organizationId: "org-1",
      expiresAt: "2026-11-01T15:00:00.000Z",
      user: { id: "u-1", email: "awa@salon.ci" },
    });
    expect(useAuthStore.getState()).toMatchObject({
      accessToken: "view-token",
      activeOrganizationId: "org-1",
      bootstrapped: true,
      viewOnly: { expiresAt: "2026-11-01T15:00:00.000Z" },
    });

    useAuthStore.getState().setActiveOrganization("org-2");
    useAuthStore.getState().clear();
    expect(writes).toEqual([]);

    await expect(getRefreshedAccessToken()).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
