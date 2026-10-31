import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Switch } from "./switch.tsx";
import { FilterChips } from "../filter-chips/filter-chips.tsx";
import { Field, Textarea, fieldDescriptionId } from "../field/field.tsx";
import { SegmentedControl } from "../tabs/tabs.tsx";

afterEach(() => {
  cleanup();
});

describe("Switch", () => {
  it("is a labelled switch that reports the opposite state when clicked", () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onChange} label="Retrait automatique" />);
    const control = screen.getByRole("switch", { name: "Retrait automatique" });
    expect(control).toHaveAttribute("aria-checked", "false");
    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("FilterChips", () => {
  it("marks the selected chip and shows counts", () => {
    const onChange = vi.fn();
    render(
      <FilterChips
        aria-label="Filtrer"
        value="all"
        onChange={onChange}
        options={[
          { value: "all", label: "Toutes" },
          { value: "todo", label: "À valider", count: 3 },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "Toutes" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /À valider/ }));
    expect(onChange).toHaveBeenCalledWith("todo");
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});

describe("SegmentedControl", () => {
  it("presses the current option", () => {
    render(
      <SegmentedControl
        aria-label="Période"
        value="30"
        onChange={() => {}}
        options={[
          { value: "7", label: "7 jours" },
          { value: "30", label: "30 jours" },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "30 jours" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("Field", () => {
  it("labels its control and announces an error in place of the help", () => {
    render(
      <Field id="note" label="Note" help="Visible par vous seul." error="Trop longue.">
        <Textarea id="note" error aria-describedby={fieldDescriptionId("note")} />
      </Field>,
    );
    const control = screen.getByLabelText("Note");
    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Trop longue.");
    expect(screen.queryByText("Visible par vous seul.")).not.toBeInTheDocument();
  });
});
