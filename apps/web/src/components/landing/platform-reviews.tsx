"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BUSINESS_MODEL_DEFINITIONS,
  type BusinessModel,
  type PublicPlatformReviewSummary,
} from "@korva/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

/** Public and anonymous: a plain fetch, not apiClient — no session to wait for or to send. */
async function fetchPublicReviews(): Promise<PublicPlatformReviewSummary> {
  const response = await fetch(`${API_URL}/public-platform-reviews`);
  const payload = (await response.json()) as { success: boolean; data?: PublicPlatformReviewSummary };
  if (!payload.success || !payload.data) throw new Error(`public-platform-reviews: ${response.status}`);
  return payload.data;
}

function modelLabel(key: string | undefined): string | undefined {
  return key && key in BUSINESS_MODEL_DEFINITIONS
    ? BUSINESS_MODEL_DEFINITIONS[key as BusinessModel].label
    : undefined;
}

/**
 * What the businesses using KORVA say — only reviews whose authors agreed to be shown here and
 * that the administration published. The average covers every review received (not just the
 * published ones), so the figure is not a selection. Nothing at all until the first one is
 * published: an empty "testimonials" block says more than no block.
 *
 * Fetched in the browser, after the page itself: the landing renders without waiting on the
 * API, and a slow or failing API costs this section only.
 */
export function PlatformReviews() {
  const { data } = useQuery({
    queryKey: ["public-platform-reviews"],
    queryFn: fetchPublicReviews,
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (!data || data.reviews.length === 0) return null;

  return (
    <section aria-labelledby="avis-heading" className="mx-auto max-w-6xl px-4 py-16 sm:px-8 sm:py-24">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 id="avis-heading" className="max-w-2xl text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          Ce qu&apos;en disent ceux qui l&apos;utilisent
        </h2>
        {data.average != null && (
          <p className="text-[0.9375rem] text-ink-soft">
            <span className="text-2xl font-semibold text-ink tabular-nums">
              {data.average.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
            </span>{" "}
            / 5, sur {data.count === 1 ? "1 avis d’entreprise" : `${data.count} avis d’entreprises`}
          </p>
        )}
      </div>
      <ul className="mt-10 grid gap-x-10 border-t border-ink sm:grid-cols-2 lg:grid-cols-3">
        {data.reviews.map((review, index) => (
          <li key={index} className="flex flex-col gap-3 border-b border-rule py-6">
            <span role="img" aria-label={`${review.rating} sur 5`} className="text-accent">
              {"★".repeat(review.rating)}
              <span className="opacity-30">{"★".repeat(5 - review.rating)}</span>
            </span>
            <blockquote className="text-[0.9375rem] leading-relaxed text-ink">
              « {review.comment} »
            </blockquote>
            <p className="mt-auto text-sm text-ink-soft">
              <span className="font-semibold text-ink">{review.displayName}</span>
              {review.displayName !== review.businessName ? `, ${review.businessName}` : ""}
              {modelLabel(review.businessModel) ? ` · ${modelLabel(review.businessModel)}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
