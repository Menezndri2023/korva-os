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
    </div>
  );
}

function PayoutRow({ payout, onChanged }: { payout: Row; onChanged: () => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const act = useMutation({
    mutationFn: (input: { action: "approve" | "reject" | "sync"; reason?: string }) =>
      adminApi.post(`/platform/payouts/${payout.id}/${input.action}`, input.reason ? { reason: input.reason } : {}),
    onSuccess: () => {
      setRejecting(false);
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
          {payout.providerReference ? `Référence GeniusPay ${payout.providerReference}. ` : ""}
          {payout.fee != null ? `Frais ${formatMoney(payout.fee, payout.currency)}. ` : ""}
          {payout.failureReason ?? ""}
        </p>
      )}
      {act.isError && <p className="text-sm text-destructive">L&apos;action n&apos;a pas abouti. Réessayez.</p>}

      {rejecting ? (
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
