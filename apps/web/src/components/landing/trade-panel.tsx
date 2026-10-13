"use client";

import { useId, useState } from "react";
import Link from "next/link";
import {
  MODULE_MIN_PLAN,
  PLAN_NAMES,
  VERTICAL_TEMPLATES,
  getStorefrontTemplate,
  modulesForPlan,
  type VerticalTemplate,
} from "@korva/types";
import {
  ACTION_SENTENCES,
  MODULE_PROMISES,
  TRIGGER_SENTENCES,
} from "@/lib/landing-content";

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

function starterSentence(vertical: VerticalTemplate): string | null {
  const workflow = vertical.starterWorkflow;
  if (!workflow) return null;
  const when = TRIGGER_SENTENCES[workflow.trigger];
  const then = ACTION_SENTENCES[workflow.action.type];
  if (!when || !then) return null;
  return `${when}, ${then}.`;
}

export function TradePanel() {
  const [selectedKey, setSelectedKey] = useState(VERTICAL_TEMPLATES[0]!.key);
  const groupId = useId();
  const selectId = useId();

  const vertical =
    VERTICAL_TEMPLATES.find((item) => item.key === selectedKey) ?? VERTICAL_TEMPLATES[0]!;
  const template = getStorefrontTemplate(vertical.defaultStorefrontTemplate);
  const automation = starterSentence(vertical);
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
          Quel est votre métier ?
        </label>
        <select
          id={selectId}
          value={selectedKey}
          onChange={(event) => setSelectedKey(event.target.value)}
          className="mt-2 w-full rounded-md border border-ink-soft bg-ink-deep px-3 py-2.5 text-base text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper focus-visible:ring-offset-2 focus-visible:ring-offset-ink-deep"
        >
          {VERTICAL_TEMPLATES.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      {/* Real radio inputs rather than aria-pressed buttons: single-select is what this is, and
          native radios bring arrow-key navigation, roving tab order and the right announcement
          for free. The input stays in the DOM (sr-only, not hidden) so all of that keeps
          working; has-[:checked] and has-[:focus-visible] style the label around it. */}
      <fieldset className="hidden sm:block" aria-describedby={groupId}>
        <legend className="text-sm text-ink-muted">Quel est votre métier ?</legend>
        <div className="mt-3 flex flex-wrap gap-2">
          {VERTICAL_TEMPLATES.map((item) => (
            <label
              key={item.key}
              className="cursor-pointer rounded-full border border-ink-soft px-3.5 py-1.5 text-sm text-ink-muted transition-colors hover:border-paper hover:text-paper has-[:checked]:border-paper has-[:checked]:bg-paper has-[:checked]:font-medium has-[:checked]:text-ink has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-paper has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-ink-deep"
            >
              <input
                type="radio"
                name="korva-trade"
                value={item.key}
                checked={item.key === selectedKey}
                onChange={() => setSelectedKey(item.key)}
                className="sr-only"
              />
              {item.label}
            </label>
          ))}
        </div>
      </fieldset>

      {/* aria-live so the panel's replacement is announced: a sighted visitor sees the content
          swap under the control they just used, a screen-reader user otherwise gets silence. */}
      <div
        id={groupId}
        aria-live="polite"
        className="mt-6 rounded-xl bg-paper p-6 text-ink shadow-xl sm:mt-8 sm:p-8"
      >
        <p className="text-sm text-ink-soft">Ce que vous obtenez en ouvrant le compte</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
          {vertical.label}
        </h2>
        <p className="mt-2 max-w-prose text-[0.9375rem] leading-relaxed text-ink-soft">
          {vertical.description}
        </p>

        {/* Split by what the free plan actually grants. Onboarding clamps a vertical's
            suggestedModules to the plan before sending them (PATCH /organizations/me rejects the
            update otherwise), so listing all of them under "day one" would promise a new signup
            modules their account will not have. */}
        <div className="mt-6 border-t border-rule pt-5">
          <h3 className="text-sm font-medium">Dès le premier jour, gratuitement</h3>
          <ul className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2">
            {freeModules.map((module) => (
              <li key={module} className="flex gap-2.5 text-[0.9375rem] leading-snug">
                <span aria-hidden="true" className="mt-px select-none text-ink-soft">
                  ✓
                </span>
                {MODULE_PROMISES[module]}
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
                    {MODULE_PROMISES[module]}
                    <span className="text-mark">
                      {" "}
                      — formule {PLAN_NAMES[MODULE_MIN_PLAN[module]]}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {automation && vertical.starterWorkflow && (
          <div className="mt-5 border-t border-rule pt-5">
            <h3 className="text-sm font-medium">
              Une automatisation, déjà configurée
            </h3>
            <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-soft">
              <span className="font-medium text-ink">
                {vertical.starterWorkflow.name}.
              </span>{" "}
              {automation}
            </p>
            {/* `workflow` is a Pro module (MODULE_MIN_PLAN), and onboarding only creates the
                starter workflow when that module made it into the final list — so on a free
                account this automation is prepared and not created. Saying so beats letting
                someone discover it after signing up. */}
            {MODULE_MIN_PLAN.workflow !== "free" && (
              <p className="mt-2 text-sm text-mark">
                Les automatisations demandent la formule{" "}
                {PLAN_NAMES[MODULE_MIN_PLAN.workflow]}.
              </p>
            )}
          </div>
        )}

        <div className="mt-5 border-t border-rule pt-5">
          <h3 className="text-sm font-medium">Votre site public</h3>
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-soft">
            <span className="font-medium text-ink">Modèle « {template.label} »</span>{" "}
            {template.description}
          </p>
          {/* The honest footnote, and the one place --color-mark is earned. Every template except
              "essentiel" carries minPlan: "starter" (storefront-themes.ts), while the verticals
              point at "salon"/"table"/"boutique"/"academie"/"vitrine" — so promising a prospect
              their trade's template without naming the plan it needs would be a claim
              EntitlementsService.assertStorefrontThemeAllowed actively refuses to honour. */}
          {template.minPlan !== "free" && (
            <p className="mt-2 text-sm text-mark">
              Ce modèle demande la formule {PLAN_NAMES[template.minPlan] ?? template.minPlan}. En
              gratuit, votre site utilise le modèle « Essentiel ».
            </p>
          )}
        </div>

        <div className="mt-7 flex flex-col gap-3 border-t border-rule pt-6 sm:flex-row sm:items-center">
          <Link
            href="/register"
            className="inline-flex items-center justify-center rounded-md bg-ink px-5 py-2.5 font-medium text-paper transition-colors hover:bg-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
          >
            Créer mon compte
          </Link>
          <p className="text-sm text-ink-soft">
            Gratuit, sans carte bancaire. Vous changez de formule quand vous voulez.
          </p>
        </div>
      </div>
    </div>
  );
}
