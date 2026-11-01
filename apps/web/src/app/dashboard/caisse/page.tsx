"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import type { CounterPayment } from "@korva/types";
import { Badge, Button, Card, Input, Notice, PageHeader } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { formatCurrency } from "@/lib/analytics-format";
import { useAuthReady } from "@/lib/use-auth-ready";
import { TillPanel } from "@/components/pro/till-panel";

const ERRORS: Record<string, string> = {
  ONLINE_PAYMENT_NOT_AVAILABLE: "Le paiement mobile money n'est pas encore disponible pour votre entreprise. Contactez KORVA.",
  CURRENCY_NOT_CHARGEABLE: "Le paiement mobile money n'est pas disponible dans la devise de votre entreprise.",
  VALIDATION_ERROR: "Saisissez un montant supérieur à zéro.",
};

function errorText(error: unknown): string {
  return (error instanceof ApiError && ERRORS[error.code]) || "Le QR code n'a pas pu être créé. Réessayez.";
}

const STATUS: Record<string, { label: string; variant: "default" | "success" | "warning" }> = {
  pending: { label: "En attente", variant: "default" },
  processing: { label: "En attente", variant: "default" },
  completed: { label: "Payé", variant: "success" },
  failed: { label: "Échoué", variant: "warning" },
  refunded: { label: "Remboursé", variant: "default" },
};

/** The screen stops asking GeniusPay after this long; the webhook still records a late payment. */
const POLL_FOR_MS = 15 * 60 * 1000;
const POLL_EVERY_MS = 3000;

/**
 * La caisse: type the amount, show the QR code, the customer scans it with their phone and pays
 * by mobile money on GeniusPay's page. The screen turns to "Payé" on its own; the money goes to
 * the Solde KORVA like any online sale.
 */
