"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TillClosing, TillReport } from "@korva/types";
import { Button, Card, Input, Notice, StatTile, Table, Td, Th } from "@korva/ui";
import { ApiError, apiClient } from "@/lib/api-client";
import { formatCurrency } from "@/lib/analytics-format";
import { usePlanFeatures } from "@/lib/use-plan-features";
import { UpgradeCard } from "./upgrade-card";
import { intlLocale, useDashboardLocale, useT, type Translate } from "@/lib/dashboard-locale";
import type { Locale } from "@korva/types";

function differenceText(closing: TillClosing, currency: string, t: Translate, locale: Locale): string {
  if (closing.difference === 0) return t("Caisse juste", "Till balances");
  const amount = formatCurrency(Math.abs(closing.difference), currency, locale);
  return closing.difference < 0 ? t(`Il manque ${amount}`, `${amount} short`) : t(`${amount} en trop`, `${amount} over`);
}

/**
 * The day's till (Pro): everything taken today by method and by staff member, then the closing —
 * count the cash drawer, KORVA compares it with the cash payments recorded. One closing per day.
 */
export function TillPanel() {
  const queryClient = useQueryClient();
  const planFeatures = usePlanFeatures();
  const locale = useDashboardLocale();
  const t = useT();
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
        description={t(
          "Voyez ce que chaque employé a encaissé dans la journée, et fermez la caisse en comparant le tiroir aux ventes.",
          "See what each employee took during the day, and close the till by comparing the drawer with the sales.",
        )}
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
        {t("Caisse du jour", "Today's till")}
      </h2>
      {report.isError && <p className="text-sm text-destructive">{t("Impossible de charger la caisse du jour.", "Today's till could not be loaded.")}</p>}
      {data && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatTile
              tone="emphasis"
              label={t("Encaissé aujourd'hui", "Taken today")}
              value={formatCurrency(data.total, data.currency, locale)}
              hint={t(`${data.count} paiement${data.count > 1 ? "s" : ""}`, `${data.count} payment${data.count === 1 ? "" : "s"}`)}
            />
            <StatTile
              label={t("Espèces attendues", "Expected cash")}
              value={formatCurrency(data.expectedCash, data.currency, locale)}
            />
            <StatTile
              label={t("QR non payés", "Unpaid QR codes")}
              value={data.counterUnpaid}
              hint={data.counterUnpaid > 0 ? t("Clients partis sans payer ?", "Customers left without paying?") : undefined}
            />
          </div>

          {data.count > 0 && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card className="overflow-hidden">
                <Table caption={t("Encaissements du jour par moyen de paiement", "Today's takings by payment method")}>
                  <thead>
                    <tr>
                      <Th>{t("Moyen de paiement", "Payment method")}</Th>
                      <Th align="right">{t("Paiements", "Payments")}</Th>
                      <Th align="right">{t("Montant", "Amount")}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byMethod.map((row) => (
                      <tr key={row.method}>
                        <Td>{row.label}</Td>
                        <Td numeric>{row.count}</Td>
                        <Td numeric>{formatCurrency(row.total, data.currency, locale)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card>
              <Card className="overflow-hidden">
                <Table caption={t("Encaissements du jour par employé", "Today's takings by employee")}>
                  <thead>
                    <tr>
                      <Th>{t("Encaissé par", "Taken by")}</Th>
                      <Th align="right">{t("Paiements", "Payments")}</Th>
                      <Th align="right">{t("Montant", "Amount")}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byStaff.map((row) => (
                      <tr key={row.userId ?? "online"}>
                        <Td>{row.name}</Td>
                        <Td numeric>{row.count}</Td>
                        <Td numeric>{formatCurrency(row.total, data.currency, locale)}</Td>
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
                {t(
                  `Caisse fermée par ${data.closing.closedByName} à ${new Date(data.closing.closedAt).toLocaleTimeString("fr-FR", { timeStyle: "short" })} : ${formatCurrency(data.closing.countedCash, data.currency)} comptés, ${differenceText(data.closing, data.currency, t, locale)}.`,
                  `Till closed by ${data.closing.closedByName} at ${new Date(data.closing.closedAt).toLocaleTimeString(intlLocale(locale), { timeStyle: "short" })}: ${formatCurrency(data.closing.countedCash, data.currency, locale)} counted, ${differenceText(data.closing, data.currency, t, locale)}.`,
                )}
              </Notice>
            ) : (
              <form onSubmit={submit} className="space-y-3">
                <h3 className="text-sm font-semibold text-text">{t("Fermer la caisse", "Close the till")}</h3>
                <p className="text-sm text-text-muted">
                  {t(
                    "Comptez les espèces du tiroir et saisissez le total. La journée ne peut être fermée qu'une fois.",
                    "Count the cash in the drawer and enter the total. A day can only be closed once.",
                  )}
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="text-sm">
                    <span className="mb-1 block font-medium text-text">{t("Espèces comptées", "Cash counted")}</span>
                    <Input
                      inputMode="decimal"
                      required
                      value={counted}
                      onChange={(event) => setCounted(event.target.value)}
                      placeholder="0"
                    />
                  </label>
                  <label className="min-w-0 flex-1 text-sm">
                    <span className="mb-1 block font-medium text-text">{t("Remarque (facultatif)", "Note (optional)")}</span>
                    <Input value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
                  </label>
                  <Button type="submit" disabled={close.isPending || counted.trim() === ""}>
                    {t("Fermer la caisse", "Close the till")}
                  </Button>
                </div>
                {close.isError && (
                  <p className="text-sm text-destructive">
                    {close.error instanceof ApiError && close.error.code === "TILL_ALREADY_CLOSED"
                      ? t("La caisse de ce jour est déjà fermée.", "This day's till is already closed.")
                      : t("La caisse n'a pas pu être fermée. Réessayez.", "The till could not be closed. Try again.")}
                  </p>
                )}
              </form>
            )}
          </Card>
        </>
      )}

      {closings.data && closings.data.length > 0 && (
        <Card className="overflow-hidden">
          <h3 className="px-5 pt-5 text-sm font-semibold text-text">{t("Dernières clôtures", "Recent closings")}</h3>
          <Table caption={t("Dernières clôtures de caisse", "Recent till closings")}>
            <thead>
              <tr>
                <Th>{t("Jour", "Day")}</Th>
                <Th>{t("Par", "By")}</Th>
                <Th align="right">{t("Encaissé", "Taken")}</Th>
                <Th align="right">{t("Espèces comptées", "Cash counted")}</Th>
                <Th>{t("Écart", "Difference")}</Th>
              </tr>
            </thead>
            <tbody>
              {closings.data.map((closing) => (
                <tr key={closing.id}>
                  <Td>{new Date(`${closing.day}T12:00:00`).toLocaleDateString(intlLocale(locale))}</Td>
                  <Td>{closing.closedByName}</Td>
                  <Td numeric>{formatCurrency(closing.total, data?.currency ?? null, locale)}</Td>
                  <Td numeric>{formatCurrency(closing.countedCash, data?.currency ?? null, locale)}</Td>
                  <Td className={closing.difference < 0 ? "text-destructive" : undefined}>
                    {differenceText(closing, data?.currency ?? "", t, locale)}
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
