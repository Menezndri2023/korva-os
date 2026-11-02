"use client";

import { useQuery } from "@tanstack/react-query";
import type { AnalyticsComparedFigure, AnalyticsInsights } from "@korva/types";
import { Card, SkeletonList, StatTile, Table, Td, Th } from "@korva/ui";
import { apiClient } from "@/lib/api-client";
import { formatCurrency } from "@/lib/analytics-format";
import { usePlanFeatures } from "@/lib/use-plan-features";
import { UpgradeCard } from "./upgrade-card";
import { useDashboardLocale, useT, type Translate } from "@/lib/dashboard-locale";

/** "+12 % vs 30 jours précédents", or what to say when there is nothing to compare with. */
function comparison(
  figure: AnalyticsComparedFigure,
  days: number,
  t: Translate,
): {
  hint: string;
  trend?: "positive" | "negative";
} {
  const against = t(`vs ${days} jours précédents`, `vs previous ${days} days`);
  if (figure.previous === 0) {
    return { hint: figure.current === 0 ? t(`Aucune ${against}`, `None ${against}`) : t(`Nouveau ${against}`, `New ${against}`) };
  }
  const change = Math.round(((figure.current - figure.previous) / figure.previous) * 100);
  if (change === 0) return { hint: t(`Stable ${against}`, `Steady ${against}`) };
  return {
    hint: t(`${change > 0 ? "+" : ""}${change} % ${against}`, `${change > 0 ? "+" : ""}${change}% ${against}`),
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
  const locale = useDashboardLocale();
  const t = useT();
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
        description={t(
          "Comparez chaque période à la précédente et voyez vos meilleurs clients et vos meilleures ventes.",
          "Compare each period with the one before and see your best customers and best sellers.",
        )}
      />
    );
  }

  return (
    <section aria-labelledby="insights-title" className="space-y-4">
      <h2 id="insights-title" className="text-base font-semibold text-text">
        {t("Analyse de la période", "Period analysis")}
      </h2>
      {isLoading && <SkeletonList rows={3} />}
      {isError && <p className="text-sm text-destructive">{t("Impossible de charger l'analyse.", "The analysis could not be loaded.")}</p>}
      {data && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {showOrders && (
              <>
                <StatTile
                  tone="emphasis"
                  label={t("Ventes", "Sales")}
                  value={formatCurrency(data.ordersRevenue.current, data.currency, locale)}
                  {...comparison(data.ordersRevenue, days, t)}
                />
                <StatTile
                  label={t("Panier moyen", "Average basket")}
                  value={formatCurrency(data.averageOrder.current, data.currency, locale)}
                  {...comparison(data.averageOrder, days, t)}
                />
              </>
            )}
            {showBookings && (
              <>
                {/* Without orders, what the bookings brought in IS the period's sales figure. */}
                <StatTile
                  tone={showOrders ? "default" : "emphasis"}
                  label={t("Montant des réservations", "Bookings value")}
                  value={formatCurrency(data.bookingsValue.current, data.currency, locale)}
                  {...comparison(data.bookingsValue, days, t)}
                />
                <StatTile
                  label={t("Réservations", "Bookings")}
                  value={data.bookingsCount.current}
                  {...comparison(data.bookingsCount, days, t)}
                />
              </>
            )}
            <StatTile
              label={t("Nouveaux clients", "New customers")}
              value={data.newContacts.current}
              {...comparison(data.newContacts, days, t)}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="overflow-hidden">
              <h3 className="px-5 pt-5 text-sm font-semibold text-text">{t("Meilleurs clients", "Best customers")}</h3>
              {data.topCustomers.length === 0 ? (
                <p className="p-5 text-sm text-text-muted">{t("Pas encore de vente sur la période.", "No sales in this period yet.")}</p>
              ) : (
                <Table caption={t("Meilleurs clients de la période", "Best customers of the period")}>
                  <thead>
                    <tr>
                      <Th>{t("Client", "Customer")}</Th>
                      <Th align="right">{t("Achats", "Purchases")}</Th>
                      <Th align="right">{t("Montant", "Amount")}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topCustomers.map((customer) => (
                      <tr key={customer.contactId}>
                        <Td>{customer.name}</Td>
                        <Td numeric>{customer.count}</Td>
                        <Td numeric>{formatCurrency(customer.total, data.currency, locale)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
            <Card className="overflow-hidden">
              <h3 className="px-5 pt-5 text-sm font-semibold text-text">{t("Meilleures ventes", "Best sellers")}</h3>
              {data.topOffers.length === 0 ? (
                <p className="p-5 text-sm text-text-muted">{t("Pas encore de vente sur la période.", "No sales in this period yet.")}</p>
              ) : (
                <Table caption={t("Meilleures ventes de la période", "Best sellers of the period")}>
                  <thead>
                    <tr>
                      <Th>{t("Offre", "Offer")}</Th>
                      <Th align="right">{t("Quantité", "Quantity")}</Th>
                      <Th align="right">{t("Montant", "Amount")}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topOffers.map((offer) => (
                      <tr key={offer.offerId ?? offer.name}>
                        <Td>{offer.name}</Td>
                        <Td numeric>{offer.quantity}</Td>
                        <Td numeric>{formatCurrency(offer.total, data.currency, locale)}</Td>
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
