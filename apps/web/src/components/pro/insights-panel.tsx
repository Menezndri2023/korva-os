"use client";

import { useQuery } from "@tanstack/react-query";
import type { AnalyticsComparedFigure, AnalyticsInsights } from "@korva/types";
import { Card, SkeletonList, StatTile, Table, Td, Th } from "@korva/ui";
import { apiClient } from "@/lib/api-client";
import { formatCurrency } from "@/lib/analytics-format";
import { usePlanFeatures } from "@/lib/use-plan-features";
import { UpgradeCard } from "./upgrade-card";

/** "+12 % vs 30 jours précédents", or what to say when there is nothing to compare with. */
function comparison(figure: AnalyticsComparedFigure, days: number): {
  hint: string;
  trend?: "positive" | "negative";
} {
  const against = `vs ${days} jours précédents`;
  if (figure.previous === 0) {
    return { hint: figure.current === 0 ? `Aucune ${against}` : `Nouveau ${against}` };
  }
  const change = Math.round(((figure.current - figure.previous) / figure.previous) * 100);
  if (change === 0) return { hint: `Stable ${against}` };
  return {
    hint: `${change > 0 ? "+" : ""}${change} % ${against}`,
    trend: change > 0 ? "positive" : "negative",
  };
}

/**
 * Pro statistics: the period against the one before it, and who and what sold the most. Shown
 * as an invitation to upgrade below Pro.
 */
export function InsightsPanel({
  days,
  showOrders,
  showBookings,
}: {
  days: number;
  showOrders: boolean;
  showBookings: boolean;
}) {
  const planFeatures = usePlanFeatures();
  const included = planFeatures.has("advanced_analytics");
  // Only once the plan is known: the hook reads every feature as included while it loads, which
  // is right for a lock badge but would send a request the API refuses.
  const ready = planFeatures.planKey !== undefined && included;
  const { data, isLoading, isError } = useQuery({
    queryKey: ["analytics", "insights", days],
    queryFn: () => apiClient.get<AnalyticsInsights>(`/analytics/insights?days=${days}`),
    enabled: ready,
  });

  if (!included) {
    return (
      <UpgradeCard
        feature="advanced_analytics"
        description="Comparez chaque période à la précédente et voyez vos meilleurs clients et vos meilleures ventes."
      />
    );
  }

  return (
    <section aria-labelledby="insights-title" className="space-y-4">
      <h2 id="insights-title" className="text-base font-semibold text-text">
        Analyse de la période
      </h2>
      {isLoading && <SkeletonList rows={3} />}
      {isError && <p className="text-sm text-destructive">Impossible de charger l&apos;analyse.</p>}
      {data && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {showOrders && (
              <>
                <StatTile
                  tone="emphasis"
                  label="Ventes"
                  value={formatCurrency(data.ordersRevenue.current, data.currency)}
                  {...comparison(data.ordersRevenue, days)}
                />
                <StatTile
                  label="Panier moyen"
                  value={formatCurrency(data.averageOrder.current, data.currency)}
                  {...comparison(data.averageOrder, days)}
                />
              </>
            )}
            {showBookings && (
              <>
                {/* Without orders, what the bookings brought in IS the period's sales figure. */}
                <StatTile
                  tone={showOrders ? "default" : "emphasis"}
                  label="Montant des réservations"
                  value={formatCurrency(data.bookingsValue.current, data.currency)}
                  {...comparison(data.bookingsValue, days)}
                />
                <StatTile
                  label="Réservations"
                  value={data.bookingsCount.current}
                  {...comparison(data.bookingsCount, days)}
                />
              </>
            )}
            <StatTile
              label="Nouveaux clients"
              value={data.newContacts.current}
              {...comparison(data.newContacts, days)}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="overflow-hidden">
              <h3 className="px-5 pt-5 text-sm font-semibold text-text">Meilleurs clients</h3>
              {data.topCustomers.length === 0 ? (
                <p className="p-5 text-sm text-text-muted">Pas encore de vente sur la période.</p>
              ) : (
                <Table caption="Meilleurs clients de la période">
                  <thead>
                    <tr>
                      <Th>Client</Th>
                      <Th align="right">Achats</Th>
                      <Th align="right">Montant</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topCustomers.map((customer) => (
                      <tr key={customer.contactId}>
                        <Td>{customer.name}</Td>
                        <Td numeric>{customer.count}</Td>
                        <Td numeric>{formatCurrency(customer.total, data.currency)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
            <Card className="overflow-hidden">
              <h3 className="px-5 pt-5 text-sm font-semibold text-text">Meilleures ventes</h3>
              {data.topOffers.length === 0 ? (
                <p className="p-5 text-sm text-text-muted">Pas encore de vente sur la période.</p>
              ) : (
                <Table caption="Meilleures ventes de la période">
                  <thead>
                    <tr>
                      <Th>Offre</Th>
                      <Th align="right">Quantité</Th>
                      <Th align="right">Montant</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topOffers.map((offer) => (
                      <tr key={offer.offerId ?? offer.name}>
                        <Td>{offer.name}</Td>
                        <Td numeric>{offer.quantity}</Td>
                        <Td numeric>{formatCurrency(offer.total, data.currency)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          </div>
        </>
      )}
    </section>
  );
}
