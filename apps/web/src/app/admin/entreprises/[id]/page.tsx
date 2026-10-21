"use client";

import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { BUSINESS_MODEL_DEFINITIONS, PLAN_KEYS, PLAN_NAMES, type PlanKey } from "@korva/types";
import { Badge, Button, Card, Input, Notice, PageHeader, Select } from "@korva/ui";
import { ApiError, apiClient } from "@/lib/api-client";
import { STOREFRONT_URL } from "@/lib/storefront-url";
import { ACTIVITY_ENTITY_LABELS, activityActionLabel } from "@/lib/analytics-format";
import {
  SUBSCRIPTION_STATUS_LABELS,
  formatDay,
  formatMoney,
  type PlatformOrganization,
} from "@/lib/platform-admin";

/**
 * One customer, everything the platform team needs to help it: subscription and invoices,
 * members, what is online, recent activity — and the three administrative actions.
 */
export default function AdminShopPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const queryKey = ["platform", "organization", id];
  const { data: org, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => apiClient.get<PlatformOrganization>(`/platform/organizations/${id}`, { withOrganization: false }),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey });
    void queryClient.invalidateQueries({ queryKey: ["platform", "overview"] });
  };

  if (isLoading) return <p className="text-sm text-text-muted">Chargement…</p>;
  if (isError || !org) return <p className="text-sm text-destructive">Commerce introuvable.</p>;

  const subscription = org.subscription;

  return (
    <div className="space-y-6">
      <Link href="/admin/entreprises" className="inline-flex items-center gap-1 text-sm text-text-muted hover:underline">
        <ArrowLeft aria-hidden className="h-4 w-4" /> Toutes les entreprises
      </Link>
      <PageHeader
        title={org.name}
        description={[
          org.businessModel ? BUSINESS_MODEL_DEFINITIONS[org.businessModel].label : org.type,
          org.country,
          `inscrit le ${formatDay(org.createdAt)}`,
        ]
          .filter(Boolean)
          .join(" — ")}
        actions={
          <a
            href={`${STOREFRONT_URL}/${org.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-border-input bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-muted"
          >
            Voir le site
          </a>
        }
      />

      {org.suspendedAt && (
        <Notice tone="warning">
          Entreprise suspendue depuis le {formatDay(org.suspendedAt)}
          {org.suspensionReason ? ` — ${org.suspensionReason}` : ""}. Ses membres ne peuvent plus travailler
          dedans et son site est hors ligne.
        </Notice>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <Count label="Offres en ligne" value={org.counts.offersOnline} sub={`sur ${org.counts.offersTotal}`} />
        <Count label="Commandes" value={org.counts.orders} />
        <Count label="Réservations" value={org.counts.bookings} />
        <Count label="Devis" value={org.counts.quotes} />
        <Count label="Prospects" value={org.counts.leads} />
        <Count label="Contacts" value={org.counts.contacts} />
        <Count label="Factures" value={org.counts.invoices} />
        <Count label="Membres" value={org.members.length} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <Card className="p-6">
          <h2 className="text-lg font-semibold">Abonnement</h2>
          {subscription ? (
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <Field label="Formule">
                {subscription.planName ?? "—"}
                {subscription.priceAmount > 0 && subscription.priceCurrency && (
                  <span className="text-text-muted"> · {formatMoney(subscription.priceAmount, subscription.priceCurrency)}/mois</span>
                )}
              </Field>
              <Field label="Statut">
                <Badge variant={subscription.status === "past_due" ? "destructive" : "default"}>
                  {SUBSCRIPTION_STATUS_LABELS[subscription.status] ?? subscription.status}
                </Badge>
                {subscription.cancelAtPeriodEnd && <Badge variant="warning" className="ml-1">Résiliation demandée</Badge>}
              </Field>
              <Field label="Période jusqu'au">{formatDay(subscription.currentPeriodEnd)}</Field>
              <Field label="Essai">
                {subscription.trialEndsAt && new Date(subscription.trialEndsAt) > new Date()
                  ? `${PLAN_NAMES[subscription.trialPlanKey as PlanKey] ?? subscription.trialPlanKey} jusqu'au ${formatDay(subscription.trialEndsAt)}`
                  : "Aucun en cours"}
              </Field>
            </dl>
          ) : (
            <p className="mt-2 text-sm text-text-muted">Aucun abonnement.</p>
          )}

          <h3 className="mt-6 text-sm font-semibold">Factures KORVA</h3>
          {org.invoices.length === 0 ? (
            <p className="mt-2 text-sm text-text-muted">Aucune facture émise.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border text-sm">
              {org.invoices.map((invoice) => (
                <InvoiceRow key={invoice.id} organizationId={org.id} invoice={invoice} onPaid={refresh} />
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <AssignPlan organizationId={org.id} current={subscription?.planKey ?? null} onDone={refresh} />
          <ExtendTrial organizationId={org.id} onDone={refresh} />
          <Suspension organizationId={org.id} suspended={Boolean(org.suspendedAt)} onDone={refresh} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-lg font-semibold">Contact</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {org.members.map((member) => (
              <li key={member.email} className="flex items-center justify-between gap-2">
                <a href={`mailto:${member.email}`} className="hover:underline">
                  {member.name ? `${member.name} — ` : ""}
                  {member.email}
                </a>
                {member.status !== "active" && <Badge>{member.status}</Badge>}
              </li>
            ))}
            {org.whatsappNumber && (
              <li>
                <a
                  href={`https://wa.me/${org.whatsappNumber.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                >
                  WhatsApp {org.whatsappNumber}
                </a>
              </li>
            )}
            {org.contactPhone && <li>Téléphone {org.contactPhone}</li>}
          </ul>
          {org.activationNudgeSentAt && (
            <p className="mt-3 text-xs text-text-muted">Relance « site vide » envoyée le {formatDay(org.activationNudgeSentAt)}.</p>
          )}
        </Card>

        <Card className="p-6">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">Activité récente</h2>
            <Link href={`/admin/journal?entreprise=${org.id}`} className="text-sm text-text-muted hover:underline">
              Tout le journal
            </Link>
          </div>
          {org.recentActivity.length === 0 ? (
            <p className="mt-2 text-sm text-text-muted">Aucune activité enregistrée.</p>
          ) : (
            <ul className="mt-3 space-y-1.5 text-sm">
              {org.recentActivity.slice(0, 12).map((entry, index) => (
                <li key={index} className="flex justify-between gap-3">
                  <span>
                    {ACTIVITY_ENTITY_LABELS[entry.entity] ?? entry.entity}{" "}
                    <span className="text-text-muted">{activityActionLabel(entry.entity, entry.action)}</span>
                  </span>
                  <span className="shrink-0 text-text-muted">{formatDay(entry.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Count({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-text-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold tabular-nums">
        {value} {sub && <span className="text-sm font-normal text-text-muted">{sub}</span>}
      </p>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-text-muted">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : "Une erreur est survenue.";
}

function InvoiceRow({
  organizationId,
  invoice,
  onPaid,
}: {
  organizationId: string;
  invoice: PlatformOrganization["invoices"][number];
  onPaid: () => void;
}) {
  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post(`/platform/organizations/${organizationId}/invoices/${invoice.id}/paid`, undefined, {
        withOrganization: false,
      }),
    onSuccess: onPaid,
  });
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <span>
        {invoice.number} · {formatMoney(invoice.amount, invoice.currency)}
        <span className="text-text-muted"> · échéance {formatDay(invoice.dueAt)}</span>
      </span>
      {invoice.status === "open" ? (
        <Button
          size="sm"
          variant="secondary"
          loading={mutation.isPending}
          onClick={() => {
            if (window.confirm(`Confirmer que ${invoice.number} a été payée hors plateforme ?`)) mutation.mutate();
          }}
        >
          Marquer payée
        </Button>
      ) : (
        <Badge variant={invoice.status === "paid" ? "success" : "default"}>
          {invoice.status === "paid" ? `Payée le ${formatDay(invoice.paidAt)}` : invoice.status}
        </Badge>
      )}
      {mutation.isError && <p className="w-full text-xs text-destructive">{errorText(mutation.error)}</p>}
    </li>
  );
}

function AssignPlan({
  organizationId,
  current,
  onDone,
}: {
  organizationId: string;
  current: string | null;
  onDone: () => void;
}) {
  const [planKey, setPlanKey] = useState<PlanKey>("starter");
  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post(`/platform/organizations/${organizationId}/plan`, { planKey }, { withOrganization: false }),
    onSuccess: onDone,
  });
  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">Attribuer une formule</h2>
      <p className="mt-1 text-sm text-text-muted">
        Après un paiement reçu hors plateforme (Mobile Money, espèces, virement). La période d&apos;un
        mois démarre aujourd&apos;hui.
      </p>
      <div className="mt-4 flex gap-2">
        <Select aria-label="Formule" value={planKey} onChange={(event) => setPlanKey(event.target.value as PlanKey)} className="flex-1">
          {PLAN_KEYS.map((key) => (
            <option key={key} value={key}>
              {PLAN_NAMES[key]}
              {key === current ? " (actuelle)" : ""}
            </option>
          ))}
        </Select>
        <Button
          loading={mutation.isPending}
          onClick={() => {
            if (window.confirm(`Passer ce commerce en formule ${PLAN_NAMES[planKey]} ?`)) mutation.mutate();
          }}
        >
          Attribuer
        </Button>
      </div>
      {mutation.isSuccess && <Notice tone="info" className="mt-3">Formule {PLAN_NAMES[planKey]} attribuée.</Notice>}
      {mutation.isError && <p className="mt-2 text-sm text-destructive">{errorText(mutation.error)}</p>}
    </Card>
  );
}

function ExtendTrial({ organizationId, onDone }: { organizationId: string; onDone: () => void }) {
  const [days, setDays] = useState("14");
  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post(`/platform/organizations/${organizationId}/trial`, { days: Number(days) }, { withOrganization: false }),
    onSuccess: onDone,
  });
  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">Prolonger l&apos;essai Pro</h2>
      <p className="mt-1 text-sm text-text-muted">Ajoute des jours à l&apos;essai en cours, ou en ouvre un à partir d&apos;aujourd&apos;hui.</p>
      <div className="mt-4 flex gap-2">
        <Input
          aria-label="Nombre de jours"
          type="number"
          min={1}
          max={90}
          value={days}
          onChange={(event) => setDays(event.target.value)}
          className="w-24"
        />
        <Button variant="secondary" loading={mutation.isPending} onClick={() => mutation.mutate()}>
          Prolonger de {days || "…"} jours
        </Button>
      </div>
      {mutation.isSuccess && <Notice tone="info" className="mt-3">Essai prolongé.</Notice>}
      {mutation.isError && <p className="mt-2 text-sm text-destructive">{errorText(mutation.error)}</p>}
    </Card>
  );
}

function Suspension({
  organizationId,
  suspended,
  onDone,
}: {
  organizationId: string;
  suspended: boolean;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      suspended
        ? apiClient.post(`/platform/organizations/${organizationId}/reactivate`, undefined, { withOrganization: false })
        : apiClient.post(`/platform/organizations/${organizationId}/suspend`, { reason }, { withOrganization: false }),
    onSuccess: () => {
      setReason("");
      onDone();
    },
  });

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">{suspended ? "Réactiver l'entreprise" : "Suspendre l'entreprise"}</h2>
      <p className="mt-1 text-sm text-text-muted">
        {suspended
          ? "Rend l'accès au tableau de bord et remet le site en ligne, tels qu'ils étaient."
          : "Bloque le tableau de bord et met le site hors ligne. Rien n'est supprimé ; réversible à tout moment."}
      </p>
      {!suspended && (
        <Input
          aria-label="Motif de la suspension"
          placeholder="Motif (ex. impayé depuis deux mois)"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="mt-4 w-full"
        />
      )}
      <Button
        variant="secondary"
        className={`mt-3 ${suspended ? "" : "text-destructive"}`}
        loading={mutation.isPending}
        disabled={!suspended && reason.trim().length < 3}
        onClick={() => {
          const question = suspended
            ? "Réactiver cette entreprise ?"
            : "Suspendre cette entreprise ? Ses membres seront bloqués et son site mis hors ligne.";
          if (window.confirm(question)) mutation.mutate();
        }}
      >
        {suspended ? "Réactiver" : "Suspendre"}
      </Button>
      {mutation.isError && <p className="mt-2 text-sm text-destructive">{errorText(mutation.error)}</p>}
    </Card>
  );
}
