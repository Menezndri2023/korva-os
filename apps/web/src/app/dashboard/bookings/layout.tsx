"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { tradeVocabulary } from "@korva/types";
import { useActiveOrganization } from "@/lib/use-active-organization";

const TABS = [
  { href: "/dashboard/bookings", label: "Réservations" },
  { href: "/dashboard/bookings/resources", label: "Équipe et ressources" },
  { href: "/dashboard/bookings/waitlist", label: "Liste d'attente" },
  { href: "/dashboard/bookings/packages", label: "Forfaits" },
];

export default function BookingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: organization } = useActiveOrganization();
  // The trade's own word, as in the menu: "Rendez-vous" for a salon, "Visites" for an agency.
  const title = tradeVocabulary(organization?.businessModel).bookings;

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
              {index === 0 ? title : tab.label}
            </Link>
          ))}
        </nav>
      </div>
      {children}
    </div>
  );
}
