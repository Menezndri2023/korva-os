import Link from "next/link";
import {
  BUSINESS_MODEL_DEFINITIONS,
  KORVA_MODULES,
  PLAN_LIMITS,
  PLAN_PRICES,
  commissionPercentLabel,
  type KorvaModule,
} from "@korva/types";
import { KorvaGlyph, KorvaWordmark } from "@/components/brand/korva-mark";
import { MODULE_PROMISES } from "@/lib/landing-content";
import { SEO_TRADES, type SeoTrade } from "@/lib/seo-trades";
import { appUrl } from "@/lib/site-url";
import { JsonLd } from "./json-ld";

const xof = (amount: number) => `${amount.toLocaleString("fr-FR")} F CFA`;

/** The questions an owner of this trade asks first — also given to search engines as FAQPage. */
export function tradeFaq(trade: SeoTrade): { question: string; answer: string }[] {
  const site = BUSINESS_MODEL_DEFINITIONS[trade.template.businessModel].siteKind.toLowerCase();
  return [
    {
      question: `KORVA OS est-il gratuit pour ${trade.audience} ?`,
      answer:
        `Oui. La formule Gratuit suffit pour démarrer : un ${site}, vos clients et vos ventes, sans carte bancaire. ` +
        `La formule Starter coûte ${xof(PLAN_PRICES.XOF.starter)} par mois, Pro ${xof(PLAN_PRICES.XOF.pro)} et Business ${xof(PLAN_PRICES.XOF.business)}.`,
    },
    {
      question: "Mes clients peuvent-ils payer par Wave, Orange Money ou carte bancaire ?",
      answer:
        "Oui. Sur votre site et à la caisse, vos clients paient par Wave, Orange Money, MTN, Moov ou carte Visa et Mastercard. " +
        `L'argent arrive sur votre Solde KORVA, que vous retirez vers votre mobile money. La commission va de ${commissionPercentLabel("free")} en Gratuit à ${commissionPercentLabel("business")} en Business.`,
    },
    {
      question: "Est-ce que j'ai un site internet ?",
      answer:
        `Oui, un ${site} en ligne dès le premier jour, à votre nom sur sites.korvasuite.com, ` +
        "et sur votre propre nom de domaine à partir de la formule Starter.",
    },
    {
      question: "Faut-il installer un logiciel ?",
      answer:
        "Non. KORVA OS fonctionne dans le navigateur, sur téléphone comme sur ordinateur. Vos données sont enregistrées en ligne et sauvegardées.",
    },
    {
      question: "Puis-je travailler avec mon équipe ?",
      answer:
        `Oui : ${PLAN_LIMITS.starter.seats} utilisateurs en Starter, ${PLAN_LIMITS.pro.seats} en Pro et ${PLAN_LIMITS.business.seats} en Business, ` +
        "chacun avec ses droits. La formule Gratuit est pour une personne.",
    },
  ];
}

export function PublicHeader() {
  return (
    <header className="bg-ink-deep text-paper">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-8">
        <Link href="/" className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper">
          <KorvaWordmark />
          <span className="sr-only">KORVA OS, accueil</span>
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2" aria-label="Navigation principale">
          <Link href="/metiers" className="hidden rounded-md px-3 py-2 text-sm text-ink-muted hover:text-paper sm:inline-block">
            Métiers
          </Link>
          <Link href="/#formules" className="hidden rounded-md px-3 py-2 text-sm text-ink-muted hover:text-paper sm:inline-block">
            Formules
          </Link>
          <Link href="/login" className="rounded-md px-2.5 py-2 text-sm text-ink-muted hover:text-paper">
            Se connecter
          </Link>
          <Link
            href="/register"
            className="whitespace-nowrap rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover"
          >
            Créer un compte
          </Link>
        </nav>
      </div>
    </header>
  );
}

