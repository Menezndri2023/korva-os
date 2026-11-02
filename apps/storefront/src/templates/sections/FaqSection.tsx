import type { PublicOrganization } from "@/lib/public-types";
import { KT } from "../kt-classes";
import { SectionHeading } from "./SectionHeading";
import { useT } from "@/lib/storefront-locale";

export function FaqSection({ organization }: { organization: PublicOrganization }) {
  const t = useT();
  const faqItems = organization.faqItems;
  if (!faqItems || faqItems.length === 0) return null;

  return (
    <section className={`px-6 py-16 ${KT.surface}`}>
      <div className="mx-auto max-w-3xl">
        <SectionHeading eyebrow={t("Questions fréquentes", "Frequently asked questions")} title={t("Vous vous demandez peut-être...", "You may be wondering...")} />
        <dl className="space-y-3">
          {faqItems.map((item) => (
            <div key={item.id} className={`rounded-xl border p-5 ${KT.border}`}>
              <dt className={`font-medium ${KT.text} ${KT.headingFont}`}>{item.question}</dt>
              <dd className={`mt-2 text-sm leading-relaxed ${KT.textMuted}`}>{item.answer}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
