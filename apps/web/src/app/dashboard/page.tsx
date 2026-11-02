"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { tradeVocabularyIn, visibleTradeTools, type ActionCenterItem, type ActionCenterSummary, type Offer } from "@korva/types";
import { Check } from "lucide-react";
import { Badge, Card, EmptyState } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { useActiveOrganization } from "@/lib/use-active-organization";
import { useAuthReady } from "@/lib/use-auth-ready";
import { useAnalyticsActivity, useAnalyticsOverview } from "@/lib/use-analytics";
import { PrioritySupportCard } from "@/components/pro/priority-support-card";
import {
  ACTIVITY_ENTITY_LABELS,
  ACTIVITY_ENTITY_LABELS_EN,
  activityActionLabel,
  formatCurrency,
  labelIn,
} from "@/lib/analytics-format";
import { intlLocale, useDashboardLocale, useT, type Translate } from "@/lib/dashboard-locale";
import { STOREFRONT_URL } from "@/lib/storefront-url";
import { KorvaReviewPrompt } from "@/components/korva-review-prompt";

function actionItemTypeLabel(type: ActionCenterItem["type"], t: Translate): string {
  switch (type) {
    case "recommendation":
      return t("Recommandation", "Recommendation");
    case "pending_approval":
      return t("Approbation requise", "Approval needed");
    case "workflow_failure":
      return t("Échec d'automatisation", "Automation failed");
    case "webhook_delivery_failure":
      return t("Échec de livraison webhook", "Webhook delivery failed");
  }
}

