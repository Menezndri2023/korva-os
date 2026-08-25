import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Dialog } from "./dialog.tsx";

afterEach(() => {
  cleanup();
});

describe("Dialog", () => {
  it("renders nothing when closed", () => {
    render(
      <Dialog open={false} onClose={vi.fn()} title="Confirmer">
        Contenu
      </Dialog>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders its content via an accessible dialog role when open", () => {
    render(
      <Dialog open onClose={vi.fn()} title="Confirmer">
        Contenu du dialogue
      </Dialog>,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Contenu du dialogue")).toBeInTheDocument();
  });

  it("labels the dialog via aria-labelledby when a title is given", () => {
    render(
      <Dialog open onClose={vi.fn()} title="Supprimer l'offre ?">
        Contenu
      </Dialog>,
    );
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Supprimer l'offre ?");
  });

  it("calls onClose when the backdrop is clicked", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Confirmer">
        Contenu
      </Dialog>,
    );
    // The backdrop is the first fixed inset-0 element rendered before the dialog panel.
    const backdrop = document.querySelector('[aria-hidden="true"]');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as Element);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not call onClose when the dialog panel itself is clicked", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Confirmer">
        Contenu
      </Dialog>,
    );
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose when Escape is pressed while open", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Confirmer">
        Contenu
      </Dialog>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not call onClose on Escape when closed", () => {
    const onClose = vi.fn();
    render(
      <Dialog open={false} onClose={onClose} title="Confirmer">
        Contenu
      </Dialog>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders without a title when none is given", () => {
    render(
      <Dialog open onClose={vi.fn()}>
        Contenu seul
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).not.toHaveAttribute("aria-labelledby");
    expect(screen.getByText("Contenu seul")).toBeInTheDocument();
  });
});
