import { describe, it, expect, vi } from "vitest";
import DashboardCatchAll from "./page";

const notFoundMock = vi.fn();
vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
}));

describe("DashboardCatchAll", () => {
  it("calls notFound() for any unmatched /dashboard/* path", () => {
    DashboardCatchAll();

    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });
});
