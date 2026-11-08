import type { PublicOrganization } from "@/lib/public-types";
import { KT } from "../kt-classes";
import { SectionHeading } from "./SectionHeading";
import { useT } from "@/lib/storefront-locale";

/** Renders nothing when the org hasn't written one — a Pro+ content section (see
 *  OrganizationsService.update (site_about_faq / site_showcase)), never a placeholder/empty state on the
 *  public page. */
export function AboutSection({ organization }: { organization: PublicOrganization }) {
  const t = useT();
  if (!organization.aboutText) return null;

  return (
    <section className={`px-6 py-16 ${KT.surface}`}>
      <div className="mx-auto max-w-3xl">
        <SectionHeading eyebrow={t("Notre histoire", "Our story")} title={t("À propos", "About")} />
        <p className={`whitespace-pre-line text-base leading-relaxed ${KT.textMuted}`}>
          {organization.aboutText}
        </p>
      </div>
    </section>
  );
}
