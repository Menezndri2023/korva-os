import type { PublicOrganization } from "@/lib/public-types";
import { KT } from "../kt-classes";
import { SectionHeading } from "./SectionHeading";

export function TestimonialsSection({ organization }: { organization: PublicOrganization }) {
  const testimonials = organization.testimonials;
  if (!testimonials || testimonials.length === 0) return null;

  return (
    <section className="px-6 py-16">
      <div className="mx-auto max-w-5xl">
        <SectionHeading eyebrow="Témoignages" title="Ils nous font confiance" />
        <div className="grid gap-6 sm:grid-cols-2 md:grid-cols-3">
          {testimonials.map((testimonial) => (
            <figure
              key={testimonial.id}
              className={`rounded-xl border p-6 shadow-sm ${KT.border} ${KT.surface}`}
            >
              {testimonial.rating != null && (
                <div className={`text-sm ${KT.accentText}`} aria-hidden="true">
                  {"★".repeat(Math.round(testimonial.rating))}
                  {"☆".repeat(5 - Math.round(testimonial.rating))}
                </div>
              )}
              <blockquote className={`mt-3 text-sm leading-relaxed ${KT.text}`}>
                &laquo;&nbsp;{testimonial.quote}&nbsp;&raquo;
              </blockquote>
              <figcaption
                className={`mt-4 text-xs font-semibold uppercase tracking-wide ${KT.textMuted}`}
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
