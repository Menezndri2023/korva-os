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
import { intlLocale, useDashboardLocale, useT } from "@/lib/dashboard-locale";

/**
 * Clients › Espaces clients: the customers who created an account on the business's site, when
 * they last signed in, and what the business can do about each account.
 */
export default function CustomerAccountsPage() {
  const authReady = useAuthReady();
  const planFeatures = usePlanFeatures();
  const locale = useDashboardLocale();
  const t = useT();
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
        {t(
          "Vos clients peuvent créer un compte sur votre site pour retrouver leurs commandes, réservations et factures. Vous ne voyez jamais leur mot de passe : envoyez-leur un lien s'ils l'ont oublié.",
          "Your customers can create an account on your website to find their orders, bookings and invoices. You never see their password: send them a link if they forget it.",
        )}
      </p>

      {planFeatures.planKey !== undefined && !planFeatures.has("customer_accounts") && (
        <UpgradeCard
          feature="customer_accounts"
          description={t(
            "Laissez vos clients créer un compte sur votre site pour suivre leurs achats et leurs réservations.",
            "Let your customers create an account on your website to follow their purchases and bookings.",
          )}
        />
      )}

      <label className="block max-w-sm text-sm">
        <span className="sr-only">{t("Rechercher un compte par e-mail", "Search for an account by e-mail")}</span>
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("Rechercher par e-mail", "Search by e-mail")}
          className="w-full"
        />
      </label>

      {isLoading && <SkeletonList rows={3} />}
      {isError && <p className="text-sm text-destructive">{t("Impossible de charger les espaces clients.", "Customer accounts could not be loaded.")}</p>}
      {data && data.length === 0 && (
        <Card>
          <EmptyState
            title={
              term
                ? t(`Aucun compte ne correspond à « ${term} ».`, `No account matches “${term}”.`)
                : t("Aucun client n'a encore créé de compte.", "No customer has created an account yet.")
            }
            description={
              term
                ? undefined
                : t(
                    "Le lien « Se connecter » de votre site leur permet d'en créer un.",
                    "The “Sign in” link on your website lets them create one.",
                  )
            }
          />
        </Card>
      )}
      {data && data.length > 0 && (
        <Card className="overflow-hidden">
          <Table caption={t("Espaces clients", "Customer accounts")}>
            <thead>
              <tr>
                <Th>{t("Client", "Customer")}</Th>
                <Th>{t("État", "Status")}</Th>
                <Th>{t("Créé le", "Created")}</Th>
                <Th>{t("Dernière connexion", "Last sign-in")}</Th>
                <Th>
                  <span className="sr-only">{t("Actions", "Actions")}</span>
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
                  <Td>{new Date(account.createdAt).toLocaleDateString(intlLocale(locale))}</Td>
                  <Td>{formatSeen(account.lastLoginAt, locale)}</Td>
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
