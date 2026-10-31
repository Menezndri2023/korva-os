"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  LogOut,
  Building2,
  CreditCard,
  LayoutDashboard,
  ScrollText,
  Star,
  Tags,
  Users,
  Wallet,
} from "lucide-react";
import { Button, Card, EmptyState, ThemeToggle } from "@korva/ui";
import { ApiError } from "@/lib/api-client";
import { setAdminToken, useAdminToken, usePlatformAdmin } from "@/lib/platform-admin";
import { useTheme } from "@/lib/theme-provider";

const NAV = [
  { href: "/admin", label: "Vue d'ensemble", icon: LayoutDashboard, exact: true },
  { href: "/admin/entreprises", label: "Entreprises", icon: Building2, exact: false },
  { href: "/admin/utilisateurs", label: "Utilisateurs", icon: Users, exact: false },
  { href: "/admin/abonnements", label: "Abonnements", icon: CreditCard, exact: false },
  { href: "/admin/formules", label: "Formules", icon: Tags, exact: false },
  { href: "/admin/reversements", label: "Reversements", icon: Wallet, exact: false },
  { href: "/admin/avis", label: "Avis sur KORVA", icon: Star, exact: false },
  { href: "/admin/journal", label: "Journal", icon: ScrollText, exact: false },
  { href: "/admin/systeme", label: "Système", icon: Activity, exact: false },
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
      </aside>
      <div className="flex-1">
        <header className="flex items-center justify-end gap-3 border-b border-border bg-surface/90 px-4 py-3 sm:px-8">
          <Link href="/admin/compte" className="text-sm text-text-muted hover:underline">
            {me.data.email}
          </Link>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <Button size="sm" variant="ghost" onClick={signOut}>
            <LogOut aria-hidden className="h-4 w-4" />
            Se déconnecter
          </Button>
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
