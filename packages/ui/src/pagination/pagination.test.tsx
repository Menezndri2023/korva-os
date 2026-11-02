import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Pagination } from "./pagination.tsx";
import { UiLocaleProvider } from "../ui-locale.tsx";

afterEach(() => {
  cleanup();
});

describe("Pagination", () => {
  it("speaks English inside an English UiLocaleProvider", () => {
    render(
      <UiLocaleProvider locale="en">
        <Pagination page={2} totalPages={5} onPageChange={vi.fn()} />
      </UiLocaleProvider>,
    );
    expect(screen.getByText("Page 2 of 5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
  });

  it("shows the current page and the total number of pages", () => {
    render(<Pagination page={2} totalPages={5} onPageChange={vi.fn()} />);
    expect(screen.getByText("Page 2 sur 5")).toBeInTheDocument();
  });

  it("calls onPageChange with page - 1 when Précédent is clicked", () => {
    const onPageChange = vi.fn();
    render(<Pagination page={2} totalPages={5} onPageChange={onPageChange} />);

    screen.getByRole("button", { name: "Précédent" }).click();

    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it("calls onPageChange with page + 1 when Suivant is clicked", () => {
    const onPageChange = vi.fn();
    render(<Pagination page={2} totalPages={5} onPageChange={onPageChange} />);

    screen.getByRole("button", { name: "Suivant" }).click();

    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it("disables Précédent on the first page", () => {
    render(<Pagination page={1} totalPages={5} onPageChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Précédent" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Suivant" })).not.toBeDisabled();
  });

  it("disables Suivant on the last page", () => {
    render(<Pagination page={5} totalPages={5} onPageChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Suivant" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Précédent" })).not.toBeDisabled();
  });

  it("disables both buttons when there is only one page", () => {
    render(<Pagination page={1} totalPages={1} onPageChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Précédent" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Suivant" })).toBeDisabled();
  });

  it("disables both buttons when the disabled prop is set, even mid-range", () => {
    render(<Pagination page={2} totalPages={5} onPageChange={vi.fn()} disabled />);
    expect(screen.getByRole("button", { name: "Précédent" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Suivant" })).toBeDisabled();
  });

  it("treats totalPages of 0 (no results) the same as 1: page 1 of 1, both buttons disabled", () => {
    render(<Pagination page={1} totalPages={0} onPageChange={vi.fn()} />);
    expect(screen.getByText("Page 1 sur 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Précédent" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Suivant" })).toBeDisabled();
  });
});
