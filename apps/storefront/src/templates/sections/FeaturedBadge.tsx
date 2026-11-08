"use client";

import { Heart } from "lucide-react";
import type { PublicOffer } from "@/lib/public-types";
import { useT } from "@/lib/storefront-locale";
import { KT } from "../kt-classes";

/** « Coup de cœur » above an offer's name — the API only sends `featured` on Pro and above. */
export function FeaturedBadge({ offer }: { offer: Pick<PublicOffer, "featured"> }) {
  const t = useT();
  if (!offer.featured) return null;
  return (
    <span
      className={`mb-1 flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold no-underline ${KT.accentBg} ${KT.accentContrastText}`}
    >
      <Heart aria-hidden className="h-3 w-3 fill-current" />
      {t("Coup de cœur", "Our favourite")}
    </span>
  );
}
