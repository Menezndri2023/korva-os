"use client";

import { MessageCircle } from "lucide-react";
import { whatsappLink } from "@/lib/contact";
import { useT } from "@/lib/storefront-locale";

/**
 * A round WhatsApp button in the corner of every page of a shop that gave its number. In the
 * markets KORVA serves, WhatsApp is where a customer asks a question before buying — a site that
 * only offers a form loses that conversation.
 *
 * WhatsApp's own green on purpose: it is recognised at a glance, whatever the shop's palette.
 * `raised` lifts it above the phone cart bar (MobileCartBar) when that bar is showing.
 */
export function WhatsAppButton({
  number,
  shopName,
  raised = false,
}: {
  number: string;
  shopName: string;
  raised?: boolean;
}) {
  const t = useT();
  return (
    <a
      href={whatsappLink(number, `Bonjour ${shopName}, `)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t(`Écrire à ${shopName} sur WhatsApp`, `Message ${shopName} on WhatsApp`)}
      className={`fixed right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-xl transition-transform hover:scale-105 md:bottom-6 ${
        raised ? "bottom-24" : "bottom-4"
      }`}
    >
      <MessageCircle aria-hidden className="h-7 w-7" />
    </a>
  );
}
