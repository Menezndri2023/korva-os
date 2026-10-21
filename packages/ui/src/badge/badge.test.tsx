import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Badge } from "./badge.tsx";

afterEach(() => {
  cleanup();
});

describe("Badge", () => {
  it("renders its children", () => {
    render(<Badge>Actif</Badge>);
    expect(screen.getByText("Actif")).toBeInTheDocument();
  });

  it("applies the default variant by default", () => {
    render(<Badge>Statut</Badge>);
    expect(screen.getByText("Statut")).toHaveClass("bg-surface-muted", "text-badge-text");
  });

  it("applies the success variant", () => {
    render(<Badge variant="success">Actif</Badge>);
    expect(screen.getByText("Actif")).toHaveClass("bg-success-soft", "text-success");
  });

  it("applies the warning variant", () => {
    render(<Badge variant="warning">Brouillon</Badge>);
    expect(screen.getByText("Brouillon")).toHaveClass("bg-warning-soft", "text-warning");
  });

  it("applies the destructive variant", () => {
    render(<Badge variant="destructive">Erreur</Badge>);
    expect(screen.getByText("Erreur")).toHaveClass("bg-destructive-soft", "text-destructive");
  });

  it("merges a caller-supplied className without dropping the component's own classes", () => {
    render(<Badge className="ml-2">Actif</Badge>);
    expect(screen.getByText("Actif")).toHaveClass("ml-2", "rounded-full");
  });

  it("forwards native span props", () => {
    render(
      <Badge data-testid="badge" title="statut actif">
        Actif
      </Badge>,
    );
    expect(screen.getByTestId("badge")).toHaveAttribute("title", "statut actif");
  });

  it("renders as a plain span, accessible via its visible text", () => {
    render(<Badge>Actif</Badge>);
    expect(screen.getByText("Actif").tagName).toBe("SPAN");
  });
});
