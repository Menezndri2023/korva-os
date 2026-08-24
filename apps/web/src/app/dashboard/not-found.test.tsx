import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DashboardNotFound from "./not-found";

describe("DashboardNotFound", () => {
  it("shows a not-found message and a link back to the dashboard", () => {
    render(<DashboardNotFound />);

    expect(screen.getByRole("heading", { name: "Page introuvable" })).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Retour au tableau de bord" });
    expect(link).toHaveAttribute("href", "/dashboard");
  });
});
