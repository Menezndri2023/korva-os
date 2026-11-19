"use client";

import { offerAttributeText, offerFieldKind } from "@korva/types";
import type { PublicOffer } from "@/lib/public-types";
import { intlLocale, useStorefrontLocale } from "@/lib/storefront-locale";
import { KT } from "../kt-classes";

/**
 * An offer's characteristics, in the site's language: guided labels and options are stored in
 * French and translated here for an English site; a guided date ("Disponible à partir du") is
 * written the local way. Whatever the owner typed themselves is shown as typed.
 */
export function OfferAttributes({ attributes }: { attributes: PublicOffer["attributes"] }) {
  const locale = useStorefrontLocale();
  if (!attributes || Object.keys(attributes).length === 0) return null;
  return (
    <dl className={`mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-2xl border p-4 text-sm ${KT.border} ${KT.surface}`}>
      {Object.entries(attributes).map(([key, raw]) => {
        const { label, value } = offerAttributeText(key, raw, locale);
        return (
          <div key={key} className="contents">
            <dt className={KT.textMuted}>{label}</dt>
            <dd className="font-medium">{offerFieldKind(key) === "date" ? formatDate(value, locale) : value}</dd>
          </div>
        );
      })}
    </dl>
  );
}

/** "2026-12-01" → "1 déc. 2026" / "1 Dec 2026" (the site's en-GB); anything else as typed. */
function formatDate(value: string, locale: "fr" | "en"): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(intlLocale(locale), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
