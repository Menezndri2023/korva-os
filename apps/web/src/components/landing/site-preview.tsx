import type { CSSProperties } from "react";
import { ShoppingBag } from "lucide-react";
import {
  BUSINESS_MODEL_DEFINITIONS,
  STOREFRONT_PALETTES,
  businessModelText,
  getStorefrontTemplate,
  verticalText,
  type Locale,
  type OfferType,
  type VerticalTemplate,
} from "@korva/types";
import { STOREFRONT_TEMPLATE_TEXT_EN } from "@/lib/landing-content";

/**
 * A phone showing the public site the visitor's trade gets, drawn in HTML from the same data
 * onboarding uses: the trade's default template, that template's first palette, and the offers
 * the catalogue suggests for the trade. Pick "Restaurant" and the phone turns terracotta and lists
 * a plat du jour; pick "Salon" and it shows coral and "Réserver".
 *
 * HTML rather than a screenshot: it costs nothing on metered mobile data, it can never drift from
 * the real templates' colours, and it answers the visitor's actual question — "à quoi ressemblera
 * MON site ?" — instead of showing someone else's.
 *
 * Colours go through CSS variables on an inline style. apps/web's CSP keeps 'unsafe-inline' for
 * style-src (see middleware.ts), and the values are our own palette constants, never input.
 */

const ACTION_LABEL: Record<Locale, Record<OfferType, string>> = {
  fr: {
    booking: "Réserver",
    product: "Ajouter",
    service: "Devis",
    package: "Ajouter",
    digital_product: "Acheter",
    subscription: "S'abonner",
  },
  en: {
    booking: "Book",
    product: "Add",
    service: "Quote",
    package: "Add",
    digital_product: "Buy",
    subscription: "Subscribe",
  },
};

export function SitePreview({ vertical, locale = "fr" }: { vertical: VerticalTemplate; locale?: Locale }) {
  const words = verticalText(vertical, locale);
  const template = getStorefrontTemplate(vertical.defaultStorefrontTemplate);
  const palette = STOREFRONT_PALETTES[template.palettes[0] ?? "graphite"];
  const model = businessModelText(BUSINESS_MODEL_DEFINITIONS[vertical.businessModel], locale);
  const primaryChannel = BUSINESS_MODEL_DEFINITIONS[vertical.businessModel].primaryChannel;
  const offers = (vertical.suggestedOffers ?? []).slice(0, 4);
  const sellsOnline = primaryChannel === "orders";

  const vars = {
    "--p-bg": palette.background,
    "--p-surface": palette.surface,
    "--p-border": palette.border,
    "--p-text": palette.text,
    "--p-muted": palette.textMuted,
    "--p-accent": palette.accent,
    "--p-on-accent": palette.accentContrast,
  } as CSSProperties;

  return (
    <figure className="mx-auto w-full max-w-[17.5rem]">
      <div
        aria-hidden="true"
        style={vars}
        className="relative overflow-hidden rounded-[2.25rem] border-[6px] border-ink-soft bg-[var(--p-bg)] text-[var(--p-text)] shadow-2xl ring-1 ring-white/10 transition-colors duration-300"
      >
        {/* The notch */}
        <div className="absolute left-1/2 top-1.5 z-10 h-4 w-20 -translate-x-1/2 rounded-full bg-ink-soft" />

        <div className="flex items-center gap-2 border-b border-[var(--p-border)] bg-[var(--p-surface)] px-3.5 pb-2.5 pt-7">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--p-accent)] text-[11px] font-bold text-[var(--p-on-accent)]">
            {words.label.charAt(0)}
          </span>
          <span className="truncate text-xs font-semibold">{words.label}</span>
          {sellsOnline && (
            <span className="ml-auto flex h-6 w-6 items-center justify-center rounded-full bg-[var(--p-accent)]/15">
              <ShoppingBag className="h-3.5 w-3.5" />
            </span>
          )}
        </div>

        <div className="bg-[var(--p-accent)] px-4 py-6 text-[var(--p-on-accent)]">
          <p className="text-base font-semibold leading-tight">{model.siteKind}</p>
          <p className="mt-1 text-[11px] opacity-85">{words.description}</p>
        </div>

        <ul className="space-y-2 px-3 py-3">
          {offers.map((offer) => (
            <li
              key={offer.name}
              className="flex items-center gap-2.5 rounded-xl border border-[var(--p-border)] bg-[var(--p-surface)] p-2"
            >
              <span className="h-9 w-9 shrink-0 rounded-lg bg-[var(--p-accent)]/15" />
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{words.offerName(offer.name)}</span>
              <span className="shrink-0 rounded-md bg-[var(--p-accent)] px-2 py-1 text-[10px] font-semibold text-[var(--p-on-accent)]">
                {ACTION_LABEL[locale][offer.type]}
              </span>
            </li>
          ))}
        </ul>

        <div className="px-3 pb-4 pt-1">
          <div className="h-2 w-2/3 rounded-full bg-[var(--p-border)]" />
          <div className="mt-1.5 h-2 w-1/2 rounded-full bg-[var(--p-border)]" />
        </div>
      </div>
      <figcaption className="mt-4 text-center text-sm text-ink-muted">
        {locale === "en"
          ? `Your website, “${(STOREFRONT_TEMPLATE_TEXT_EN[template.key] ?? template).label}” template`
          : `Votre site, modèle « ${template.label} »`}
      </figcaption>
    </figure>
  );
}
