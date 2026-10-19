"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BUSINESS_MODEL_DEFINITIONS, type KorvaModule, type Organization } from "@korva/types";
import { Button, ThemeToggle } from "@korva/ui";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { useActiveOrganization } from "@/lib/use-active-organization";
import { useTheme } from "@/lib/theme-provider";

const MODULE_NAV: { module: KorvaModule; label: string; href: string }[] = [
  { module: "crm", label: "CRM", href: "/dashboard/crm" },
  { module: "catalog", label: "Catalogue", href: "/dashboard/catalog" },
  { module: "booking", label: "Réservations", href: "/dashboard/bookings" },
  { module: "commerce", label: "Commandes", href: "/dashboard/orders" },
  { module: "finance", label: "Devis & Factures", href: "/dashboard/finance" },
  { module: "workflow", label: "Workflows", href: "/dashboard/workflows" },
  { module: "communication", label: "Communication", href: "/dashboard/communication" },
  { module: "analytics", label: "Statistiques", href: "/dashboard/analytics" },
  { module: "ai", label: "Assistant IA", href: "/dashboard/ai" },
  { module: "marketing", label: "Marketing", href: "/dashboard/marketing" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const accessToken = useAuthStore((state) => state.accessToken);
  const user = useAuthStore((state) => state.user);
  const activeOrganizationId = useAuthStore((state) => state.activeOrganizationId);
  const bootstrapped = useAuthStore((state) => state.bootstrapped);
  const setActiveOrganization = useAuthStore((state) => state.setActiveOrganization);
  const clear = useAuthStore((state) => state.clear);
  const { data: organization } = useActiveOrganization();
  const { theme, toggleTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { data: organizations } = useQuery({
    queryKey: ["organizations", "me", "all"],
    queryFn: () => apiClient.get<Organization[]>("/organizations/me/all"),
    enabled: bootstrapped && Boolean(accessToken),
  });

  useEffect(() => {
    // Wait for useAuthBootstrap's silent /auth/refresh to resolve before deciding the user
    // is logged out — accessToken is always null for an instant on every fresh page load.
    if (!bootstrapped) return;
    if (!accessToken) {
      router.replace("/login");
    } else if (!activeOrganizationId) {
      router.replace("/onboarding");
    }
  }, [bootstrapped, accessToken, activeOrganizationId, router]);

  useEffect(() => {
    // Prevent the page behind the open mobile drawer from scrolling. Captures whatever was
    // there before (rather than assuming "") so this never clobbers an unrelated overflow
    // value some other part of the app might have set.
    const previousOverflow = document.body.style.overflow;
    if (sidebarOpen) {
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [sidebarOpen]);

  useEffect(() => {
    if (!sidebarOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSidebarOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [sidebarOpen]);

  const enabledModules = new Set(organization?.enabledModules ?? []);
  // Trade-specific screens follow the type of activity: every shop used to see "Cuisine" and
  // every salon "Formations", because both only checked a module. An organization without a
  // type of activity keeps exactly that older behaviour.
  const screens = organization?.businessModel
    ? BUSINESS_MODEL_DEFINITIONS[organization.businessModel].screens
    : { kitchen: true, training: true };

  async function logout() {
    try {
      // Revokes the session server-side and clears the HttpOnly refresh cookie — clearing
      // local state alone would leave that cookie valid.
      await apiClient.post("/auth/logout", undefined, { withOrganization: false });
    } catch {
      // Still log out locally even if the network call failed.
    } finally {
      clear();
      router.replace("/login");
    }
  }

  function switchOrganization(organizationId: string) {
    if (organizationId === activeOrganizationId) return;
    setActiveOrganization(organizationId);
    // Every module's data is scoped to the active organization — clear the cache outright
    // rather than trying to invalidate each query key individually, so nothing from the
    // previous organization can flash on screen under the new one.
    queryClient.clear();
  }

  return (
    <div className="flex min-h-screen">
      {sidebarOpen && (
        <button
          aria-label="Fermer le menu"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-zinc-900/40 md:hidden"
        />
      )}

      <aside
        id="mobile-sidebar"
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-border bg-surface px-4 py-6 transition-transform md:static md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-6 px-2">
          <p className="text-lg font-semibold">KORVA OS</p>
          <p className="truncate text-xs text-text-muted">{organization?.name ?? "..."}</p>
        </div>

        <nav className="flex-1 space-y-1">
          <NavLink
            href="/dashboard"
            label="Tableau de bord"
            active={pathname === "/dashboard"}
            onClick={() => setSidebarOpen(false)}
          />
          {MODULE_NAV.filter((item) => enabledModules.has(item.module)).map((item) => (
            <NavLink
              key={item.module}
              href={item.href}
              label={item.label}
              active={pathname === item.href}
              onClick={() => setSidebarOpen(false)}
            />
          ))}
          <NavLink
            href="/dashboard/action-center"
            label="Centre d'action"
            active={pathname === "/dashboard/action-center"}
            onClick={() => setSidebarOpen(false)}
          />
          {(enabledModules.has("commerce") || enabledModules.has("booking")) && (
            <NavLink
              href="/dashboard/reviews"
              label="Avis clients"
              active={pathname === "/dashboard/reviews"}
              onClick={() => setSidebarOpen(false)}
            />
          )}
          {enabledModules.has("commerce") && (
            <NavLink
              href="/dashboard/returns"
              label="Retours"
              active={pathname === "/dashboard/returns"}
              onClick={() => setSidebarOpen(false)}
            />
          )}
          {enabledModules.has("booking") && screens.training && (
            <NavLink
              href="/dashboard/formation/courses"
              label="Formations"
              active={pathname.startsWith("/dashboard/formation")}
              onClick={() => setSidebarOpen(false)}
            />
          )}
          {enabledModules.has("commerce") && screens.kitchen && (
            <NavLink
              href="/dashboard/kitchen"
              label="Cuisine"
              active={pathname === "/dashboard/kitchen"}
              onClick={() => setSidebarOpen(false)}
            />
          )}
          <NavLink
            href="/dashboard/settings"
            label="Paramètres"
            active={pathname === "/dashboard/settings"}
            onClick={() => setSidebarOpen(false)}
          />
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col md:pl-0">
        <header className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3 shadow-sm md:px-8">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              aria-label="Ouvrir le menu"
              aria-expanded={sidebarOpen}
              aria-controls="mobile-sidebar"
              onClick={() => setSidebarOpen(true)}
              className="p-2 md:hidden"
            >
              <MenuIcon />
            </Button>
            {organizations && organizations.length > 1 && (
              <OrgSwitcher
                organizations={organizations}
                activeOrganizationId={activeOrganizationId}
                onSwitch={switchOrganization}
              />
            )}
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
            {organization?.slug && <StorefrontLinkMenu slug={organization.slug} />}
            <UserMenu
              name={[user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email || ""}
              email={user?.email ?? ""}
              onLogout={() => void logout()}
            />
          </div>
        </header>

        <main className="flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}

function NavLink({
  href,
  label,
  active,
  onClick,
}: {
  href: string;
  label: string;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`block rounded-md px-3 py-2 text-sm font-medium transition-colors ${
        active ? "bg-zinc-900 text-text-primary shadow-sm" : "text-text hover:bg-surface-muted"
      }`}
    >
      {label}
    </Link>
  );
}

function OrgSwitcher({
  organizations,
  activeOrganizationId,
  onSwitch,
}: {
  organizations: Organization[];
  activeOrganizationId: string | null;
  onSwitch: (organizationId: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">Changer d&apos;organisation</span>
      <select
        value={activeOrganizationId ?? ""}
        onChange={(event) => onSwitch(event.target.value)}
        className="rounded-md border border-border-input bg-surface px-2 py-1.5 text-sm text-text focus:border-focus focus:outline-none"
      >
        {organizations.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Always-visible, one-click access to the org's live public storefront from anywhere in the
 * dashboard — previously this link only existed buried in Settings' "Mon site existant" card.
 * "Copier le lien" is the direct answer to "l'accès au storefront devrait être possible via un
 * lien pour ses clients" — the owner can grab the exact client-facing URL and share it (WhatsApp,
 * SMS, email, ...) without having to open the storefront tab and copy from the address bar.
 */
function StorefrontLinkMenu({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const storefrontUrl = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? "http://localhost:3001";
  const storefrontPageUrl = `${storefrontUrl}/${slug}`;

  return (
    <div className="relative">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="hidden sm:inline-flex"
      >
        Ma boutique en ligne
      </Button>
      <Button
        variant="secondary"
        size="sm"
        aria-label="Ma boutique en ligne"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="p-2 sm:hidden"
      >
        <StorefrontIcon />
      </Button>

      {open && (
        <>
          <button
            aria-label="Fermer le menu boutique en ligne"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40"
          />
          <div className="absolute right-0 z-50 mt-2 w-64 rounded-md border border-border bg-surface p-1 shadow-lg">
            <a
              href={storefrontPageUrl}
              target="_blank"
              rel="noreferrer"
              onClick={() => setOpen(false)}
              className="block rounded-md px-3 py-2 text-sm font-medium text-text hover:bg-surface-muted"
            >
              Ouvrir ma boutique →
            </a>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(storefrontPageUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="block w-full rounded-md px-3 py-2 text-left text-sm font-medium text-text hover:bg-surface-muted"
            >
              {copied ? "Lien copié !" : "Copier le lien pour mes clients"}
            </button>
            <div className="my-1 h-px bg-border" />
            <Link
              href="/dashboard/settings"
              onClick={() => setOpen(false)}
              className="block rounded-md px-3 py-2 text-sm text-text-muted hover:bg-surface-muted"
            >
              Personnaliser ma boutique
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

function StorefrontIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M3 8l1-4h12l1 4M3 8v7a1 1 0 001 1h3v-4h6v4h3a1 1 0 001-1V8M3 8h14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UserMenu({ name, email, onLogout }: { name: string; email: string; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const initials = getInitials(name || email);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 text-xs font-medium text-text-primary"
      >
        {initials}
      </button>

      {open && (
        <>
          <button
            aria-label="Fermer le menu utilisateur"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40"
          />
          <div className="absolute right-0 z-50 mt-2 w-56 rounded-md border border-border bg-surface p-1 shadow-lg">
            <div className="px-3 py-2">
              <p className="truncate text-sm font-medium text-text">{name || "—"}</p>
              <p className="truncate text-xs text-text-muted">{email}</p>
            </div>
            <div className="my-1 h-px bg-border" />
            <Button
              variant="ghost"
              onClick={onLogout}
              className="w-full justify-start text-left"
            >
              Se déconnecter
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function getInitials(source: string): string {
  const parts = source.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
