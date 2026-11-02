"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BUSINESS_MODEL_DEFINITIONS,
  businessModelText,
  type BusinessModel,
  type Locale,
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

function modelLabel(key: string | undefined, locale: Locale): string | undefined {
  return key && key in BUSINESS_MODEL_DEFINITIONS
    ? businessModelText(BUSINESS_MODEL_DEFINITIONS[key as BusinessModel], locale).label
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
export function PlatformReviews({ locale = "fr" }: { locale?: Locale }) {
  const en = locale === "en";
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
          {en ? "What the people who use it say" : "Ce qu’en disent ceux qui l’utilisent"}
        </h2>
        {data.average != null && (
          <p className="text-[0.9375rem] text-ink-soft">
            <span className="text-2xl font-semibold text-ink tabular-nums">
              {data.average.toLocaleString(en ? "en-GB" : "fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
            </span>{" "}
            {en
              ? `/ 5, from ${data.count === 1 ? "1 business review" : `${data.count} business reviews`}`
              : `/ 5, sur ${data.count === 1 ? "1 avis d’entreprise" : `${data.count} avis d’entreprises`}`}
          </p>
        )}
      </div>
      <ul className="mt-10 grid gap-x-10 border-t border-ink sm:grid-cols-2 lg:grid-cols-3">
        {data.reviews.map((review, index) => (
          <li key={index} className="flex flex-col gap-3 border-b border-rule py-6">
            <span role="img" aria-label={en ? `${review.rating} out of 5` : `${review.rating} sur 5`} className="text-accent">
              {"★".repeat(review.rating)}
              <span className="opacity-30">{"★".repeat(5 - review.rating)}</span>
            </span>
            <blockquote className="text-[0.9375rem] leading-relaxed text-ink">
              {en ? `“${review.comment}”` : `« ${review.comment} »`}
            </blockquote>
            <p className="mt-auto text-sm text-ink-soft">
              <span className="font-semibold text-ink">{review.displayName}</span>
              {review.displayName !== review.businessName ? `, ${review.businessName}` : ""}
              {modelLabel(review.businessModel, locale) ? ` · ${modelLabel(review.businessModel, locale)}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
