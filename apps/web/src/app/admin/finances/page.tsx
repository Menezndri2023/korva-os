"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  SegmentedControl,
  Skeleton,
  StatTile,
  Table,
  Td,
  Th,
} from "@korva/ui";
import { ApiError } from "@/lib/api-client";
import { adminApi, formatDay, formatMoney, type PlatformFinance } from "@/lib/platform-admin";

const PERIODS = [
  { value: "7", label: "7 jours" },
  { value: "30", label: "30 jours" },
  { value: "90", label: "90 jours" },
  { value: "365", label: "12 mois" },
] as const;
type Period = (typeof PERIODS)[number]["value"];

/**
 * KORVA's own money: what the plans brought in, what KORVA kept on the businesses' online sales,
 * what was paid back to them, what it still holds for them — and the plan invoices to chase.
 */
export default function AdminFinancePage() {
  const [period, setPeriod] = useState<Period>("30");
  const finance = useQuery({
    queryKey: ["platform", "finance", Number(period)],
    queryFn: () => adminApi.get<PlatformFinance>(`/platform/finance?days=${period}`),
  });
  const data = finance.data;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Finances KORVA"
        description="Formules encaissées, commissions sur les ventes en ligne, reversements et factures à relancer."
        actions={<SegmentedControl aria-label="Période" options={PERIODS} value={period} onChange={setPeriod} />}
      />

      {finance.isError && <p className="text-sm text-destructive">Impossible de charger les finances.</p>}

      {!data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-32 rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          <section aria-label="Revenus de KORVA" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Formules encaissées"
              value={
                data.plansPaid.length === 0
                  ? formatMoney(0, data.held.currency)
                  : data.plansPaid.map((row) => formatMoney(row.total, row.currency)).join(" + ")
              }
              hint={`${data.plansPaid.reduce((sum, row) => sum + row.count, 0)} facture(s) payée(s)`}
            />
            <StatTile
              label="Commissions KORVA"
              value={formatMoney(data.onlineSales.commissions, data.onlineSales.currency)}
              hint={`sur ${data.onlineSales.count} vente(s) en ligne`}
            />
            <StatTile
              label="Ventes en ligne des entreprises"
              value={formatMoney(data.onlineSales.total, data.onlineSales.currency)}
              hint={`dont ${formatMoney(data.onlineSales.providerFees, data.onlineSales.currency)} de frais GeniusPay`}
            />
            <StatTile
              label="Reversé aux entreprises"
              value={formatMoney(data.payoutsPaid.total, data.held.currency)}
              hint={`${data.payoutsPaid.count} retrait(s), ${formatMoney(data.payoutsPaid.fees, data.held.currency)} de frais`}
            />
          </section>

          <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div>
              <h2 className="text-base font-semibold">Argent détenu pour les entreprises</h2>
              <p className="mt-1 text-sm text-text-muted">
                Disponible {formatMoney(data.held.available, data.held.currency)}, en attente{" "}
                {formatMoney(data.held.pending, data.held.currency)}. Il doit toujours rester sur le compte GeniusPay de KORVA.
              </p>
            </div>
            <Link href="/admin/reversements" className="text-sm font-semibold text-action hover:underline">
              Voir les reversements
            </Link>
          </Card>

          <OpenInvoices invoices={data.openInvoices} />
        </>
      )}
    </div>
  );
}

function OpenInvoices({ invoices }: { invoices: PlatformFinance["openInvoices"] }) {
  const overdue = invoices.filter((invoice) => invoice.overdue).length;
  return (
    <Card className="overflow-hidden">
      <div className="p-6 pb-3">
        <h2 className="text-lg font-semibold">Factures de formule à encaisser</h2>
        <p className="mt-1 text-sm text-text-muted">
          {invoices.length === 0
            ? "Toutes les factures de formule sont réglées."
            : `${invoices.length} facture(s) ouverte(s), dont ${overdue} en retard. Un changement de formule non payé n'est pas listé : il ne s'active simplement pas.`}
        </p>
      </div>
      {invoices.length === 0 ? (
        <EmptyState title="Rien à relancer." description="Les nouvelles factures apparaîtront ici à leur échéance." />
      ) : (
        <Table caption="Factures de formule ouvertes">
          <thead>
            <tr>
              <Th>Entreprise</Th>
              <Th>Facture</Th>
              <Th align="right">Montant</Th>
              <Th>Échéance</Th>
              <Th align="right">Action</Th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((invoice) => (
              <InvoiceRow key={invoice.id} invoice={invoice} />
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function InvoiceRow({ invoice }: { invoice: PlatformFinance["openInvoices"][number] }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const markPaid = useMutation({
    mutationFn: () =>
      adminApi.post(`/platform/organizations/${invoice.organizationId}/invoices/${invoice.id}/paid`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["platform"] }),
  });
  return (
    <tr>
      <Td>
        <Link href={`/admin/entreprises/${invoice.organizationId}`} className="font-medium hover:underline">
          {invoice.organizationName}
        </Link>
      </Td>
      <Td>{invoice.number}</Td>
      <Td numeric>{formatMoney(invoice.amount, invoice.currency)}</Td>
      <Td>
        {formatDay(invoice.dueAt)}{" "}
        {invoice.overdue && <Badge variant="warning">En retard</Badge>}
      </Td>
      <Td align="right">
        {confirming ? (
          <span className="inline-flex flex-wrap justify-end gap-2">
            <Button size="sm" loading={markPaid.isPending} onClick={() => markPaid.mutate()}>
              Confirmer le paiement reçu
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Annuler
            </Button>
          </span>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setConfirming(true)}>
            Marquer payée
          </Button>
        )}
        {markPaid.isError && (
          <p className="mt-1 text-xs text-destructive">
            {markPaid.error instanceof ApiError ? markPaid.error.message : "Le paiement n'a pas pu être enregistré."}
          </p>
        )}
      </Td>
    </tr>
  );
}
