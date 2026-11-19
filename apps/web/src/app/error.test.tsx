import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GlobalError from "./error";

describe("GlobalError (root)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a retry action and calls retry() when clicked", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const retry = vi.fn();
    const user = userEvent.setup();
    render(<GlobalError error={new Error("boom")} retry={retry} />);

    expect(screen.getByRole("heading", { name: "Une erreur est survenue" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Réessayer" }));

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("logs the error for diagnostics", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("boom");
    render(<GlobalError error={error} retry={vi.fn()} />);

    expect(errorSpy).toHaveBeenCalledWith(error);
  });
});
