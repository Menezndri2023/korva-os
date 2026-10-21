"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BUSINESS_MODEL_DEFINITIONS, type KorvaModule, type Organization } from "@korva/types";
import { Button, Notice, ThemeToggle } from "@korva/ui";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { useActiveOrganization } from "@/lib/use-active-organization";
import { usePlanFeatures } from "@/lib/use-plan-features";
import { useTheme } from "@/lib/theme-provider";
import {
  BellRing,
  CalendarDays,
  ChartColumn,
  ChefHat,
  GraduationCap,
  LayoutDashboard,
  Megaphone,
  MessageCircle,
  Package,
  Receipt,
  Settings,
  ShoppingBag,
  Sparkles,
  Star,
  Undo2,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { STOREFRONT_URL } from "@/lib/storefront-url";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown only while this is true for the active organization. */
  visible: boolean;
  /** Active on nested routes too (e.g. /dashboard/catalog/123). Exact match otherwise. */
  prefix?: boolean;
};

/**
 * The navigation, grouped by what an owner is doing rather than by module: selling, looking
 * after customers, running the business. Each entry keeps the exact condition it had in the flat
 * list (module enabled, type of activity, plan feature) — only the order and the grouping are new.
 */
function navGroups(
  enabledModules: Set<KorvaModule>,
  screens: { kitchen: boolean; training: boolean },
  hasKitchen: boolean,
): { title: string | null; items: NavItem[] }[] {
  const on = (module: KorvaModule) => enabledModules.has(module);
  return [
    {
      title: null,
      items: [
        { href: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard, visible: true },
        { href: "/dashboard/action-center", label: "Centre d'action", icon: BellRing, visible: true },
      ],
    },
    {
      title: "Vendre",
      items: [
        { href: "/dashboard/catalog", label: "Catalogue", icon: Package, visible: on("catalog"), prefix: true },
        { href: "/dashboard/orders", label: "Commandes", icon: ShoppingBag, visible: on("commerce"), prefix: true },
        { href: "/dashboard/bookings", label: "Réservations", icon: CalendarDays, visible: on("booking"), prefix: true },
        {
          href: "/dashboard/kitchen",
          label: "Cuisine",
          icon: ChefHat,
          visible: on("commerce") && screens.kitchen && hasKitchen,
        },
        { href: "/dashboard/returns", label: "Retours", icon: Undo2, visible: on("commerce") },
        {
          href: "/dashboard/reviews",
          label: "Avis clients",
          icon: Star,
          visible: on("commerce") || on("booking"),
        },
      ],
    },
    {
      title: "Clients",
      items: [
        { href: "/dashboard/crm", label: "CRM", icon: Users, visible: on("crm"), prefix: true },
        { href: "/dashboard/marketing", label: "Marketing", icon: Megaphone, visible: on("marketing"), prefix: true },
        {
          href: "/dashboard/communication",
          label: "Communication",
          icon: MessageCircle,
          visible: on("communication"),
          prefix: true,
        },
      ],
    },
    {
      title: "Gestion",
      items: [
        { href: "/dashboard/finance", label: "Devis & Factures", icon: Receipt, visible: on("finance"), prefix: true },
        { href: "/dashboard/analytics", label: "Statistiques", icon: ChartColumn, visible: on("analytics") },
        { href: "/dashboard/workflows", label: "Workflows", icon: Workflow, visible: on("workflow"), prefix: true },
        {
          href: "/dashboard/formation/courses",
          label: "Formations",
          icon: GraduationCap,
          visible: on("booking") && screens.training,
          prefix: true,
        },
        { href: "/dashboard/ai", label: "Assistant IA", icon: Sparkles, visible: on("ai") },
      ],
    },
  ];
}

function trialDaysLeft(endsAt: string): number {
  return Math.max(1, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86_400_000));
}

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
  const planFeatures = usePlanFeatures();
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
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col bg-sidebar px-3 py-5 text-sidebar-text transition-transform md:sticky md:top-0 md:h-screen md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-6 flex items-center gap-3 px-2">
          {/* The business's initial on a saffron tile: the one warm mark in the petrol column,
              and the quickest way to see which organization is open. */}
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary font-display text-base font-bold text-on-primary"
          >
            {(organization?.name ?? "K").charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{organization?.name ?? "..."}</p>
            <p className="text-xs text-sidebar-muted">KORVA OS</p>
          </div>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto pb-4">
          {navGroups(enabledModules, screens, planFeatures.has("kitchen_display")).map((group) => {
            const items = group.items.filter((item) => item.visible);
            if (items.length === 0) return null;
            return (
              <div key={group.title ?? "main"}>
                {group.title && (
                  <p className="mb-1.5 px-3 text-xs font-medium text-sidebar-muted">{group.title}</p>
                )}
                <div className="space-y-0.5">
                  {items.map((item) => (
                    <NavLink
                      key={item.href}
                      href={item.href}
                      label={item.label}
                      icon={item.icon}
                      active={
                        item.prefix
                          ? pathname === item.href || pathname.startsWith(`${item.href}/`)
                          : pathname === item.href
                      }
                      onClick={() => setSidebarOpen(false)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
        <NavLink
          href="/dashboard/settings"
          label="Paramètres"
          icon={Settings}
          active={pathname === "/dashboard/settings"}
          onClick={() => setSidebarOpen(false)}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col md:pl-0">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border bg-surface/90 px-4 py-3 backdrop-blur md:px-8">
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

        <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-8">
          {organization && !enabledModules.has("website") && (
            // Visitors of a site whose module is off see "Ce site n'est pas en ligne"; the owner
            // must not have to discover that from a customer.
            <Notice tone="accent" className="mb-4">
              Votre site public n&apos;est pas en ligne : vos clients voient « Ce site n&apos;est pas
              en ligne pour le moment ».{" "}
              <Link href="/dashboard/settings" className="font-medium underline">
                Activez le module Site web
              </Link>{" "}
              pour le publier.
            </Notice>
          )}
          {planFeatures.trialEndsAt && (
            // The trial ends on its own; saying when, and where to choose a plan, is the only
            // way the owner is not surprised by Free coming back.
            <Notice tone="warning" className="mb-4">
              Essai Pro offert : {trialDaysLeft(planFeatures.trialEndsAt)} jour
              {trialDaysLeft(planFeatures.trialEndsAt) > 1 ? "s" : ""} restant
              {trialDaysLeft(planFeatures.trialEndsAt) > 1 ? "s" : ""}. Vos données restent à vous
              après l&apos;essai ;{" "}
              <Link href="/dashboard/settings" className="font-medium underline">
                choisissez une formule
              </Link>{" "}
              pour garder les fonctions Pro.
            </Notice>
          )}{children}</main>
      </div>
    </div>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  onClick,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        active
          ? "bg-sidebar-hover font-semibold text-white"
          : "text-sidebar-text hover:bg-sidebar-hover hover:text-white"
      }`}
    >
      {active && (
        <span aria-hidden="true" className="absolute inset-y-1.5 left-0 w-1 rounded-full bg-primary" />
      )}
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={2} />
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
  const storefrontPageUrl = `${STOREFRONT_URL}/${slug}`;

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
        className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar text-xs font-medium text-text-primary"
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
