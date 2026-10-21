import Link from "next/link";
import type { PublicOrganization } from "@/lib/public-types";
import { KT } from "../kt-classes";
import type { SiteHeaderLink } from "./SiteHeader";

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
  return (
    <footer className={`mt-auto border-t ${KT.border} ${KT.surface}`}>
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div className="max-w-sm">
          <p className={`text-lg font-semibold ${KT.headingFont}`}>{organization.name}</p>
          {organization.tagline && (
            <p className={`mt-1 text-sm leading-relaxed ${KT.textMuted}`}>{organization.tagline}</p>
          )}
        </div>
        {links.length > 0 && (
          <nav aria-label="Liens utiles" className={`flex flex-col gap-2 text-sm ${KT.textMuted}`}>
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
