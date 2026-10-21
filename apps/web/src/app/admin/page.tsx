"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { BUSINESS_MODEL_DEFINITIONS, PLAN_KEYS, PLAN_NAMES } from "@korva/types";
import { Card, PageHeader } from "@korva/ui";
import { channelCount, formatMoney, type PlatformOverview, adminApi } from "@/lib/platform-admin";

/** The platform at a glance: who signed up, who is live, who pays, who needs a hand. */
export default function AdminOverviewPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["platform", "overview"],
    queryFn: () => adminApi.get<PlatformOverview>("/platform/overview"),
  });

  return (
    <div className="space-y-8">
      <PageHeader title="Vue d'ensemble" description="L'activité de toute la plateforme KORVA OS." />

      {isLoading && <p className="text-sm text-text-muted">Chargement…</p>}
      {isError && <p className="text-sm text-destructive">Impossible de charger les chiffres.</p>}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Entreprises" value={data.organizations} hint={`+${data.newLast7Days} cette semaine, +${data.newLast30Days} sur 30 jours`} />
            <Metric
              label="Sites en ligne"
              value={data.sitesOnline}
              hint={`${data.offersOnline} offres publiées`}
              href="/admin/entreprises"
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

          <Card className="overflow-hidden">
            <div className="p-6 pb-3">
              <h2 className="text-lg font-semibold">Par métier</h2>
              <p className="mt-1 text-sm text-text-muted">
                Chaque métier est mesuré sur son propre canal : commandes, réservations, devis ou prospects.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-y border-border bg-surface-muted text-left text-xs font-medium text-text-muted">
                  <tr>
                    <th className="px-6 py-2.5">Métier</th>
                    <th className="px-6 py-2.5">Entreprises</th>
                    <th className="px-6 py-2.5">Sites en ligne</th>
                    <th className="px-6 py-2.5">Activité sur 30 jours</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.byBusinessModel.map((group) => (
                    <tr key={group.businessModel}>
                      <td className="px-6 py-3 font-medium">
                        {group.businessModel === "none"
                          ? "Métier non renseigné"
                          : BUSINESS_MODEL_DEFINITIONS[group.businessModel].label}
                      </td>
                      <td className="px-6 py-3 tabular-nums">{group.organizations}</td>
                      <td className="px-6 py-3 tabular-nums">{group.sitesOnline}</td>
                      <td className="px-6 py-3 tabular-nums">{channelCount(group.activity30d, group.channel)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

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
              <h2 className="text-lg font-semibold">Entreprises par formule</h2>
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
