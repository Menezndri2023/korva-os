"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { BUSINESS_MODEL_DEFINITIONS, PLAN_KEYS, PLAN_NAMES, type PlanKey, type WalletSummary } from "@korva/types";
import {
  Badge,
  Button,
  Card,
  Field as UiField,
  Input,
  Notice,
  Select,
  SkeletonList,
  StatTile,
  TabBar,
  Table,
  Td,
  Textarea,
  Th,
  tabClassName,
} from "@korva/ui";
import { ApiError } from "@/lib/api-client";
import { STOREFRONT_URL } from "@/lib/storefront-url";
import { ACTIVITY_ENTITY_LABELS, activityActionLabel } from "@/lib/analytics-format";
import {
  SUBSCRIPTION_STATUS_LABELS,
  formatDay,
  formatMoney,
  type PlatformNote,
  type PlatformOrganization,
  adminApi,
} from "@/lib/platform-admin";

const TABS = [
  { key: "resume", label: "Résumé" },
  { key: "formule", label: "Formule et factures" },
  { key: "solde", label: "Solde et ventes" },
  { key: "equipe", label: "Équipe" },
  { key: "journal", label: "Journal" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/** The open tab lives in the address (#formule…), so the global search can link straight to it. */
function useTab(): TabKey {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash.slice(1), () => "");
  return TABS.some((tab) => tab.key === hash) ? (hash as TabKey) : "resume";
}

/**
 * One business, everything the platform team needs to help it, in tabs: a summary with internal
 * notes, its plan and KORVA invoices, its Solde, its team and its activity — and the
 * administrative actions (assign a plan, extend a trial, adjust the Solde, suspend).
 */
export default function AdminShopPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const tab = useTab();
  const queryKey = ["platform", "organization", id];
  const { data: org, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => adminApi.get<PlatformOrganization>(`/platform/organizations/${id}`),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey });
    void queryClient.invalidateQueries({ queryKey: ["platform", "overview"] });
    void queryClient.invalidateQueries({ queryKey: ["platform", "todo"] });
  };

  if (isLoading) return <SkeletonList rows={5} />;
  if (isError || !org) return <p className="text-sm text-destructive">Entreprise introuvable.</p>;

  const subscription = org.subscription;
  const trialRunning = Boolean(subscription?.trialEndsAt && new Date(subscription.trialEndsAt) > new Date());

  return (
    <div className="space-y-6">
      <Link href="/admin/entreprises" className="inline-flex items-center gap-1 text-sm text-text-muted hover:underline">
        <ArrowLeft aria-hidden className="h-4 w-4" /> Toutes les entreprises
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span aria-hidden className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-surface-muted font-display text-xl font-semibold text-action">
            {initials(org.name)}
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-text">{org.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-text-muted">
              {[
                org.businessModel ? BUSINESS_MODEL_DEFINITIONS[org.businessModel].label : org.type,
                org.country,
                `inscrite le ${formatDay(org.createdAt)}`,
              ]
                .filter(Boolean)
                .join(", ")}
              {org.suspendedAt ? <Badge variant="destructive">Suspendue</Badge> : <Badge variant="success">Active</Badge>}
              {subscription?.planName && (
                <Badge>
                  {subscription.planName}
                  {trialRunning && subscription.trialPlanKey
                    ? `, essai ${PLAN_NAMES[subscription.trialPlanKey as PlanKey] ?? subscription.trialPlanKey} jusqu'au ${formatDay(subscription.trialEndsAt)}`
                    : ""}
                </Badge>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={`${STOREFRONT_URL}/${org.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center rounded-lg border border-border-input bg-surface px-4 text-sm font-semibold hover:bg-surface-muted"
          >
            Voir le site
          </a>
          {!org.suspendedAt && <ViewDashboardButton organizationId={org.id} />}
          <a
            href="#formule"
            className="inline-flex min-h-11 items-center rounded-lg bg-action px-4 text-sm font-semibold text-on-action hover:bg-action-hover"
          >
            Changer la formule
          </a>
        </div>
      </div>

      {org.suspendedAt && (
        <Notice tone="warning">
          Entreprise suspendue depuis le {formatDay(org.suspendedAt)}
          {org.suspensionReason ? ` : ${org.suspensionReason}` : ""}. Ses membres ne peuvent plus travailler
          dedans et son site est hors ligne.
        </Notice>
      )}

      <TabBar aria-label="Sections de la fiche">
        {TABS.map((item) => (
          <a key={item.key} href={`#${item.key}`} aria-current={item.key === tab ? "page" : undefined} className={tabClassName(item.key === tab)}>
            {item.label}
          </a>
        ))}
      </TabBar>

      <TabPanel tab="resume" active={tab}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          <Count label="Offres en ligne" value={org.counts.offersOnline} sub={`sur ${org.counts.offersTotal}`} />
          <Count label="Commandes" value={org.counts.orders} />
          <Count label="Réservations" value={org.counts.bookings} />
          <Count label="Devis" value={org.counts.quotes} />
          <Count label="Prospects" value={org.counts.leads} />
          <Count label="Clients" value={org.counts.contacts} />
          <Count label="Factures" value={org.counts.invoices} />
          <Count label="Membres" value={org.members.length} />
        </div>
        <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
          <div className="space-y-6">
            <Card className="p-6">
              <h2 className="text-lg font-semibold">Contact</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {org.members.map((member) => (
                  <li key={member.email} className="flex items-center justify-between gap-2">
                    <a href={`mailto:${member.email}`} className="hover:underline">
                      {member.name ? `${member.name}, ` : ""}
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
              <h2 className="text-lg font-semibold">Ce qu&apos;elle utilise</h2>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {org.enabledModules.length === 0 ? (
                  <p className="text-sm text-text-muted">Aucun module activé.</p>
                ) : (
                  org.enabledModules.map((module) => <Badge key={module}>{MODULE_LABELS[module] ?? module}</Badge>)
                )}
              </div>
            </Card>
          </div>
          <div className="space-y-6">
            <Notes organizationId={org.id} />
            <Suspension organizationId={org.id} suspended={Boolean(org.suspendedAt)} onDone={refresh} />
          </div>
        </div>
      </TabPanel>

      <TabPanel tab="formule" active={tab}>
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
                  {trialRunning
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
          </div>
        </div>
      </TabPanel>

      <TabPanel tab="solde" active={tab}>
        <WalletPanel organizationId={org.id} />
      </TabPanel>

      <TabPanel tab="equipe" active={tab}>
        <Card className="overflow-hidden">
          <Table caption="Membres de l'entreprise">
            <thead>
              <tr>
                <Th>Membre</Th>
                <Th>Statut</Th>
              </tr>
            </thead>
            <tbody>
              {org.members.map((member) => (
                <tr key={member.email}>
                  <Td>
                    <span className="font-medium">{member.name ?? member.email}</span>
                    {member.name && <span className="block text-xs text-text-muted">{member.email}</span>}
                  </Td>
                  <Td>
                    <Badge variant={member.status === "active" ? "success" : "default"}>
                      {member.status === "active" ? "Actif" : member.status}
                    </Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <p className="text-sm text-text-muted">
          Pour réinitialiser un mot de passe ou désactiver un compte, ouvrez la personne dans{" "}
          <Link href="/admin/utilisateurs" className="font-semibold text-action hover:underline">Utilisateurs</Link>.
        </p>
      </TabPanel>

      <TabPanel tab="journal" active={tab}>
        <Card className="p-6">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">Activité récente</h2>
            <Link href={`/admin/journal?entreprise=${org.id}`} className="text-sm font-semibold text-action hover:underline">
              Tout le journal
            </Link>
          </div>
          {org.recentActivity.length === 0 ? (
            <p className="mt-2 text-sm text-text-muted">Aucune activité enregistrée.</p>
          ) : (
            <ul className="mt-3 space-y-1.5 text-sm">
              {org.recentActivity.map((entry, index) => (
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
      </TabPanel>
    </div>
  );
}

/** Hidden rather than unmounted: a half-typed note survives a look at another tab. */
function TabPanel({ tab, active, children }: { tab: TabKey; active: TabKey; children: React.ReactNode }) {
  return (
    <div id={`fiche-${tab}`} className={tab === active ? "space-y-6" : "hidden"}>
      {children}
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");
}

const MODULE_LABELS: Record<string, string> = {
  crm: "Clients",
  catalog: "Catalogue",
  commerce: "Commandes",
  booking: "Réservations",
  finance: "Devis et factures",
  marketing: "Promotions",
  communication: "Messages",
  website: "Site",
  analytics: "Statistiques",
  workflow: "Automatisations",
  ai: "KORVA IA",
};

/** Internal notes: what was said or promised to this business. Never shown to it. */
function Notes({ organizationId }: { organizationId: string }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const notes = useQuery({
    queryKey: ["platform", "notes", organizationId],
    queryFn: () => adminApi.get<PlatformNote[]>(`/platform/organizations/${organizationId}/notes`),
  });
  const add = useMutation({
    mutationFn: () => adminApi.post<PlatformNote>(`/platform/organizations/${organizationId}/notes`, { text: text.trim() }),
    onSuccess: () => {
      setText("");
      void queryClient.invalidateQueries({ queryKey: ["platform", "notes", organizationId] });
    },
  });
  return (
    <Card className="space-y-3 p-6">
      <h2 className="text-lg font-semibold">Notes internes</h2>
      {notes.data && notes.data.length === 0 && (
        <p className="text-sm text-text-muted">Aucune note. Notez ici un appel, une promesse, une demande.</p>
      )}
      {notes.data && notes.data.length > 0 && (
        <ul className="max-h-72 space-y-2 overflow-y-auto">
          {notes.data.map((note) => (
            <li key={note.id} className="rounded-lg bg-app-background px-3 py-2 text-sm">
              <p className="whitespace-pre-line">{note.text}</p>
              <p className="mt-1 text-xs text-text-muted">
                {note.authorEmail}, {formatDay(note.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim()) add.mutate();
        }}
        className="space-y-2"
      >
        <UiField id={`note-${organizationId}`} label="Ajouter une note" error={add.isError ? errorText(add.error) : undefined}>
          <Textarea id={`note-${organizationId}`} value={text} maxLength={2000} onChange={(event) => setText(event.target.value)} />
        </UiField>
        <Button type="submit" size="sm" loading={add.isPending} disabled={!text.trim()}>
          Enregistrer la note
        </Button>
      </form>
    </Card>
  );
}

/** The business's Solde as KORVA sees it, and a manual adjustment (a correction, a goodwill gesture). */
function WalletPanel({ organizationId }: { organizationId: string }) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const wallet = useQuery({
    queryKey: ["platform", "organization-wallet", organizationId],
    queryFn: () => adminApi.get<WalletSummary>(`/platform/organizations/${organizationId}/wallet`),
  });
  const value = Number(amount.replace(/\s/g, "").replace(",", "."));
  const valid = Number.isFinite(value) && value !== 0 && note.trim().length >= 3;
  const adjust = useMutation({
    mutationFn: () =>
      adminApi.post<WalletSummary>(`/platform/organizations/${organizationId}/wallet/adjustments`, {
        amount: value,
        note: note.trim(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["platform", "organization-wallet", organizationId] });
      void queryClient.invalidateQueries({ queryKey: ["platform", "finance"] });
      setAmount("");
      setNote("");
      setConfirming(false);
    },
  });

  if (wallet.isLoading) return <SkeletonList rows={3} />;
  if (wallet.isError || !wallet.data) return <p className="text-sm text-destructive">Impossible de charger le Solde.</p>;
  const summary = wallet.data;
  const money = (n: number) => formatMoney(n, summary.currency);

  return (
    <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <StatTile label="Disponible" value={money(summary.available)} hint={`Formule ${PLAN_NAMES[summary.plan]}, commission ${(summary.commissionBasisPoints / 100).toLocaleString("fr-FR")} %`} />
          <StatTile label="En attente" value={money(summary.pending)} hint={summary.holdDays > 0 ? `Libéré ${summary.holdDays} j après chaque vente` : "Libéré à chaque vente"} />
        </div>
        <Card className="p-6 text-sm">
          <h2 className="text-lg font-semibold">Retraits</h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3">
            <Field label="Numéro de retrait">
              {summary.destination ? `${summary.destination.provider} ${summary.destination.account}` : "Aucun numéro confirmé"}
            </Field>
            <Field label="Retrait automatique">
              {summary.autoPayout.enabled ? `Oui, ${summary.autoPayout.frequency === "daily" ? "chaque jour" : "chaque semaine"}` : "Non"}
            </Field>
            <Field label="Retrait en cours">{summary.openPayout ? money(summary.openPayout.amount) : "Aucun"}</Field>
            <Field label="Formule payée depuis le Solde">{summary.autoPaySubscription ? "Oui" : "Non"}</Field>
          </dl>
          <Link href="/admin/reversements" className="mt-4 inline-block font-semibold text-action hover:underline">
            Voir les reversements
          </Link>
        </Card>
      </div>
      <Card className="space-y-3 p-6">
        <h2 className="text-lg font-semibold">Ajuster le Solde</h2>
        <p className="text-sm text-text-muted">
          Une correction ou un geste commercial, visible par l&apos;entreprise avec votre motif. Montant négatif pour retirer.
        </p>
        <UiField id={`adjust-amount-${organizationId}`} label="Montant" help={`En ${summary.currency}, par exemple 5000 ou -1500.`}>
          <Input id={`adjust-amount-${organizationId}`} inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); setConfirming(false); }} />
        </UiField>
        <UiField id={`adjust-note-${organizationId}`} label="Motif" help="Affiché à l'entreprise dans ses mouvements.">
          <Input id={`adjust-note-${organizationId}`} maxLength={300} value={note} onChange={(event) => { setNote(event.target.value); setConfirming(false); }} />
        </UiField>
        {adjust.isError && <p className="text-sm text-destructive" role="alert">{errorText(adjust.error)}</p>}
        {confirming ? (
          <div className="flex flex-wrap gap-2">
            <Button loading={adjust.isPending} onClick={() => adjust.mutate()}>
              Confirmer {value > 0 ? "le crédit" : "le débit"} de {money(Math.abs(value))}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>Annuler</Button>
          </div>
        ) : (
          <Button variant="secondary" disabled={!valid} onClick={() => setConfirming(true)}>
            Ajuster le Solde
          </Button>
        )}
      </Card>
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
      adminApi.post(`/platform/organizations/${organizationId}/invoices/${invoice.id}/paid`),
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
      adminApi.post(`/platform/organizations/${organizationId}/plan`, { planKey }),
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
      adminApi.post(`/platform/organizations/${organizationId}/trial`, { days: Number(days) }),
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
        ? adminApi.post(`/platform/organizations/${organizationId}/reactivate`)
        : adminApi.post(`/platform/organizations/${organizationId}/suspend`, { reason }),
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

/**
 * "Voir son tableau de bord": a new tab on the business's own dashboard, read-only, for 30
 * minutes. The tab is opened at the click (a tab opened after the request would be blocked as a
 * pop-up), then pointed at /voir with the view token in the URL fragment.
 */
function ViewDashboardButton({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function open() {
    setError(null);
    setPending(true);
    const tab = window.open("about:blank", "_blank");
    try {
      const view = await adminApi.post<{
        accessToken: string;
        organizationId: string;
        expiresAt: string;
        user: { id: string; email: string; firstName?: string; lastName?: string };
      }>(`/platform/organizations/${organizationId}/view-as`, {});
      const fragment = new URLSearchParams({
        t: view.accessToken,
        o: view.organizationId,
        e: view.expiresAt,
        u: JSON.stringify(view.user),
      });
      if (tab) {
        tab.opener = null;
        tab.location.href = `${window.location.origin}/voir#${fragment.toString()}`;
      } else {
        // Pop-up blocked: open the view in this tab instead.
        router.push(`/voir#${fragment.toString()}`);
      }
    } catch (err) {
      tab?.close();
      setError(err instanceof ApiError ? err.message : "Impossible d'ouvrir le tableau de bord.");
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex flex-col">
      <Button variant="secondary" onClick={() => void open()} disabled={pending}>
        Voir son tableau de bord
      </Button>
      {error && <span className="mt-1 text-xs text-destructive">{error}</span>}
    </span>
  );
}
