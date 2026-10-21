"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Suspense } from "react";
import { PLAN_NAMES, type PlanKey } from "@korva/types";
import { Badge, Card, PageHeader } from "@korva/ui";
import { apiClient } from "@/lib/api-client";
import {
  SUBSCRIPTION_STATUS_LABELS,
  formatDay,
  formatMoney,
  type PlatformSubscriptionRow,
} from "@/lib/platform-admin";

const FILTERS = [
  { key: "all", label: "Tous" },
  { key: "paid", label: "Payants" },
  { key: "trial", label: "En essai" },
  { key: "past_due", label: "Impayés" },
  { key: "canceling", label: "Résiliation demandée" },
] as const;

/** Every subscription, filtered by what needs attention: trials ending, unpaid, cancelling. */
export default function AdminSubscriptionsPage() {
  // useSearchParams needs a Suspense boundary to prerender this route.
  return (
    <Suspense fallback={<p className="text-sm text-text-muted">Chargement…</p>}>
      <SubscriptionsList />
    </Suspense>
  );
}

function SubscriptionsList() {
  const filter = useSearchParams().get("filtre") ?? "all";
  const { data, isLoading, isError } = useQuery({
    queryKey: ["platform", "subscriptions", filter],
    queryFn: () =>
      apiClient.get<PlatformSubscriptionRow[]>(`/platform/subscriptions?filter=${filter}`, { withOrganization: false }),
  });

  return (
    <div>
      <PageHeader title="Abonnements" description="Formules, essais en cours et impayés de tous les commerces." />
      <nav aria-label="Filtrer les abonnements" className="flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <Link
            key={item.key}
            href={item.key === "all" ? "/admin/abonnements" : `/admin/abonnements?filtre=${item.key}`}
            aria-current={filter === item.key ? "page" : undefined}
            className={`rounded-full border px-3 py-1.5 text-sm ${
              filter === item.key
                ? "border-primary bg-primary font-semibold text-on-primary"
                : "border-border-input bg-surface hover:bg-surface-muted"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <Card className="mt-4 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium text-text-muted">
              <tr>
                <th className="px-4 py-2.5">Commerce</th>
                <th className="px-4 py-2.5">Formule</th>
                <th className="px-4 py-2.5">Statut</th>
                <th className="px-4 py-2.5">Période jusqu&apos;au</th>
                <th className="px-4 py-2.5">Essai</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (
                <tr><td colSpan={5} className="px-4 py-6 text-text-muted">Chargement…</td></tr>
              )}
              {isError && (
                <tr><td colSpan={5} className="px-4 py-6 text-destructive">Impossible de charger les abonnements.</td></tr>
              )}
              {data?.map((row) => (
                <tr key={row.organizationId}>
                  <td className="px-4 py-3">
                    <Link href={`/admin/entreprises/${row.organizationId}`} className="font-medium hover:underline">
                      {row.organizationName}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {row.planName}
                    {row.priceAmount > 0 && (
                      <span className="text-text-muted"> · {formatMoney(row.priceAmount, row.priceCurrency)}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={row.status === "past_due" ? "destructive" : "default"}>
                      {SUBSCRIPTION_STATUS_LABELS[row.status] ?? row.status}
                    </Badge>
                    {row.cancelAtPeriodEnd && <Badge variant="warning" className="ml-1">Résiliation</Badge>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatDay(row.currentPeriodEnd)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {row.trialEndsAt
                      ? `${PLAN_NAMES[row.trialPlanKey as PlanKey] ?? row.trialPlanKey} → ${formatDay(row.trialEndsAt)}`
                      : "—"}
                  </td>
                </tr>
              ))}
              {data && data.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-text-muted">Aucun abonnement dans cette catégorie.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
