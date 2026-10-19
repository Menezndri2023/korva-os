import { describe, expect, it } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderHook, act } from "@testing-library/react";
import type { OfferOptionGroup } from "@korva/types";
import {
  missingRequiredGroups,
  OfferOptionsPicker,
  summarizeOptions,
} from "./OfferOptionsPicker";
import { useCart } from "@/lib/use-cart";

const groups: OfferOptionGroup[] = [
  {
    id: "size",
    name: "Taille",
    required: true,
    maxChoices: 1,
    options: [
      { id: "small", name: "Petit", priceDelta: 0 },
      { id: "large", name: "Grand", priceDelta: 500 },
    ],
  },
  {
    id: "extras",
    name: "Suppléments",
    required: false,
    maxChoices: 2,
    options: [
      { id: "egg", name: "Œuf", priceDelta: 200 },
      { id: "chili", name: "Piment", priceDelta: 0 },
      { id: "fish", name: "Poisson", priceDelta: 700 },
    ],
  },
];

function Harness() {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <>
      <OfferOptionsPicker groups={groups} selected={selected} onChange={setSelected} currency="XOF" />
      <output data-testid="selected">{selected.join(",")}</output>
      <output data-testid="missing">{missingRequiredGroups(groups, selected).join(",")}</output>
    </>
  );
}

describe("OfferOptionsPicker", () => {
  it("keeps one choice in a single-choice group and caps a multiple-choice group", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByTestId("missing")).toHaveTextContent("Taille");

    await user.click(screen.getByRole("radio", { name: /Petit/ }));
    await user.click(screen.getByRole("radio", { name: /Grand/ }));
    expect(screen.getByTestId("selected")).toHaveTextContent("large");
    expect(screen.getByTestId("missing")).toBeEmptyDOMElement();

    await user.click(screen.getByRole("checkbox", { name: /Œuf/ }));
    await user.click(screen.getByRole("checkbox", { name: /Piment/ }));
    expect(screen.getByRole("checkbox", { name: /Poisson/ })).toBeDisabled();
    expect(screen.getByTestId("selected")).toHaveTextContent("large,egg,chili");
  });

  it("summarises names in group order with the added price", () => {
    expect(summarizeOptions(groups, ["egg", "large"])).toEqual({
      ids: ["large", "egg"],
      labels: ["Grand", "Œuf"],
      priceDelta: 700,
    });
  });
});

describe("useCart with options", () => {
  it("keeps differently-optioned items on separate lines and merges identical ones", () => {
    const { result } = renderHook(() => useCart("maquis"));
    const offer = { id: "garba", name: "Garba", pricing: { amount: 2500 } };

    act(() => result.current.addToCart(offer, undefined, summarizeOptions(groups, ["large", "egg"])));
    act(() => result.current.addToCart(offer, undefined, summarizeOptions(groups, ["egg", "large"])));
    act(() => result.current.addToCart(offer, undefined, summarizeOptions(groups, ["small"])));

    expect(result.current.cart).toEqual([
      expect.objectContaining({
        name: "Garba (Grand, Œuf)",
        unitPrice: 3200,
        quantity: 2,
        optionIds: ["egg", "large"],
      }),
      expect.objectContaining({ name: "Garba (Petit)", unitPrice: 2500, quantity: 1 }),
    ]);
  });
});
