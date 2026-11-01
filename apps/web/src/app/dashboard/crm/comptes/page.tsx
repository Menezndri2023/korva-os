"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CustomerAccountSummary } from "@korva/types";
import { Card, EmptyState, Input, SkeletonList, Table, Td, Th } from "@korva/ui";
import { apiClient } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { usePlanFeatures } from "@/lib/use-plan-features";
import { UpgradeCard } from "@/components/pro/upgrade-card";
import { AccountStatus, CustomerAccountActions, formatSeen } from "@/components/customer-account-actions";

/**
 * Clients › Espaces clients: the customers who created an account on the business's site, when
 * they last signed in, and what the business can do about each account.
 */
export default function CustomerAccountsPage() {
  const authReady = useAuthReady();
  const planFeatures = usePlanFeatures();
  const [search, setSearch] = useState("");
  const term = search.trim();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["customer-accounts", term],
    queryFn: () =>
      apiClient.get<CustomerAccountSummary[]>(
        `/customer-accounts${term ? `?search=${encodeURIComponent(term)}` : ""}`,
      ),
    enabled: authReady,
  });

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-text-muted">
        Vos clients peuvent créer un compte sur votre site pour retrouver leurs commandes, réservations
        et factures. Vous ne voyez jamais leur mot de passe : envoyez-leur un lien s&apos;ils l&apos;ont oublié.
      </p>

      {planFeatures.planKey !== undefined && !planFeatures.has("customer_accounts") && (
        <UpgradeCard
          feature="customer_accounts"
          description="Laissez vos clients créer un compte sur votre site pour suivre leurs achats et leurs réservations."
        />
      )}

      <label className="block max-w-sm text-sm">
        <span className="sr-only">Rechercher un compte par e-mail</span>
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Rechercher par e-mail"
          className="w-full"
        />
      </label>

      {isLoading && <SkeletonList rows={3} />}
      {isError && <p className="text-sm text-destructive">Impossible de charger les espaces clients.</p>}
      {data && data.length === 0 && (
        <Card>
          <EmptyState
            title={term ? `Aucun compte ne correspond à « ${term} ».` : "Aucun client n'a encore créé de compte."}
            description={term ? undefined : "Le lien « Se connecter » de votre site leur permet d'en créer un."}
          />
        </Card>
      )}
      {data && data.length > 0 && (
        <Card className="overflow-hidden">
          <Table caption="Espaces clients">
            <thead>
              <tr>
                <Th>Client</Th>
                <Th>État</Th>
                <Th>Créé le</Th>
                <Th>Dernière connexion</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {data.map((account) => (
                <tr key={account.id}>
                  <Td>
                    <Link href={`/dashboard/crm/${account.contactId}`} className="font-medium hover:underline">
                      {account.name || account.email}
                    </Link>
                    {account.name && <span className="block text-xs text-text-muted">{account.email}</span>}
                  </Td>
                  <Td>
                    <AccountStatus account={account} />
                  </Td>
                  <Td>{new Date(account.createdAt).toLocaleDateString("fr-FR")}</Td>
                  <Td>{formatSeen(account.lastLoginAt)}</Td>
                  <Td>
                    <CustomerAccountActions account={account} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
