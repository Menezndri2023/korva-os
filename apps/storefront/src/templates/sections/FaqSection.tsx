import type { PublicOrganization } from "@/lib/public-types";
import { KT } from "../kt-classes";

export function FaqSection({ organization }: { organization: PublicOrganization }) {
  const faqItems = organization.faqItems;
  if (!faqItems || faqItems.length === 0) return null;

  return (
    <section className={`px-6 py-14 ${KT.surface}`}>
      <div className="mx-auto max-w-3xl">
        <h2 className={`text-xl font-semibold ${KT.headingFont}`}>Questions fréquentes</h2>
        <dl className={`mt-6 divide-y ${KT.border}`}>
          {faqItems.map((item) => (
            <div key={item.id} className="py-4">
              <dt className={`font-medium ${KT.text} ${KT.headingFont}`}>{item.question}</dt>
              <dd className={`mt-2 text-sm ${KT.textMuted}`}>{item.answer}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
