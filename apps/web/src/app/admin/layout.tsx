"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  Building2,
  ChartColumnBig,
  CreditCard,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  ScrollText,
  Star,
  Tags,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button, Card, EmptyState, ThemeToggle } from "@korva/ui";
import { ApiError } from "@/lib/api-client";
import {
  setAdminToken,
  useAdminToken,
  usePlatformAdmin,
  usePlatformTodo,
  type PlatformTodo,
} from "@/lib/platform-admin";
import { useTheme } from "@/lib/theme-provider";
import { AdminSearch } from "@/components/admin/admin-search";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  /** The "À traiter" counter shown beside it, when there is one. */
  badge?: keyof PlatformTodo;
}

/**
 * Grouped by what the KORVA team is doing: watching the platform, looking after its customers,
 * following the money, keeping the platform running.
 */
const NAV: { title: string; items: NavItem[] }[] = [
  {
    title: "Pilotage",
    items: [{ href: "/admin", label: "Vue d'ensemble", icon: LayoutDashboard, exact: true }],
  },
  {
    title: "Clients",
    items: [
      { href: "/admin/entreprises", label: "Entreprises", icon: Building2 },
      { href: "/admin/utilisateurs", label: "Utilisateurs", icon: Users },
      { href: "/admin/avis", label: "Avis sur KORVA", icon: Star, badge: "reviewsToModerate" },
    ],
  },
  {
    title: "Argent",
    items: [
      { href: "/admin/finances", label: "Finances KORVA", icon: ChartColumnBig, badge: "overdueInvoices" },
      { href: "/admin/abonnements", label: "Abonnements", icon: CreditCard },
      { href: "/admin/reversements", label: "Reversements", icon: Wallet, badge: "payoutsToApprove" },
      { href: "/admin/formules", label: "Formules", icon: Tags },
    ],
  },
  {
    title: "Plateforme",
    items: [
      { href: "/admin/paiements", label: "Paiements GeniusPay", icon: Landmark },
      { href: "/admin/journal", label: "Journal", icon: ScrollText },
      { href: "/admin/systeme", label: "Système", icon: Activity },
    ],
  },
];

/**
 * L'Administration de KORVA OS: the platform team's own space, with its own sign-in
 * (/admin/connexion) and its own session — nothing shared with the businesses' dashboard. The API
 * is the gate (PlatformAdminGuard); this layout only routes to sign-in and says when refused.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const token = useAdminToken();
  const me = usePlatformAdmin();
  const { theme, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const isSignInPage = pathname === "/admin/connexion";

  // No administrator session (or it was just revoked): to the administration's own sign-in.
  useEffect(() => {
    if (!isSignInPage && token === null) router.replace("/admin/connexion");
  }, [isSignInPage, token, router]);

  if (isSignInPage) return <>{children}</>;

  if (me.isError) {
    const forbidden = me.error instanceof ApiError && me.error.code === "PLATFORM_ADMIN_ONLY";
    return (
      <Centered>
        <EmptyState
          title={forbidden ? "Session expirée" : "Administration indisponible"}
          description={forbidden ? "Reconnectez-vous à l'administration." : "Réessayez dans un instant."}
          action={<Link href="/admin/connexion" className="font-medium underline">Se connecter</Link>}
        />
      </Centered>
    );
  }
  if (!me.data) {
    return <Centered><p className="p-6 text-sm text-text-muted">Chargement…</p></Centered>;
  }

  function signOut() {
    setAdminToken(null);
    router.replace("/admin/connexion");
  }

  return (
    <div className="flex min-h-screen bg-app-background text-text">
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 shrink-0 flex-col overflow-y-auto bg-sidebar text-sidebar-text md:sticky md:top-0 md:flex md:h-screen ${
          menuOpen ? "flex" : "hidden"
        }`}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-5">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary font-display font-bold text-on-primary">K</span>
            <div>
              <p className="text-sm font-semibold text-white">Administration</p>
              <p className="text-xs text-sidebar-muted">KORVA</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMenuOpen(false)}
            className="rounded-lg p-2 hover:bg-sidebar-hover md:hidden"
            aria-label="Fermer le menu"
          >
            <X aria-hidden className="h-5 w-5" />
          </button>
        </div>
        <AdminNav pathname={pathname} onNavigate={() => setMenuOpen(false)} />
      </aside>
      {menuOpen && (
        <button
          type="button"
          aria-label="Fermer le menu"
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur sm:px-8">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="rounded-lg p-2 text-text-muted hover:bg-surface-muted md:hidden"
            aria-label="Ouvrir le menu"
          >
            <Menu aria-hidden className="h-5 w-5" />
          </button>
          <AdminSearch />
          <div className="ml-auto flex items-center gap-2">
            <Link href="/admin/compte" className="hidden text-sm text-text-muted hover:underline lg:inline">
              {me.data.email}
            </Link>
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
            <Button size="sm" variant="ghost" onClick={signOut}>
              <LogOut aria-hidden className="h-4 w-4" />
              <span className="sr-only sm:not-sr-only">Se déconnecter</span>
            </Button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8">{children}</main>
      </div>
    </div>
  );
}

function AdminNav({ pathname, onNavigate }: { pathname: string; onNavigate: () => void }) {
  const todo = usePlatformTodo();
  return (
    <nav aria-label="Administration" className="flex flex-col gap-5 px-3 pb-6">
      {NAV.map((group) => (
        <div key={group.title}>
          <p className="px-3 pb-1.5 text-xs font-semibold text-sidebar-muted">{group.title}</p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
              const count = item.badge ? todo.data?.[item.badge] ?? 0 : 0;
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      active ? "bg-sidebar-hover font-semibold text-white" : "hover:bg-sidebar-hover"
                    }`}
                  >
                    {active && <span aria-hidden className="absolute inset-y-1.5 left-0 w-1 rounded-full bg-primary" />}
                    <Icon aria-hidden className="h-4 w-4 shrink-0" />
                    <span className="flex-1">{item.label}</span>
                    {count > 0 && (
                      <span className="min-w-5 rounded-full bg-primary px-1.5 text-center text-xs font-bold leading-5 text-on-primary">
                        {count}
                        <span className="sr-only"> à traiter</span>
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-app-background px-4">
      <Card className="w-full max-w-md">{children}</Card>
    </div>
  );
}
