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
import { CashSaleCard } from "@/components/cash-sale-card";
import { useActiveOrganization } from "@/lib/use-active-organization";
import { intlLocale, useDashboardLocale, useT, type Translate } from "@/lib/dashboard-locale";

function errorText(error: unknown, t: Translate): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "ONLINE_PAYMENT_NOT_AVAILABLE":
        return t(
          "Le paiement mobile money n'est pas encore disponible pour votre entreprise. Contactez KORVA.",
          "Mobile money payment is not available for your business yet. Contact KORVA.",
        );
      case "ONLINE_PAYMENT_TERMS_REQUIRED":
        return t(
          "Pour encaisser par mobile money, activez d'abord le paiement en ligne et acceptez ses conditions dans Paramètres > Entreprise. Vous pouvez aussi rester aux espèces, sans commission.",
          "To take mobile money, first turn on online payment and accept its terms in Settings > Business. You can also stay with cash, with no commission.",
        );
      case "ONLINE_PAYMENT_BELOW_MINIMUM":
        return t(
          "Le paiement mobile money commence à 500 F : encaissez ce montant en espèces.",
          "Mobile money payment starts at 500 F: take this amount in cash.",
        );
      case "CURRENCY_NOT_CHARGEABLE":
        return t(
          "Le paiement mobile money n'est pas disponible dans la devise de votre entreprise.",
          "Mobile money payment is not available in your business's currency.",
        );
      case "VALIDATION_ERROR":
        return t("Saisissez un montant supérieur à zéro.", "Enter an amount above zero.");
    }
  }
  return t("Le QR code n'a pas pu être créé. Réessayez.", "The QR code could not be created. Try again.");
}

