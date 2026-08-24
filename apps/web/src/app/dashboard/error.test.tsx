import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DashboardError from "./error";

describe("DashboardError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a retry action and calls reset() when clicked", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reset = vi.fn();
    const user = userEvent.setup();
    render(<DashboardError error={new Error("boom")} reset={reset} />);

    expect(screen.getByRole("heading", { name: "Une erreur est survenue" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Réessayer" }));

    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("logs the error for diagnostics", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("boom");
    render(<DashboardError error={error} reset={vi.fn()} />);

    expect(errorSpy).toHaveBeenCalledWith(error);
  });
});
