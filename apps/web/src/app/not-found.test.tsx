import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import NotFound from "./not-found";

describe("NotFound (root)", () => {
  it("shows a not-found message and a link back to the app root", () => {
    render(<NotFound />);

    expect(screen.getByRole("heading", { name: "Page introuvable" })).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Retour à l'accueil" });
    expect(link).toHaveAttribute("href", "/");
  });
});
