"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PLAN_KEYS, PLAN_NAMES } from "@korva/types";
import { Card, PageHeader } from "@korva/ui";
import { apiClient } from "@/lib/api-client";
import { formatMoney, type PlatformOverview } from "@/lib/platform-admin";

/** The platform at a glance: who signed up, who is live, who pays, who needs a hand. */
export default function AdminOverviewPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["platform", "overview"],
    queryFn: () => apiClient.get<PlatformOverview>("/platform/overview", { withOrganization: false }),
  });

  return (
    <div className="space-y-8">
      <PageHeader title="Vue d'ensemble" description="L'activité de toute la plateforme KORVA OS." />

      {isLoading && <p className="text-sm text-text-muted">Chargement…</p>}
      {isError && <p className="text-sm text-destructive">Impossible de charger les chiffres.</p>}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Commerces" value={data.organizations} hint={`+${data.newLast7Days} cette semaine, +${data.newLast30Days} sur 30 jours`} />
            <Metric
              label="Sites en ligne"
              value={data.sitesOnline}
              hint={`${data.offersOnline} offres publiées`}
              href="/admin/commerces"
            />
            <Metric label="Commandes (30 j)" value={data.ordersLast30Days} hint={`${data.bookingsLast30Days} réservations`} />
            <Metric
              label="Essais en cours"
              value={data.trialsRunning}
              hint={data.pastDue > 0 ? `${data.pastDue} impayé(s)` : "Aucun impayé"}
              href="/admin/abonnements?filtre=trial"
              warn={data.pastDue > 0}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-6">
              <h2 className="text-lg font-semibold">Revenus mensuels attendus</h2>
              <p className="mt-1 text-sm text-text-muted">
                Somme des formules payantes actives, par devise de facturation.
              </p>
              {Object.keys(data.monthlyRevenueByCurrency).length === 0 ? (
                <p className="mt-4 text-sm text-text-muted">Aucune formule payante pour l&apos;instant.</p>
              ) : (
                <ul className="mt-4 space-y-2">
                  {Object.entries(data.monthlyRevenueByCurrency).map(([currency, amount]) => (
                    <li key={currency} className="flex items-baseline justify-between border-b border-border pb-2 last:border-0">
                      <span className="text-sm text-text-muted">{currency}</span>
                      <span className="font-display text-2xl font-semibold tabular-nums">{formatMoney(amount, currency)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="p-6">
              <h2 className="text-lg font-semibold">Commerces par formule</h2>
              <ul className="mt-4 space-y-3">
                {PLAN_KEYS.map((plan) => {
                  const count = data.organizationsByPlan[plan] ?? 0;
                  const share = data.organizations ? (count / data.organizations) * 100 : 0;
                  return (
                    <li key={plan}>
                      <div className="flex justify-between text-sm">
                        <span>{PLAN_NAMES[plan]}</span>
                        <span className="tabular-nums text-text-muted">{count}</span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  href,
  warn,
}: {
  label: string;
  value: number;
  hint: string;
  href?: string;
  warn?: boolean;
}) {
  const body = (
    <Card className="h-full p-5 transition-colors hover:border-border-input">
      <p className="text-sm text-text-muted">{label}</p>
      <p className="mt-1 font-display text-3xl font-semibold tabular-nums">{value}</p>
      <p className={`mt-1 text-xs ${warn ? "font-medium text-warning" : "text-text-muted"}`}>{hint}</p>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
