"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, PageHeader } from "@korva/ui";
import { formatMoney, type PlatformPlanRow, adminApi } from "@/lib/platform-admin";

function limitText(value: number | undefined): string {
  if (value === undefined) return "—";
  return value === -1 ? "Illimité" : String(value);
}

/**
 * The plan catalog exactly as billing uses it: one row per tier and currency, with its limits and
 * how many businesses subscribe. Read-only on purpose — prices live in @korva/types (PLAN_PRICES)
 * and are seeded at deploy, so a change goes through the code and its review.
 */
export default function AdminPlansPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["platform", "plans"],
    queryFn: () => adminApi.get<PlatformPlanRow[]>("/platform/plans"),
  });
  const currencies = [...new Set((data ?? []).map((plan) => plan.priceCurrency))];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Formules"
        description="Le catalogue appliqué par la facturation, pays par pays. Les prix se modifient dans le code (PLAN_PRICES), puis au déploiement."
      />
      {isLoading && <p className="text-sm text-text-muted">Chargement…</p>}
      {isError && <p className="text-sm text-destructive">Impossible de charger les formules.</p>}
      {currencies.map((currency) => (
        <Card key={currency} className="overflow-hidden">
          <h2 className="px-6 pt-5 text-lg font-semibold">{currency}</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-border bg-surface-muted text-left text-xs font-medium text-text-muted">
                <tr>
                  <th className="px-6 py-2.5">Formule</th>
                  <th className="px-6 py-2.5">Prix / mois</th>
                  <th className="px-6 py-2.5">Utilisateurs</th>
                  <th className="px-6 py-2.5">Offres</th>
                  <th className="px-6 py-2.5">Équipe réservable</th>
                  <th className="px-6 py-2.5">Modules</th>
                  <th className="px-6 py-2.5">Abonnés</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data!
                  .filter((plan) => plan.priceCurrency === currency)
                  .map((plan) => (
                    <tr key={`${plan.key}-${currency}`}>
                      <td className="px-6 py-3 font-medium">{plan.name}</td>
                      <td className="px-6 py-3 tabular-nums">{formatMoney(plan.priceAmount, plan.priceCurrency)}</td>
                      <td className="px-6 py-3">{limitText(plan.limits.seats)}</td>
                      <td className="px-6 py-3">{limitText(plan.limits.offers)}</td>
                      <td className="px-6 py-3">{limitText(plan.limits.bookable_staff)}</td>
                      <td className="px-6 py-3 tabular-nums">{plan.modules.length}</td>
                      <td className="px-6 py-3 tabular-nums">{plan.subscribers}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}
