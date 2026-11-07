"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PAYOUT_PROVIDER_LABELS,
  PAYOUT_STATUS_LABELS,
  type Payout,
  type PayoutStatus,
  type PlatformWalletOverview,
} from "@korva/types";
import { Badge, Button, Card, EmptyState, Input, PageHeader } from "@korva/ui";
import { adminApi, formatDay, formatMoney } from "@/lib/platform-admin";

type Row = Payout & { organizationName: string };
type Filter = PayoutStatus | "all";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "requested", label: "À valider" },
  { key: "processing", label: "En cours d'envoi" },
  { key: "completed", label: "Versés" },
  { key: "failed", label: "Échoués" },
  { key: "rejected", label: "Refusés" },
  { key: "all", label: "Tous" },
];

const STATUS_VARIANT: Record<PayoutStatus, "default" | "success" | "warning"> = {
  requested: "default",
  processing: "default",
  completed: "success",
  failed: "warning",
  rejected: "warning",
};

/**
 * Reversements: the money KORVA holds for its businesses (formule B) and the withdrawals going
 * out of it. With PAYOUT_APPROVAL=manual every withdrawal waits here for a "Valider"; a refused
 * or failed one is given back to the business's balance by the API.
 */
export default function AdminPayoutsPage() {
  const [filter, setFilter] = useState<Filter>("requested");
  const queryClient = useQueryClient();
  const overview = useQuery({
    queryKey: ["platform", "payouts", "overview"],
    queryFn: () => adminApi.get<PlatformWalletOverview>("/platform/wallets/overview"),
  });
  const list = useQuery({
    queryKey: ["platform", "payouts", filter],
    queryFn: () => adminApi.get<Row[]>(`/platform/payouts${filter === "all" ? "" : `?status=${filter}`}`),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["platform", "payouts"] });
  const o = overview.data;

  return (
    <div>
      <PageHeader
        title="Reversements"
        description="L'argent encaissé pour les entreprises sur le compte GeniusPay de KORVA, et les retraits vers leurs numéros mobile money."
      />

      {o && (
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          <Card className="p-4">
            <p className="text-xs text-text-muted">Dû aux entreprises</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(o.heldAvailable + o.heldPending, o.currency)}</p>
            <p className="text-xs text-text-muted">dont {formatMoney(o.heldPending, o.currency)} en attente</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-text-muted">Commission ce mois-ci</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(o.commissionThisMonth, o.currency)}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-text-muted">À valider</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{o.payoutsToApprove}</p>
            <p className="text-xs text-text-muted">
              {o.approvalMode === "manual" ? "Validation manuelle" : "Envoi automatique"}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-text-muted">En cours d&apos;envoi</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{o.payoutsProcessing}</p>
          </Card>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filtrer les retraits">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
              filter === key
                ? "border-action bg-action font-semibold text-on-action"
                : "border-border-input bg-surface hover:bg-surface-muted"
            }`}
          >
            {label}
            {key === "requested" && o ? ` (${o.payoutsToApprove})` : ""}
          </button>
        ))}
      </div>

      {list.isLoading && <Card className="p-6 text-sm text-text-muted">Chargement…</Card>}
      {list.isError && <Card className="p-6 text-sm text-destructive">Impossible de charger les retraits.</Card>}
      {list.data && list.data.length === 0 && (
        <Card>
          <EmptyState
            title={filter === "requested" ? "Aucun retrait à valider." : "Aucun retrait ici."}
            description="Les entreprises demandent leurs retraits depuis leur page Solde KORVA."
          />
        </Card>
      )}

      <div className="space-y-3">
        {list.data?.map((payout) => (
          <PayoutRow key={payout.id} payout={payout} onChanged={refresh} />
        ))}
      </div>

      <CustomerRefunds />
    </div>
  );
}

interface ManualRefund {
  id: string;
  organizationId: string;
  organizationName: string;
  amount: number;
  currency: string;
  reason?: string;
  status: "processing" | "completed" | "failed";
  providerReference?: string;
  invoiceNumber?: string;
  customer: { name: string; email?: string; phone?: string };
  manualReference?: string;
  rejectionReason?: string;
  createdAt: string;
}

/**
 * Customer refunds of payments made online: GeniusPay has no refund API, so the business's Solde
 * was debited and KORVA sends the money back by hand — then records the transfer's reference.
 */
function CustomerRefunds() {
  const queryClient = useQueryClient();
  const refunds = useQuery({
    queryKey: ["platform", "refunds"],
    queryFn: () => adminApi.get<ManualRefund[]>("/platform/refunds"),
  });
  const toSend = refunds.data?.filter((refund) => refund.status === "processing") ?? [];
  const done = refunds.data?.filter((refund) => refund.status !== "processing").slice(0, 10) ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["platform", "refunds"] });

  return (
    <section className="mt-8 space-y-3">
      <h2 className="text-lg font-semibold">Remboursements clients à envoyer</h2>
      <p className="text-sm text-text-muted">
        Paiements en ligne remboursés par une entreprise : le montant est déjà retiré de son Solde. Renvoyez-le au
        client (Wave, ou remboursement depuis le tableau de bord GeniusPay), puis notez la référence.
      </p>
      {refunds.isError && <Card className="p-4 text-sm text-destructive">Impossible de charger les remboursements.</Card>}
      {refunds.data && toSend.length === 0 && (
        <Card>
          <EmptyState title="Aucun remboursement à envoyer." description="Les entreprises remboursent depuis la facture payée." />
        </Card>
      )}
      {toSend.map((refund) => (
        <RefundRow key={refund.id} refund={refund} onChanged={refresh} />
      ))}
      {done.length > 0 && (
        <Card className="p-4">
          <p className="mb-2 text-sm font-medium">Derniers traités</p>
          <ul className="divide-y divide-border text-sm">
            {done.map((refund) => (
              <li key={refund.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                <span>
                  {formatMoney(refund.amount, refund.currency)} — {refund.organizationName} — {refund.customer.name || refund.customer.email}
                </span>
                <span className="text-text-muted">
                  {refund.status === "completed" ? `Envoyé, réf. ${refund.manualReference}` : `Refusé : ${refund.rejectionReason}`}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

function RefundRow({ refund, onChanged }: { refund: ManualRefund; onChanged: () => void }) {
  const [mode, setMode] = useState<"idle" | "sent" | "reject">("idle");
  const [value, setValue] = useState("");
  const act = useMutation({
    mutationFn: () =>
      mode === "sent"
        ? adminApi.post(`/platform/refunds/${refund.id}/mark-sent`, { reference: value.trim() })
        : adminApi.post(`/platform/refunds/${refund.id}/reject`, { reason: value.trim() }),
    onSuccess: () => {
      setMode("idle");
      setValue("");
      onChanged();
    },
  });
  return (
    <Card className="space-y-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-lg font-semibold tabular-nums">{formatMoney(refund.amount, refund.currency)}</p>
        <Link href={`/admin/entreprises/${refund.organizationId}`} className="text-sm hover:underline">
          {refund.organizationName}
        </Link>
      </div>
      <p className="text-sm">
        Client : {refund.customer.name || "—"}
        {refund.customer.phone ? ` — ${refund.customer.phone}` : ""}
        {refund.customer.email ? ` — ${refund.customer.email}` : ""}
      </p>
      <p className="text-xs text-text-muted">
        {refund.invoiceNumber ? `Facture ${refund.invoiceNumber}. ` : ""}
        {refund.providerReference ? `Paiement GeniusPay ${refund.providerReference}. ` : ""}
        {refund.reason ? `Motif : ${refund.reason}. ` : ""}
        Demandé le {formatDay(refund.createdAt)}.
      </p>
      {act.isError && <p className="text-sm text-destructive">L&apos;action n&apos;a pas abouti. Réessayez.</p>}
      {mode === "idle" ? (
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          <Button type="button" size="sm" onClick={() => setMode("sent")}>
            Remboursé au client
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => setMode("reject")}>
            Refuser ce remboursement
          </Button>
        </div>
      ) : (
        <form
          className="space-y-2 border-t border-border pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            act.mutate();
          }}
        >
          <label className="block text-sm">
            <span className="mb-1 block text-text-muted">
              {mode === "sent" ? "Référence du transfert au client" : "Motif (montré à l'entreprise, le montant lui est rendu)"}
            </span>
            <Input value={value} minLength={3} maxLength={300} required onChange={(event) => setValue(event.target.value)} />
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={act.isPending}>
              {mode === "sent" ? "Enregistrer comme remboursé" : "Refuser le remboursement"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode("idle")}>
              Annuler
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function PayoutRow({ payout, onChanged }: { payout: Row; onChanged: () => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [markingPaid, setMarkingPaid] = useState(false);
  const [reference, setReference] = useState("");
  const [fee, setFee] = useState("");
  const act = useMutation({
    mutationFn: (
      input:
        | { action: "approve" | "sync" }
        | { action: "reject"; reason: string }
        | { action: "mark-paid"; reference: string; fee?: number },
    ) => {
      const { action, ...body } = input;
      return adminApi.post(`/platform/payouts/${payout.id}/${action}`, body);
    },
    onSuccess: () => {
      setRejecting(false);
      setMarkingPaid(false);
      onChanged();
    },
  });

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-lg font-semibold tabular-nums">{formatMoney(payout.amount, payout.currency)}</p>
          <p className="text-xs text-text-muted">
            <Link href={`/admin/entreprises/${payout.organizationId}`} className="hover:underline">
              {payout.organizationName}
            </Link>{" "}
            — {formatDay(payout.createdAt)}
            {payout.trigger === "auto" ? " — automatique" : ""}
          </p>
        </div>
        <Badge variant={STATUS_VARIANT[payout.status]}>{PAYOUT_STATUS_LABELS[payout.status]}</Badge>
      </div>
      <p className="text-sm text-text">
        {PAYOUT_PROVIDER_LABELS[payout.destination.provider]} {payout.destination.account} — au nom de{" "}
        {payout.destination.holderName}
      </p>
      {(payout.providerReference || payout.failureReason || payout.fee != null) && (
        <p className="text-xs text-text-muted">
          {payout.providerReference
            ? payout.providerReference.startsWith("manual:")
              ? `Versé à la main, référence ${payout.providerReference.slice("manual:".length)}. `
              : `Référence GeniusPay ${payout.providerReference}. `
            : ""}
          {payout.fee != null ? `Frais ${formatMoney(payout.fee, payout.currency)}. ` : ""}
          {payout.failureReason ?? ""}
        </p>
      )}
      {act.isError && <p className="text-sm text-destructive">L&apos;action n&apos;a pas abouti. Réessayez.</p>}

      {markingPaid ? (
        <form
          className="space-y-2 border-t border-border pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            act.mutate({
              action: "mark-paid",
              reference: reference.trim(),
              ...(fee.trim() ? { fee: Number(fee) } : {}),
            });
          }}
        >
          <p className="text-sm text-text-muted">
            Envoyez {formatMoney(payout.amount, payout.currency)} à ce numéro depuis le compte de KORVA (Wave, Orange
            Money…), puis notez la référence de la transaction : l&apos;entreprise la voit sur son Solde.
          </p>
          <label className="block text-sm">
            <span className="mb-1 block text-text-muted">Référence de la transaction</span>
            <Input value={reference} minLength={3} maxLength={100} required onChange={(event) => setReference(event.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-text-muted">Frais payés (laisser vide si aucun)</span>
            <Input type="number" min={0} step="any" value={fee} onChange={(event) => setFee(event.target.value)} />
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={act.isPending}>
              Enregistrer comme versé
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMarkingPaid(false)}>
              Annuler
            </Button>
          </div>
        </form>
      ) : rejecting ? (
        <form
          className="space-y-2 border-t border-border pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            act.mutate({ action: "reject", reason: reason.trim() });
          }}
        >
          <label className="block text-sm">
            <span className="mb-1 block text-text-muted">Motif (montré à l&apos;entreprise, le montant lui est rendu)</span>
            <Input value={reason} minLength={3} maxLength={300} required onChange={(event) => setReason(event.target.value)} />
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={act.isPending}>
              Refuser le retrait
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setRejecting(false)}>
              Annuler
            </Button>
          </div>
        </form>
      ) : (
        (payout.status === "requested" || payout.status === "processing") && (
          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            {payout.status === "requested" && (
              <>
                <Button type="button" size="sm" loading={act.isPending} onClick={() => act.mutate({ action: "approve" })}>
                  Valider et envoyer
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setMarkingPaid(true)}>
                  Versé à la main
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setRejecting(true)}>
                  Refuser
                </Button>
              </>
            )}
            {payout.status === "processing" && (
              <Button type="button" size="sm" variant="secondary" loading={act.isPending} onClick={() => act.mutate({ action: "sync" })}>
                Vérifier auprès de GeniusPay
              </Button>
            )}
          </div>
        )
      )}
    </Card>
  );
}
