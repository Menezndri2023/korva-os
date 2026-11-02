"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, ShoppingBag, UserRound } from "lucide-react";
import type { PublicOrganization } from "@/lib/public-types";
import { KT } from "../kt-classes";
import { useT } from "@/lib/storefront-locale";

export interface SiteHeaderLink {
  href: string;
  label: string;
}

/**
 * The one header every template shares. Each template used to build its own, and none of them
 * survived a phone: the links wrapped under the name, the name broke over three lines, and the
 * boutique header pushed the page wider than the screen.
 *
 * Here the name and the cart always stay on one row. From `md:` the links sit inline; below it
 * they fold into a menu (a native <details>, so it opens before any JavaScript has loaded). The
 * cart is an icon with a count, and is only shown where the shop sells online.
 *
 * `tone="accent"` paints the header in the organization's accent (the académie look); the
 * default sits on the theme's surface. Sticky in both, so the cart is always one tap away.
 */
export function SiteHeader({
  slug,
  organization,
  links,
  authHydrated,
  isAuthenticated,
  customerFirstName,
  commerceEnabled,
  cartCount,
  onOpenCheckout,
  tone = "surface",
}: {
  slug: string;
  organization: PublicOrganization;
  links: SiteHeaderLink[];
  authHydrated: boolean;
  isAuthenticated: boolean;
  customerFirstName?: string;
  commerceEnabled: boolean;
  cartCount: number;
  onOpenCheckout: () => void;
  tone?: "surface" | "accent";
}) {
  const t = useT();
  const accent = tone === "accent";
  const bar = accent
    ? `${KT.accentBg} ${KT.accentContrastText}`
    : `border-b ${KT.border} ${KT.surface} ${KT.text}`;
  const linkTone = accent ? "opacity-90 hover:opacity-100" : `${KT.textMuted} hover:text-[var(--kt-text)]`;
  const accountHref = `/${slug}/account${isAuthenticated ? "" : "/login"}`;
  // No account can exist here (Free plan, none created before): no sign-in to offer.
  const accountsOffered = isAuthenticated || organization.customerSignInAvailable !== false;
  const accountLabel = isAuthenticated ? (customerFirstName ?? t("Mon compte", "My account")) : t("Se connecter", "Sign in");

  return (
    <header className={`sticky top-0 z-30 ${bar}`}>
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link href={`/${slug}`} className="flex min-w-0 flex-1 items-center gap-3">
          <Monogram organization={organization} inverted={accent} />
          <span className={`truncate text-base font-semibold sm:text-lg ${KT.headingFont}`}>
            {organization.name}
          </span>
        </Link>

        <nav aria-label={t("Navigation du site", "Site navigation")} className="hidden items-center gap-6 text-sm md:flex">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className={`transition-colors ${linkTone}`}>
              {link.label}
            </Link>
          ))}
          {authHydrated && accountsOffered && (
            <Link href={accountHref} className={`inline-flex items-center gap-1.5 transition-colors ${linkTone}`}>
              <UserRound aria-hidden className="h-4 w-4" />
              {accountLabel}
            </Link>
          )}
        </nav>

        {commerceEnabled && (
          <button
            type="button"
            onClick={onOpenCheckout}
            disabled={cartCount === 0}
            aria-label={cartCount === 0 ? t("Panier vide", "Empty basket") : `Voir le panier, ${cartCount} article${cartCount > 1 ? "s" : ""}`}
            className={`relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50 ${
              accent ? "bg-white/15 hover:bg-white/25" : `${KT.accentSoftBg} hover:opacity-90`
            }`}
          >
            <ShoppingBag aria-hidden className="h-5 w-5" />
            {cartCount > 0 && (
              <span
                className={`absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold ring-2 ${
                  accent
                    ? "bg-white text-[var(--kt-accent)] ring-[var(--kt-accent)]"
                    : `${KT.accentBg} ${KT.accentContrastText} ring-[var(--kt-surface)]`
                }`}
              >
                {cartCount}
              </span>
            )}
          </button>
        )}

        <MobileMenu
          links={links}
          accountHref={authHydrated && accountsOffered ? accountHref : undefined}
          accountLabel={accountLabel}
          accent={accent}
        />
      </div>
    </header>
  );
}

function MobileMenu({
  links,
  accountHref,
  accountLabel,
  accent,
}: {
  links: SiteHeaderLink[];
  accountHref?: string;
  accountLabel: string;
  accent: boolean;
}) {
  const t = useT();
  return (
    <details className="group relative md:hidden">
      <summary
        aria-label={t("Menu", "Menu")}
        className={`flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-full [&::-webkit-details-marker]:hidden ${
          accent ? "hover:bg-white/15" : KT.accentSoftHoverBg
        }`}
      >
        <Menu aria-hidden className="h-5 w-5" />
      </summary>
      <div
        className={`absolute right-0 top-12 w-60 overflow-hidden rounded-2xl border py-2 shadow-xl ${KT.border} ${KT.surface} ${KT.text}`}
      >
        {links.map((link) => (
          <Link key={link.href} href={link.href} className={`block px-4 py-3 text-sm ${KT.accentSoftHoverBg}`}>
            {link.label}
          </Link>
        ))}
        {accountHref && (
          <Link
            href={accountHref}
            className={`flex items-center gap-2 border-t px-4 py-3 text-sm font-medium ${KT.border} ${KT.accentSoftHoverBg}`}
          >
            <UserRound aria-hidden className="h-4 w-4" />
            {accountLabel}
          </Link>
        )}
      </div>
    </details>
  );
}

/**
 * The organization's logo, or — since most small shops start without one — its initial on an
 * accent tile, so the header never opens on a bare name.
 */
export function Monogram({
  organization,
  inverted = false,
  size = "md",
}: {
  organization: PublicOrganization;
  inverted?: boolean;
  size?: "md" | "lg";
}) {
  const [failed, setFailed] = useState(false);
  const box = size === "lg" ? "h-16 w-16 text-2xl rounded-2xl" : "h-9 w-9 text-base rounded-xl";

  if (organization.logo && !failed) {
    return (
      // Arbitrary tenant-supplied host, not one of Next's configured image domains (see
      // middleware.ts img-src comment).
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={organization.logo}
        alt=""
        loading="eager"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`${box} shrink-0 bg-white object-contain p-0.5`}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`${box} flex shrink-0 items-center justify-center font-bold ${KT.headingFont} ${
        inverted ? "bg-white/15" : `${KT.accentBg} ${KT.accentContrastText}`
      }`}
    >
      {organization.name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/** The links every template's header and footer carry, in each template's own words. */
export function siteLinks(
  slug: string,
  catalogVisible: boolean,
  labels: { catalog: string; track: string },
): SiteHeaderLink[] {
  return [
    ...(catalogVisible ? [{ href: `/${slug}/catalogue`, label: labels.catalog }] : []),
    { href: `/${slug}/track`, label: labels.track },
  ];
}
