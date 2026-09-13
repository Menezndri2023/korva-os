import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SectionHeading } from "./SectionHeading";

describe("SectionHeading", () => {
  it("renders the eyebrow label and the title as a heading", () => {
    render(<SectionHeading eyebrow="À propos" title="Notre histoire" />);
    expect(screen.getByText("À propos")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Notre histoire" })).toBeInTheDocument();
  });
});