/** Footer with every trade page linked: how a crawler finds them, and how a visitor does too. */
export function PublicFooter() {
  return (
    <footer className="bg-ink-deep text-ink-muted">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-8 md:grid-cols-[1fr_2fr]">
        <div className="space-y-3">
          <div className="flex items-center gap-2.5 text-paper">
            <KorvaGlyph className="size-6" compact />
            <p className="text-sm font-semibold">KORVA OS</p>
          </div>
          <p className="max-w-xs text-sm">
            Le système de gestion des petites entreprises : clients, ventes, rendez-vous, caisse et site internet.
          </p>
          <p className="text-sm">&copy; {new Date().getFullYear()} KORVA OS</p>
        </div>
        <nav aria-label="KORVA OS par métier">
          <p className="mb-3 text-sm font-semibold text-paper">KORVA OS pour votre métier</p>
          <ul className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {SEO_TRADES.map((trade) => (
              <li key={trade.slug}>
                <Link href={`/metiers/${trade.slug}`} className="hover:text-paper hover:underline">
                  {trade.template.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}

/** One trade's public page: what KORVA does for it, in its words, with prices and questions. */
export function TradePage({ trade }: { trade: SeoTrade }) {
  const model = BUSINESS_MODEL_DEFINITIONS[trade.template.businessModel];
  const modules = trade.template.suggestedModules.filter((m): m is KorvaModule =>
    (KORVA_MODULES as readonly string[]).includes(m),
  );
  const faq = tradeFaq(trade);
  const url = `${appUrl()}/metiers/${trade.slug}`;
  const others = SEO_TRADES.filter((other) => other.slug !== trade.slug).slice(0, 6);

  return (
    <div className="bg-paper text-ink">
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "KORVA OS", item: appUrl() },
              { "@type": "ListItem", position: 2, name: "Métiers", item: `${appUrl()}/metiers` },
              { "@type": "ListItem", position: 3, name: trade.template.label, item: url },
            ],
          },
          {
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: `KORVA OS pour ${trade.template.label.toLowerCase()}`,
            applicationCategory: "BusinessApplication",
            operatingSystem: "Web, Android, iOS (navigateur)",
            url,
            description: trade.heading,
            offers: {
              "@type": "AggregateOffer",
              priceCurrency: "XOF",
              lowPrice: PLAN_PRICES.XOF.free,
              highPrice: PLAN_PRICES.XOF.business,
              offerCount: 4,
            },
          },
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: faq.map((item) => ({
              "@type": "Question",
              name: item.question,
              acceptedAnswer: { "@type": "Answer", text: item.answer },
            })),
          },
        ]}
      />
      <PublicHeader />

      <section className="bg-ink-deep text-paper">
        <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-8 sm:pb-20">
          <nav aria-label="Fil d'Ariane" className="text-sm text-ink-muted">
            <Link href="/" className="hover:text-paper">Accueil</Link>
            <span aria-hidden> / </span>
            <Link href="/metiers" className="hover:text-paper">Métiers</Link>
            <span aria-hidden> / </span>
            <span className="text-paper">{trade.template.label}</span>
          </nav>
          <h1 className="mt-6 max-w-3xl text-[2rem] font-semibold leading-[1.12] tracking-[-0.02em] sm:text-[2.6rem]">
            {trade.heading}
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-ink-muted">
            {trade.scene} KORVA OS rassemble vos clients, vos ventes, votre caisse et votre site au même endroit, déjà configuré pour {trade.audience}.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/register"
              className="rounded-lg bg-primary px-5 py-3 font-semibold text-on-primary hover:bg-primary-hover"
            >
              Créer mon compte gratuit
            </Link>
            <Link href="/#formules" className="rounded-lg border border-ink-soft px-5 py-3 font-medium hover:border-paper">
              Voir les formules
            </Link>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-6xl space-y-16 px-4 py-16 sm:px-8">
        <section aria-labelledby="outils">
          <h2 id="outils" className="text-2xl font-semibold">Ce que KORVA OS fait pour vous</h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {modules.map((module) => (
              <li key={module} className="border-t border-rule pt-4">
                <p className="font-medium">{MODULE_PROMISES[module]}</p>
              </li>
            ))}
            <li className="border-t border-rule pt-4">
              <p className="font-medium">Paiement par Wave, Orange Money, MTN, Moov et carte bancaire</p>
            </li>
            <li className="border-t border-rule pt-4">
              <p className="font-medium">
                {model.siteKind} : {model.vocabulary.catalog.toLowerCase()}, {model.vocabulary.bookings.toLowerCase()} et espace client
              </p>
            </li>
          </ul>
        </section>

        {trade.template.suggestedOffers && trade.template.suggestedOffers.length > 0 && (
          <section aria-labelledby="exemples">
            <h2 id="exemples" className="text-2xl font-semibold">Prêt pour ce que vous vendez</h2>
            <p className="mt-2 max-w-2xl text-ink-soft">
              À l&apos;inscription, KORVA OS vous propose des offres types de votre métier, que vous ajustez :
            </p>
            <ul className="mt-5 flex flex-wrap gap-2">
              {trade.template.suggestedOffers.map((offer) => (
                <li key={offer.name} className="rounded-full border border-rule px-4 py-1.5 text-sm">
                  {offer.name}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="prix">
          <h2 id="prix" className="text-2xl font-semibold">Combien ça coûte</h2>
          <dl className="mt-6 grid gap-4 sm:grid-cols-4">
            {(["free", "starter", "pro", "business"] as const).map((plan) => (
              <div key={plan} className="border-t border-rule pt-4">
                <dt className="text-sm text-ink-soft">{{ free: "Gratuit", starter: "Starter", pro: "Pro", business: "Business" }[plan]}</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums">
                  {plan === "free" ? "0 F CFA" : `${xof(PLAN_PRICES.XOF[plan])} / mois`}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-sm text-ink-soft">Prix en Côte d&apos;Ivoire et dans la zone franc CFA ; ils sont fixés pays par pays.</p>
        </section>

        <section aria-labelledby="questions">
          <h2 id="questions" className="text-2xl font-semibold">Questions fréquentes</h2>
          <div className="mt-6 divide-y divide-rule border-y border-rule">
            {faq.map((item) => (
              <details key={item.question} className="group py-4">
                <summary className="cursor-pointer list-none font-medium [&::-webkit-details-marker]:hidden">
                  {item.question}
                </summary>
                <p className="mt-2 max-w-3xl text-ink-soft">{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section aria-labelledby="autres">
          <h2 id="autres" className="text-xl font-semibold">KORVA OS pour d&apos;autres métiers</h2>
          <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
            {others.map((other) => (
              <li key={other.slug}>
                <Link href={`/metiers/${other.slug}`} className="underline-offset-2 hover:underline">
                  {other.template.label}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/metiers" className="font-medium underline-offset-2 hover:underline">
                Tous les métiers
              </Link>
            </li>
          </ul>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
