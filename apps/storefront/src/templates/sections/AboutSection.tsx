import type { PublicOrganization } from "@/lib/public-types";
import { KT } from "../kt-classes";

/** Renders nothing when the org hasn't written one — a Pro+ content section (see
 *  EntitlementsService.assertContentSectionsAllowed), never a placeholder/empty state on the
 *  public page. */
export function AboutSection({ organization }: { organization: PublicOrganization }) {
  if (!organization.aboutText) return null;

  return (
    <section className={`px-6 py-14 ${KT.surface}`}>
      <div className="mx-auto max-w-3xl">
        <h2 className={`text-xl font-semibold ${KT.headingFont}`}>À propos</h2>
        <p className={`mt-4 whitespace-pre-line text-sm leading-relaxed ${KT.textMuted}`}>
          {organization.aboutText}
        </p>
      </div>
    </section>
  );
}
