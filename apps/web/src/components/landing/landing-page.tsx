import Link from "next/link";
import {
  BUSINESS_MODELS,
  BUSINESS_MODEL_DEFINITIONS,
  PLAN_NAMES,
  SIGNUP_TRIAL,
  businessModelText,
  type Locale,
} from "@korva/types";
import { KorvaWordmark } from "@/components/brand/korva-mark";
import { landingText } from "@/lib/landing-content";
import { PlanLadder } from "./plan-ladder";
import { PlatformReviews } from "./platform-reviews";
import { TradePanel } from "./trade-panel";
import { JsonLd } from "@/components/seo/json-ld";
import { LanguageLink, PublicFooter } from "@/components/seo/trade-page";
import { KORVA_SUPPORT, PLAN_PRICES } from "@korva/types";

/**
 * KORVA's public home page.
 *
 * Replaces a 25-line redirect: until now the domain opened straight onto a login form, so the
 * product that sells "your business, properly presented" presented itself with no page, no
 * identity and no explanation of what it does.
 *
 * The layout is a ledger, left-aligned and ruled, because that is what the product replaces for
 * most of its customers — and because a centred hero over a card grid is what every generated
 * SaaS page looks like. One dark ink field at the top carries all the emphasis, with the one
 * picture on the page: a phone drawing the visitor's own site (site-preview.tsx). Everything below
 * it is quiet paper and hairlines; saffron marks the actions. No photos and no entrance animations:
 * the markets this ships to (Cote d'Ivoire, Senegal, Morocco) are mobile-majority on metered
 * mobile data, so type and rules do the work and the page stays cheap to load.
 */
const TEXT = {
  fr: {
    home: "KORVA OS, accueil",
    trades: "Métiers",
    plans: "Formules",
    signIn: "Se connecter",
    signUp: "Créer un compte",
    h1: "Votre cahier, votre carnet de rendez-vous et votre caisse, au même endroit.",
    lead: "KORVA OS remplace les carnets, les tableurs et les commandes perdues dans les messages. Vous ouvrez un compte, vous dites votre métier, et tout est déjà en place.",
    cta: "Créer mon compte gratuit",
    trial: (days: number, plan: string) => `${days} jours de formule ${plan} offerts, sans carte bancaire.`,
    replacesH2: "Vous ne changez pas de métier. Vous arrêtez de le gérer de tête.",
    today: "Aujourd'hui",
    withKorva: "Avec KORVA OS",
    modelsH2: "Votre façon de vendre décide de votre site",
    modelsLead:
      "Une boutique a besoin d'un panier, un salon d'un agenda, une agence d'un formulaire de devis. Vous dites comment vous travaillez, KORVA monte le site qui va avec. Vous pouvez tout changer ensuite.",
    plansH2: "Quatre formules. Vous commencez par la gratuite.",
    plansLead: "Pas de carte bancaire pour ouvrir un compte. Les prix sont fixés pays par pays, pas convertis depuis l'euro.",
    closingH2: "Ouvrez le compte, dites votre métier. Le reste est déjà prêt.",
    closingCta: "Créer mon compte",
    haveAccount: "J'ai déjà un compte",
  },
  en: {
    home: "KORVA OS, home",
    trades: "Trades",
    plans: "Plans",
    signIn: "Sign in",
    signUp: "Create an account",
    h1: "Your notebook, your appointment book and your till, in one place.",
    lead: "KORVA OS replaces notebooks, spreadsheets and orders lost in messages. Open an account, tell us your trade, and everything is already set up.",
    cta: "Create my free account",
    trial: (days: number, plan: string) => `${days} days of the ${plan} plan free, no credit card.`,
    replacesH2: "You don't change your trade. You stop running it from memory.",
    today: "Today",
    withKorva: "With KORVA OS",
    modelsH2: "The way you sell decides your website",
    modelsLead:
      "A shop needs a basket, a salon a diary, an agency a quote form. Tell us how you work and KORVA builds the website that goes with it. You can change everything later.",
    plansH2: "Four plans. You start with the free one.",
    plansLead: "No credit card to open an account. Prices are set country by country, not converted from the euro.",
    closingH2: "Open your account, tell us your trade. The rest is ready.",
    closingCta: "Create my account",
    haveAccount: "I already have an account",
  },
} satisfies Record<Locale, unknown>;

