import Link from "next/link";
import { MapPin, MessageCircle, Phone } from "lucide-react";
import { telLink, whatsappLink } from "@/lib/contact";
import type { PublicOrganization } from "@/lib/public-types";
import { KT } from "../kt-classes";
import type { SiteHeaderLink } from "./SiteHeader";
import { useT } from "@/lib/storefront-locale";

/**
 * Closes every template the same way: who the business is, and the same links as the header —
 * at the bottom of a long page on a phone, scrolling back up for "Suivre ma commande" is the
 * step people give up on.
 */
export function SiteFooter({
  organization,
  links,
}: {
  organization: PublicOrganization;
  links: SiteHeaderLink[];
}) {
  const t = useT();
  return (
    <footer className={`mt-auto border-t ${KT.border} ${KT.surface}`}>
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div className="max-w-sm">
          <p className={`text-lg font-semibold ${KT.headingFont}`}>{organization.name}</p>
          {organization.tagline && (
            <p className={`mt-1 text-sm leading-relaxed ${KT.textMuted}`}>{organization.tagline}</p>
          )}
          <ContactLines organization={organization} />
        </div>
        {links.length > 0 && (
          <nav aria-label={t("Liens utiles", "Useful links")} className={`flex flex-col gap-2 text-sm ${KT.textMuted}`}>
            {links.map((link) => (
              <Link key={link.href} href={link.href} className="hover:underline">
                {link.label}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </footer>
  );
}

/** Phone, WhatsApp and address, each only when the shop gave it. */
function ContactLines({ organization }: { organization: PublicOrganization }) {
  const { contactPhone, whatsappNumber, contactAddress } = organization;
  if (!contactPhone && !whatsappNumber && !contactAddress) return null;
  return (
    <ul className={`mt-4 space-y-2 text-sm ${KT.textMuted}`}>
      {contactPhone && (
        <li>
          <a href={telLink(contactPhone)} className="inline-flex items-center gap-2 hover:underline">
            <Phone aria-hidden className="h-4 w-4" />
            {contactPhone}
          </a>
        </li>
      )}
      {whatsappNumber && (
        <li>
          <a
            href={whatsappLink(whatsappNumber)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 hover:underline"
          >
            <MessageCircle aria-hidden className="h-4 w-4" />
            WhatsApp {whatsappNumber}
          </a>
        </li>
      )}
      {contactAddress && (
        <li className="flex items-start gap-2">
          <MapPin aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          {contactAddress}
        </li>
      )}
    </ul>
  );
}
