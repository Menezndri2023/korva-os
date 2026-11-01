"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { BUSINESS_MODEL_DEFINITIONS, PLAN_KEYS, PLAN_NAMES } from "@korva/types";
import { Card, PageHeader, Skeleton, StatTile, Table, Td, Th } from "@korva/ui";
import {
  adminApi,
  channelCount,
  formatMoney,
  usePlatformTodo,
  type PlatformBusinessRow,
  type PlatformFinance,
  type PlatformOverview,
  type PlatformTodo,
} from "@/lib/platform-admin";

const TODO: { key: keyof PlatformTodo; label: (n: number) => string; href: string }[] = [
  { key: "payoutsToApprove", label: (n) => `retrait${n > 1 ? "s" : ""} à valider`, href: "/admin/reversements" },
  { key: "overdueInvoices", label: (n) => `facture${n > 1 ? "s" : ""} de formule en retard`, href: "/admin/finances" },
  { key: "reviewsToModerate", label: () => "avis à modérer", href: "/admin/avis" },
  { key: "pastDueSubscriptions", label: (n) => `abonnement${n > 1 ? "s" : ""} impayé${n > 1 ? "s" : ""}`, href: "/admin/abonnements?filtre=past_due" },
];

/** The platform at a glance: what needs an action first, then the money, then the businesses. */
export default function AdminOverviewPage() {
  const overview = useQuery({
    queryKey: ["platform", "overview"],
    queryFn: () => adminApi.get<PlatformOverview>("/platform/overview"),
  });
  const finance = useQuery({
    queryKey: ["platform", "finance", 30],
    queryFn: () => adminApi.get<PlatformFinance>("/platform/finance?days=30"),
  });
  const businesses = useQuery({
    queryKey: ["platform", "businesses"],
    queryFn: () => adminApi.get<PlatformBusinessRow[]>("/platform/businesses"),
  });
  const todo = usePlatformTodo();
  const data = overview.data;

  return (
    <div className="space-y-8">
      <PageHeader title="Vue d'ensemble" description="Toute la plateforme KORVA, sur les 30 derniers jours." />

      <TodoPanel todo={todo.data} />

      {overview.isError && <p className="text-sm text-destructive">Impossible de charger les chiffres.</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {finance.data ? (
          <>
            <StatTile
              label="Formules encaissées"
              value={
                finance.data.plansPaid.length === 0
                  ? formatMoney(0, "XOF")
                  : finance.data.plansPaid.map((row) => formatMoney(row.total, row.currency)).join(" + ")
              }
              hint={`${finance.data.plansPaid.reduce((sum, row) => sum + row.count, 0)} facture(s) payée(s)`}
            />
            <StatTile
              label="Commissions sur les ventes"
              value={formatMoney(finance.data.onlineSales.commissions, finance.data.onlineSales.currency)}
              hint={`sur ${formatMoney(finance.data.onlineSales.total, finance.data.onlineSales.currency)} vendus en ligne`}
            />
          </>
        ) : (
          <>
            <Skeleton className="h-32 rounded-2xl" />
            <Skeleton className="h-32 rounded-2xl" />
          </>
        )}
        {data ? (
          <StatTile
            label="Entreprises"
            value={data.organizations}
            hint={`+${data.newLast7Days} cette semaine, ${data.trialsRunning} en essai`}
          />
        ) : (
          <Skeleton className="h-32 rounded-2xl" />
        )}
        {finance.data ? (
          <StatTile
            label="Argent dans les Soldes"
            value={formatMoney(finance.data.held.available + finance.data.held.pending, finance.data.held.currency)}
            hint="dû aux entreprises"
          />
        ) : (
          <Skeleton className="h-32 rounded-2xl" />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ActivationFunnel rows={businesses.data} />
        <Card className="p-6">
          <h2 className="text-lg font-semibold">Entreprises par formule</h2>
          {data ? (
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
                      <div className="h-full rounded-full bg-action" style={{ width: `${share}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Skeleton className="mt-4 h-40" />
          )}
          {data && Object.keys(data.monthlyRevenueByCurrency).length > 0 && (
            <p className="mt-5 border-t border-border pt-3 text-sm text-text-muted">
              Revenu mensuel attendu :{" "}
              <span className="font-semibold text-text">
                {Object.entries(data.monthlyRevenueByCurrency)
                  .map(([currency, amount]) => formatMoney(amount, currency))
                  .join(" + ")}
              </span>
            </p>
          )}
        </Card>
      </div>

      {data && (
        <Card className="overflow-hidden">
          <div className="p-6 pb-3">
            <h2 className="text-lg font-semibold">Par métier</h2>
            <p className="mt-1 text-sm text-text-muted">
              Chaque métier est mesuré sur son propre canal : commandes, réservations, devis ou prospects.
            </p>
          </div>
          <Table caption="Entreprises par métier">
            <thead>
              <tr>
                <Th>Métier</Th>
                <Th align="right">Entreprises</Th>
                <Th align="right">Sites en ligne</Th>
                <Th align="right">Activité sur 30 jours</Th>
              </tr>
            </thead>
            <tbody>
              {data.byBusinessModel.map((group) => (
                <tr key={group.businessModel}>
                  <Td className="font-medium">
                    {group.businessModel === "none"
                      ? "Métier non renseigné"
                      : BUSINESS_MODEL_DEFINITIONS[group.businessModel].label}
                  </Td>
                  <Td numeric>{group.organizations}</Td>
                  <Td numeric>{group.sitesOnline}</Td>
                  <Td numeric>{channelCount(group.activity30d, group.channel)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function TodoPanel({ todo }: { todo: PlatformTodo | undefined }) {
  const items = todo ? TODO.filter((item) => todo[item.key] > 0) : [];
  return (
    <section aria-labelledby="todo-title" className="rounded-2xl bg-sidebar p-5 text-white sm:p-6">
      <h2 id="todo-title" className="text-lg font-semibold text-white">
        À traiter aujourd&apos;hui
      </h2>
      {!todo ? (
        <p className="mt-2 text-sm text-sidebar-text">Chargement…</p>
      ) : items.length === 0 ? (
        <p className="mt-2 text-sm text-sidebar-text">Rien en attente : aucun retrait, aucune facture en retard, aucun avis à modérer.</p>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                className="flex h-full flex-col gap-0.5 rounded-xl bg-sidebar-hover px-4 py-3 transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span className="font-display text-2xl font-semibold tabular-nums text-primary">{todo[item.key]}</span>
                <span className="text-sm">{item.label(todo[item.key])}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** From sign-up to paying: where the businesses stop. Computed from the businesses list. */
function ActivationFunnel({ rows }: { rows: PlatformBusinessRow[] | undefined }) {
  const steps = rows
    ? [
        { label: "Inscrites", count: rows.length },
        { label: "Site en ligne avec une offre", count: rows.filter((r) => r.websiteEnabled && r.activeOffers > 0).length },
        { label: "Actives sur 30 jours", count: rows.filter((r) => r.activity30d > 0).length },
        { label: "Formule payante", count: rows.filter((r) => r.planKey && r.planKey !== "free").length },
      ]
    : [];
  const total = rows?.length ?? 0;
  return (
    <Card className="p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">Activation</h2>
        <Link href="/admin/entreprises" className="text-sm font-semibold text-action hover:underline">
          Voir qui relancer
        </Link>
      </div>
      {!rows ? (
        <Skeleton className="mt-4 h-40" />
      ) : (
        <ol className="mt-4 space-y-3">
          {steps.map((step, index) => (
            <li key={step.label}>
              <div className="flex justify-between text-sm">
                <span>{step.label}</span>
                <span className="tabular-nums text-text-muted">{step.count}</span>
              </div>
              <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-surface-muted">
                <div
                  className={`h-full rounded-full ${index === steps.length - 1 ? "bg-primary" : "bg-action"}`}
                  style={{ width: `${total ? (step.count / total) * 100 : 0}%` }}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
