"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Card, Input } from "@korva/ui";
import { PublicApiError } from "@/lib/public-api-client";
import { useCustomerAuth } from "@/lib/use-customer-auth";
import { usePublicOrganization } from "@/lib/use-public-organization";
import type { PublicOrganization } from "@/lib/public-types";
import { AccountShell } from "./account-shell";
import { tradeVocabulary, type BusinessModel } from "@korva/types";

/**
 * The account sections this business actually has: a clothing shop's customer has no "Mes
 * formations", a salon's no "Mes retours", and each says it in the trade's words ("Mes
 * rendez-vous", "Mes visites"). Until the business is known, every section is listed (each page
 * handles being empty on its own).
 */
export function accountLinks(organization: PublicOrganization | undefined): { path: string; label: string }[] {
  const on = (module: string) => !organization || organization.enabledModules.includes(module);
  const model = organization?.businessModel;
  // Returns are for goods sent back; a wishlist is for products or properties one comes back to.
  const tradeIs = (...models: BusinessModel[]) => !model || models.includes(model);
  const bookings = tradeVocabulary(model).bookings.toLowerCase();
  const links: { path: string; label: string; shown: boolean }[] = [
    { path: "orders", label: "Mes commandes", shown: on("commerce") },
    { path: "bookings", label: `Mes ${bookings}`, shown: on("booking") },
    { path: "quotes", label: "Mes devis", shown: on("finance") || model === "quotes" },
    { path: "returns", label: "Mes retours", shown: on("commerce") && tradeIs("retail") },
    { path: "wishlist", label: "Mes favoris", shown: on("catalog") && tradeIs("retail", "real_estate") },
    {
      path: "learning",
      label: "Mes formations",
      shown: !organization || model === "training",
    },
  ];
  return links.filter((link) => link.shown);
}

export default function ProfileClient({ slug }: { slug: string }) {
  const router = useRouter();
  const { hydrated, isAuthenticated, customer, updateProfile, logout } = useCustomerAuth(slug);
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
      <AccountShell slug={slug} title="Mon compte">
        <Card className="p-6 text-center text-sm text-text-muted">Chargement…</Card>
      </AccountShell>
    );
  }

  return (
    <AccountShell slug={slug} title="Mon compte">
      <p className="text-sm text-text-muted">
        Bonjour{customer.firstName ? ` ${customer.firstName}` : ""}, retrouvez ici tout ce qui vous concerne.
      </p>
      {/* The sections first, as tiles: what the customer came for. The profile comes after. */}
      <nav aria-label="Mon espace client" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {accountLinks(organizationQuery.data).map(({ path, label }) => (
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

      <h2 className="pt-2 text-sm font-semibold text-text">Mes informations</h2>
      <Card className="p-4">
        <form onSubmit={handleSubmit} className="space-y-3 text-sm">
          <label className="block">
            <span className="mb-1 block text-text-muted">Adresse e-mail</span>
            <Input value={customer.email} disabled className="w-full" />
          </label>
          <label className="block">
            <span className="mb-1 block text-text-muted">Prénom</span>
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} className="w-full" />
          </label>
          <label className="block">
            <span className="mb-1 block text-text-muted">Nom</span>
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} className="w-full" />
          </label>
          <label className="block">
            <span className="mb-1 block text-text-muted">Téléphone</span>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full" />
          </label>

          {updateMutation.isError && (
            <p className="text-xs text-destructive">
              {updateMutation.error instanceof PublicApiError
                ? updateMutation.error.message
                : "Impossible de mettre à jour le profil."}
            </p>
          )}
          {updateMutation.isSuccess && <p className="text-xs text-green-700">Profil mis à jour.</p>}

          <Button type="submit" loading={updateMutation.isPending} className="w-full">
            Enregistrer
          </Button>
        </form>
      </Card>

      <button onClick={handleLogout} className="text-sm text-text-muted hover:underline">
        Se déconnecter
      </button>
    </AccountShell>
  );
}
