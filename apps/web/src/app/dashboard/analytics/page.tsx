"use client";

import { useMemo, useState } from "react";
import { Badge, Card } from "@korva/ui";
import { visibleTradeTools, type AnalyticsRevenuePoint, type DataExportKind } from "@korva/types";
import { useActiveOrganization } from "@/lib/use-active-organization";
import { InsightsPanel } from "@/components/pro/insights-panel";
import { ExportPanel } from "@/components/pro/export-panel";
import {
  useAnalyticsActivity,
  useAnalyticsOverview,
  useAnalyticsRevenue,
  useInventoryDeadStock,
  useInventoryTurnover,
  useInventoryValuation,
} from "@/lib/use-analytics";
import {
  activityActionLabel,
  ACTIVITY_ENTITY_LABELS,
  ACTIVITY_ENTITY_LABELS_EN,
  formatCurrency,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_LABELS_EN,
  labelIn,
  LEAD_STATUS_LABELS,
  LEAD_STATUS_LABELS_EN,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_LABELS_EN,
} from "@/lib/analytics-format";
import { intlLocale, useDashboardLocale, useT } from "@/lib/dashboard-locale";

const PERIODS = [
  { days: 7, interval: "day" as const },
  { days: 30, interval: "day" as const },
  { days: 90, interval: "week" as const },
];