const STATUS: Record<string, { label: [string, string]; variant: "default" | "success" | "warning" }> = {
  pending: { label: ["En attente", "Pending"], variant: "default" },
  processing: { label: ["En attente", "Pending"], variant: "default" },
  completed: { label: ["Payé", "Paid"], variant: "success" },
  failed: { label: ["Échoué", "Failed"], variant: "warning" },
  refunded: { label: ["Remboursé", "Refunded"], variant: "default" },
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
  const { data: organization } = useActiveOrganization();
  const locale = useDashboardLocale();
  const t = useT();
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
        title={t("Caisse", "Till")}
        description={t(
          "Saisissez le montant et montrez le QR code : le client le scanne avec son téléphone et paie par Wave, Orange Money, MTN, Moov ou carte. L'argent arrive dans votre Solde KORVA.",
          "Enter the amount and show the QR code: the customer scans it with their phone and pays by Wave, Orange Money, MTN, Moov or card. The money arrives in your KORVA balance.",
        )}
      />

      {!current ? (
        <Card className="p-5">
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label htmlFor="counter-amount" className="text-sm font-medium text-text">
                {t("Montant à encaisser", "Amount to take")}
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
                {t("Pour quoi ?", "What for?")}{" "}
                <span className="font-normal text-text-muted">
                  {t("(facultatif, apparaît sur la facture)", "(optional, shown on the invoice)")}
                </span>
              </label>
              <Input
                id="counter-label"
                maxLength={120}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                className="mt-1"
                placeholder={t("Vente au comptoir", "Counter sale")}
              />
            </div>
            {create.isError && (
              <p className="text-sm text-destructive" role="alert">
                {errorText(create.error, t)}
              </p>
            )}
            <Button type="submit" loading={create.isPending} disabled={!(parsedAmount > 0)}>
              {t("Afficher le QR code", "Show the QR code")}
            </Button>
          </form>
        </Card>
      ) : (
        <Card className="p-5">
          {sale.data ? <SaleDisplay sale={sale.data} onNewSale={newSale} expired={current.expired} /> : (
            <p className="text-sm text-text-muted">{t("Chargement…", "Loading…")}</p>
          )}
        </Card>
      )}

      <CashSaleCard currency={organization?.currency ?? null} />

      <Card className="p-5">
        <h2 className="text-base font-semibold text-text">{t("Dernières ventes à la caisse", "Recent till sales")}</h2>
        {recent.data && recent.data.length === 0 && (
          <p className="mt-2 text-sm text-text-muted">
            {t("Aucune vente encaissée par QR code pour l'instant.", "No sales taken by QR code yet.")}
          </p>
        )}
        <ul className="mt-3 divide-y divide-border">
          {recent.data?.map((payment) => {
            const badge = STATUS[payment.status] ?? { label: [payment.status, payment.status] as [string, string], variant: "default" as const };
            return (
              <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <span>
                  <span className="font-medium tabular-nums">{formatCurrency(payment.amount, payment.currency, locale)}</span>{" "}
                  <span className="text-text-muted">{payment.label}</span>
                  <span className="block text-xs text-text-muted">
                    {payment.invoiceNumber} — {new Date(payment.createdAt).toLocaleString(intlLocale(locale), { dateStyle: "short", timeStyle: "short" })}
                  </span>
                </span>
                <Badge variant={badge.variant}>{t(...badge.label)}</Badge>
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
  const locale = useDashboardLocale();
  const t = useT();
  const amount = formatCurrency(sale.amount, sale.currency, locale);
  const [copied, setCopied] = useState(false);
  const copy = (url: string) =>
    void navigator.clipboard?.writeText(url).then(
      () => setCopied(true),
      () => setCopied(false),
    );

  if (sale.status === "completed") {
    return (
      <div className="space-y-4 py-6 text-center" role="status">
        <p className="text-3xl font-semibold text-text">{t("Payé", "Paid")}</p>
        <p className="text-lg tabular-nums text-text">{amount}</p>
        <p className="text-sm text-text-muted">
          {t(
            `Facture ${sale.invoiceNumber} réglée. Le montant arrive dans votre Solde KORVA, frais et commission déduits.`,
            `Invoice ${sale.invoiceNumber} paid. The amount arrives in your KORVA balance, fees and commission deducted.`,
          )}
        </p>
        <Button onClick={onNewSale}>{t("Nouvelle vente", "New sale")}</Button>
      </div>
    );
  }
  if (sale.status === "failed") {
    return (
      <div className="space-y-4 py-6 text-center" role="status">
        <p className="text-2xl font-semibold text-text">{t("Paiement non abouti", "Payment not completed")}</p>
        <p className="text-sm text-text-muted">
          {t(
            `Le client n'a pas pu payer ${amount}. Créez un nouveau QR code pour réessayer.`,
            `The customer could not pay ${amount}. Create a new QR code to try again.`,
          )}
        </p>
        <Button onClick={onNewSale}>{t("Nouvelle vente", "New sale")}</Button>
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
          {t(
            "Ce QR code n'est plus surveillé par cet écran. Si le client a payé, la vente apparaîtra comme payée dans la liste ci-dessous.",
            "This screen no longer watches this QR code. If the customer paid, the sale will show as paid in the list below.",
          )}
        </Notice>
      ) : (
        <p className="text-sm text-text-muted" aria-live="polite">
          {t("En attente du paiement… L'écran se met à jour tout seul.", "Waiting for the payment… The screen updates by itself.")}
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        {sale.checkoutUrl && (
          <Button size="sm" variant="secondary" onClick={() => copy(sale.checkoutUrl!)}>
            {copied ? t("Lien copié", "Link copied") : t("Copier le lien de paiement", "Copy the payment link")}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onNewSale}>
          {t("Annuler et revenir", "Cancel and go back")}
        </Button>
      </div>
    </div>
  );
}

/** Black on white whatever the theme: phone cameras read a dark-mode (inverted) QR code badly. */
function QrImage({ value }: { value: string }) {
  const t = useT();
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
      aria-label={t("QR code de paiement mobile money", "Mobile money payment QR code")}
      className="size-64 rounded-lg bg-white p-2 [&>svg]:size-full"
      // The SVG is generated locally by the qrcode library from GeniusPay's URL — never user HTML.
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );
}
