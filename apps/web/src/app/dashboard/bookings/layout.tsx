"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/dashboard/bookings", label: "Réservations" },
  { href: "/dashboard/bookings/resources", label: "Équipe et ressources" },
  { href: "/dashboard/bookings/waitlist", label: "Liste d'attente" },
  { href: "/dashboard/bookings/packages", label: "Forfaits" },
];

export default function BookingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Réservations</h1>
        <nav className="mt-3 flex gap-1 overflow-x-auto border-b border-border">
          {TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={`shrink-0 whitespace-nowrap px-3 py-2 text-sm font-medium ${
                pathname === tab.href
                  ? "border-b-2 border-primary text-text"
                  : "text-text-muted hover:text-text"
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </div>
      {children}
    </div>
  );
}
