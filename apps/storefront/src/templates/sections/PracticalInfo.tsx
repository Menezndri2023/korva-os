"use client";

import { CalendarCheck, MessageCircle, Truck, Wallet } from "lucide-react";
import type { PublicOrganization } from "@/lib/public-types";
import { useT } from "@/lib/storefront-locale";
import { KT } from "../kt-classes";

/**
 * "Bon à savoir": the three answers a visitor looks for before ordering or booking — how to pay,
 * how they will get it, how to reach the business — read from the business's own settings, so
 * the site never promises what the business did not choose. Shown under the hero of every
 * template; renders nothing when there is nothing true to say.
 */
export function PracticalInfo({
  organization,
  commerceEnabled,
  bookingEnabled,
}: {
  organization: PublicOrganization;
  commerceEnabled: boolean;
  bookingEnabled: boolean;
}) {
  const t = useT();
  const items: { icon: typeof Wallet; title: string; text: string }[] = [];

  const online = organization.acceptedPaymentMethods.includes("online");
  const cash = organization.acceptedPaymentMethods.includes("cash");
  if (commerceEnabled && (online || cash)) {
    items.push({
      icon: Wallet,
      title: t("Paiement", "Payment"),
      text: [
        online ? t("Wave, Orange Money, MTN, Moov ou carte", "Wave, Orange Money, MTN, Moov or card") : null,
        cash ? t("espèces", "cash") : null,
      ]
        .filter(Boolean)
        .join(t(" ou ", " or ")),
    });
  }

  const modes = organization.fulfillmentModes ?? [];
  if (commerceEnabled && modes.length > 0) {
    items.push({
      icon: Truck,
      title: t("Réception", "Receiving"),
      text: modes
        .map((mode) =>
          mode === "delivery"
            ? t("livraison", "delivery")
            : mode === "pickup"
              ? t("retrait sur place", "collection")
              : t("sur place", "eat in"),
        )
        .join(", "),
    });
  }

  if (bookingEnabled) {
    items.push({
      icon: CalendarCheck,
      title: t("Réservation", "Booking"),
      text: t("en ligne, à l'heure qui vous convient", "online, at the time that suits you"),
    });
  }

  if (organization.whatsappNumber) {
    items.push({
      icon: MessageCircle,
      title: t("Une question ?", "A question?"),
      text: t(`WhatsApp ${organization.whatsappNumber}`, `WhatsApp ${organization.whatsappNumber}`),
    });
  }

  if (items.length === 0) return null;
  return (
    <section aria-label={t("Bon à savoir", "Good to know")} className={`rounded-2xl border ${KT.border} ${KT.surface}`}>
      <ul className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:flex-wrap sm:gap-x-10">
        {items.map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex items-start gap-3">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${KT.accentSoftBg} ${KT.accentText}`}>
              <Icon aria-hidden className="h-4 w-4" />
            </span>
            <span className="min-w-0 text-sm">
              <span className="block font-semibold">{title}</span>
              <span className={`block first-letter:uppercase ${KT.textMuted}`}>{text}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
