"use client";

import { ShoppingBag } from "lucide-react";
import { KT } from "../kt-classes";
import { useT } from "@/lib/storefront-locale";

/**
 * On a phone, once something is in the cart, a bar along the bottom of the screen leads to the
 * checkout — where a thumb already is, instead of the small header icon at the top of a page
 * that may be long scrolled away. Hidden from `md:` up, where the header is always in reach.
 *
 * Renders a spacer of its own height so the bar never covers the end of the page.
 */
export function MobileCartBar({
  cartCount,
  onOpenCheckout,
}: {
  cartCount: number;
  onOpenCheckout: () => void;
}) {
  const t = useT();
  if (cartCount === 0) return null;
  return (
    <>
      <div aria-hidden className="h-20 md:hidden" />
      <div className="fixed inset-x-0 bottom-0 z-30 p-3 md:hidden">
        <button
          type="button"
          onClick={onOpenCheckout}
          className={`flex w-full items-center justify-between rounded-2xl px-5 py-3.5 text-sm font-semibold shadow-2xl ${KT.accentBg} ${KT.accentContrastText}`}
        >
          <span className="inline-flex items-center gap-2">
            <ShoppingBag aria-hidden className="h-5 w-5" />
            {t(`${cartCount} article${cartCount > 1 ? "s" : ""}`, `${cartCount} item${cartCount > 1 ? "s" : ""}`)}
          </span>
          <span>{t("Voir le panier", "View the basket")}</span>
        </button>
      </div>
    </>
  );
}
