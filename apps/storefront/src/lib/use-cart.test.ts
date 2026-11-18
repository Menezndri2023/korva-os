import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { lineKey, useCart } from "./use-cart";

const donation = { id: "don", name: "Don libre", pricing: { amount: 500 } };

describe("useCart — donations (Offer.freeAmount)", () => {
  it("keeps the chosen amount on the line, shown as its price", () => {
    const { result } = renderHook(() => useCart("asso-test-1"));
    act(() => result.current.addToCart(donation, undefined, undefined, 15000));
    expect(result.current.cart).toEqual([
      expect.objectContaining({ offerId: "don", amount: 15000, unitPrice: 15000, quantity: 1 }),
    ]);
  });

  it("makes two different amounts two lines, and the same amount one line of two", () => {
    const { result } = renderHook(() => useCart("asso-test-2"));
    act(() => result.current.addToCart(donation, undefined, undefined, 1000));
    act(() => result.current.addToCart(donation, undefined, undefined, 2000));
    act(() => result.current.addToCart(donation, undefined, undefined, 1000));
    expect(result.current.cart.map((line) => [line.amount, line.quantity])).toEqual([
      [1000, 2],
      [2000, 1],
    ]);
  });

  it("tells lines apart by amount, so removing one donation leaves the other", () => {
    expect(lineKey({ offerId: "don", amount: 1000 })).not.toBe(lineKey({ offerId: "don", amount: 2000 }));
    expect(lineKey({ offerId: "x" })).toBe(lineKey({ offerId: "x", amount: undefined }));
  });
});
