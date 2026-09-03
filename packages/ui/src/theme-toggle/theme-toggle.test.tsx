import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ThemeToggle } from "./theme-toggle.tsx";

afterEach(() => {
  cleanup();
});

describe("ThemeToggle", () => {
  it("labels itself as switching to dark when currently light", () => {
    render(<ThemeToggle theme="light" onToggle={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Passer au thème sombre" })).toBeInTheDocument();
  });

  it("labels itself as switching to light when currently dark", () => {
    render(<ThemeToggle theme="dark" onToggle={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Passer au thème clair" })).toBeInTheDocument();
  });

  it("calls onToggle when clicked", () => {
    const onToggle = vi.fn();
    render(<ThemeToggle theme="light" onToggle={onToggle} />);
    screen.getByRole("button").click();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