function rangeForDays(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export default function AnalyticsPage() {
  const [periodIndex, setPeriodIndex] = useState(1);
  const locale = useDashboardLocale();
  const t = useT();
  const en = locale === "en";
  const period = PERIODS[periodIndex]!;
  const range = useMemo(() => rangeForDays(period.days), [period.days]);

  const overviewQuery = useAnalyticsOverview(range);
  const revenueQuery = useAnalyticsRevenue({ ...range, interval: period.interval });
  const activityQuery = useAnalyticsActivity(8);
  const turnoverQuery = useInventoryTurnover(30);
  const deadStockQuery = useInventoryDeadStock(90);
  const valuationQuery = useInventoryValuation();
  const { data: organization } = useActiveOrganization();
  // The Pro tools follow the trade, like the menu: no orders to analyse or export for a salon.
  const tools = visibleTradeTools(organization?.businessModel, organization?.extraTools);
  const enabled = new Set(organization?.enabledModules ?? []);
  // Until the organization is known, everything shows, as before this followed the trade.
  const showOrders = !organization || (tools.has("orders") && enabled.has("commerce"));
  const showBookings = !organization || (tools.has("bookings") && enabled.has("booking"));
  const exportKinds: DataExportKind[] = [
    ...(showOrders ? (["orders"] as const) : []),
    ...(showBookings ? (["bookings"] as const) : []),
    "contacts",
    "sales-journal",
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("Statistiques", "Statistics")}</h1>
          <p className="mt-1 text-sm text-text-muted">
            {t("Vue d'ensemble de l'activité de votre organisation.", "An overview of your organization's activity.")}
          </p>
        </div>
        <div className="flex gap-1 rounded-md border border-border p-1">
          {PERIODS.map((p, index) => (
            <button
              key={p.days}
              type="button"
              onClick={() => setPeriodIndex(index)}
              className={`rounded px-3 py-1.5 text-sm font-medium ${
                index === periodIndex
                  ? "bg-sidebar text-text-primary"
                  : "text-text-muted hover:bg-surface-muted"
              }`}
            >
              {t(`${p.days} jours`, `${p.days} days`)}
            </button>
          ))}
        </div>
      </div>

      <InsightsPanel days={period.days} showOrders={showOrders} showBookings={showBookings} />

      {overviewQuery.isLoading && <KpiCardsSkeleton />}

      {overviewQuery.isError && (
        <Card className="p-6">
          <p className="text-sm text-destructive">
            {t("Impossible de charger les statistiques.", "Statistics could not be loaded.")}
          </p>
          <button
            onClick={() => overviewQuery.refetch()}
            className="mt-2 text-sm font-medium text-text underline"
          >
            {t("Réessayer", "Try again")}
          </button>
        </Card>
      )}

      {overviewQuery.data && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
            <KpiCard
              label={t("Prospects", "Leads")}
              value={overviewQuery.data.leads.total}
              breakdown={overviewQuery.data.leads.byStatus}
              labels={en ? LEAD_STATUS_LABELS_EN : LEAD_STATUS_LABELS}
            />
            {/* Each figure only for a trade that has it: no orders for a salon, no bookings for a shop. */}
            {showBookings && (
              <KpiCard
                label={t("Réservations", "Bookings")}
                value={overviewQuery.data.bookings.total}
                detail={t(`${overviewQuery.data.bookings.upcoming} à venir`, `${overviewQuery.data.bookings.upcoming} upcoming`)}
              />
            )}
            {showOrders && (
              <KpiCard
                label={t("Chiffre d'affaires", "Revenue")}
                value={formatCurrency(overviewQuery.data.orders.revenue, overviewQuery.data.orders.currency, locale)}
                detail={
                  en
                    ? `${overviewQuery.data.orders.total} order${overviewQuery.data.orders.total === 1 ? "" : "s"}`
                    : `${overviewQuery.data.orders.total} commande${overviewQuery.data.orders.total > 1 ? "s" : ""}`
                }
              />
            )}
            <KpiCard
              label={t("Encours factures", "Unpaid invoices")}
              value={formatCurrency(
                overviewQuery.data.invoices.outstanding,
                overviewQuery.data.invoices.currency,
                locale,
              )}
              detail={
                en
                  ? `${overviewQuery.data.invoices.total} invoice${overviewQuery.data.invoices.total === 1 ? "" : "s"}`
                  : `${overviewQuery.data.invoices.total} facture${overviewQuery.data.invoices.total > 1 ? "s" : ""}`
              }
            />
          </div>

          {showOrders && (
          <Card className="p-6">
            <h2 className="text-sm font-medium text-text">{t("Chiffre d'affaires", "Revenue")}</h2>
            <div className="mt-4">
              {revenueQuery.isLoading && (
                <p className="py-8 text-center text-sm text-text-muted">{t("Chargement...", "Loading...")}</p>
              )}
              {revenueQuery.data && revenueQuery.data.points.length === 0 && (
                <EmptyState
                  title={t("Aucune donnée disponible pour cette période", "No data for this period")}
                  description={t(
                    "Les données apparaîtront dès que vous aurez des commandes confirmées.",
                    "Figures will appear as soon as you have confirmed orders.",
                  )}
                />
              )}
              {revenueQuery.data && revenueQuery.data.points.length > 0 && (
                <RevenueChart
                  points={revenueQuery.data.points}
                  currency={revenueQuery.data.currency}
                  locale={locale}
                />
              )}
            </div>
          </Card>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[repeat(auto-fit,minmax(260px,1fr))]">
            {showOrders && (
              <StatusBreakdownCard
                title={t("Commandes par statut", "Orders by status")}
                byStatus={overviewQuery.data.orders.byStatus}
                labels={en ? ORDER_STATUS_LABELS_EN : ORDER_STATUS_LABELS}
                emptyMessage={t("Aucune commande sur cette période.", "No orders in this period.")}
              />
            )}
            <StatusBreakdownCard
              title={t("Prospects par statut", "Leads by status")}
              byStatus={overviewQuery.data.leads.byStatus}
              labels={en ? LEAD_STATUS_LABELS_EN : LEAD_STATUS_LABELS}
              emptyMessage={t("Aucun prospect sur cette période.", "No leads in this period.")}
            />
            <StatusBreakdownCard
              title={t("Factures par statut", "Invoices by status")}
              byStatus={overviewQuery.data.invoices.byStatus}
              labels={en ? INVOICE_STATUS_LABELS_EN : INVOICE_STATUS_LABELS}
              emptyMessage={t("Aucune facture sur cette période.", "No invoices in this period.")}
            />
          </div>

          <Card className="p-6">
            <h2 className="text-sm font-medium text-text">{t("Activité récente", "Recent activity")}</h2>
            <div className="mt-4">
              {activityQuery.isLoading && (
                <p className="text-sm text-text-muted">{t("Chargement...", "Loading...")}</p>
              )}
              {activityQuery.data && activityQuery.data.length === 0 && (
                <EmptyState
                  title={t("Aucune activité récente", "No recent activity")}
                  description={t(
                    "Les actions effectuées dans votre organisation apparaîtront ici.",
                    "Actions taken in your organization will appear here.",
                  )}
                />
              )}
              {activityQuery.data && activityQuery.data.length > 0 && (
                <ul className="divide-y divide-border">
                  {activityQuery.data.map((entry) => (
                    <li key={entry.id} className="flex items-center justify-between py-2 text-sm">
                      <span className="text-text">
                        {labelIn(ACTIVITY_ENTITY_LABELS, ACTIVITY_ENTITY_LABELS_EN, entry.entity, locale)}{" "}
                        <span className="text-text-muted">
                          {activityActionLabel(entry.entity, entry.action, locale)}
                        </span>
                      </span>
                      <span className="text-text-muted">
                        {new Date(entry.createdAt).toLocaleString(intlLocale(locale))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          {turnoverQuery.data && turnoverQuery.data.length > 0 && (
            <InventorySection
              turnover={turnoverQuery.data}
              deadStock={deadStockQuery.data ?? []}
              valuation={valuationQuery.data}
            />
          )}
        </>
      )}

      <ExportPanel kinds={exportKinds} />
    </div>
  );
}

/** Phase C3 (docs/KORVA_OS_V2_AUDIT.md §2.4) — hidden entirely for an org with no tracked
 *  inventory at all, rather than showing three empty cards. */
function InventorySection({
  turnover,
  deadStock,
  valuation,
}: {
  turnover: NonNullable<ReturnType<typeof useInventoryTurnover>["data"]>;
  deadStock: NonNullable<ReturnType<typeof useInventoryDeadStock>["data"]>;
  valuation: ReturnType<typeof useInventoryValuation>["data"];
}) {
  const locale = useDashboardLocale();
  const t = useT();
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="p-6">
        <h2 className="text-sm font-medium text-text">{t("Rotation des stocks (30 jours)", "Stock turnover (30 days)")}</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {[...turnover]
            .sort((a, b) => b.unitsSoldInPeriod - a.unitsSoldInPeriod)
            .slice(0, 8)
            .map((entry) => (
              <li key={entry.offerId} className="flex items-center justify-between">
                <span className="text-text">{entry.offerName}</span>
                <span className="text-text-muted">
                  {t(
                    `${entry.unitsSoldInPeriod} vendu(s) · ${entry.currentStock} en stock`,
                    `${entry.unitsSoldInPeriod} sold · ${entry.currentStock} in stock`,
                  )}
                </span>
              </li>
            ))}
        </ul>
      </Card>

      <Card className="p-6">
        <h2 className="text-sm font-medium text-text">{t("Stock dormant (90 jours)", "Dead stock (90 days)")}</h2>
        {deadStock.length === 0 ? (
          <p className="mt-3 text-sm text-text-muted">{t("Aucun stock dormant détecté.", "No dead stock found.")}</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {deadStock.slice(0, 8).map((entry) => (
              <li key={entry.offerId} className="flex items-center justify-between">
                <span className="text-text">{entry.offerName}</span>
                <span className="text-text-muted">
                  {t(`${entry.currentStock} en stock`, `${entry.currentStock} in stock`)} ·{" "}
                  {entry.lastSoldAt
                    ? t(
                        `vendu le ${new Date(entry.lastSoldAt).toLocaleDateString("fr-FR")}`,
                        `last sold ${new Date(entry.lastSoldAt).toLocaleDateString(intlLocale(locale))}`,
                      )
                    : t("jamais vendu", "never sold")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-6">
        <h2 className="text-sm font-medium text-text">{t("Valorisation du stock", "Stock value")}</h2>
        {valuation ? (
          <>
            <p className="mt-3 text-2xl font-semibold text-text">
              {formatCurrency(valuation.totalValue, valuation.currency, locale)}
            </p>
            {valuation.unvaluedOfferCount > 0 && (
              <p className="mt-1 text-xs text-text-muted">
                {t(
                  `${valuation.unvaluedOfferCount} offre(s) sans coût connu, exclue(s) du total.`,
                  `${valuation.unvaluedOfferCount} offer(s) with no known cost, left out of the total.`,
                )}
              </p>
            )}
          </>
        ) : (
          <p className="mt-3 text-sm text-text-muted">{t("Chargement...", "Loading...")}</p>
        )}
      </Card>
    </div>
  );
}

function KpiCard({
  label,
  value,
  detail,
  breakdown,
  labels,
}: {
  label: string;
  value: number | string;
  detail?: string;
  breakdown?: Partial<Record<string, number>>;
  labels?: Record<string, string>;
}) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-text">{value}</p>
      {detail && <p className="mt-1 text-xs text-text-muted">{detail}</p>}
      {breakdown && labels && (
        <div className="mt-2 flex flex-wrap gap-1">
          {Object.entries(breakdown)
            .filter((entry): entry is [string, number] => entry[1] !== undefined && entry[1] > 0)
            .map(([status, count]) => (
              <Badge key={status}>{labels[status] ?? status}: {count}</Badge>
            ))}
        </div>
      )}
    </Card>
  );
}

function KpiCardsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <Card key={i} className="p-4">
          <div className="h-3 w-16 animate-pulse rounded bg-surface-muted" />
          <div className="mt-2 h-6 w-20 animate-pulse rounded bg-surface-muted" />
        </Card>
      ))}
    </div>
  );
}

function StatusBreakdownCard({
  title,
  byStatus,
  labels,
  emptyMessage,
}: {
  title: string;
  byStatus: Partial<Record<string, number>>;
  labels: Record<string, string>;
  emptyMessage: string;
}) {
  const rows = Object.entries(byStatus).filter(
    (entry): entry is [string, number] => entry[1] !== undefined && entry[1] > 0,
  );
  const max = Math.max(1, ...rows.map(([, count]) => count));

  return (
    <Card className="p-6">
      <h2 className="text-sm font-medium text-text">{title}</h2>
      <div className="mt-4">
        {rows.length === 0 && <p className="text-sm text-text-muted">{emptyMessage}</p>}
        {rows.length > 0 && (
          <ul className="space-y-2">
            {rows.map(([status, count]) => (
              <li key={status} className="flex items-center gap-3">
                <span className="w-36 shrink-0 text-sm text-text-muted">
                  {labels[status] ?? status}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted">
                  <div
                    className="h-full rounded-full bg-sidebar"
                    style={{ width: `${(count / max) * 100}%` }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right text-sm font-medium text-text">
                  {count}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function RevenueChart({
  points,
  currency,
  locale,
}: {
  points: AnalyticsRevenuePoint[];
  currency: string | null;
  locale: "fr" | "en";
}) {
  const max = Math.max(1, ...points.map((p) => p.revenue));
  // Sparse x-axis labels: first, middle, last — never one label per bar (dataviz skill).
  const labelIndexes = new Set(
    [0, Math.floor((points.length - 1) / 2), points.length - 1].filter((i) => i >= 0),
  );

  return (
    <div role="img" aria-label={
        locale === "en"
          ? `Revenue by period, from ${points[0]?.date} to ${points[points.length - 1]?.date}`
          : `Chiffre d'affaires par période, de ${points[0]?.date} à ${points[points.length - 1]?.date}`
      }>
      <div className="flex h-40 items-stretch gap-1">
        {points.map((point) => (
          <div
            key={point.date}
            // max-w caps each bar so a handful of points (as few as one) don't stretch to
            // fill the whole row — flex-1 alone would make a single day look like a solid
            // block instead of a bar.
            className="group relative flex w-full max-w-10 flex-1 flex-col justify-end"
          >
            <div
              className="rounded-t-[4px] bg-sidebar transition-colors group-hover:bg-sidebar-hover"
              style={{ height: `${Math.max(2, (point.revenue / max) * 100)}%` }}
            />
            <div className="pointer-events-none absolute bottom-full left-1/2 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-sidebar px-2 py-1 text-xs text-white group-hover:block">
              {point.date} · {formatCurrency(point.revenue, currency, locale)}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        {points.map((point, index) => (
          <div key={point.date} className="w-full max-w-10 flex-1 text-center text-[10px] text-text-muted">
            {labelIndexes.has(index) ? point.date : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="py-8 text-center">
      <p className="text-sm font-medium text-text">{title}</p>
      <p className="mt-1 text-sm text-text-muted">{description}</p>
    </div>
  );
}
