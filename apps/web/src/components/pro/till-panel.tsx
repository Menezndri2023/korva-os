"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TillClosing, TillReport } from "@korva/types";
import { Button, Card, Input, Notice, StatTile, Table, Td, Th } from "@korva/ui";
import { ApiError, apiClient } from "@/lib/api-client";
import { formatCurrency } from "@/lib/analytics-format";
import { usePlanFeatures } from "@/lib/use-plan-features";
import { UpgradeCard } from "./upgrade-card";

function differenceText(closing: TillClosing, currency: string): string {
  if (closing.difference === 0) return "Caisse juste";
  const amount = formatCurrency(Math.abs(closing.difference), currency);
  return closing.difference < 0 ? `Il manque ${amount}` : `${amount} en trop`;
}

/**
 * The day's till (Pro): everything taken today by method and by staff member, then the closing —
 * count the cash drawer, KORVA compares it with the cash payments recorded. One closing per day.
 */
export function TillPanel() {
  const queryClient = useQueryClient();
  const planFeatures = usePlanFeatures();
  const included = planFeatures.has("cash_closing");
  // Only once the plan is known: the hook reads every feature as included while it loads, which
  // is right for a lock badge but would send a request the API refuses.
  const ready = planFeatures.planKey !== undefined && included;
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");

  const report = useQuery({
    queryKey: ["till", "today"],
    queryFn: () => apiClient.get<TillReport>("/counter-payments/till"),
    enabled: ready,
    refetchInterval: 60_000,
  });
  const closings = useQuery({
    queryKey: ["till", "closings"],
    queryFn: () => apiClient.get<TillClosing[]>("/counter-payments/till/closings"),
    enabled: ready,
  });
  const close = useMutation({
    mutationFn: (input: { day: string; countedCash: number; note?: string }) =>
      apiClient.post<TillClosing>("/counter-payments/till/closings", input),
    onSuccess: async () => {
      setCounted("");
      setNote("");
      await queryClient.invalidateQueries({ queryKey: ["till"] });
    },
  });

  if (!included) {
    return (
      <UpgradeCard
        feature="cash_closing"
        description="Voyez ce que chaque employé a encaissé dans la journée, et fermez la caisse en comparant le tiroir aux ventes."
      />
    );
  }

  const data = report.data;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!data) return;
    const countedCash = Number(counted.replace(",", "."));
    if (!Number.isFinite(countedCash) || countedCash < 0) return;
    close.mutate({ day: data.day, countedCash, note: note.trim() || undefined });
  }

  return (
    <section aria-labelledby="till-title" className="space-y-4">
      <h2 id="till-title" className="text-base font-semibold text-text">
        Caisse du jour
      </h2>
      {report.isError && <p className="text-sm text-destructive">Impossible de charger la caisse du jour.</p>}
      {data && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatTile
              tone="emphasis"
              label="Encaissé aujourd'hui"
              value={formatCurrency(data.total, data.currency)}
              hint={`${data.count} paiement${data.count > 1 ? "s" : ""}`}
            />
            <StatTile label="Espèces attendues" value={formatCurrency(data.expectedCash, data.currency)} />
            <StatTile
              label="QR non payés"
              value={data.counterUnpaid}
              hint={data.counterUnpaid > 0 ? "Clients partis sans payer ?" : undefined}
            />
          </div>

          {data.count > 0 && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card className="overflow-hidden">
                <Table caption="Encaissements du jour par moyen de paiement">
                  <thead>
                    <tr>
                      <Th>Moyen de paiement</Th>
                      <Th align="right">Paiements</Th>
                      <Th align="right">Montant</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byMethod.map((row) => (
                      <tr key={row.method}>
                        <Td>{row.label}</Td>
                        <Td numeric>{row.count}</Td>
                        <Td numeric>{formatCurrency(row.total, data.currency)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card>
              <Card className="overflow-hidden">
                <Table caption="Encaissements du jour par employé">
                  <thead>
                    <tr>
                      <Th>Encaissé par</Th>
                      <Th align="right">Paiements</Th>
                      <Th align="right">Montant</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byStaff.map((row) => (
                      <tr key={row.userId ?? "online"}>
                        <Td>{row.name}</Td>
                        <Td numeric>{row.count}</Td>
                        <Td numeric>{formatCurrency(row.total, data.currency)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card>
            </div>
          )}

          <Card className="p-5">
            {data.closing ? (
              <Notice tone={data.closing.difference === 0 ? "info" : "warning"}>
                Caisse fermée par {data.closing.closedByName} à{" "}
                {new Date(data.closing.closedAt).toLocaleTimeString("fr-FR", { timeStyle: "short" })} :{" "}
                {formatCurrency(data.closing.countedCash, data.currency)} comptés,{" "}
                {differenceText(data.closing, data.currency)}.
              </Notice>
            ) : (
              <form onSubmit={submit} className="space-y-3">
                <h3 className="text-sm font-semibold text-text">Fermer la caisse</h3>
                <p className="text-sm text-text-muted">
                  Comptez les espèces du tiroir et saisissez le total. La journée ne peut être fermée qu&apos;une fois.
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="text-sm">
                    <span className="mb-1 block font-medium text-text">Espèces comptées</span>
                    <Input
                      inputMode="decimal"
                      required
                      value={counted}
                      onChange={(event) => setCounted(event.target.value)}
                      placeholder="0"
                    />
                  </label>
                  <label className="min-w-0 flex-1 text-sm">
                    <span className="mb-1 block font-medium text-text">Remarque (facultatif)</span>
                    <Input value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
                  </label>
                  <Button type="submit" disabled={close.isPending || counted.trim() === ""}>
                    Fermer la caisse
                  </Button>
                </div>
                {close.isError && (
                  <p className="text-sm text-destructive">
                    {close.error instanceof ApiError && close.error.code === "TILL_ALREADY_CLOSED"
                      ? "La caisse de ce jour est déjà fermée."
                      : "La caisse n'a pas pu être fermée. Réessayez."}
                  </p>
                )}
              </form>
            )}
          </Card>
        </>
      )}

      {closings.data && closings.data.length > 0 && (
        <Card className="overflow-hidden">
          <h3 className="px-5 pt-5 text-sm font-semibold text-text">Dernières clôtures</h3>
          <Table caption="Dernières clôtures de caisse">
            <thead>
              <tr>
                <Th>Jour</Th>
                <Th>Par</Th>
                <Th align="right">Encaissé</Th>
                <Th align="right">Espèces comptées</Th>
                <Th>Écart</Th>
              </tr>
            </thead>
            <tbody>
              {closings.data.map((closing) => (
                <tr key={closing.id}>
                  <Td>{new Date(`${closing.day}T12:00:00`).toLocaleDateString("fr-FR")}</Td>
                  <Td>{closing.closedByName}</Td>
                  <Td numeric>{formatCurrency(closing.total, data?.currency ?? null)}</Td>
                  <Td numeric>{formatCurrency(closing.countedCash, data?.currency ?? null)}</Td>
                  <Td className={closing.difference < 0 ? "text-destructive" : undefined}>
                    {differenceText(closing, data?.currency ?? "")}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </section>
  );
}
