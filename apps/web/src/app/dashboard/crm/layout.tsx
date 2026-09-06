"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/dashboard/crm", label: "Clients" },
  { href: "/dashboard/crm/leads", label: "Prospects" },
  { href: "/dashboard/crm/deals", label: "Affaires" },
  { href: "/dashboard/crm/activities", label: "Activités" },
  { href: "/dashboard/crm/tickets", label: "Tickets" },
];

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">CRM</h1>
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