export function LandingPage({ locale = "fr" }: { locale?: Locale }) {
  const t = TEXT[locale];
  const en = locale === "en";
  const register = en ? "/register?lang=en" : "/register";
  const login = en ? "/login?lang=en" : "/login";
  return (
    <div className="bg-paper text-ink" lang={locale}>
      {/* Who KORVA is and what it sells, for search engines and AI assistants. */}
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "Organization",
            name: "KORVA OS",
            url: "https://app.korvasuite.com",
            logo: "https://app.korvasuite.com/apple-icon.png",
            email: KORVA_SUPPORT.email,
            contactPoint: {
              "@type": "ContactPoint",
              contactType: "customer support",
              email: KORVA_SUPPORT.email,
              telephone: KORVA_SUPPORT.phoneDisplay.replace(/\s/g, ""),
              availableLanguage: ["French"],
            },
          },
          {
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "KORVA OS",
            applicationCategory: "BusinessApplication",
            operatingSystem: "Web, Android, iOS (navigateur)",
            url: "https://app.korvasuite.com",
            inLanguage: "fr",
            description:
              "Logiciel de gestion pour petites entreprises : clients, rendez-vous, commandes, stock, caisse, factures et site internet. Paiement Wave, Orange Money, MTN, Moov et carte bancaire.",
            offers: {
              "@type": "AggregateOffer",
              priceCurrency: "XOF",
              lowPrice: PLAN_PRICES.XOF.free,
              highPrice: PLAN_PRICES.XOF.business,
              offerCount: 4,
            },
          },
        ]}
      />
      {/* ------------------------------------------------------------------ ink field */}
      <div className="bg-ink-deep text-paper">
        <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-8">
          <Link
            href={en ? "/en" : "/"}
            className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper focus-visible:ring-offset-2 focus-visible:ring-offset-ink-deep"
          >
            <KorvaWordmark />
            <span className="sr-only">{t.home}</span>
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2">
            <Link
              href={en ? "/en/trades" : "/metiers"}
              className="hidden rounded-md px-3 py-2 text-sm text-ink-muted transition-colors hover:text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper sm:inline-block"
            >
              {t.trades}
            </Link>
            <Link
              href="#formules"
              className="hidden rounded-md px-3 py-2 text-sm text-ink-muted transition-colors hover:text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper sm:inline-block"
            >
              {t.plans}
            </Link>
            <LanguageLink locale={locale} />
            <Link
              href={login}
              className="whitespace-nowrap rounded-md px-2.5 py-2 text-sm text-ink-muted transition-colors hover:text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper"
            >
              {t.signIn}
            </Link>
            <Link
              href={register}
              className="whitespace-nowrap rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper focus-visible:ring-offset-2 focus-visible:ring-offset-ink-deep"
            >
              {t.signUp}
            </Link>
          </nav>
        </header>

        <div className="mx-auto max-w-6xl px-4 pt-10 pb-20 sm:px-8 sm:pt-16 sm:pb-28">
          <h1 className="max-w-3xl text-[2rem] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[2.75rem] lg:text-[3.25rem]">
            {t.h1}
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-muted sm:text-lg">
            {t.lead}
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
            <Link
              href={register}
              className="inline-flex items-center justify-center rounded-lg bg-primary px-6 py-3 text-base font-semibold text-on-primary shadow-lg shadow-black/20 transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper focus-visible:ring-offset-2 focus-visible:ring-offset-ink-deep"
            >
              {t.cta}
            </Link>
            <p className="text-sm text-ink-muted">
              {t.trial(SIGNUP_TRIAL.days, PLAN_NAMES[SIGNUP_TRIAL.plan])}
            </p>
          </div>

          <TradePanel locale={locale} />
        </div>
      </div>

      {/* ------------------------------------------------------- what it replaces (paper) */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-8 sm:py-24">
        <h2 className="max-w-2xl text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          {t.replacesH2}
        </h2>

        {/* A ruled two-column table, not a grid of cards: the left column is the visitor's
            current week and the right is the same week in KORVA, so the pairing between the two
            IS the information. Column headings carry that structure and only exist from sm:,
            where the two columns are actually side by side. */}
        <div className="mt-10">
          <div className="hidden border-b border-ink pb-2 sm:grid sm:grid-cols-2 sm:gap-10">
            <p className="text-sm font-medium text-ink-soft">{t.today}</p>
            <p className="text-sm font-medium text-ink">{t.withKorva}</p>
          </div>
          <dl className="divide-y divide-rule">
            {landingText(locale).replaces.map((row) => (
              <div
                key={row.korva}
                className="grid gap-1.5 py-5 sm:grid-cols-2 sm:gap-10 sm:py-4"
              >
                <dt className="text-[0.9375rem] leading-snug text-ink-soft">{row.today}</dt>
                <dd className="text-[0.9375rem] font-medium leading-snug text-ink">
                  {row.korva}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ------------------------------------------------------ types of activity (paper) */}
      {/* Was the seventeen trades again as chips — the hero's own picker, repeated. The eight
          types of activity say something the picker does not: each one gets a different KIND of
          site. Read from BUSINESS_MODEL_DEFINITIONS, the table onboarding stores and the
          storefront reads, so this list cannot promise a site the product does not build. */}
      <section className="border-y border-rule bg-paper-shade">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-8 sm:py-20">
          <h2 className="max-w-2xl text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            {t.modelsH2}
          </h2>
          <p className="mt-3 max-w-2xl text-[0.9375rem] leading-relaxed text-ink-soft">
            {t.modelsLead}
          </p>
          <dl className="mt-10 grid gap-x-10 border-t border-ink sm:grid-cols-2">
            {BUSINESS_MODELS.map((key) => {
              const model = businessModelText(BUSINESS_MODEL_DEFINITIONS[key], locale);
              return (
                <div key={key} className="border-b border-rule py-5">
                  <dt className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="text-lg font-semibold text-ink">{model.label}</span>
                    <span className="text-sm font-medium text-accent">{model.siteKind}</span>
                  </dt>
                  <dd className="mt-1 text-[0.9375rem] leading-snug text-ink-soft">
                    {model.description}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      </section>

      <PlatformReviews locale={locale} />

      {/* ------------------------------------------------------------------ plans (paper) */}
      <section id="formules" className="mx-auto max-w-6xl px-4 py-16 sm:px-8 sm:py-24">
        <h2 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          {t.plansH2}
        </h2>
        <p className="mt-3 max-w-2xl text-[0.9375rem] leading-relaxed text-ink-soft">
          {t.plansLead}
        </p>
        <div className="mt-10">
          <PlanLadder locale={locale} />
        </div>
      </section>

      {/* ------------------------------------------------------------------- closing (ink) */}
      <section className="bg-ink text-paper">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-8 sm:py-20">
          <h2 className="max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">
            {t.closingH2}
          </h2>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href={register}
              className="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 font-semibold text-on-primary transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
            >
              {t.closingCta}
            </Link>
            <Link
              href={login}
              className="inline-flex items-center justify-center rounded-lg border border-ink-soft px-5 py-2.5 font-medium text-paper transition-colors hover:border-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
            >
              {t.haveAccount}
            </Link>
          </div>
        </div>
      </section>

      <PublicFooter locale={locale} />
    </div>
  );
}
