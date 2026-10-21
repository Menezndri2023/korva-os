"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/dashboard/catalog", label: "Offres" },
  { href: "/dashboard/catalog/categories", label: "Catégories" },
  { href: "/dashboard/catalog/warehouses", label: "Entrepôts" },
  { href: "/dashboard/catalog/suppliers", label: "Fournisseurs" },
  { href: "/dashboard/catalog/purchase-orders", label: "Commandes fournisseurs" },
];

export default function CatalogLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Catalogue</h1>
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
