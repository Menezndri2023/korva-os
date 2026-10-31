import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Button } from "./button.tsx";

afterEach(() => {
  cleanup();
});

describe("Button", () => {
  it("renders its children via an accessible button role", () => {
    render(<Button>Envoyer</Button>);
    expect(screen.getByRole("button", { name: "Envoyer" })).toBeInTheDocument();
  });

  it("defaults to type=button", () => {
    render(<Button>Envoyer</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });

  it("accepts an explicit type=submit", () => {
    render(<Button type="submit">Envoyer</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "submit");
  });

  it("applies the primary variant by default", () => {
    render(<Button>Envoyer</Button>);
    expect(screen.getByRole("button")).toHaveClass("bg-action", "text-on-action");
  });

  it("applies the secondary variant", () => {
    render(<Button variant="secondary">Envoyer</Button>);
    expect(screen.getByRole("button")).toHaveClass("border-border-input");
  });

  it("applies the ghost variant", () => {
    render(<Button variant="ghost">Envoyer</Button>);
    expect(screen.getByRole("button")).toHaveClass("text-text-muted");
  });

  it("applies the sm size", () => {
    render(<Button size="sm">Envoyer</Button>);
    expect(screen.getByRole("button")).toHaveClass("min-h-9", "px-3");
  });

  it("applies the md size by default", () => {
    render(<Button>Envoyer</Button>);
    expect(screen.getByRole("button")).toHaveClass("min-h-11", "px-4");
  });

  it("applies the lg size", () => {
    render(<Button size="lg">Envoyer</Button>);
    expect(screen.getByRole("button")).toHaveClass("min-h-12", "px-5");
  });

  it("respects disabled", () => {
    render(<Button disabled>Envoyer</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("disables the button and exposes aria-busy when loading", () => {
    render(<Button loading>Envoyer</Button>);
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("is not aria-busy when not loading", () => {
    render(<Button>Envoyer</Button>);
    expect(screen.getByRole("button")).not.toHaveAttribute("aria-busy");
  });

  it("merges a caller-supplied className without dropping the component's own classes", () => {
    render(<Button className="mt-4">Envoyer</Button>);
    expect(screen.getByRole("button")).toHaveClass("mt-4", "bg-action");
  });

  it("forwards native button props (e.g. onClick) to the underlying element", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Envoyer</Button>);
    screen.getByRole("button").click();
    expect(onClick).toHaveBeenCalledOnce();
  });
});
