"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/dashboard-locale";

const TABS = [
  { href: "/dashboard/finance", label: ["Devis", "Quotes"] },
  { href: "/dashboard/finance/invoices", label: ["Factures", "Invoices"] },
  { href: "/dashboard/finance/expenses", label: ["Dépenses", "Expenses"] },
  { href: "/dashboard/finance/time-entries", label: ["Suivi du temps", "Time tracking"] },
  { href: "/dashboard/finance/projects", label: ["Projets", "Projects"] },
  { href: "/dashboard/finance/discount-codes", label: ["Codes promo", "Discount codes"] },
  { href: "/dashboard/finance/recurring-billing", label: ["Abonnements clients", "Customer subscriptions"] },
] satisfies { href: string; label: [string, string] }[];

export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  const t = useT();
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("Finance", "Finance")}</h1>
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
              {t(...tab.label)}
            </Link>
          ))}
        </nav>
      </div>
      {children}
    </div>
  );
}
