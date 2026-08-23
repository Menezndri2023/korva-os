import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Card } from "./card.tsx";

afterEach(() => {
  cleanup();
});

describe("Card", () => {
  it("renders its children", () => {
    render(<Card>Contenu</Card>);
    expect(screen.getByText("Contenu")).toBeInTheDocument();
  });

  it("renders as a plain div", () => {
    render(<Card data-testid="card">Contenu</Card>);
    expect(screen.getByTestId("card").tagName).toBe("DIV");
  });

  it("applies the shared border/background/radius styling", () => {
    render(<Card data-testid="card">Contenu</Card>);
    expect(screen.getByTestId("card")).toHaveClass("rounded-lg", "border-border", "bg-surface");
  });

  it("merges a caller-supplied className without dropping the component's own classes", () => {
    render(
      <Card data-testid="card" className="p-6">
        Contenu
      </Card>,
    );
    const card = screen.getByTestId("card");
    expect(card).toHaveClass("p-6", "rounded-lg");
  });

  it("forwards native div props", () => {
    render(
      <Card data-testid="card" id="welcome-card">
        Contenu
      </Card>,
    );
    expect(screen.getByTestId("card")).toHaveAttribute("id", "welcome-card");
  });

  it("does not add any interactive role or tabindex on its own", () => {
    render(<Card data-testid="card">Contenu</Card>);
    const card = screen.getByTestId("card");
    expect(card).not.toHaveAttribute("role");
    expect(card).not.toHaveAttribute("tabindex");
  });
});