export default function CounterPage() {
  const authReady = useAuthReady();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [current, setCurrent] = useState<{ id: string; expired: boolean } | null>(null);
  const parsedAmount = Number(amount.replace(/\s/g, "").replace(",", "."));

  const currentId = current?.id;
  useEffect(() => {
    if (!currentId) return;
    const timer = setTimeout(
      () => setCurrent((sale) => (sale?.id === currentId ? { ...sale, expired: true } : sale)),
      POLL_FOR_MS,
    );
    return () => clearTimeout(timer);
  }, [currentId]);

  const recent = useQuery({
    queryKey: ["counter-payments"],
    queryFn: () => apiClient.get<CounterPayment[]>("/counter-payments"),
    enabled: authReady,
  });

  const create = useMutation({
    mutationFn: () =>
      apiClient.post<CounterPayment>("/counter-payments", {
        amount: parsedAmount,
        ...(label.trim() ? { label: label.trim() } : {}),
      }),
    onSuccess: (payment) => {
      queryClient.setQueryData(["counter-payments", payment.id], payment);
      setCurrent({ id: payment.id, expired: false });
      void queryClient.invalidateQueries({ queryKey: ["counter-payments"], exact: true });
    },
  });

  const sale = useQuery({
    queryKey: ["counter-payments", current?.id],
    queryFn: () => apiClient.get<CounterPayment>(`/counter-payments/${current!.id}`),
    enabled: authReady && current !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      const waiting = status === "pending" || status === "processing";
      return waiting && current && !current.expired ? POLL_EVERY_MS : false;
    },
  });

  const status = sale.data?.status;
  const settled = status === "completed" || status === "failed";
  useEffect(() => {
    if (settled) {
      void queryClient.invalidateQueries({ queryKey: ["counter-payments"], exact: true });
      void queryClient.invalidateQueries({ queryKey: ["wallet"] });
    }
  }, [settled, queryClient]);

  const newSale = () => {
    setCurrent(null);
    setAmount("");
    setLabel("");
    create.reset();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        title="Caisse"
        description="Saisissez le montant et montrez le QR code : le client le scanne avec son téléphone et paie par Wave, Orange Money, MTN, Moov ou carte. L'argent arrive dans votre Solde KORVA."
      />

      {!current ? (
        <Card className="p-5">
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label htmlFor="counter-amount" className="text-sm font-medium text-text">
                Montant à encaisser
              </label>
              <Input
                id="counter-amount"
                inputMode="decimal"
                autoComplete="off"
                autoFocus
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="mt-1 h-14 text-2xl font-semibold tabular-nums"
                placeholder="0"
              />
            </div>
            <div>
              <label htmlFor="counter-label" className="text-sm font-medium text-text">
                Pour quoi ? <span className="font-normal text-text-muted">(facultatif, apparaît sur la facture)</span>
              </label>
              <Input
                id="counter-label"
                maxLength={120}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                className="mt-1"
                placeholder="Vente au comptoir"
              />
            </div>
            {create.isError && (
              <p className="text-sm text-destructive" role="alert">
                {errorText(create.error)}
              </p>
            )}
            <Button type="submit" loading={create.isPending} disabled={!(parsedAmount > 0)}>
              Afficher le QR code
            </Button>
          </form>
        </Card>
      ) : (
        <Card className="p-5">
          {sale.data ? <SaleDisplay sale={sale.data} onNewSale={newSale} expired={current.expired} /> : (
            <p className="text-sm text-text-muted">Chargement…</p>
          )}
        </Card>
      )}

      <Card className="p-5">
        <h2 className="text-base font-semibold text-text">Dernières ventes à la caisse</h2>
        {recent.data && recent.data.length === 0 && (
          <p className="mt-2 text-sm text-text-muted">Aucune vente encaissée par QR code pour l&apos;instant.</p>
        )}
        <ul className="mt-3 divide-y divide-border">
          {recent.data?.map((payment) => {
            const badge = STATUS[payment.status] ?? { label: payment.status, variant: "default" as const };
            return (
              <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <span>
                  <span className="font-medium tabular-nums">{formatCurrency(payment.amount, payment.currency)}</span>{" "}
                  <span className="text-text-muted">{payment.label}</span>
                  <span className="block text-xs text-text-muted">
                    {payment.invoiceNumber} — {new Date(payment.createdAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
                  </span>
                </span>
                <Badge variant={badge.variant}>{badge.label}</Badge>
              </li>
            );
          })}
        </ul>
      </Card>

      <TillPanel />
    </div>
  );
}

function SaleDisplay({
  sale,
  expired,
  onNewSale,
}: {
  sale: CounterPayment;
  expired: boolean;
  onNewSale: () => void;
}) {
  const amount = formatCurrency(sale.amount, sale.currency);
  const [copied, setCopied] = useState(false);
  const copy = (url: string) =>
    void navigator.clipboard?.writeText(url).then(
      () => setCopied(true),
      () => setCopied(false),
    );

  if (sale.status === "completed") {
    return (
      <div className="space-y-4 py-6 text-center" role="status">
        <p className="text-3xl font-semibold text-text">Payé</p>
        <p className="text-lg tabular-nums text-text">{amount}</p>
        <p className="text-sm text-text-muted">
          Facture {sale.invoiceNumber} réglée. Le montant arrive dans votre Solde KORVA, frais et commission déduits.
        </p>
        <Button onClick={onNewSale}>Nouvelle vente</Button>
      </div>
    );
  }
  if (sale.status === "failed") {
    return (
      <div className="space-y-4 py-6 text-center" role="status">
        <p className="text-2xl font-semibold text-text">Paiement non abouti</p>
        <p className="text-sm text-text-muted">Le client n&apos;a pas pu payer {amount}. Créez un nouveau QR code pour réessayer.</p>
        <Button onClick={onNewSale}>Nouvelle vente</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <p className="text-3xl font-semibold tabular-nums text-text">{amount}</p>
      <p className="text-sm text-text-muted">{sale.label}</p>
      {sale.checkoutUrl && <QrImage value={sale.checkoutUrl} />}
      {expired ? (
        <Notice tone="warning">
          Ce QR code n&apos;est plus surveillé par cet écran. Si le client a payé, la vente apparaîtra comme payée dans la liste ci-dessous.
        </Notice>
      ) : (
        <p className="text-sm text-text-muted" aria-live="polite">
          En attente du paiement… L&apos;écran se met à jour tout seul.
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        {sale.checkoutUrl && (
          <Button size="sm" variant="secondary" onClick={() => copy(sale.checkoutUrl!)}>
            {copied ? "Lien copié" : "Copier le lien de paiement"}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onNewSale}>
          Annuler et revenir
        </Button>
      </div>
    </div>
  );
}

/** Black on white whatever the theme: phone cameras read a dark-mode (inverted) QR code badly. */
function QrImage({ value }: { value: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    QRCode.toString(value, { type: "svg", margin: 2, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } })
      .then((markup) => !cancelled && setSvg(markup))
      .catch(() => !cancelled && setSvg(null));
    return () => {
      cancelled = true;
    };
  }, [value]);

  return (
    <div
      role="img"
      aria-label="QR code de paiement mobile money"
      className="size-64 rounded-lg bg-white p-2 [&>svg]:size-full"
      // The SVG is generated locally by the qrcode library from GeniusPay's URL — never user HTML.
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );
}