export default function DashboardPage() {
  const user = useAuthStore((state) => state.user);
  const { data: organization, isLoading: isOrganizationLoading } = useActiveOrganization();
  const authReady = useAuthReady();
  const overviewQuery = useAnalyticsOverview();
  const activityQuery = useAnalyticsActivity(5);
  const locale = useDashboardLocale();
  const t = useT();

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
  // The summary follows the trade's tools, like the menu: a salon has no orders to count.
  const enabledModules = new Set(organization?.enabledModules ?? []);
  const trade = visibleTradeTools(organization?.businessModel, organization?.extraTools);
  // A figure needs the trade's tool AND its module: a consultancy whose bookings are off has no
  // appointments to count.
  const tools = new Set(
    [...trade].filter((tool) => enabledModules.has(tool === "bookings" ? "booking" : "commerce")),
  );
  const words = tradeVocabularyIn(organization?.businessModel, locale);
  const totalActivity =
    (overviewQuery.data?.leads.total ?? 0) +
    (overviewQuery.data?.bookings.total ?? 0) +
    (overviewQuery.data?.orders.total ?? 0) +
    (overviewQuery.data?.invoices.total ?? 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          {t("Bienvenue", "Welcome")}{user?.firstName ? `, ${user.firstName}` : ""}
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          {isOrganizationLoading ? t("Chargement...", "Loading...") : (organization?.name ?? "—")}
        </p>
      </div>

      {organization && (
        <GettingStarted
          hasLogo={Boolean(organization.logo)}
          hasOnlineOffer={(onlineOffersQuery.data?.pagination.total ?? 0) > 0}
          siteOnline={organization.enabledModules.includes("website")}
          slug={organization.slug}
          loading={onlineOffersQuery.isLoading}
          t={t}
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
        t={t}
      />

      {overviewQuery.isLoading && <SummarySkeleton />}

      {overviewQuery.isError && !isPermissionDenied && !isModuleNotEnabled && (
        <Card className="p-6">
          <p className="text-sm text-destructive">
            {t("Impossible de charger l'activité de votre organisation.", "Your organization's activity could not be loaded.")}
          </p>
          <button
            onClick={() => overviewQuery.refetch()}
            className="mt-2 text-sm font-medium text-text underline"
          >
            {t("Réessayer", "Try again")}
          </button>
        </Card>
      )}

      {isPermissionDenied && (
        <Card className="p-6">
          <p className="text-sm text-text-muted">
            {t(
              "Les statistiques globales de l'organisation sont réservées aux administrateurs.",
              "The organization's overall statistics are for administrators only.",
            )}
          </p>
        </Card>
      )}

      {isModuleNotEnabled && (
        <Card className="p-6">
          <p className="text-sm text-text-muted">
            {t(
              "Activez le module Statistiques pour voir un résumé de votre activité ici.",
              "Turn on the Statistics module to see a summary of your activity here.",
            )}
          </p>
          <Link
            href="/dashboard/settings#abonnement"
            className="mt-2 inline-block text-sm font-medium text-text underline"
          >
            {t("Ouvrir les paramètres", "Open settings")}
          </Link>
        </Card>
      )}

      {overviewQuery.data && totalActivity === 0 && (
        <Card>
          <EmptyState
            title={t("Vos chiffres apparaîtront ici", "Your figures will appear here")}
            description={t(
              "Dès votre première réservation, commande ou facture, vous verrez ici votre activité du mois.",
              "From your first booking, order or invoice, you will see this month's activity here.",
            )}
          />
        </Card>
      )}

      {overviewQuery.data && totalActivity > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
          {/* auto-fit: three or four figures depending on the trade, always filling the row. */}
          <SummaryCard label={t("Prospects", "Leads")} value={overviewQuery.data.leads.total} href="/dashboard/crm/leads" />
          {tools.has("bookings") && (
            <SummaryCard
              label={t(`${words.bookings} à venir`, `Upcoming ${words.bookings.toLowerCase()}`)}
              value={overviewQuery.data.bookings.upcoming}
              href="/dashboard/bookings"
            />
          )}
          {tools.has("orders") && (
            <SummaryCard
              label={t("Chiffre d'affaires", "Revenue")}
              value={formatCurrency(overviewQuery.data.orders.revenue, overviewQuery.data.orders.currency, locale)}
              href="/dashboard/orders"
            />
          )}
          <SummaryCard
            label={t("Encours factures", "Unpaid invoices")}
            value={formatCurrency(overviewQuery.data.invoices.outstanding, overviewQuery.data.invoices.currency, locale)}
            href="/dashboard/finance"
          />
        </div>
      )}

      {hasAnalytics && (
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-text">{t("Activité récente", "Recent activity")}</h2>
            <Link href="/dashboard/analytics" className="text-sm font-medium text-text underline">
              {t("Voir les statistiques", "See statistics")}
            </Link>
          </div>
          <div className="mt-4">
            {activityQuery.isLoading && <p className="text-sm text-text-muted">{t("Chargement...", "Loading...")}</p>}
            {activityQuery.data && activityQuery.data.length === 0 && (
              <p className="text-sm text-text-muted">{t("Aucune activité récente.", "No recent activity.")}</p>
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
      )}

      <PrioritySupportCard />
    </div>
  );
}

function AttentionSection({
  summary,
  feed,
  isLoading,
  total,
  t,
}: {
  summary?: ActionCenterSummary;
  feed?: ActionCenterItem[];
  isLoading: boolean;
  total: number;
  t: Translate;
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
        <h2 className="text-sm font-semibold text-text">{t("Ce qui nécessite votre attention", "What needs your attention")}</h2>
        <Link href="/dashboard/action-center" className="text-sm font-medium text-text underline">
          {t("Ouvrir le centre d'action", "Open the action centre")}
        </Link>
      </div>

      {total === 0 ? (
        <p className="mt-3 text-sm text-text-muted">
          {t(
            "Rien ne nécessite votre attention pour le moment — tout est sous contrôle.",
            "Nothing needs your attention right now — everything is under control.",
          )}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {feed.slice(0, 3).map((item) => (
            <li key={`${item.type}-${item.id}`} className="flex items-center gap-2 py-2 text-sm">
              <Badge>{actionItemTypeLabel(item.type, t)}</Badge>
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
  t,
}: {
  hasLogo: boolean;
  hasOnlineOffer: boolean;
  siteOnline: boolean;
  slug: string;
  loading: boolean;
  t: Translate;
}) {
  if (loading) return null;
  const steps = [
    { done: hasLogo, label: t("Ajoutez votre logo", "Add your logo"), href: "/dashboard/settings#entreprise" },
    { done: hasOnlineOffer, label: t("Mettez une offre en ligne", "Put an offer online"), href: "/dashboard/catalog" },
    { done: siteOnline, label: t("Publiez votre site", "Publish your website"), href: "/dashboard/settings#abonnement" },
  ];
  const remaining = steps.filter((step) => !step.done).length;
  if (remaining === 0) return null;

  return (
    <section className="rounded-2xl bg-sidebar p-6 text-white">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{t("Pour bien démarrer", "Getting started")}</h2>
          <p className="mt-1 text-sm text-sidebar-text">
            {remaining === 1
              ? t(
                  "Plus qu'une étape avant que vos clients trouvent votre activité en ligne.",
                  "One step left before your customers can find your business online.",
                )
              : t(
                  `Encore ${remaining} étapes avant que vos clients trouvent votre activité en ligne.`,
                  `${remaining} steps left before your customers can find your business online.`,
                )}
          </p>
        </div>
        {siteOnline && (
          <a
            href={`${STOREFRONT_URL}/${slug}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-sidebar hover:bg-white/90"
          >
            {t("Voir mon site", "See my website")}
          </a>
        )}
      </div>
      <ul className="mt-5 grid gap-2 sm:grid-cols-3">
        {steps.map((step) => (
          <li key={step.label}>
            <Link
              href={step.href}
              className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors ${
                step.done ? "bg-white/5 text-sidebar-text line-through" : "bg-sidebar-hover hover:bg-white/15"
              }`}
            >
              <span
                aria-hidden="true"
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-primary ${
                  step.done ? "bg-primary text-on-primary" : ""
                }`}
              >
                {step.done && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
              </span>
              <span>
                {step.label}
                <span className="sr-only">{step.done ? t(" (fait)", " (done)") : t(" (à faire)", " (to do)")}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
