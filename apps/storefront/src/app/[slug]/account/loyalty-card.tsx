"use client";

import { useQuery } from "@tanstack/react-query";
import { Card } from "@korva/ui";
import type { ContactLoyalty } from "@korva/types";
import { publicApiClient } from "@/lib/public-api-client";
import { useT } from "@/lib/storefront-locale";

/** "Ma carte de fidélité": the stamps so far and what they lead to — shown only if the shop has one. */
export function LoyaltyCard({
  slug,
  authFetch,
}: {
  slug: string;
  authFetch: <T>(fn: (token: string) => Promise<T>) => Promise<T>;
}) {
  const t = useT();
  const card = useQuery({
    queryKey: ["account-loyalty", slug],
    queryFn: () => authFetch((token) => publicApiClient.get<ContactLoyalty>(`/public/${slug}/account/loyalty`, token)),
  });
  const data = card.data;
  if (!data?.enabled) return null;
  const full = data.rewardsAvailable > 0;
  const onCard = full ? data.stampsRequired : data.stamps % data.stampsRequired;
  const left = data.stampsRequired - onCard;

  return (
    <Card className="space-y-3 p-4">
      <h2 className="text-sm font-semibold text-text">{t("Ma carte de fidélité", "My loyalty card")}</h2>
      <div className="flex flex-wrap gap-1.5" role="img" aria-label={t(`${onCard} tampons sur ${data.stampsRequired}`, `${onCard} stamps out of ${data.stampsRequired}`)}>
        {Array.from({ length: data.stampsRequired }, (_, index) => (
          <span
            key={index}
            className={`h-7 w-7 rounded-full border-2 ${index < onCard ? "border-[var(--kt-accent)] bg-[var(--kt-accent)]" : "border-border"}`}
          />
        ))}
      </div>
      <p className="text-sm text-text">
        {full
          ? t(`Votre carte est pleine : ${data.reward}. Elle vous attend à votre prochaine visite.`, `Your card is full: ${data.reward}. It is waiting for your next visit.`)
          : t(
              `Encore ${left} pour : ${data.reward}.`,
              `${left} more for: ${data.reward}.`,
            )}
      </p>
    </Card>
  );
}
