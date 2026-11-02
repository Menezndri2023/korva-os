"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { tradeVocabularyIn } from "@korva/types";
import { useActiveOrganization } from "@/lib/use-active-organization";
import { useDashboardLocale, useT } from "@/lib/dashboard-locale";

const TABS: { href: string; label: [string, string] }[] = [
  { href: "/dashboard/bookings", label: ["Réservations", "Bookings"] },
  { href: "/dashboard/bookings/resources", label: ["Équipe et ressources", "Team and resources"] },
  { href: "/dashboard/bookings/waitlist", label: ["Liste d'attente", "Waiting list"] },
  { href: "/dashboard/bookings/packages", label: ["Forfaits", "Packages"] },
];

export default function BookingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: organization } = useActiveOrganization();
  const locale = useDashboardLocale();
  const t = useT();
  // The trade's own word, as in the menu: "Rendez-vous" for a salon, "Visites" for an agency.
  const title = tradeVocabularyIn(organization?.businessModel, locale).bookings;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <nav className="mt-3 flex gap-1 overflow-x-auto border-b border-border">
          {TABS.map((tab, index) => (
            // The first tab is the bookings list itself: same word as the title.
            <Link
              key={tab.href}
              href={tab.href}
              className={`shrink-0 whitespace-nowrap px-3 py-2 text-sm font-medium ${
                pathname === tab.href
                  ? "border-b-2 border-primary text-text"
                  : "text-text-muted hover:text-text"
              }`}
            >
              {index === 0 ? title : t(...tab.label)}
            </Link>
          ))}
        </nav>
      </div>
      {children}
    </div>
  );
}
