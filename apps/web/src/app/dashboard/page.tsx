"use client";

import Link from "next/link";
import { Card } from "@korva/ui";
import { ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { useActiveOrganization } from "@/lib/use-active-organization";
import { useAnalyticsActivity, useAnalyticsOverview } from "@/lib/use-analytics";
import { ACTIVITY_ACTION_LABELS, ACTIVITY_ENTITY_LABELS, formatCurrency } from "@/lib/analytics-format";

export default function DashboardPage() {
  const user = useAuthStore((state) => state.user);
  const { data: organization, isLoading: isOrganizationLoading } = useActiveOrganization();
  const overviewQuery = useAnalyticsOverview();
  const activityQuery = useAnalyticsActivity(5);

  // Some roles (e.g. STAFF, SALES) legitimately don't have analytics.read — that's a
  // permission boundary, not a failure, so it must not render as a retry-able error.
  const isPermissionDenied =
    overviewQuery.error instanceof ApiError && overviewQuery.error.code === "PERMISSION_DENIED";
  // GET /analytics/overview is gated behind the "analytics" module (RequireModule), even though
  // the KPIs it returns (leads/bookings/orders/invoices totals) are plain CRM/booking/commerce/
  // finance data with no real dependency on that module — an org that has simply toggled
  // Statistiques off in Settings still legitimately wants this landing page to work, not show a
  // permanent, retry-able "Impossible de charger" error (retrying can never succeed here; only
  // re-enabling the module would).
  const isModuleNotEnabled =
    overviewQuery.error instanceof ApiError && overviewQuery.error.code === "MODULE_NOT_ENABLED";
  const hasAnalytics = (organization?.enabledModules.includes("analytics") ?? false) && !isPermissionDenied;
  const totalActivity =
    (overviewQuery.data?.leads.total ?? 0) +
    (overviewQuery.data?.bookings.total ?? 0) +
    (overviewQuery.data?.orders.total ?? 0) +
    (overviewQuery.data?.invoices.total ?? 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          Bienvenue{user?.firstName ? `, ${user.firstName}` : ""}
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          {isOrganizationLoading ? "Chargement..." : (organization?.name ?? "—")}
        </p>
      </div>

      {overviewQuery.isLoading && <SummarySkeleton />}

      {overviewQuery.isError && !isPermissionDenied && !isModuleNotEnabled && (
        <Card className="p-6">
          <p className="text-sm text-destructive">Impossible de charger l&apos;activité de votre organisation.</p>
          <button
            onClick={() => overviewQuery.refetch()}
            className="mt-2 text-sm font-medium text-text underline"
          >
            Réessayer
          </button>
        </Card>
      )}

      {isPermissionDenied && (
        <Card className="p-6">
          <p className="text-sm text-text-muted">
            Les statistiques globales de l&apos;organisation sont réservées aux administrateurs.
          </p>
        </Card>
      )}

      {isModuleNotEnabled && (
        <Card className="p-6">
          <p className="text-sm text-text-muted">
            Activez le module Statistiques pour voir un résumé de votre activité ici.
          </p>
          <Link
            href="/dashboard/settings"
            className="mt-2 inline-block text-sm font-medium text-text underline"
          >
            Ouvrir les paramètres
          </Link>
        </Card>
      )}

      {overviewQuery.data && totalActivity === 0 && (
        <Card className="p-8 text-center">
          <p className="text-base font-medium text-text">Votre organisation est prête</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-text-muted">
            Aucune activité pour l&apos;instant. Les modules que vous avez activés sont
            disponibles dans le menu à gauche — les données que vous y créerez apparaîtront ici.
          </p>
        </Card>
      )}

      {overviewQuery.data && totalActivity > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard label="Prospects" value={overviewQuery.data.leads.total} href="/dashboard/crm/leads" />
          <SummaryCard
            label="Réservations à venir"
            value={overviewQuery.data.bookings.upcoming}
            href="/dashboard/bookings"
          />
          <SummaryCard
            label="Chiffre d'affaires"
            value={formatCurrency(overviewQuery.data.orders.revenue, overviewQuery.data.orders.currency)}
            href="/dashboard/orders"
          />
          <SummaryCard
            label="Encours factures"
            value={formatCurrency(overviewQuery.data.invoices.outstanding, overviewQuery.data.invoices.currency)}
            href="/dashboard/finance"
          />
        </div>
      )}

      {hasAnalytics && (
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-text">Activité récente</h2>
            <Link href="/dashboard/analytics" className="text-sm font-medium text-text underline">
              Voir les statistiques
            </Link>
          </div>
          <div className="mt-4">
            {activityQuery.isLoading && <p className="text-sm text-text-muted">Chargement...</p>}
            {activityQuery.data && activityQuery.data.length === 0 && (
              <p className="text-sm text-text-muted">Aucune activité récente.</p>
            )}
            {activityQuery.data && activityQuery.data.length > 0 && (
              <ul className="divide-y divide-border">
                {activityQuery.data.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-text">
                      {ACTIVITY_ENTITY_LABELS[entry.entity] ?? entry.entity}{" "}
                      <span className="text-text-muted">
                        {ACTIVITY_ACTION_LABELS[entry.action] ?? entry.action.toLowerCase()}
                      </span>
                    </span>
                    <span className="text-text-muted">
                      {new Date(entry.createdAt).toLocaleString("fr-FR")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

function SummaryCard({ label, value, href }: { label: string; value: number | string; href: string }) {
  return (
    <Link href={href}>
      <Card className="p-4 transition-colors hover:bg-surface-muted">
        <p className="text-xs font-medium uppercase text-text-muted">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-text">{value}</p>
      </Card>
    </Link>
  );
}

function SummarySkeleton() {
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
