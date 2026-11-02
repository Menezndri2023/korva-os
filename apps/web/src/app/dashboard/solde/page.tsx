"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MIN_PAYOUT_AMOUNT,
  PAYOUT_PROVIDERS,
  PAYOUT_PROVIDER_LABELS,
  PAYOUT_STATUS_LABELS,
  PAYOUT_STATUS_LABELS_EN,
  PLAN_PAYOUT_RULES,
  WALLET_ENTRY_LABELS,
  WALLET_ENTRY_LABELS_EN,
  type Payout,
  type PayoutFrequency,
  type PayoutProvider,
  type WalletEntry,
  type WalletSummary,
} from "@korva/types";
import { Badge, Button, Card, EmptyState, Input, Notice, PageHeader } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { formatCurrency } from "@/lib/analytics-format";
import { useAuthReady } from "@/lib/use-auth-ready";
import { intlLocale, useDashboardLocale, useT, type Translate } from "@/lib/dashboard-locale";

const ERRORS: Record<string, [string, string]> = {
  PAYOUT_DESTINATION_MISSING: ["Enregistrez d'abord votre numéro de retrait.", "Save your withdrawal number first."],
  PAYOUT_WEEKLY_LIMIT: [
    "Vous avez déjà fait votre demande de retrait de la semaine. Activez le retrait automatique ou passez en Pro pour retirer quand vous voulez.",
    "You have already made this week's withdrawal request. Turn on automatic withdrawal or move to Pro to withdraw whenever you like.",
  ],
  PAYOUT_BELOW_MINIMUM: [
    `Le retrait minimum est de ${MIN_PAYOUT_AMOUNT.toLocaleString("fr-FR")}.`,
    `The minimum withdrawal is ${MIN_PAYOUT_AMOUNT.toLocaleString("en-GB")}.`,
  ],
  PAYOUT_EXCEEDS_BALANCE: ["Ce montant dépasse votre solde disponible.", "This amount is more than your available balance."],
  PAYOUT_ALREADY_OPEN: ["Un retrait est déjà en cours : attendez qu'il soit versé.", "A withdrawal is already in progress: wait until it is paid out."],
  PAYOUT_CODE_INVALID: ["Ce code ne correspond pas. Vérifiez l'e-mail reçu.", "This code does not match. Check the e-mail you received."],
  PAYOUT_CODE_EXPIRED: [
    "Ce code a expiré. Enregistrez le numéro à nouveau pour en recevoir un autre.",
    "This code has expired. Save the number again to get another one.",
  ],
  PAYOUT_CODE_LOCKED: [
    "Trop d'essais. Enregistrez le numéro à nouveau pour recevoir un nouveau code.",
    "Too many attempts. Save the number again to get a new code.",
  ],
  PAYOUT_DAILY_NOT_IN_PLAN: [
    "Le retrait automatique quotidien est inclus à partir de Pro.",
    "Daily automatic withdrawal is included from Pro.",
  ],
  VALIDATION_ERROR: ["Vérifiez les informations saisies.", "Check the details you entered."],
};

function errorText(error: unknown, t: Translate): string {
  const known = error instanceof ApiError ? ERRORS[error.code] : undefined;
  return known ? t(...known) : t("L'action n'a pas abouti. Réessayez.", "That did not work. Try again.");
}

const STATUS_VARIANT: Record<Payout["status"], "default" | "success" | "warning"> = {
  requested: "default",
  processing: "default",
  completed: "success",
  failed: "warning",
  rejected: "warning",
};

/**
 * Le Solde KORVA: what customers paid online (Wave, Orange Money, MTN, Moov, card) is collected
 * by KORVA and kept here, minus GeniusPay's fee and the plan's commission. The business withdraws
 * it to its mobile money number — on request, or automatically.
 */
