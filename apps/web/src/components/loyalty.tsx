"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ContactLoyalty, Organization } from "@korva/types";
import { Button, Card, Input } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { useT } from "@/lib/dashboard-locale";

/**
 * Paramètres › Entreprise: "Carte de fidélité" — a reward every N paid purchases or visits.
 * Stamps are counted on their own (each paid invoice, each attended booking); the business only
 * chooses how many and what the reward is.
 */
export function LoyaltySettings({ organization }: { organization: Organization }) {
  const t = useT();
  const queryClient = useQueryClient();
  const current = organization.loyalty;
  const [enabled, setEnabled] = useState(current?.enabled ?? false);
  const [stamps, setStamps] = useState(String(current?.stampsRequired ?? 10));
  const [reward, setReward] = useState(current?.reward ?? "");
  const save = useMutation({
    mutationFn: () =>
      apiClient.patch<Organization>("/organizations/me", {
        loyalty: { enabled, stampsRequired: Number(stamps), reward: reward.trim() },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["organizations", "me"] }),
  });
  const valid = Number(stamps) >= 2 && Number(stamps) <= 50 && reward.trim().length >= 2;

  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface p-5">
      <div>
        <h2 className="text-base font-semibold text-text">{t("Carte de fidélité", "Loyalty card")}</h2>
        <p className="mt-1 text-sm text-text-muted">
          {t(
            "Un tampon à chaque achat payé ou rendez-vous honoré ; la récompense quand la carte est pleine. Le client est prévenu par e-mail et voit sa carte dans son espace client.",
            "A stamp for every paid purchase or attended appointment; the reward when the card is full. The customer is told by e-mail and sees the card in their customer area.",
          )}
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm text-text">
        <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
        {t("Proposer une carte de fidélité", "Offer a loyalty card")}
      </label>
      {enabled && (
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <label className="text-sm">
            <span className="mb-1 block text-text-muted">{t("Tampons pour une récompense", "Stamps for a reward")}</span>
            <Input type="number" min={2} max={50} value={stamps} onChange={(event) => setStamps(event.target.value)} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-text-muted">{t("Récompense", "Reward")}</span>
            <Input
              value={reward}
              maxLength={120}
              placeholder={t("ex. 1 coupe offerte, -20 % sur le prochain achat", "e.g. 1 free haircut, 20% off the next purchase")}
              onChange={(event) => setReward(event.target.value)}
            />
          </label>
        </div>
      )}
      {save.isError && (
        <p className="text-sm text-destructive">
          {save.error instanceof ApiError ? save.error.message : t("L'enregistrement n'a pas abouti.", "Saving failed.")}
        </p>
      )}
      {save.isSuccess && <p className="text-sm text-text-muted">{t("Enregistré.", "Saved.")}</p>}
      <Button type="button" size="sm" loading={save.isPending} disabled={enabled && !valid} onClick={() => save.mutate()}>
        {t("Enregistrer la carte de fidélité", "Save the loyalty card")}
      </Button>
    </section>
  );
}

/** The customer's card on their contact page: progress, "+1 tampon", "Utiliser la récompense". */
export function ContactLoyaltyCard({ contactId }: { contactId: string }) {
  const t = useT();
  const authReady = useAuthReady();
  const queryClient = useQueryClient();
  const key = ["contacts", contactId, "loyalty"];
  const card = useQuery({
    queryKey: key,
    queryFn: () => apiClient.get<ContactLoyalty>(`/contacts/${contactId}/loyalty`),
    enabled: authReady,
  });
  const act = useMutation({
    mutationFn: (action: "stamp" | "redeem") => apiClient.post<ContactLoyalty>(`/contacts/${contactId}/loyalty/${action}`),
    onSuccess: (data) => queryClient.setQueryData(key, data),
  });
  const data = card.data;
  if (!data?.enabled) return null;
  const onCard = data.stamps % data.stampsRequired;
  const full = data.rewardsAvailable > 0;

  return (
    <Card className="space-y-3 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t("Carte de fidélité", "Loyalty card")}</h2>
        <span className="text-sm text-text-muted">
          {full
            ? t(`Récompense à donner : ${data.reward}`, `Reward to give: ${data.reward}`)
            : t(`${onCard} / ${data.stampsRequired} tampons`, `${onCard} / ${data.stampsRequired} stamps`)}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5" aria-hidden>
        {Array.from({ length: data.stampsRequired }, (_, index) => (
          <span
            key={index}
            className={`h-6 w-6 rounded-full border ${index < (full ? data.stampsRequired : onCard) ? "border-action bg-action" : "border-border bg-surface"}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" loading={act.isPending && act.variables === "stamp"} onClick={() => act.mutate("stamp")}>
          {t("+1 tampon", "+1 stamp")}
        </Button>
        {full && (
          <Button type="button" size="sm" loading={act.isPending && act.variables === "redeem"} onClick={() => act.mutate("redeem")}>
            {t("Récompense donnée", "Reward given")}
          </Button>
        )}
      </div>
      {data.rewardsUsed > 0 && (
        <p className="text-xs text-text-muted">
          {t(`${data.rewardsUsed} récompense(s) déjà donnée(s).`, `${data.rewardsUsed} reward(s) already given.`)}
        </p>
      )}
    </Card>
  );
}
