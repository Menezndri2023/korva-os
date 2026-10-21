import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { createRef } from "react";
import { Input } from "./input.tsx";

afterEach(() => {
  cleanup();
});

describe("Input", () => {
  it("renders as an accessible textbox", () => {
    render(<Input aria-label="Email" />);
    expect(screen.getByRole("textbox", { name: "Email" })).toBeInTheDocument();
  });

  it("renders the given type", () => {
    render(<Input aria-label="Email" type="email" />);
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveAttribute("type", "email");
  });

  it("renders a placeholder", () => {
    render(<Input placeholder="vous@exemple.com" />);
    expect(screen.getByPlaceholderText("vous@exemple.com")).toBeInTheDocument();
  });

  it("renders a controlled value", () => {
    render(<Input aria-label="Email" value="ada@example.com" onChange={() => {}} />);
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue("ada@example.com");
  });

  it("renders a defaultValue", () => {
    render(<Input aria-label="Email" defaultValue="ada@example.com" />);
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue("ada@example.com");
  });

  it("respects disabled", () => {
    render(<Input aria-label="Email" disabled />);
    expect(screen.getByRole("textbox", { name: "Email" })).toBeDisabled();
  });

  it("merges a caller-supplied className without dropping the component's own classes", () => {
    render(<Input aria-label="Email" className="mt-1 w-full" />);
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveClass("mt-1", "w-full", "rounded-lg");
  });

  it("forwards a ref to the underlying native input (required for react-hook-form's register())", () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input aria-label="Email" ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it("is not aria-invalid when error is false (default)", () => {
    render(<Input aria-label="Email" />);
    expect(screen.getByRole("textbox", { name: "Email" })).not.toHaveAttribute("aria-invalid");
  });

  it("exposes aria-invalid=true and an error border when error is true", () => {
    render(<Input aria-label="Email" error />);
    const input = screen.getByRole("textbox", { name: "Email" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveClass("border-destructive");
  });

  it("applies the standard border color when there is no error", () => {
    render(<Input aria-label="Email" />);
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveClass("border-border-input");
  });

  it("applies a focus style class (keyboard-visible, not just a browser default)", () => {
    render(<Input aria-label="Email" />);
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveClass("focus:border-focus");
  });
});
