"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BUSINESS_MODEL_DEFINITIONS, tradeVocabularyIn } from "@korva/types";
import { useActiveOrganization } from "@/lib/use-active-organization";
import { useDashboardLocale, useT } from "@/lib/dashboard-locale";

const TABS: { href: string; label: [string, string]; stock?: boolean }[] = [
  { href: "/dashboard/catalog", label: ["Offres", "Offers"] },
  { href: "/dashboard/catalog/categories", label: ["Catégories", "Categories"] },
  { href: "/dashboard/catalog/warehouses", label: ["Entrepôts", "Warehouses"], stock: true },
  { href: "/dashboard/catalog/suppliers", label: ["Fournisseurs", "Suppliers"], stock: true },
  { href: "/dashboard/catalog/purchase-orders", label: ["Commandes fournisseurs", "Purchase orders"], stock: true },
];

export default function CatalogLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: organization } = useActiveOrganization();
  const locale = useDashboardLocale();
  const t = useT();
  const title = tradeVocabularyIn(organization?.businessModel, locale).catalog;
  // Stock tools only for a trade that keeps goods (and for an organization with no type of
  // activity, as before). The pages stay reachable by their address.
  const stock = organization?.businessModel
    ? BUSINESS_MODEL_DEFINITIONS[organization.businessModel].stock
    : true;
  const tabs = TABS.filter((tab) => !tab.stock || stock || pathname === tab.href);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <nav className="mt-3 flex gap-1 overflow-x-auto border-b border-border">
          {tabs.map((tab) => (
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
