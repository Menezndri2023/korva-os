import Link from "next/link";
import {
  BUSINESS_MODEL_DEFINITIONS,
  KORVA_MODULES,
  PLAN_LIMITS,
  PLAN_PRICES,
  businessModelText,
  commissionPercentLabel,
  verticalText,
  type KorvaModule,
  type Locale,
} from "@korva/types";
import { KorvaGlyph, KorvaWordmark } from "@/components/brand/korva-mark";
import { landingText } from "@/lib/landing-content";
import { SEO_TRADES, tradePath, tradeWords, type SeoTrade } from "@/lib/seo-trades";
import { appUrl } from "@/lib/site-url";
import { JsonLd } from "./json-ld";

const money = (amount: number, currency: "XOF" | "USD", locale: Locale) =>
  currency === "XOF"
    ? `${amount.toLocaleString(locale === "en" ? "en-GB" : "fr-FR")} F CFA`
    : `$${amount}`;

const TEXT = {
  fr: {
    home: "Accueil",
    trades: "Métiers",
    plans: "Formules",
    signIn: "Se connecter",
    signUp: "Créer un compte",
    kicker: (scene: string, audience: string) =>
      `${scene} KORVA OS rassemble vos clients, vos ventes, votre caisse et votre site au même endroit, déjà configuré pour ${audience}.`,
    cta: "Créer mon compte gratuit",
    seePlans: "Voir les formules",
    whatH2: "Ce que KORVA OS fait pour vous",
    payments: "Paiement par Wave, Orange Money, MTN, Moov et carte bancaire",
    site: (kind: string, catalog: string, bookings: string) => `${kind} : ${catalog}, ${bookings} et espace client`,
    offersH2: "Prêt pour ce que vous vendez",
    offersLead: "À l'inscription, KORVA OS vous propose des offres types de votre métier, que vous ajustez :",
    priceH2: "Combien ça coûte",
    perMonth: "/ mois",
    priceNote: "Prix en Côte d'Ivoire et dans la zone franc CFA ; ils sont fixés pays par pays.",
    faqH2: "Questions fréquentes",
    othersH2: "KORVA OS pour d'autres métiers",
    allTrades: "Tous les métiers",
    footerLead: "Le système de gestion des petites entreprises : clients, ventes, rendez-vous, caisse et site internet.",
    footerTrades: "KORVA OS pour votre métier",
    breadcrumb: "Fil d'Ariane",
    nav: "Navigation principale",
    planNames: { free: "Gratuit", starter: "Starter", pro: "Pro", business: "Business" },
  },
  en: {
    home: "Home",
    trades: "Trades",
    plans: "Plans",
    signIn: "Sign in",
    signUp: "Create an account",
    kicker: (scene: string, audience: string) =>
      `${scene} KORVA OS brings your customers, sales, till and website together, already set up for ${audience}.`,
    cta: "Create my free account",
    seePlans: "See the plans",
    whatH2: "What KORVA OS does for you",
    payments: "Payment by card (Visa, Mastercard) and mobile money (Wave, Orange Money, MTN, Moov)",
    site: (kind: string, catalog: string, bookings: string) => `${kind}: ${catalog}, ${bookings} and customer accounts`,
    offersH2: "Ready for what you sell",
    offersLead: "When you sign up, KORVA OS suggests typical offers for your trade, which you adjust:",
    priceH2: "What it costs",
    perMonth: "/ month",
    priceNote: "International prices in US dollars; local prices apply in each country.",
    faqH2: "Frequently asked questions",
    othersH2: "KORVA OS for other trades",
    allTrades: "All trades",
    footerLead: "The management system for small businesses: customers, sales, appointments, till and website.",
    footerTrades: "KORVA OS for your trade",
    breadcrumb: "Breadcrumb",
    nav: "Main navigation",
    planNames: { free: "Free", starter: "Starter", pro: "Pro", business: "Business" },
  },
} satisfies Record<Locale, unknown>;

