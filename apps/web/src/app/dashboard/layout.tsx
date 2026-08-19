"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { KorvaModule } from "@korva/types";
import { useAuthStore } from "@/lib/auth-store";
import { useActiveOrganization } from "@/lib/use-active-organization";

const MODULE_NAV: { module: KorvaModule; label: string; href: string }[] = [
  { module: "crm", label: "CRM", href: "/dashboard/crm" },
  { module: "catalog", label: "Catalogue", href: "/dashboard/catalog" },
  { module: "booking", label: "Réservations", href: "/dashboard/bookings" },
  { module: "commerce", label: "Commandes", href: "/dashboard/orders" },
  { module: "finance", label: "Devis & Factures", href: "/dashboard/finance" },
  { module: "workflow", label: "Workflows", href: "/dashboard/workflows" },
  { module: "communication", label: "Communication", href: "/dashboard/communication" },
  { module: "analytics", label: "Analytics", href: "/dashboard/analytics" },
  { module: "ai", label: "Assistant IA", href: "/dashboard/ai" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const accessToken = useAuthStore((state) => state.accessToken);
  const activeOrganizationId = useAuthStore((state) => state.activeOrganizationId);
  const clear = useAuthStore((state) => state.clear);
  const { data: organization } = useActiveOrganization();

  useEffect(() => {
    if (!accessToken) {
      router.replace("/login");
    } else if (!activeOrganizationId) {
      router.replace("/onboarding");
    }
  }, [accessToken, activeOrganizationId, router]);

  const enabledModules = new Set(organization?.enabledModules ?? []);

  return (
    <div className="flex min-h-screen">
      <aside className="w-64 shrink-0 border-r border-zinc-200 bg-white px-4 py-6">
        <div className="mb-6 px-2">
          <p className="text-lg font-semibold">KORVA OS</p>
          <p className="truncate text-xs text-zinc-500">{organization?.name ?? "..."}</p>
        </div>

        <nav className="space-y-1">
          <NavLink href="/dashboard" label="Tableau de bord" active={pathname === "/dashboard"} />
          {MODULE_NAV.filter((item) => enabledModules.has(item.module)).map((item) => (
            <NavLink key={item.module} href={item.href} label={item.label} active={pathname === item.href} />
          ))}
          <NavLink href="/dashboard/settings" label="Paramètres" active={pathname === "/dashboard/settings"} />
        </nav>

        <button
          onClick={() => {
            clear();
            router.replace("/login");
          }}
          className="mt-8 w-full rounded-md px-3 py-2 text-left text-sm text-zinc-500 hover:bg-zinc-100"
        >
          Se déconnecter
        </button>
      </aside>

      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}

function NavLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`block rounded-md px-3 py-2 text-sm font-medium ${
        active ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-100"
      }`}
    >
      {label}
    </Link>
  );
}
