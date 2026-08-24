import "./test-localstorage-shim"; // must load before auth-store.ts — see that file's comment
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAuthReady } from "./use-auth-ready";
import { useAuthStore } from "./auth-store";

describe("useAuthReady", () => {
  beforeEach(() => {
    useAuthStore.setState({
      accessToken: null,
      user: null,
      activeOrganizationId: null,
      bootstrapped: false,
    });
  });

  it("is false before bootstrap has resolved, even with a persisted organization id", () => {
    useAuthStore.setState({ bootstrapped: false, activeOrganizationId: "org-1" });
    const { result } = renderHook(() => useAuthReady());
    expect(result.current).toBe(false);
  });

  it("is false once bootstrapped if there is no active organization (logged out / onboarding)", () => {
    useAuthStore.setState({ bootstrapped: true, activeOrganizationId: null });
    const { result } = renderHook(() => useAuthReady());
    expect(result.current).toBe(false);
  });

  it("is true once bootstrap has resolved and an organization is active", () => {
    useAuthStore.setState({ bootstrapped: true, activeOrganizationId: "org-1" });
    const { result } = renderHook(() => useAuthReady());
    expect(result.current).toBe(true);
  });

  it("flips from false to true as the store transitions, without a remount", () => {
    const { result, rerender } = renderHook(() => useAuthReady());
    expect(result.current).toBe(false);

    useAuthStore.setState({ bootstrapped: true, activeOrganizationId: "org-1" });
    rerender();

    expect(result.current).toBe(true);
  });
});
