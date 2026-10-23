"use client";

import { useQuery } from "@tanstack/react-query";
import { Badge, Card, Notice, PageHeader } from "@korva/ui";
import { adminApi, type PlatformSystem } from "@/lib/platform-admin";

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
}

function usd(value: number): string {
  return `${value.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
}

function duration(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return days > 0 ? `${days} j ${hours} h` : `${hours} h ${Math.floor((seconds % 3600) / 60)} min`;
}

/**
 * The platform's technical state, as the API sees it: background queues (failed jobs first), the
 * database against the free Atlas tier's 512 MB cap, and whether email and payment collection are
 * really configured. Refreshed every minute while open.
 */
export default function AdminSystemPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["platform", "system"],
    queryFn: () => adminApi.get<PlatformSystem>("/platform/system"),
    refetchInterval: 60_000,
  });

  if (isLoading) return <p className="text-sm text-text-muted">Chargement…</p>;
  if (isError || !data) return <p className="text-sm text-destructive">Impossible de lire l&apos;état du système.</p>;

  const dbShare = data.database.storageBytes / data.database.freeTierCapBytes;
  const failed = (data.queues ?? []).reduce((sum, queue) => sum + queue.failed, 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Système" description="L'état technique de la plateforme, actualisé chaque minute." />

      {!data.email.configured && (
        <Notice tone="warning">
          Aucun envoi d&apos;e-mail réel : les rappels, factures et relances sont seulement journalisés.
          Renseignez EMAIL_PROVIDER=resend et RESEND_API_KEY sur le serveur.
        </Notice>
      )}
      {data.payments.platformAccounts === 0 && (
        <Notice tone="warning">
          Aucun prestataire de paiement de la plateforme : les formules se règlent hors ligne, à
          enregistrer depuis la fiche de chaque entreprise.
        </Notice>
      )}
      {dbShare > 0.7 && (
        <Notice tone="warning">
          La base occupe {Math.round(dbShare * 100)} % des 512 Mo de l&apos;offre gratuite Atlas.
        </Notice>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-5">
          <p className="text-sm text-text-muted">API</p>
          <p className="mt-1 font-display text-2xl font-semibold">En ligne</p>
          <p className="mt-1 text-xs text-text-muted">
            depuis {duration(data.api.uptimeSeconds)} · Node {data.api.nodeVersion}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-text-muted">Base de données</p>
          <p className="mt-1 font-display text-2xl font-semibold">{megabytes(data.database.storageBytes)}</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-muted">
            <div
              className={`h-full rounded-full ${dbShare > 0.7 ? "bg-warning" : "bg-primary"}`}
              style={{ width: `${Math.min(100, dbShare * 100)}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-text-muted">sur 512 Mo · {data.database.collections} collections</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-text-muted">E-mails</p>
          <p className="mt-1 font-display text-2xl font-semibold">{data.email.configured ? "Actifs" : "Inactifs"}</p>
          <p className="mt-1 text-xs text-text-muted">{data.email.from ?? data.email.provider}</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-text-muted">Tâches en échec</p>
          <p className={`mt-1 font-display text-2xl font-semibold ${failed > 0 ? "text-destructive" : ""}`}>
            {data.queues ? failed : "—"}
          </p>
          <p className="mt-1 text-xs text-text-muted">{data.administrators} administrateur(s) KORVA</p>
        </Card>
      </div>

      <KorvaAiCard ai={data.ai} />

      <Card className="overflow-hidden">
        <h2 className="px-6 pt-5 text-lg font-semibold">Tâches de fond</h2>
        {!data.queues ? (
          <p className="px-6 pb-5 pt-2 text-sm text-text-muted">Files indisponibles (Redis injoignable ou tâches désactivées).</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-border bg-surface-muted text-left text-xs font-medium text-text-muted">
                <tr>
                  <th className="px-6 py-2.5">Tâche</th>
                  <th className="px-6 py-2.5">En attente</th>
                  <th className="px-6 py-2.5">En cours</th>
                  <th className="px-6 py-2.5">Planifiées</th>
                  <th className="px-6 py-2.5">En échec</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.queues.map((queue) => (
                  <tr key={queue.name}>
                    <td className="px-6 py-3">{queue.label}</td>
                    <td className="px-6 py-3 tabular-nums">{queue.waiting}</td>
                    <td className="px-6 py-3 tabular-nums">{queue.active}</td>
                    <td className="px-6 py-3 tabular-nums">{queue.delayed}</td>
                    <td className="px-6 py-3">
                      {queue.failed > 0 ? <Badge variant="destructive">{queue.failed}</Badge> : <span className="tabular-nums">0</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/**
 * KORVA IA from the platform's side: which brain answers (never the key), and what it has cost
 * this month against the budget set in AI_MONTHLY_BUDGET_USD.
 */
function KorvaAiCard({ ai }: { ai: PlatformSystem["ai"] }) {
  const share = ai.monthlyBudgetUsd ? ai.spentThisMonthUsd / ai.monthlyBudgetUsd : null;
  return (
    <Card className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">KORVA IA</h2>
          <p className="text-sm text-text-muted">
            {ai.configured
              ? `${ai.provider} · modèle ${ai.model}`
              : `Non configurée : ${ai.reason ?? "aucun fournisseur"}.`}
          </p>
        </div>
        <Badge variant={ai.configured ? "success" : "warning"}>{ai.configured ? "Active" : "Inactive"}</Badge>
      </div>

      {!ai.configured && (
        <Notice tone="warning">
          Les entreprises voient « KORVA IA arrive bientôt » et rien n&apos;est décompté. Pour
          l&apos;activer, renseignez AI_PROVIDER, AI_API_KEY et AI_MODEL sur le serveur (voir
          .env.production.example), puis redémarrez l&apos;API.
        </Notice>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs text-text-muted">Questions posées ce mois-ci</p>
          <p className="mt-1 font-display text-2xl font-semibold tabular-nums">{ai.messagesThisMonth}</p>
        </div>
        <div>
          <p className="text-xs text-text-muted">Entreprises qui l&apos;ont utilisée ce mois-ci</p>
          <p className="mt-1 font-display text-2xl font-semibold tabular-nums">{ai.activeOrganizationsThisMonth}</p>
        </div>
      </div>

      <DailyActivity daily={ai.daily} />

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <p className="text-xs text-text-muted">Dépense du mois</p>
          <p className="mt-1 font-display text-2xl font-semibold tabular-nums">{usd(ai.spentThisMonthUsd)}</p>
          <p className="text-xs text-text-muted">
            {ai.monthlyBudgetUsd !== null ? `sur un budget de ${usd(ai.monthlyBudgetUsd)}` : "aucun budget plafond défini"}
          </p>
          {share !== null && (
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-muted">
              <div
                className={`h-full rounded-full ${share >= 0.8 ? "bg-warning" : "bg-primary"}`}
                style={{ width: `${Math.min(100, share * 100)}%` }}
              />
            </div>
          )}
        </div>
        <div>
          <p className="text-xs text-text-muted">Appels au modèle ce mois-ci</p>
          <p className="mt-1 font-display text-2xl font-semibold tabular-nums">{ai.callsThisMonth}</p>
          {ai.unpricedCalls > 0 && (
            <p className="text-xs text-warning">
              {ai.unpricedCalls} sans prix connu : renseignez AI_PRICE_INPUT/OUTPUT_PER_MILLION_USD.
            </p>
          )}
        </div>
        <div>
          <p className="text-xs text-text-muted">Entreprises qui l&apos;utilisent le plus</p>
          {ai.topOrganizations.length === 0 ? (
            <p className="mt-1 text-sm text-text-muted">Personne ce mois-ci.</p>
          ) : (
            <ul className="mt-1 space-y-1 text-sm">
              {ai.topOrganizations.map((org) => (
                <li key={org.organizationId} className="flex justify-between gap-2">
                  <span className="truncate">{org.name}</span>
                  <span className="shrink-0 tabular-nums text-text-muted">
                    {org.calls} · {usd(org.costUsd)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}

const dayLabel = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });

/** Model calls per day over the last 30 days — how KORVA IA's use is growing. */
function DailyActivity({ daily }: { daily: PlatformSystem["ai"]["daily"] }) {
  const max = Math.max(1, ...daily.map((day) => day.calls));
  const total = daily.reduce((sum, day) => sum + day.calls, 0);
  return (
    <div>
      <p className="text-xs text-text-muted">Activité des 30 derniers jours · {total} appels au modèle</p>
      <div
        className="mt-2 flex h-24 items-end gap-0.5 rounded-lg bg-surface-muted p-2"
        role="img"
        aria-label={`Appels par jour sur 30 jours, ${total} au total, au plus ${max} un même jour`}
      >
        {daily.map((day) => (
          <div
            key={day.day}
            title={`${dayLabel.format(new Date(day.day))} : ${day.calls} appel(s), ${day.organizations} entreprise(s), ${usd(day.costUsd)}`}
            className={`flex-1 rounded-sm ${day.calls > 0 ? "bg-primary" : "bg-border"}`}
            style={{ height: `${Math.max(4, (day.calls / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-text-muted">
        <span>{daily[0] ? dayLabel.format(new Date(daily[0].day)) : ""}</span>
        <span>aujourd&apos;hui</span>
      </div>
    </div>
  );
}
