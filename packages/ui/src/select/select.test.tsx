import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { createRef } from "react";
import { Select } from "./select.tsx";

afterEach(() => {
  cleanup();
});

describe("Select", () => {
  it("renders its options via an accessible combobox role", () => {
    render(
      <Select aria-label="Statut">
        <option value="open">Ouvert</option>
        <option value="won">Gagné</option>
      </Select>,
    );
    const select = screen.getByRole("combobox", { name: "Statut" });
    expect(select).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Gagné" })).toBeInTheDocument();
  });

  it("applies the default border-border-input style", () => {
    render(<Select aria-label="Statut" />);
    expect(screen.getByRole("combobox")).toHaveClass("border-border-input");
  });

  it("applies the error border style and aria-invalid when error is set", () => {
    render(<Select aria-label="Statut" error />);
    const select = screen.getByRole("combobox");
    expect(select).toHaveClass("border-destructive");
    expect(select).toHaveAttribute("aria-invalid", "true");
  });

  it("is not aria-invalid by default", () => {
    render(<Select aria-label="Statut" />);
    expect(screen.getByRole("combobox")).not.toHaveAttribute("aria-invalid");
  });

  it("respects disabled", () => {
    render(<Select aria-label="Statut" disabled />);
    expect(screen.getByRole("combobox")).toBeDisabled();
  });

  it("merges a caller-supplied className without dropping the component's own classes", () => {
    render(<Select aria-label="Statut" className="col-span-2" />);
    expect(screen.getByRole("combobox")).toHaveClass("col-span-2", "rounded-md");
  });

  it("forwards a ref to the underlying select element (required for react-hook-form register())", () => {
    const ref = createRef<HTMLSelectElement>();
    render(<Select aria-label="Statut" ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLSelectElement);
  });

  it("forwards native select props (e.g. onChange) to the underlying element", async () => {
    const onChange = vi.fn();
    render(
      <Select aria-label="Statut" onChange={onChange}>
        <option value="open">Ouvert</option>
        <option value="won">Gagné</option>
      </Select>,
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    select.value = "won";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onChange).toHaveBeenCalledOnce();
  });
});
