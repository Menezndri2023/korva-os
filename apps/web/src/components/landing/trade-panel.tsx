"use client";

import { useId, useState } from "react";
import Link from "next/link";
import {
  MODULE_MIN_PLAN,
  PLAN_NAMES,
  VERTICAL_TEMPLATES,
  getStorefrontTemplate,
  modulesForPlan,
  starterWorkflowName,
  verticalText,
  type Locale,
  type VerticalTemplate,
} from "@korva/types";
import { STOREFRONT_TEMPLATE_TEXT_EN, landingText } from "@/lib/landing-content";
import { SitePreview } from "./site-preview";

/**
 * The hero's working part: the visitor names their trade, and the page shows the account they
 * would actually get.
 *
 * This is not a mockup. Every line below is read from VERTICAL_TEMPLATES and STOREFRONT_TEMPLATES
 * in packages/types — the same data the onboarding flow reads when it pre-fills the organization
 * type, ticks the module boxes and creates the starter workflow. A prospect who picks "Restaurant"
 * here sees the modules, the automation and the site template they will have after signing up,
 * and if that configuration changes in the type package this panel changes with it. There is
 * nothing to keep in sync and nothing to overstate.
 *
 * Chosen over a dashboard screenshot because the visitor has exactly one question — "est-ce que
 * c'est pour moi ?" — and a screenshot of someone else's data does not answer it. It is also the
 * one thing on this page a generic SaaS template could not produce: it needs the 17-vertical
 * catalog to exist.
 */

/** What a brand-new organization actually gets: every account starts on the free plan. */
const FREE_PLAN_MODULES = modulesForPlan("free");

function starterSentence(vertical: VerticalTemplate, locale: Locale): string | null {
  const workflow = vertical.starterWorkflow;
  if (!workflow) return null;
  const text = landingText(locale);
  const when = text.triggerSentences[workflow.trigger];
  const then = text.actionSentences[workflow.action.type];
  if (!when || !then) return null;
  return `${when}, ${then}.`;
}

const TEXT = {
  fr: {
    question: "Quel est votre métier ?",
    youGet: "Ce que vous obtenez en ouvrant le compte",
    dayOne: "Dès le premier jour, gratuitement",
    plan: (name: string) => `formule ${name}`,
    automation: "Une automatisation, déjà configurée",
    automationPlan: (name: string) => `Les automatisations demandent la formule ${name}.`,
    site: "Votre site public",
    template: (label: string) => `Modèle « ${label} »`,
    templatePlan: (name: string) =>
      `Ce modèle demande la formule ${name}. En gratuit, votre site utilise le modèle « Essentiel ».`,
    cta: "Créer mon compte",
    ctaNote: "Gratuit, sans carte bancaire. Vous changez de formule quand vous voulez.",
  },
  en: {
    question: "What is your trade?",
    youGet: "What you get when you open your account",
    dayOne: "From day one, for free",
    plan: (name: string) => `${name} plan`,
    automation: "An automation, already set up",
    automationPlan: (name: string) => `Automations need the ${name} plan.`,
    site: "Your public website",
    template: (label: string) => `“${label}” template`,
    templatePlan: (name: string) =>
      `This template needs the ${name} plan. On Free, your website uses the “Essential” template.`,
    cta: "Create my account",
    ctaNote: "Free, no credit card. Change plans whenever you like.",
  },
} satisfies Record<Locale, unknown>;

