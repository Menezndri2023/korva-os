"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/dashboard/finance", label: "Devis" },
  { href: "/dashboard/finance/invoices", label: "Factures" },
  { href: "/dashboard/finance/expenses", label: "Dépenses" },
  { href: "/dashboard/finance/time-entries", label: "Suivi du temps" },
  { href: "/dashboard/finance/projects", label: "Projets" },
  { href: "/dashboard/finance/discount-codes", label: "Codes promo" },
  { href: "/dashboard/finance/recurring-billing", label: "Abonnements clients" },
];

export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Finance</h1>
        <nav className="mt-3 flex gap-1 border-b border-zinc-200">
          {TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={`px-3 py-2 text-sm font-medium ${
                pathname === tab.href
                  ? "border-b-2 border-zinc-900 text-zinc-900"
                  : "text-zinc-500 hover:text-zinc-700"
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
