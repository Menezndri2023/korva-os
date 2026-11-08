"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Heart } from "lucide-react";
import type { Offer } from "@korva/types";
import { Button } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { PlanLock } from "@/components/plan-lock";
import { usePlanFeatures } from "@/lib/use-plan-features";
import { useT } from "@/lib/dashboard-locale";

/**
 * « Coup de cœur » (featured_offers, Pro and above): the offer leads the public site, marked.
 * Removing the mark is always possible, even after a downgrade.
 */
export function FeaturedOfferToggle({ offer }: { offer: Offer }) {
  const t = useT();
  const queryClient = useQueryClient();
  const { has } = usePlanFeatures();
  const featured = Boolean(offer.featured);
  const locked = !featured && !has("featured_offers");
  const mutation = useMutation({
    mutationFn: (next: boolean) => apiClient.patch<Offer>(`/offers/${offer.id}`, { featured: next }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["offers"] });
    },
  });

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <Button
        type="button"
        size="sm"
        variant={featured ? "primary" : "secondary"}
        disabled={locked}
        loading={mutation.isPending}
        aria-pressed={featured}
        onClick={() => mutation.mutate(!featured)}
      >
        <Heart aria-hidden className={`h-4 w-4 ${featured ? "fill-current" : ""}`} />
        {featured ? t("Coup de cœur sur votre site", "Featured on your website") : t("Mettre en coup de cœur", "Feature on your website")}
      </Button>
      {locked && <PlanLock feature="featured_offers" />}
      {!locked && (
        <p className="text-xs text-text-muted">
          {t("Vos coups de cœur passent en premier sur votre site.", "Your favourites come first on your website.")}
        </p>
      )}
      {mutation.isError && (
        <p className="text-xs text-destructive">
          {mutation.error instanceof ApiError ? mutation.error.message : t("Erreur", "Error")}
        </p>
      )}
    </div>
  );
}
