import { KT } from "../kt-classes";

/**
 * Shared editorial-style heading for every content section (about/team/gallery/testimonials/
 * FAQ) — an accent-colored eyebrow label + a larger heading + a short accent underline. Pure
 * Tailwind utility classes reading the existing `--kt-*` CSS vars (see kt-classes.ts), so this
 * carries zero extra risk for the strict `style-src` CSP: no new inline styles, no new color
 * tokens, just a more deliberate use of the ones every template already has.
 */
export function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-8">
      <p className={`text-xs font-semibold uppercase tracking-widest ${KT.accentText}`}>
        {eyebrow}
      </p>
      <h2 className={`mt-2 text-2xl font-semibold sm:text-3xl ${KT.headingFont}`}>{title}</h2>
      <div className={`mt-3 h-1 w-12 rounded-full ${KT.accentBg}`} />
    </div>
  );
}
