"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { ActionCenterItem, ActionCenterSummary, Offer } from "@korva/types";
import { Check } from "lucide-react";
import { Badge, Card, EmptyState } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { useActiveOrganization } from "@/lib/use-active-organization";
import { useAuthReady } from "@/lib/use-auth-ready";
import { useAnalyticsActivity, useAnalyticsOverview } from "@/lib/use-analytics";
import { ACTIVITY_ENTITY_LABELS, activityActionLabel, formatCurrency } from "@/lib/analytics-format";
import { STOREFRONT_URL } from "@/lib/storefront-url";
import { KorvaReviewPrompt } from "@/components/korva-review-prompt";

const ACTION_ITEM_TYPE_LABELS: Record<ActionCenterItem["type"], string> = {
  recommendation: "Recommandation",
  pending_approval: "Approbation requise",
  workflow_failure: "Échec d'automatisation",
  webhook_delivery_failure: "Échec de livraison webhook",
};

export default function DashboardPage() {
  const user = useAuthStore((state) => state.user);
  const { data: organization, isLoading: isOrganizationLoading } = useActiveOrganization();
  const authReady = useAuthReady();
  const overviewQuery = useAnalyticsOverview();
  const activityQuery = useAnalyticsActivity(5);

  // Attention-first per docs/BUSINESS_OS_AUDIT.md §5/§10 ("dashboard philosophy shift") — every
  // system role has recommendations.read (see packages/types/src/rbac.ts), and unlike analytics
  // this isn't gated behind a KorvaModule at all, so no permission/module empty-state branch is
  // needed here the way analytics below needs one.
  const actionSummaryQuery = useQuery({
    queryKey: ["action-center", "summary"],
    queryFn: () => apiClient.get<ActionCenterSummary>("/action-center/summary"),
    enabled: authReady,
  });
  const actionFeedQuery = useQuery({
    queryKey: ["action-center", "feed"],
    queryFn: () => apiClient.get<ActionCenterItem[]>("/action-center/feed"),
    enabled: authReady,
  });
  // What the "Pour bien démarrer" list needs to know: is anything on the public site yet?
  const onlineOffersQuery = useQuery({
    queryKey: ["offers", "online-count"],
    queryFn: () => apiClient.getList<Offer>("/offers?page=1&limit=1&status=active"),
    enabled: authReady && Boolean(organization?.enabledModules.includes("catalog")),
  });
  const actionTotal = actionSummaryQuery.data
    ? actionSummaryQuery.data.pendingApprovals +
      actionSummaryQuery.data.recommendations +
      actionSummaryQuery.data.failures
    : 0;

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

      {organization && (
        <GettingStarted
          hasLogo={Boolean(organization.logo)}
          hasOnlineOffer={(onlineOffersQuery.data?.pagination.total ?? 0) > 0}
          siteOnline={organization.enabledModules.includes("website")}
          slug={organization.slug}
          loading={onlineOffersQuery.isLoading}
        />
      )}

      {organization && (
        <KorvaReviewPrompt organizationId={organization.id} organizationCreatedAt={organization.createdAt} />
      )}

      <AttentionSection
        summary={actionSummaryQuery.data}
        feed={actionFeedQuery.data}
        isLoading={actionSummaryQuery.isLoading || actionFeedQuery.isLoading}
        total={actionTotal}
      />

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
            href="/dashboard/settings#abonnement"
            className="mt-2 inline-block text-sm font-medium text-text underline"
          >
            Ouvrir les paramètres
          </Link>
        </Card>
      )}

      {overviewQuery.data && totalActivity === 0 && (
        <Card>
          <EmptyState
            title="Vos chiffres apparaîtront ici"
            description="Dès votre première réservation, commande ou facture, vous verrez ici votre activité du mois."
          />
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
                        {activityActionLabel(entry.entity, entry.action)}
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

function AttentionSection({
  summary,
  feed,
  isLoading,
  total,
}: {
  summary?: ActionCenterSummary;
  feed?: ActionCenterItem[];
  isLoading: boolean;
  total: number;
}) {
  if (isLoading) {
    return (
      <Card className="p-6">
        <div className="h-4 w-48 animate-pulse rounded bg-surface-muted" />
        <div className="mt-3 h-10 w-full animate-pulse rounded bg-surface-muted" />
      </Card>
    );
  }
  if (!summary || !feed) return null;

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text">Ce qui nécessite votre attention</h2>
        <Link href="/dashboard/action-center" className="text-sm font-medium text-text underline">
          Ouvrir le centre d&apos;action
        </Link>
      </div>

      {total === 0 ? (
        <p className="mt-3 text-sm text-text-muted">
          Rien ne nécessite votre attention pour le moment — tout est sous contrôle.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {feed.slice(0, 3).map((item) => (
            <li key={`${item.type}-${item.id}`} className="flex items-center gap-2 py-2 text-sm">
              <Badge>{ACTION_ITEM_TYPE_LABELS[item.type]}</Badge>
              <span className="text-text">{item.title}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SummaryCard({ label, value, href }: { label: string; value: number | string; href: string }) {
  return (
    <Link href={href}>
      <Card className="p-4 transition-colors hover:bg-surface-muted">
        <p className="text-sm text-text-muted">{label}</p>
        <p className="mt-1 font-display text-2xl font-semibold text-text">{value}</p>
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

/**
 * The first things that make a business visible, checked against its real data — the list
 * disappears once all are done. Its absence would have caught a shop whose only offer was a
 * draft: the site looked broken to customers and nothing in the dashboard said why.
 *
 * A checklist, not numbered steps: they can be done in any order.
 */
function GettingStarted({
  hasLogo,
  hasOnlineOffer,
  siteOnline,
  slug,
  loading,
}: {
  hasLogo: boolean;
  hasOnlineOffer: boolean;
  siteOnline: boolean;
  slug: string;
  loading: boolean;
}) {
  if (loading) return null;
  const steps = [
    { done: hasLogo, label: "Ajoutez votre logo", href: "/dashboard/settings#entreprise" },
    { done: hasOnlineOffer, label: "Mettez une offre en ligne", href: "/dashboard/catalog" },
    { done: siteOnline, label: "Publiez votre site", href: "/dashboard/settings#abonnement" },
  ];
  const remaining = steps.filter((step) => !step.done).length;
  if (remaining === 0) return null;

  return (
    <section className="rounded-2xl bg-primary p-6 text-on-primary">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Pour bien démarrer</h2>
          <p className="mt-1 text-sm opacity-80">
            {remaining === 1 ? "Plus qu'une étape" : `Encore ${remaining} étapes`} avant que vos
            clients trouvent votre activité en ligne.
          </p>
        </div>
        {siteOnline && (
          <a
            href={`${STOREFRONT_URL}/${slug}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-sidebar px-4 py-2 text-sm font-semibold text-white hover:bg-sidebar-hover"
          >
            Voir mon site
          </a>
        )}
      </div>
      <ul className="mt-5 grid gap-2 sm:grid-cols-3">
        {steps.map((step) => (
          <li key={step.label}>
            <Link
              href={step.href}
              className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors ${
                step.done ? "bg-white/25 line-through opacity-70" : "bg-white/60 hover:bg-white/80"
              }`}
            >
              <span
                aria-hidden="true"
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-on-primary ${
                  step.done ? "bg-on-primary text-primary" : ""
                }`}
              >
                {step.done && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
              </span>
              <span>
                {step.label}
                <span className="sr-only">{step.done ? " (fait)" : " (à faire)"}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