export default function WalletPage() {
  const authReady = useAuthReady();
  const queryClient = useQueryClient();
  const wallet = useQuery({
    queryKey: ["wallet"],
    queryFn: () => apiClient.get<WalletSummary>("/wallet"),
    enabled: authReady,
  });
  const entries = useQuery({
    queryKey: ["wallet", "entries"],
    queryFn: () => apiClient.get<WalletEntry[]>("/wallet/entries?limit=30"),
    enabled: authReady,
  });
  const payouts = useQuery({
    queryKey: ["wallet", "payouts"],
    queryFn: () => apiClient.get<Payout[]>("/wallet/payouts?limit=10"),
    enabled: authReady,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["wallet"] });

  const summary = wallet.data;
  const locale = useDashboardLocale();
  const t = useT();
  const money = (amount: number) => formatCurrency(amount, summary?.currency ?? null, locale);

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        title={t("Solde KORVA", "KORVA balance")}
        description={t(
          "L'argent payé en ligne par vos clients arrive ici. Retirez-le sur votre numéro mobile money quand vous voulez, ou laissez KORVA le verser automatiquement.",
          "Money your customers pay online arrives here. Withdraw it to your mobile money number whenever you like, or let KORVA pay it out automatically.",
        )}
      />

      {wallet.isLoading && <Card className="p-6 text-sm text-text-muted">{t("Chargement…", "Loading…")}</Card>}
      {wallet.isError && <Card className="p-6 text-sm text-destructive">{t(
        "Impossible de charger votre solde. Réessayez.",
        "Your balance could not be loaded. Try again.",
      )}</Card>}

      {summary && (
        <>
          <Card className="p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-sm text-text-muted">{t("Disponible", "Available")}</p>
                <p className="mt-1 text-3xl font-semibold tabular-nums text-text">{money(summary.available)}</p>
              </div>
              <div>
                <p className="text-sm text-text-muted">{t("En attente", "Pending")}</p>
                <p className="mt-1 text-xl font-medium tabular-nums text-text">{money(summary.pending)}</p>
                <p className="text-xs text-text-muted">
                  {summary.holdDays > 0
                    ? t(
                        `Disponible ${summary.holdDays} jour${summary.holdDays > 1 ? "s" : ""} après le paiement du client.`,
                        `Available ${summary.holdDays} day${summary.holdDays === 1 ? "" : "s"} after the customer pays.`,
                      )
                    : t("Disponible dès le paiement du client.", "Available as soon as the customer pays.")}
                </p>
              </div>
            </div>
            <p className="mt-4 border-t border-border pt-3 text-xs text-text-muted">
              {t(
                `Sur chaque vente en ligne : frais GeniusPay et commission KORVA de ${(summary.commissionBasisPoints / 100).toLocaleString(intlLocale(locale))} % (votre formule).`,
                `On each online sale: GeniusPay's fee and a KORVA commission of ${(summary.commissionBasisPoints / 100).toLocaleString("en-GB")}% (your plan).`,
              )}{" "}
              {PLAN_PAYOUT_RULES[summary.plan].payoutFeeIncluded
                ? t("Les frais de retrait sont offerts par KORVA.", "KORVA pays the withdrawal fee.")
                : t(
                    "Les frais de retrait GeniusPay sont déduits du montant versé.",
                    "GeniusPay's withdrawal fee is taken from the amount paid out.",
                  )}{" "}
              {t(
                "L'argent encaissé en espèces reste dans votre caisse et n'apparaît pas ici.",
                "Cash you take stays in your till and does not appear here.",
              )}
            </p>
          </Card>

          <WithdrawCard summary={summary} money={money} onDone={refresh} />
          <DestinationCard summary={summary} onDone={refresh} />
          <AutoPayoutCard summary={summary} onDone={refresh} />
          <SubscriptionAutopayCard summary={summary} onDone={refresh} />
        </>
      )}

      <Card className="p-5">
        <h2 className="text-base font-semibold text-text">{t("Retraits", "Withdrawals")}</h2>
        {payouts.data && payouts.data.length === 0 && (
          <p className="mt-2 text-sm text-text-muted">{t("Aucun retrait pour l'instant.", "No withdrawals yet.")}</p>
        )}
        <ul className="mt-3 divide-y divide-border">
          {payouts.data?.map((payout) => (
            <li key={payout.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <span>
                <span className="font-medium tabular-nums">{money(payout.amount)}</span>
                <span className="text-text-muted">
                  {" "}
                  {t("vers", "to")} {PAYOUT_PROVIDER_LABELS[payout.destination.provider]} {payout.destination.account}
                  {payout.trigger === "auto" ? t(" (automatique)", " (automatic)") : ""} —{" "}
                  {new Date(payout.createdAt).toLocaleDateString(intlLocale(locale))}
                </span>
                {payout.failureReason && <span className="block text-xs text-text-muted">{payout.failureReason}</span>}
              </span>
              <Badge variant={STATUS_VARIANT[payout.status]}>{locale === "en" ? PAYOUT_STATUS_LABELS_EN[payout.status] : PAYOUT_STATUS_LABELS[payout.status]}</Badge>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-5">
        <h2 className="text-base font-semibold text-text">{t("Mouvements", "Movements")}</h2>
        {entries.data && entries.data.length === 0 && (
          <EmptyState
            title={t("Aucun paiement en ligne pour l'instant.", "No online payments yet.")}
            description={t(
              "Activez le paiement en ligne dans vos paramètres : vos clients paient par Wave, Orange Money, MTN, Moov ou carte depuis votre boutique.",
              "Turn on online payment in your settings: your customers pay by Wave, Orange Money, MTN, Moov or card from your shop.",
            )}
          />
        )}
        <ul className="mt-3 divide-y divide-border">
          {entries.data?.map((entry) => (
            <li key={entry.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
              <span>
                {locale === "en" ? WALLET_ENTRY_LABELS_EN[entry.kind] : WALLET_ENTRY_LABELS[entry.kind]}
                <span className="block text-xs text-text-muted">
                  {new Date(entry.createdAt).toLocaleDateString(intlLocale(locale))}
                  {entry.note ? ` — ${entry.note}` : ""}
                </span>
              </span>
              <span className={`tabular-nums ${entry.amount < 0 ? "text-text-muted" : "font-medium text-text"}`}>
                {entry.amount > 0 ? "+" : ""}
                {money(entry.amount)}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function WithdrawCard({
  summary,
  money,
  onDone,
}: {
  summary: WalletSummary;
  money: (amount: number) => string;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const t = useT();
  const withdraw = useMutation({
    mutationFn: () =>
      apiClient.post<Payout>("/wallet/payouts", amount.trim() ? { amount: Number(amount) } : {}),
    onSuccess: () => {
      setAmount("");
      onDone();
    },
  });

  const open = summary.openPayout;
  const left = summary.manualPayoutsLeftThisWeek;
  const blocked = !summary.destination || open !== null || left === 0 || summary.available < MIN_PAYOUT_AMOUNT;

  return (
    <Card className="space-y-3 p-5">
      <h2 className="text-base font-semibold text-text">{t("Retirer", "Withdraw")}</h2>
      {open ? (
        <Notice tone="accent">
          {t(
            `Retrait de ${money(open.amount)} ${PAYOUT_STATUS_LABELS[open.status].toLowerCase()} vers ${PAYOUT_PROVIDER_LABELS[open.destination.provider]} ${open.destination.account}.`,
            `Withdrawal of ${money(open.amount)} ${PAYOUT_STATUS_LABELS_EN[open.status].toLowerCase()} to ${PAYOUT_PROVIDER_LABELS[open.destination.provider]} ${open.destination.account}.`,
          )}
        </Notice>
      ) : (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            withdraw.mutate();
          }}
        >
          <label className="text-sm">
            <span className="mb-1 block text-text-muted">{t(
              "Montant (vide = tout le disponible)",
              "Amount (empty = all available)",
            )}</span>
            <Input
              type="number"
              inputMode="numeric"
              min={MIN_PAYOUT_AMOUNT}
              max={summary.available}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder={String(summary.available)}
              className="w-48"
            />
          </label>
          <Button type="submit" loading={withdraw.isPending} disabled={blocked}>
            {t("Retirer", "Withdraw")}
          </Button>
        </form>
      )}
      <p className="text-xs text-text-muted">
        {!summary.destination
          ? t(
              "Enregistrez votre numéro de retrait ci-dessous pour pouvoir retirer.",
              "Save your withdrawal number below to be able to withdraw.",
            )
          : left === null
            ? t(
                `Retraits à la demande, sans limite. Minimum ${money(MIN_PAYOUT_AMOUNT)}.`,
                `Withdraw on request, with no limit. Minimum ${money(MIN_PAYOUT_AMOUNT)}.`,
              )
            : t(
                `${left} demande de retrait restante cette semaine. Minimum ${money(MIN_PAYOUT_AMOUNT)}.`,
                `${left} withdrawal request left this week. Minimum ${money(MIN_PAYOUT_AMOUNT)}.`,
              )}
      </p>
      {withdraw.isError && (
        <p className="text-sm text-destructive" role="alert">
          {errorText(withdraw.error, t)}
        </p>
      )}
      {withdraw.isSuccess && <p className="text-sm text-text">{t(
        "Demande envoyée. Vous serez prévenu dès le versement.",
        "Request sent. You will be told as soon as it is paid out.",
      )}</p>}
    </Card>
  );
}

function DestinationCard({ summary, onDone }: { summary: WalletSummary; onDone: () => void }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [provider, setProvider] = useState<PayoutProvider>(summary.destination?.provider ?? "wave");
  const [account, setAccount] = useState(summary.destination?.account ?? "+225 ");
  const [holderName, setHolderName] = useState(summary.destination?.holderName ?? "");
  const [code, setCode] = useState("");

  const save = useMutation({
    mutationFn: () => apiClient.put("/wallet/destination", { provider, account, holderName }),
    onSuccess: () => {
      setEditing(false);
      onDone();
    },
  });
  const confirm = useMutation({
    mutationFn: () => apiClient.post("/wallet/destination/confirm", { code }),
    onSuccess: () => {
      setCode("");
      onDone();
    },
  });

  const pending = summary.pendingDestination;

  return (
    <Card className="space-y-3 p-5">
      <h2 className="text-base font-semibold text-text">{t("Numéro de retrait", "Withdrawal number")}</h2>
      {summary.destination && !editing && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            {PAYOUT_PROVIDER_LABELS[summary.destination.provider]} {summary.destination.account}
            <span className="block text-xs text-text-muted">
              {t(`Au nom de ${summary.destination.holderName}`, `In the name of ${summary.destination.holderName}`)}
            </span>
          </span>
          <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(true)}>
            {t("Changer de numéro", "Change number")}
          </Button>
        </div>
      )}

      {pending && (
        <form
          className="space-y-2 rounded-md border border-border p-3"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            confirm.mutate();
          }}
        >
          <p className="text-sm text-text">
            {t(
              `Un code à 6 chiffres a été envoyé par e-mail pour confirmer ${PAYOUT_PROVIDER_LABELS[pending.provider]} ${pending.account}.`,
              `A 6-digit code was sent by e-mail to confirm ${PAYOUT_PROVIDER_LABELS[pending.provider]} ${pending.account}.`,
            )}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <Input
              aria-label={t("Code reçu par e-mail", "Code received by e-mail")}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
              className="w-32"
            />
            <Button type="submit" size="sm" loading={confirm.isPending} disabled={code.length !== 6}>
              {t("Confirmer le numéro", "Confirm the number")}
            </Button>
          </div>
          {confirm.isError && (
            <p className="text-sm text-destructive" role="alert">
              {errorText(confirm.error, t)}
            </p>
          )}
        </form>
      )}

      {(!summary.destination || editing) && !pending && (
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <label className="text-sm">
            <span className="mb-1 block text-text-muted">{t("Opérateur", "Operator")}</span>
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value as PayoutProvider)}
              className="w-full rounded-md border border-border-input bg-surface px-3 py-2 text-sm text-text"
            >
              {PAYOUT_PROVIDERS.map((key) => (
                <option key={key} value={key}>
                  {PAYOUT_PROVIDER_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-text-muted">{t(
              "Numéro (format international)",
              "Number (international format)",
            )}</span>
            <Input value={account} onChange={(event) => setAccount(event.target.value)} required />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block text-text-muted">{t("Nom du titulaire du compte", "Account holder's name")}</span>
            <Input value={holderName} onChange={(event) => setHolderName(event.target.value)} required minLength={2} />
          </label>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button type="submit" loading={save.isPending}>
              {t("Recevoir le code de confirmation", "Get the confirmation code")}
            </Button>
            {editing && (
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                {t("Annuler", "Cancel")}
              </Button>
            )}
          </div>
          {save.isError && (
            <p className="text-sm text-destructive sm:col-span-2" role="alert">
              {errorText(save.error, t)}
            </p>
          )}
          <p className="text-xs text-text-muted sm:col-span-2">
            {t(
              "Par sécurité, un nouveau numéro est confirmé par un code envoyé à votre e-mail, et les retraits automatiques n'y partent qu'après 48 heures.",
              "For security, a new number is confirmed by a code sent to your e-mail, and automatic withdrawals only go to it after 48 hours.",
            )}
          </p>
        </form>
      )}
    </Card>
  );
}

function AutoPayoutCard({ summary, onDone }: { summary: WalletSummary; onDone: () => void }) {
  const t = useT();
  const dailyAllowed = PLAN_PAYOUT_RULES[summary.plan].dailyAutoPayout;
  const [enabled, setEnabled] = useState(summary.autoPayout.enabled);
  const [frequency, setFrequency] = useState<PayoutFrequency>(summary.autoPayout.frequency);
  const [minimum, setMinimum] = useState(String(summary.autoPayout.minimum));

  const save = useMutation({
    mutationFn: () =>
      apiClient.patch<WalletSummary>("/wallet/auto-payout", { enabled, frequency, minimum: Number(minimum) }),
    onSuccess: onDone,
  });

  return (
    <Card className="p-5">
      <form
        className="space-y-3"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <h2 className="text-base font-semibold text-text">{t("Retrait automatique", "Automatic withdrawal")}</h2>
        <label className="flex items-start gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            {t(
              "Verser automatiquement mon solde disponible sur mon numéro de retrait",
              "Automatically pay my available balance to my withdrawal number",
            )}
            <span className="block text-xs text-text-muted">
              {t(
                "Sans demande de votre part, dès que le solde atteint le minimum choisi.",
                "Without you asking, as soon as the balance reaches the minimum you chose.",
              )}
            </span>
          </span>
        </label>
        {enabled && (
          <div className="flex flex-wrap gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-text-muted">{t("Fréquence", "Frequency")}</span>
              <select
                value={frequency}
                onChange={(event) => setFrequency(event.target.value as PayoutFrequency)}
                className="rounded-md border border-border-input bg-surface px-3 py-2 text-sm text-text"
              >
                <option value="weekly">{t("Chaque semaine", "Every week")}</option>
                <option value="daily" disabled={!dailyAllowed}>
                  {t("Chaque jour", "Every day")}
                  {dailyAllowed ? "" : t(" (à partir de Pro)", " (from Pro)")}
                </option>
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-text-muted">{t("À partir de", "From")}</span>
              <Input
                type="number"
                inputMode="numeric"
                min={MIN_PAYOUT_AMOUNT}
                value={minimum}
                onChange={(event) => setMinimum(event.target.value)}
                className="w-36"
              />
            </label>
          </div>
        )}
        {save.isError && (
          <p className="text-sm text-destructive" role="alert">
            {errorText(save.error, t)}
          </p>
        )}
        <Button type="submit" size="sm" variant="secondary" loading={save.isPending}>
          {t("Enregistrer", "Save")}
        </Button>
        {save.isSuccess && <span className="ml-2 text-sm text-text-muted">{t("Enregistré.", "Saved.")}</span>}
      </form>
    </Card>
  );
}

function SubscriptionAutopayCard({ summary, onDone }: { summary: WalletSummary; onDone: () => void }) {
  const t = useT();
  const save = useMutation({
    mutationFn: (enabled: boolean) => apiClient.patch<WalletSummary>("/wallet/subscription-autopay", { enabled }),
    onSuccess: onDone,
  });
  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold text-text">{t("Payer ma formule KORVA", "Pay my KORVA plan")}</h2>
      <label className="mt-3 flex items-start gap-2 text-sm text-text">
        <input
          type="checkbox"
          checked={save.isPending ? Boolean(save.variables) : summary.autoPaySubscription}
          disabled={save.isPending}
          onChange={(event) => save.mutate(event.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          {t(
            "Régler automatiquement mes factures KORVA avec mon solde",
            "Pay my KORVA invoices automatically from my balance",
          )}
          <span className="block text-xs text-text-muted">
            {t(
              "Quand le solde disponible couvre la facture. Sinon, vous la payez par mobile money ou carte depuis Paramètres > Abonnement.",
              "When the available balance covers the invoice. Otherwise you pay it by mobile money or card from Settings > Subscription.",
            )}
          </span>
        </span>
      </label>
      {save.isError && (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {errorText(save.error, t)}
        </p>
      )}
    </Card>
  );
}
