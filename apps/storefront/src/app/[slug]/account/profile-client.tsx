"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Card, Input } from "@korva/ui";
import { PublicApiError } from "@/lib/public-api-client";
import { useCustomerAuth } from "@/lib/use-customer-auth";
import { LoyaltyCard } from "./loyalty-card";
import { usePublicOrganization } from "@/lib/use-public-organization";
import type { PublicOrganization } from "@/lib/public-types";
import { AccountShell } from "./account-shell";
import { tradeVocabularyIn, type BusinessModel, type Locale } from "@korva/types";
import { translator } from "@/lib/storefront-locale-core";
import { useStorefrontLocale, useT } from "@/lib/storefront-locale";

/**
 * The account sections this business actually has: a clothing shop's customer has no "Mes
 * formations", a salon's no "Mes retours", and each says it in the trade's words ("Mes
 * rendez-vous", "Mes visites"). Until the business is known, every section is listed (each page
 * handles being empty on its own).
 */
export function accountLinks(
  organization: PublicOrganization | undefined,
  locale: Locale = "fr",
): { path: string; label: string }[] {
  const t = translator(locale);
  const on = (module: string) => !organization || organization.enabledModules.includes(module);
  const model = organization?.businessModel;
  // Returns are for goods sent back; a wishlist is for products or properties one comes back to.
  const tradeIs = (...models: BusinessModel[]) => !model || models.includes(model);
  const bookings = tradeVocabularyIn(model, locale).bookings.toLowerCase();
  const links: { path: string; label: string; shown: boolean }[] = [
    { path: "orders", label: t("Mes commandes", "My orders"), shown: on("commerce") },
    { path: "bookings", label: t(`Mes ${bookings}`, `My ${bookings}`), shown: on("booking") },
    { path: "quotes", label: t("Mes devis", "My quotes"), shown: on("finance") || model === "quotes" },
    { path: "returns", label: t("Mes retours", "My returns"), shown: on("commerce") && tradeIs("retail") },
    { path: "wishlist", label: t("Mes favoris", "My favourites"), shown: on("catalog") && tradeIs("retail", "real_estate") },
    {
      path: "learning",
      label: t("Mes formations", "My courses"),
      shown: !organization || model === "training",
    },
  ];
  return links.filter((link) => link.shown);
}

export default function ProfileClient({ slug }: { slug: string }) {
  const locale = useStorefrontLocale();
  const t = useT();
  const router = useRouter();
  const { hydrated, isAuthenticated, customer, updateProfile, logout, authFetch } = useCustomerAuth(slug);
  const organizationQuery = usePublicOrganization(slug);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");

  // Seeds the edit form once the customer profile is known (post-hydration) — see useCart's
  // own hydration-effect comment for why this can't just be render-time initial state.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!customer) return;
    setFirstName(customer.firstName ?? "");
    setLastName(customer.lastName ?? "");
    setPhone(customer.phone ?? "");
  }, [customer]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (hydrated && !isAuthenticated) {
      router.replace(`/${slug}/account/login`);
    }
  }, [hydrated, isAuthenticated, slug, router]);

  const updateMutation = useMutation({
    mutationFn: () =>
      updateProfile({
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        phone: phone || undefined,
      }),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    updateMutation.mutate();
  }

  async function handleLogout() {
    await logout();
    router.push(`/${slug}`);
  }

  if (!hydrated || !isAuthenticated || !customer) {
    return (
      <AccountShell slug={slug} title={t("Mon compte", "My account")}>
        <Card className="p-6 text-center text-sm text-text-muted">{t("Chargement…", "Loading…")}</Card>
      </AccountShell>
    );
  }

  return (
    <AccountShell slug={slug} title={t("Mon compte", "My account")}>
      <p className="text-sm text-text-muted">
        {t(
          `Bonjour${customer.firstName ? ` ${customer.firstName}` : ""}, retrouvez ici tout ce qui vous concerne.`,
          `Hello${customer.firstName ? ` ${customer.firstName}` : ""}, everything about you is here.`,
        )}
      </p>
      {/* The sections first, as tiles: what the customer came for. The profile comes after. */}
      <nav aria-label={t("Mon espace client", "My customer area")} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {accountLinks(organizationQuery.data, locale).map(({ path, label }) => (
          <Link
            key={path}
            href={`/${slug}/account/${path}`}
            className="flex min-h-14 items-center justify-between rounded-xl border border-border bg-surface px-4 py-3 text-sm font-semibold text-text transition-colors hover:border-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {label}
            <span aria-hidden className="text-text-muted">→</span>
          </Link>
        ))}
      </nav>

      <LoyaltyCard slug={slug} authFetch={authFetch} />

      <h2 className="pt-2 text-sm font-semibold text-text">{t("Mes informations", "My details")}</h2>
      <Card className="p-4">
        <form onSubmit={handleSubmit} className="space-y-3 text-sm">
          <label className="block">
            <span className="mb-1 block text-text-muted">{t("Adresse e-mail", "Email address")}</span>
            <Input value={customer.email} disabled className="w-full" />
          </label>
          <label className="block">
            <span className="mb-1 block text-text-muted">{t("Prénom", "First name")}</span>
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} className="w-full" />
          </label>
          <label className="block">
            <span className="mb-1 block text-text-muted">{t("Nom", "Last name")}</span>
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} className="w-full" />
          </label>
          <label className="block">
            <span className="mb-1 block text-text-muted">{t("Téléphone", "Phone")}</span>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full" />
          </label>

          {updateMutation.isError && (
            <p className="text-xs text-destructive">
              {updateMutation.error instanceof PublicApiError
                ? updateMutation.error.message
                : t("Impossible de mettre à jour le profil.", "The profile could not be updated.")}
            </p>
          )}
          {updateMutation.isSuccess && <p className="text-xs text-green-700">{t("Profil mis à jour.", "Profile updated.")}</p>}

          <Button type="submit" loading={updateMutation.isPending} className="w-full">
            {t("Enregistrer", "Save")}
          </Button>
        </form>
      </Card>

      <button onClick={handleLogout} className="text-sm text-text-muted hover:underline">
        {t("Se déconnecter", "Sign out")}
      </button>
    </AccountShell>
  );
}