export function TradePanel({ locale = "fr" }: { locale?: Locale }) {
  const t = TEXT[locale];
  const promises = landingText(locale).modulePromises;
  const [selectedKey, setSelectedKey] = useState(VERTICAL_TEMPLATES[0]!.key);
  const groupId = useId();
  const selectId = useId();

  const vertical =
    VERTICAL_TEMPLATES.find((item) => item.key === selectedKey) ?? VERTICAL_TEMPLATES[0]!;
  const template = getStorefrontTemplate(vertical.defaultStorefrontTemplate);
  const automation = starterSentence(vertical, locale);
  const words = verticalText(vertical, locale);
  const templateText = locale === "en" ? (STOREFRONT_TEMPLATE_TEXT_EN[template.key] ?? template) : template;
  const freeModules = vertical.suggestedModules.filter((module) =>
    FREE_PLAN_MODULES.includes(module),
  );
  const paidModules = vertical.suggestedModules.filter(
    (module) => !FREE_PLAN_MODULES.includes(module),
  );

  return (
    <div className="mt-10">
      {/* Mobile: a native picker. 17 options is four to six lines of wrapped chips on a phone,
          which pushes the panel — the part that does the convincing — off the screen entirely.
          A native <select> is also the control an Android user already knows, and it opens as a
          system sheet instead of a scroll. Chips return at sm:, where they fit in two lines and
          show the breadth of the catalog at a glance. display:none on each takes the inactive
          one out of the accessibility tree, so only one control is ever announced. */}
      <div className="sm:hidden">
        <label htmlFor={selectId} className="block text-sm text-ink-muted">
          {t.question}
        </label>
        <select
          id={selectId}
          value={selectedKey}
          onChange={(event) => setSelectedKey(event.target.value)}
          className="mt-2 w-full rounded-md border border-ink-soft bg-ink-deep px-3 py-2.5 text-base text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper focus-visible:ring-offset-2 focus-visible:ring-offset-ink-deep"
        >
          {VERTICAL_TEMPLATES.map((item) => (
            <option key={item.key} value={item.key}>
              {verticalText(item, locale).label}
            </option>
          ))}
        </select>
      </div>

      {/* Real radio inputs rather than aria-pressed buttons: single-select is what this is, and
          native radios bring arrow-key navigation, roving tab order and the right announcement
          for free. The input stays in the DOM (sr-only, not hidden) so all of that keeps
          working; has-[:checked] and has-[:focus-visible] style the label around it. */}
      <fieldset className="hidden sm:block" aria-describedby={groupId}>
        <legend className="text-sm text-ink-muted">{t.question}</legend>
        <div className="mt-3 flex flex-wrap gap-2">
          {VERTICAL_TEMPLATES.map((item) => (
            <label
              key={item.key}
              className="cursor-pointer rounded-full border border-ink-soft px-3.5 py-1.5 text-sm text-ink-muted transition-colors hover:border-paper hover:text-paper has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:font-semibold has-[:checked]:text-on-primary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-paper has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-ink-deep"
            >
              <input
                type="radio"
                name="korva-trade"
                value={item.key}
                checked={item.key === selectedKey}
                onChange={() => setSelectedKey(item.key)}
                className="sr-only"
              />
              {verticalText(item, locale).label}
            </label>
          ))}
        </div>
      </fieldset>

      {/* The phone beside the panel from lg:, above it on a phone — it is the part that shows
          the visitor their own site, so on a small screen it comes before the details. */}
      <div className="mt-6 grid gap-8 sm:mt-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start lg:gap-12">
        <div className="lg:sticky lg:top-8 lg:order-last">
          <SitePreview vertical={vertical} locale={locale} />
        </div>
        {/* aria-live so the panel's replacement is announced: a sighted visitor sees the content
            swap under the control they just used, a screen-reader user otherwise gets silence. */}
        <div
          id={groupId}
          aria-live="polite"
          className="rounded-2xl bg-paper p-6 text-ink shadow-xl sm:p-8"
        >
          <p className="text-sm text-ink-soft">{t.youGet}</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            {words.label}
          </h2>
          <p className="mt-2 max-w-prose text-[0.9375rem] leading-relaxed text-ink-soft">
            {words.description}
          </p>

          {/* Split by what the free plan actually grants. Onboarding clamps a vertical's
              suggestedModules to the plan before sending them (PATCH /organizations/me rejects the
              update otherwise), so listing all of them under "day one" would promise a new signup
              modules their account will not have. */}
          <div className="mt-6 border-t border-rule pt-5">
            <h3 className="text-sm font-medium">{t.dayOne}</h3>
            <ul className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2">
              {freeModules.map((module) => (
                <li key={module} className="flex gap-2.5 text-[0.9375rem] leading-snug">
                  <span aria-hidden="true" className="mt-px select-none text-ink-soft">
                    ✓
                  </span>
                  {promises[module]}
                </li>
              ))}
            </ul>
            {paidModules.length > 0 && (
              <ul className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2">
                {paidModules.map((module) => (
                  <li
                    key={module}
                    className="flex gap-2.5 text-[0.9375rem] leading-snug text-ink-soft"
                  >
                    <span aria-hidden="true" className="mt-px select-none">
                      +
                    </span>
                    <span>
                      {promises[module]}
                      <span className="text-mark">
                        {" "}
                        — {t.plan(PLAN_NAMES[MODULE_MIN_PLAN[module]])}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {automation && vertical.starterWorkflow && (
            <div className="mt-5 border-t border-rule pt-5">
              <h3 className="text-sm font-medium">{t.automation}</h3>
              <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-soft">
                <span className="font-medium text-ink">
                  {starterWorkflowName(vertical.starterWorkflow.name, locale)}.
                </span>{" "}
                {automation}
              </p>
              {/* `workflow` is a Pro module (MODULE_MIN_PLAN), and onboarding only creates the
                  starter workflow when that module made it into the final list — so on a free
                  account this automation is prepared and not created. Saying so beats letting
                  someone discover it after signing up. */}
              {MODULE_MIN_PLAN.workflow !== "free" && (
                <p className="mt-2 text-sm text-mark">{t.automationPlan(PLAN_NAMES[MODULE_MIN_PLAN.workflow])}</p>
              )}
            </div>
          )}

          <div className="mt-5 border-t border-rule pt-5">
            <h3 className="text-sm font-medium">{t.site}</h3>
            <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-soft">
              <span className="font-medium text-ink">{t.template(templateText.label)}</span>{" "}
              {templateText.description}
            </p>
            {/* Kept as a conditional even though every template is reachable from free today: the
                gate is real (assertStorefrontThemeAllowed), and if a template is ever put behind a
                tier again this says so instead of promising a prospect something the API refuses.
                It renders nothing while minPlan is "free" everywhere. */}
            {template.minPlan !== "free" && (
              <p className="mt-2 text-sm text-mark">{t.templatePlan(PLAN_NAMES[template.minPlan] ?? template.minPlan)}</p>
            )}
          </div>

          <div className="mt-7 flex flex-col gap-3 border-t border-rule pt-6 sm:flex-row sm:items-center">
            <Link
              href={locale === "en" ? "/register?lang=en" : "/register"}
              className="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 font-semibold text-on-primary transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
            >
              {t.cta}
            </Link>
            <p className="text-sm text-ink-soft">{t.ctaNote}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
