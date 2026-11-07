"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card, EmptyState, Input } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { formatCurrency } from "@/lib/analytics-format";
import { useAuthReady } from "@/lib/use-auth-ready";
import { useActiveOrganization } from "@/lib/use-active-organization";
import { intlLocale, useDashboardLocale, useT } from "@/lib/dashboard-locale";

interface GiftCard {
  id: string;
  code: string;
  initialAmount: number;
  balance: number;
  currency: string;
  status: "active" | "disabled";
  recipientName?: string;
  recipientEmail?: string;
  expiresAt: string | null;
  uses: { invoiceId: string; amount: number; at: string }[];
  createdAt: string;
}

/**
 * Cartes cadeaux: issue a card (sold at the counter or offered) and e-mail its code; follow what
 * is left on each. Spending one is a payment like any other — on the site's checkout, or with
 * "Payer avec une carte cadeau" on an invoice.
 */
export default function GiftCardsPage() {
  const t = useT();
  const locale = useDashboardLocale();
  const authReady = useAuthReady();
  const queryClient = useQueryClient();
  const { data: organization } = useActiveOrganization();
  const cards = useQuery({
    queryKey: ["gift-cards"],
    queryFn: () => apiClient.get<GiftCard[]>("/gift-cards"),
    enabled: authReady,
  });
  const [amount, setAmount] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [message, setMessage] = useState("");
  const [created, setCreated] = useState<GiftCard | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["gift-cards"] });
  const create = useMutation({
    mutationFn: () =>
      apiClient.post<GiftCard>("/gift-cards", {
        amount: Number(amount),
        recipientName: recipientName.trim() || undefined,
        recipientEmail: recipientEmail.trim() || undefined,
        message: message.trim() || undefined,
        sendEmail: !!recipientEmail.trim(),
      }),
    onSuccess: (card) => {
      setCreated(card);
      setAmount("");
      setRecipientName("");
      setRecipientEmail("");
      setMessage("");
      void refresh();
    },
  });
  const disable = useMutation({
    mutationFn: (id: string) => apiClient.post(`/gift-cards/${id}/disable`),
    onSuccess: refresh,
  });
  const money = (value: number, currency: string) => formatCurrency(value, currency, locale);

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  return (
    <div className="max-w-3xl space-y-5">
      <Card className="space-y-3 p-5">
        <div>
          <h2 className="text-base font-semibold text-text">{t("Émettre une carte cadeau", "Issue a gift card")}</h2>
          <p className="mt-1 text-sm text-text-muted">
            {t(
              "Encaissez le montant comme d'habitude, puis créez la carte : son code se dépense en boutique, sur votre site ou sur une facture, en une ou plusieurs fois.",
              "Take the amount as usual, then create the card: its code is spent in store, on your site or on an invoice, in one go or several.",
            )}
          </p>
        </div>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-text-muted">{t(`Montant (${organization?.currency ?? ""})`, `Amount (${organization?.currency ?? ""})`)}</span>
            <Input type="number" min={1} step="any" required value={amount} onChange={(event) => setAmount(event.target.value)} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-text-muted">{t("Pour (optionnel)", "For (optional)")}</span>
            <Input value={recipientName} maxLength={120} onChange={(event) => setRecipientName(event.target.value)} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-text-muted">{t("E-mail du bénéficiaire (le code lui est envoyé)", "Recipient's e-mail (the code is sent to it)")}</span>
            <Input type="email" value={recipientEmail} onChange={(event) => setRecipientEmail(event.target.value)} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-text-muted">{t("Message (optionnel)", "Message (optional)")}</span>
            <Input value={message} maxLength={500} onChange={(event) => setMessage(event.target.value)} />
          </label>
          <div className="sm:col-span-2">
            <Button type="submit" loading={create.isPending} disabled={!(Number(amount) > 0)}>
              {t("Créer la carte cadeau", "Create the gift card")}
            </Button>
          </div>
        </form>
        {create.isError && (
          <p className="text-sm text-destructive">
            {create.error instanceof ApiError ? create.error.message : t("La carte n'a pas été créée.", "The card was not created.")}
          </p>
        )}
        {created && (
          <div className="rounded-md bg-surface-muted p-3 text-sm" role="status">
            <p className="text-text-muted">{t("Carte créée. Son code :", "Card created. Its code:")}</p>
            <p className="font-mono text-lg font-semibold tracking-wider text-text">{created.code}</p>
            <p className="text-text-muted">
              {money(created.initialAmount, created.currency)}
              {created.recipientEmail ? t(` — envoyé à ${created.recipientEmail}`, ` — sent to ${created.recipientEmail}`) : ""}
            </p>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="text-base font-semibold text-text">{t("Cartes émises", "Cards issued")}</h2>
        {cards.data && cards.data.length === 0 && (
          <EmptyState title={t("Aucune carte cadeau pour l'instant.", "No gift cards yet.")} description={t("Elles apparaîtront ici avec ce qu'il reste dessus.", "They will show here with what is left on them.")} />
        )}
        <ul className="mt-3 divide-y divide-border">
          {cards.data?.map((card) => (
            <li key={card.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <span>
                <span className="font-mono font-semibold">{card.code}</span>
                <span className="text-text-muted">
                  {card.recipientName ? ` — ${card.recipientName}` : ""} — {new Date(card.createdAt).toLocaleDateString(intlLocale(locale))}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span className="tabular-nums">
                  {money(card.balance, card.currency)} / {money(card.initialAmount, card.currency)}
                </span>
                {card.status === "disabled" ? (
                  <Badge variant="warning">{t("Désactivée", "Disabled")}</Badge>
                ) : card.balance <= 0 ? (
                  <Badge>{t("Utilisée", "Used")}</Badge>
                ) : (
                  <Button type="button" size="sm" variant="ghost" onClick={() => disable.mutate(card.id)}>
                    {t("Désactiver", "Disable")}
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
