import { KT } from "../kt-classes";

/**
 * Shared heading for every content section (about/team/gallery/testimonials/FAQ) and the
 * templates' own offer lists: a short accent line of context, the heading, and an accent rule.
 * Pure Tailwind utility classes reading the `--kt-*` CSS vars (see kt-classes.ts), so it adds no
 * inline style under the strict `style-src` CSP.
 *
 * The context line is sentence case on purpose: a tracked-out capitalised label above every
 * heading made each section read like a template rather than the shop's own page.
 */
export function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-8">
      <p className={`text-sm font-medium ${KT.accentText}`}>{eyebrow}</p>
      <h2 className={`mt-1 text-2xl font-semibold sm:text-3xl ${KT.headingFont}`}>{title}</h2>
      <div className={`mt-3 h-1 w-12 rounded-full ${KT.accentBg}`} />
    </div>
  );
}