/** The questions an owner of this trade asks first — also given to search engines as FAQPage. */
export function tradeFaq(trade: SeoTrade, locale: Locale = "fr"): { question: string; answer: string }[] {
  const model = businessModelText(BUSINESS_MODEL_DEFINITIONS[trade.template.businessModel], locale);
  const site = model.siteKind.toLowerCase();
  const { audience } = tradeWords(trade, locale);
  if (locale === "en") {
    return [
      {
        question: `Is KORVA OS free for ${audience}?`,
        answer:
          `Yes. The Free plan is enough to start: a ${site}, your customers and your sales, no credit card. ` +
          `Starter costs ${money(PLAN_PRICES.USD.starter, "USD", locale)} a month, Pro ${money(PLAN_PRICES.USD.pro, "USD", locale)} and Business ${money(PLAN_PRICES.USD.business, "USD", locale)}.`,
      },
      {
        question: "Can my customers pay by card?",
        answer:
          "Yes. On your website and at your till, customers pay by Visa or Mastercard, and by Wave, Orange Money, MTN or Moov where mobile money exists. " +
          `The money lands in your KORVA Balance. Commission ranges from ${commissionPercentLabel("free").replace(",", ".")} on Free to ${commissionPercentLabel("business").replace(",", ".")} on Business.`,
      },
      {
        question: "Do I get a website?",
        answer: `Yes, a ${site} online from day one, under your name on sites.korvasuite.com, and on your own domain from the Starter plan.`,
      },
      {
        question: "Do I need to install anything?",
        answer: "No. KORVA OS runs in the browser, on a phone or a computer. Your data is stored online and backed up.",
      },
      {
        question: "Can I work with my team?",
        answer:
          `Yes: ${PLAN_LIMITS.starter.seats} users on Starter, ${PLAN_LIMITS.pro.seats} on Pro and ${PLAN_LIMITS.business.seats} on Business, ` +
          "each with their own permissions. The Free plan is for one person.",
      },
    ];
  }
  return [
    {
      question: `KORVA OS est-il gratuit pour ${audience} ?`,
      answer:
        `Oui. La formule Gratuit suffit pour démarrer : un ${site}, vos clients et vos ventes, sans carte bancaire. ` +
        `La formule Starter coûte ${money(PLAN_PRICES.XOF.starter, "XOF", locale)} par mois, Pro ${money(PLAN_PRICES.XOF.pro, "XOF", locale)} et Business ${money(PLAN_PRICES.XOF.business, "XOF", locale)}.`,
    },
    {
      question: "Mes clients peuvent-ils payer par Wave, Orange Money ou carte bancaire ?",
      answer:
        "Oui. Sur votre site et à la caisse, vos clients paient par Wave, Orange Money, MTN, Moov ou carte Visa et Mastercard. " +
        `L'argent arrive sur votre Solde KORVA, que vous retirez vers votre mobile money. La commission va de ${commissionPercentLabel("free")} en Gratuit à ${commissionPercentLabel("business")} en Business.`,
    },
    {
      question: "Est-ce que j'ai un site internet ?",
      answer: `Oui, un ${site} en ligne dès le premier jour, à votre nom sur sites.korvasuite.com, et sur votre propre nom de domaine à partir de la formule Starter.`,
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

/** "FR | EN": to the same page in the other language when it exists, else to its home. */
export function LanguageLink({ locale, href }: { locale: Locale; href?: string }) {
  const other = locale === "en" ? "fr" : "en";
  return (
    <Link
      href={href ?? (other === "en" ? "/en" : "/")}
      hrefLang={other}
      lang={other}
      className="rounded-md px-2 py-2 text-sm font-semibold uppercase text-ink-muted hover:text-paper"
    >
      {other}
      <span className="sr-only">{other === "en" ? " — English" : " — Français"}</span>
    </Link>
  );
}

export function PublicHeader({ locale = "fr", otherLanguageHref }: { locale?: Locale; otherLanguageHref?: string }) {
  const t = TEXT[locale];
  const en = locale === "en";
  return (
    <header className="bg-ink-deep text-paper">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-8">
        <Link href={en ? "/en" : "/"} className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper">
          <KorvaWordmark />
          <span className="sr-only">KORVA OS, {t.home}</span>
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2" aria-label={t.nav}>
          <Link href={en ? "/en/trades" : "/metiers"} className="hidden rounded-md px-3 py-2 text-sm text-ink-muted hover:text-paper sm:inline-block">
            {t.trades}
          </Link>
          <Link href={en ? "/en#formules" : "/#formules"} className="hidden rounded-md px-3 py-2 text-sm text-ink-muted hover:text-paper sm:inline-block">
            {t.plans}
          </Link>
          <LanguageLink locale={locale} href={otherLanguageHref} />
          <Link href={en ? "/login?lang=en" : "/login"} className="rounded-md px-2.5 py-2 text-sm text-ink-muted hover:text-paper">
            {t.signIn}
          </Link>
          <Link
            href={en ? "/register?lang=en" : "/register"}
            className="whitespace-nowrap rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover"
          >
            {t.signUp}
          </Link>
        </nav>
      </div>
    </header>
  );
}

/** Footer with every trade page linked: how a crawler finds them, and how a visitor does too. */
export function PublicFooter({ locale = "fr" }: { locale?: Locale }) {
  const t = TEXT[locale];
  return (
    <footer className="bg-ink-deep text-ink-muted">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-8 md:grid-cols-[1fr_2fr]">
        <div className="space-y-3">
          <div className="flex items-center gap-2.5 text-paper">
            <KorvaGlyph className="size-6" compact />
            <p className="text-sm font-semibold">KORVA OS</p>
          </div>
          <p className="max-w-xs text-sm">{t.footerLead}</p>
          <p className="text-sm">&copy; {new Date().getFullYear()} KORVA OS</p>
        </div>
        <nav aria-label={t.footerTrades}>
          <p className="mb-3 text-sm font-semibold text-paper">{t.footerTrades}</p>
          <ul className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {SEO_TRADES.map((trade) => (
              <li key={trade.slug}>
                <Link href={tradePath(trade, locale)} className="hover:text-paper hover:underline">
                  {verticalText(trade.template, locale).label}
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
export function TradePage({ trade, locale = "fr" }: { trade: SeoTrade; locale?: Locale }) {
  const t = TEXT[locale];
  const en = locale === "en";
  const words = tradeWords(trade, locale);
  const label = verticalText(trade.template, locale);
  const model = businessModelText(BUSINESS_MODEL_DEFINITIONS[trade.template.businessModel], locale);
  const promises = landingText(locale).modulePromises;
  const modules = trade.template.suggestedModules.filter((m): m is KorvaModule =>
    (KORVA_MODULES as readonly string[]).includes(m),
  );
  const faq = tradeFaq(trade, locale);
  const url = `${appUrl()}${tradePath(trade, locale)}`;
  const tradesIndex = en ? "/en/trades" : "/metiers";
  const others = SEO_TRADES.filter((other) => other.slug !== trade.slug).slice(0, 6);
  const currency = en ? "USD" : "XOF";

  return (
    <div className="bg-paper text-ink" lang={locale}>
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "KORVA OS", item: `${appUrl()}${en ? "/en" : ""}` },
              { "@type": "ListItem", position: 2, name: t.trades, item: `${appUrl()}${tradesIndex}` },
              { "@type": "ListItem", position: 3, name: label.label, item: url },
            ],
          },
          {
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: en ? `KORVA OS for ${label.label.toLowerCase()}` : `KORVA OS pour ${label.label.toLowerCase()}`,
            applicationCategory: "BusinessApplication",
            operatingSystem: en ? "Web, Android, iOS (browser)" : "Web, Android, iOS (navigateur)",
            inLanguage: locale,
            url,
            description: words.heading,
            offers: {
              "@type": "AggregateOffer",
              priceCurrency: currency,
              lowPrice: PLAN_PRICES[currency].free,
              highPrice: PLAN_PRICES[currency].business,
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
      <PublicHeader locale={locale} otherLanguageHref={tradePath(trade, en ? "fr" : "en")} />

      <section className="bg-ink-deep text-paper">
        <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-8 sm:pb-20">
          <nav aria-label={t.breadcrumb} className="text-sm text-ink-muted">
            <Link href={en ? "/en" : "/"} className="hover:text-paper">{t.home}</Link>
            <span aria-hidden> / </span>
            <Link href={tradesIndex} className="hover:text-paper">{t.trades}</Link>
            <span aria-hidden> / </span>
            <span className="text-paper">{label.label}</span>
          </nav>
          <h1 className="mt-6 max-w-3xl text-[2rem] font-semibold leading-[1.12] tracking-[-0.02em] sm:text-[2.6rem]">
            {words.heading}
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-ink-muted">{t.kicker(words.scene, words.audience)}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href={en ? "/register?lang=en" : "/register"}
              className="rounded-lg bg-primary px-5 py-3 font-semibold text-on-primary hover:bg-primary-hover"
            >
              {t.cta}
            </Link>
            <Link href={en ? "/en#formules" : "/#formules"} className="rounded-lg border border-ink-soft px-5 py-3 font-medium hover:border-paper">
              {t.seePlans}
            </Link>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-6xl space-y-16 px-4 py-16 sm:px-8">
        <section aria-labelledby="outils">
          <h2 id="outils" className="text-2xl font-semibold">{t.whatH2}</h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {modules.map((module) => (
              <li key={module} className="border-t border-rule pt-4">
                <p className="font-medium">{promises[module]}</p>
              </li>
            ))}
            <li className="border-t border-rule pt-4">
              <p className="font-medium">{t.payments}</p>
            </li>
            <li className="border-t border-rule pt-4">
              <p className="font-medium">
                {t.site(model.siteKind, model.vocabulary.catalog.toLowerCase(), model.vocabulary.bookings.toLowerCase())}
              </p>
            </li>
          </ul>
        </section>

        {trade.template.suggestedOffers && trade.template.suggestedOffers.length > 0 && (
          <section aria-labelledby="exemples">
            <h2 id="exemples" className="text-2xl font-semibold">{t.offersH2}</h2>
            <p className="mt-2 max-w-2xl text-ink-soft">{t.offersLead}</p>
            <ul className="mt-5 flex flex-wrap gap-2">
              {trade.template.suggestedOffers.map((offer) => (
                <li key={offer.name} className="rounded-full border border-rule px-4 py-1.5 text-sm">
                  {label.offerName(offer.name)}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="prix">
          <h2 id="prix" className="text-2xl font-semibold">{t.priceH2}</h2>
          <dl className="mt-6 grid gap-4 sm:grid-cols-4">
            {(["free", "starter", "pro", "business"] as const).map((plan) => (
              <div key={plan} className="border-t border-rule pt-4">
                <dt className="text-sm text-ink-soft">{t.planNames[plan]}</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums">
                  {money(PLAN_PRICES[currency][plan], currency, locale)}
                  {plan !== "free" && ` ${t.perMonth}`}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-sm text-ink-soft">{t.priceNote}</p>
        </section>

        <section aria-labelledby="questions">
          <h2 id="questions" className="text-2xl font-semibold">{t.faqH2}</h2>
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
          <h2 id="autres" className="text-xl font-semibold">{t.othersH2}</h2>
          <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
            {others.map((other) => (
              <li key={other.slug}>
                <Link href={tradePath(other, locale)} className="underline-offset-2 hover:underline">
                  {verticalText(other.template, locale).label}
                </Link>
              </li>
            ))}
            <li>
              <Link href={tradesIndex} className="font-medium underline-offset-2 hover:underline">
                {t.allTrades}
              </Link>
            </li>
          </ul>
        </section>
      </main>

      <PublicFooter locale={locale} />
    </div>
  );
}
