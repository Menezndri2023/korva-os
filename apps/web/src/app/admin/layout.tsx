"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CreditCard, LayoutDashboard, Store, ArrowLeft } from "lucide-react";
import { Card, EmptyState, ThemeToggle } from "@korva/ui";
import { ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { usePlatformAdmin } from "@/lib/platform-admin";
import { useTheme } from "@/lib/theme-provider";

const NAV = [
  { href: "/admin", label: "Vue d'ensemble", icon: LayoutDashboard, exact: true },
  { href: "/admin/commerces", label: "Commerces", icon: Store, exact: false },
  { href: "/admin/abonnements", label: "Abonnements", icon: CreditCard, exact: false },
];

/**
 * L'Administration de KORVA OS: the platform team's own space, apart from any organization.
 * The API is the gate (PlatformAdminGuard); this layout asks once and, when refused, says so
 * rather than showing empty tables.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const bootstrapped = useAuthStore((state) => state.bootstrapped);
  const accessToken = useAuthStore((state) => state.accessToken);
  const me = usePlatformAdmin();
  const { theme, toggleTheme } = useTheme();

  if (bootstrapped && !accessToken) {
    return (
      <Centered>
        <EmptyState
          title="Connectez-vous"
          description="L'administration est réservée à l'équipe KORVA."
          action={<Link href="/login" className="font-medium underline">Se connecter</Link>}
        />
      </Centered>
    );
  }
  if (me.isError) {
    const forbidden = me.error instanceof ApiError && me.error.code === "PLATFORM_ADMIN_ONLY";
    return (
      <Centered>
        <EmptyState
          title={forbidden ? "Réservé à l'équipe KORVA" : "Administration indisponible"}
          description={
            forbidden
              ? "Votre adresse doit figurer dans PLATFORM_ADMIN_EMAILS sur le serveur."
              : "Réessayez dans un instant."
          }
          action={<Link href="/dashboard" className="font-medium underline">Retour au tableau de bord</Link>}
        />
      </Centered>
    );
  }
  if (!me.data) {
    return <Centered><p className="text-sm text-text-muted">Chargement…</p></Centered>;
  }

  return (
    <div className="flex min-h-screen flex-col bg-app-background text-text md:flex-row">
      <aside className="flex flex-col bg-sidebar text-sidebar-text md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0">
        <div className="flex items-center gap-3 px-5 py-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary font-bold text-on-primary">K</span>
          <div>
            <p className="text-sm font-semibold text-white">Administration</p>
            <p className="text-xs text-sidebar-muted">KORVA OS</p>
          </div>
        </div>
        <nav aria-label="Administration" className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible">
          {NAV.map((item) => {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                  active ? "bg-sidebar-hover font-medium text-white" : "hover:bg-sidebar-hover"
                }`}
              >
                <Icon aria-hidden className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto hidden px-3 pb-5 md:block">
          <Link href="/dashboard" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-sidebar-hover">
            <ArrowLeft aria-hidden className="h-4 w-4" />
            Mon tableau de bord
          </Link>
        </div>
      </aside>
      <div className="flex-1">
        <header className="flex items-center justify-end gap-3 border-b border-border bg-surface/90 px-4 py-3 sm:px-8">
          <span className="text-sm text-text-muted">{me.data.email}</span>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8">{children}</main>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-app-background px-4">
      <Card className="w-full max-w-md">{children}</Card>
    </div>
  );
}
