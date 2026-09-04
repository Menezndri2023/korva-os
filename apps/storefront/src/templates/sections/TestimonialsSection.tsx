import type { PublicOrganization } from "@/lib/public-types";
import { KT } from "../kt-classes";

export function TestimonialsSection({ organization }: { organization: PublicOrganization }) {
  const testimonials = organization.testimonials;
  if (!testimonials || testimonials.length === 0) return null;

  return (
    <section className="px-6 py-14">
      <div className="mx-auto max-w-5xl">
        <h2 className={`text-xl font-semibold ${KT.headingFont}`}>Ce que disent nos clients</h2>
        <div className="mt-6 grid gap-6 sm:grid-cols-2 md:grid-cols-3">
          {testimonials.map((testimonial) => (
            <figure
              key={testimonial.id}
              className={`rounded-lg border p-5 ${KT.border} ${KT.surface}`}
            >
              {testimonial.rating != null && (
                <div className={`text-sm ${KT.accentText}`} aria-hidden="true">
                  {"★".repeat(Math.round(testimonial.rating))}
                  {"☆".repeat(5 - Math.round(testimonial.rating))}
                </div>
              )}
              <blockquote className={`mt-2 text-sm ${KT.text}`}>
                &laquo;&nbsp;{testimonial.quote}&nbsp;&raquo;
              </blockquote>
              <figcaption
                className={`mt-3 text-xs font-medium uppercase tracking-wide ${KT.textMuted}`}
              >
                {testimonial.authorName}
                {testimonial.role ? ` — ${testimonial.role}` : ""}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
