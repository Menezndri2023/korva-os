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

/**
 * The account sections this business actually has: a clothing shop's customer has no "Mes
 * formations", a salon's no "Mes retours". Until the business is known, every section is listed
 * (each page handles being empty on its own).
 */
export function accountLinks(organization: PublicOrganization | undefined): { path: string; label: string }[] {
  const on = (module: string) => !organization || organization.enabledModules.includes(module);
  const links: { path: string; label: string; shown: boolean }[] = [
    { path: "orders", label: "Mes commandes", shown: on("commerce") },
    { path: "bookings", label: "Mes réservations", shown: on("booking") },
    { path: "quotes", label: "Mes devis", shown: on("finance") || organization?.businessModel === "quotes" },
    { path: "returns", label: "Mes retours", shown: on("commerce") && organization?.businessModel !== "restaurant" },
    { path: "wishlist", label: "Ma liste de souhaits", shown: on("catalog") && on("commerce") },
    {
      path: "learning",
      label: "Mes formations",
      shown: !organization || organization.businessModel === "training",
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
      <nav aria-label="Mon espace client" className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {accountLinks(organizationQuery.data).map(({ path, label }) => (
          <Link key={path} href={`/${slug}/account/${path}`} className="font-medium text-text hover:underline">
            {label}
          </Link>
        ))}
      </nav>

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
