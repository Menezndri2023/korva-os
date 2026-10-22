import Link from "next/link";
import { BUSINESS_MODELS, BUSINESS_MODEL_DEFINITIONS, PLAN_NAMES, SIGNUP_TRIAL } from "@korva/types";
import { KorvaGlyph, KorvaWordmark } from "@/components/brand/korva-mark";
import { REPLACES } from "@/lib/landing-content";
import { PlanLadder } from "./plan-ladder";
import { PlatformReviews } from "./platform-reviews";
import { TradePanel } from "./trade-panel";

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
export function LandingPage() {
  return (
    <div className="bg-paper text-ink">
      {/* ------------------------------------------------------------------ ink field */}
      <div className="bg-ink-deep text-paper">
        <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-8">
          <Link
            href="/"
            className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper focus-visible:ring-offset-2 focus-visible:ring-offset-ink-deep"
          >
            <KorvaWordmark />
            <span className="sr-only">KORVA OS, accueil</span>
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2">
            <Link
              href="#formules"
              className="hidden rounded-md px-3 py-2 text-sm text-ink-muted transition-colors hover:text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper sm:inline-block"
            >
              Formules
            </Link>
            <Link
              href="/login"
              className="whitespace-nowrap rounded-md px-2.5 py-2 text-sm text-ink-muted transition-colors hover:text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper"
            >
              Se connecter
            </Link>
            <Link
              href="/register"
              className="whitespace-nowrap rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper focus-visible:ring-offset-2 focus-visible:ring-offset-ink-deep"
            >
              Créer un compte
            </Link>
          </nav>
        </header>

        <div className="mx-auto max-w-6xl px-4 pt-10 pb-20 sm:px-8 sm:pt-16 sm:pb-28">
          <h1 className="max-w-3xl text-[2rem] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[2.75rem] lg:text-[3.25rem]">
            Votre cahier, votre carnet de rendez-vous et votre caisse, au même endroit.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-muted sm:text-lg">
            KORVA OS remplace les carnets, les tableurs et les commandes perdues dans les
            messages. Vous ouvrez un compte, vous dites votre métier, et tout est déjà en place.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
            <Link
              href="/register"
              className="inline-flex items-center justify-center rounded-lg bg-primary px-6 py-3 text-base font-semibold text-on-primary shadow-lg shadow-black/20 transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper focus-visible:ring-offset-2 focus-visible:ring-offset-ink-deep"
            >
              Créer mon compte gratuit
            </Link>
            <p className="text-sm text-ink-muted">
              {SIGNUP_TRIAL.days} jours de formule {PLAN_NAMES[SIGNUP_TRIAL.plan]} offerts, sans
              carte bancaire.
            </p>
          </div>

          <TradePanel />
        </div>
      </div>

      {/* ------------------------------------------------------- what it replaces (paper) */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-8 sm:py-24">
        <h2 className="max-w-2xl text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          Vous ne changez pas de métier. Vous arrêtez de le gérer de tête.
        </h2>

        {/* A ruled two-column table, not a grid of cards: the left column is the visitor's
            current week and the right is the same week in KORVA, so the pairing between the two
            IS the information. Column headings carry that structure and only exist from sm:,
            where the two columns are actually side by side. */}
        <div className="mt-10">
          <div className="hidden border-b border-ink pb-2 sm:grid sm:grid-cols-2 sm:gap-10">
            <p className="text-sm font-medium text-ink-soft">Aujourd&apos;hui</p>
            <p className="text-sm font-medium text-ink">Avec KORVA OS</p>
          </div>
          <dl className="divide-y divide-rule">
            {REPLACES.map((row) => (
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
            Votre façon de vendre décide de votre site
          </h2>
          <p className="mt-3 max-w-2xl text-[0.9375rem] leading-relaxed text-ink-soft">
            Une boutique a besoin d&apos;un panier, un salon d&apos;un agenda, une agence
            d&apos;un formulaire de devis. Vous dites comment vous travaillez, KORVA monte le site
            qui va avec. Vous pouvez tout changer ensuite.
          </p>
          <dl className="mt-10 grid gap-x-10 border-t border-ink sm:grid-cols-2">
            {BUSINESS_MODELS.map((key) => {
              const model = BUSINESS_MODEL_DEFINITIONS[key];
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

      <PlatformReviews />

      {/* ------------------------------------------------------------------ plans (paper) */}
      <section id="formules" className="mx-auto max-w-6xl px-4 py-16 sm:px-8 sm:py-24">
        <h2 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          Quatre formules. Vous commencez par la gratuite.
        </h2>
        <p className="mt-3 max-w-2xl text-[0.9375rem] leading-relaxed text-ink-soft">
          Pas de carte bancaire pour ouvrir un compte. Les prix sont fixés pays par pays, pas
          convertis depuis l&apos;euro.
        </p>
        <div className="mt-10">
          <PlanLadder />
        </div>
      </section>

      {/* ------------------------------------------------------------------- closing (ink) */}
      <section className="bg-ink text-paper">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-8 sm:py-20">
          <h2 className="max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">
            Ouvrez le compte, dites votre métier. Le reste est déjà prêt.
          </h2>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href="/register"
              className="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 font-semibold text-on-primary transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
            >
              Créer mon compte
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center justify-center rounded-lg border border-ink-soft px-5 py-2.5 font-medium text-paper transition-colors hover:border-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
            >
              J&apos;ai déjà un compte
            </Link>
          </div>
        </div>
      </section>

      <footer className="bg-ink-deep text-ink-muted">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex items-center gap-2.5 text-paper">
            <KorvaGlyph className="size-5" />
            <p className="text-sm">
              KORVA OS, le système de gestion des petites entreprises.
            </p>
          </div>
          <p className="text-sm">
            &copy; {new Date().getFullYear()} KORVA OS
          </p>
        </div>
      </footer>
    </div>
  );
}
