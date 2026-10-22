import type { PublicReview } from "@korva/types";
import type { PublicOrganization } from "@/lib/public-types";
import { KT } from "../kt-classes";
import { SectionHeading } from "./SectionHeading";

const monthYear = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });

export function ReviewStars({ rating, className = "" }: { rating: number; className?: string }) {
  const full = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span className={`${KT.accentText} ${className}`} role="img" aria-label={`${full} sur 5 étoiles`}>
      {"★".repeat(full)}
      <span className="opacity-25">{"★".repeat(5 - full)}</span>
    </span>
  );
}

/** "4,6 sur 5 · 23 avis" — the figure a visitor looks for first. */
export function RatingSummary({ average, count }: { average: number | null; count: number }) {
  if (average == null || count === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className={`text-3xl font-semibold ${KT.headingFont}`}>
        {average.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
      </span>
      <div>
        <ReviewStars rating={average} className="text-lg" />
        <p className={`text-xs ${KT.textMuted}`}>
          {count === 1 ? "1 avis de client vérifié" : `${count} avis de clients vérifiés`}
        </p>
      </div>
    </div>
  );
}

/**
 * One customer review. Every review here comes from a real, finished purchase (a delivered order
 * or a completed booking), so "Client vérifié" is literally true; the first name shows only when
 * the customer chose to sign.
 */
export function ReviewItem({
  review,
  organizationName,
  showOffer = false,
}: {
  review: PublicReview;
  organizationName: string;
  showOffer?: boolean;
}) {
  return (
    <article className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <ReviewStars rating={review.rating} />
        <time dateTime={review.createdAt} className={`text-xs ${KT.textMuted}`}>
          {monthYear.format(new Date(review.createdAt))}
        </time>
      </div>
      {review.comment && <p className={`text-sm leading-relaxed ${KT.text}`}>{review.comment}</p>}
      <p className={`text-xs ${KT.textMuted}`}>
        <span className="font-medium">{review.authorName ?? "Client vérifié"}</span>
        {showOffer && review.offerName ? ` · ${review.offerName}` : ""}
      </p>
      {review.reply && (
        <div className={`mt-1 rounded-lg border-l-2 px-3 py-2 ${KT.borderAccent} ${KT.accentSoftBg}`}>
          <p className={`text-xs font-medium ${KT.text}`}>Réponse de {organizationName}</p>
          <p className={`mt-0.5 text-sm ${KT.textMuted}`}>{review.reply.body}</p>
        </div>
      )}
    </article>
  );
}

/** Home page: the business's overall rating and its latest reviews. Absent until the first one. */
export function CustomerReviewsSection({ organization }: { organization: PublicOrganization }) {
  const summary = organization.reviewSummary;
  if (!summary || summary.count === 0) return null;

  return (
    <section id="avis" className="px-6 py-16">
      <div className="mx-auto max-w-5xl">
        <SectionHeading eyebrow="Avis clients" title="Ce que nos clients en pensent" />
        <RatingSummary average={summary.average} count={summary.count} />
        <div className="mt-8 grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          {summary.latest.map((review, index) => (
            <div key={index} className={`rounded-xl border p-5 ${KT.border} ${KT.surface}`}>
              <ReviewItem review={review} organizationName={organization.name} showOffer />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
