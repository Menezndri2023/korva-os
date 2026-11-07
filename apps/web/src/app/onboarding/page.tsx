"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch, Controller } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import {
  createOrganizationSchema,
  type CreateOrganizationInput,
  type ImportOrganizationPreviewInput,
} from "@korva/validation";
import {
  ACQUISITION_SOURCES,
  acquisitionSourceLabel,
  BILLABLE_COUNTRIES,
  businessModelText,
  planName,
  verticalText,
  BUSINESS_MODELS,
  BUSINESS_MODEL_DEFINITIONS,
  MODULE_MIN_PLAN,
  PLAN_NAMES,
  SIGNUP_TRIAL,
  VERTICAL_TEMPLATES,
  currencyForCountry,
  modulesForPlan,
  type BusinessModel,
  type KorvaModule,
  type Organization,
  type Workflow,
} from "@korva/types";
import { Check } from "lucide-react";
import { Button, Input, Select } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { forgetReferral, readReferral } from "@/lib/referral";
import { intlLocale, useDashboardLocale, useT } from "@/lib/dashboard-locale";

const MODULE_LABELS: Record<KorvaModule, [string, string]> = {
  crm: ["Clients & Prospects (CRM)", "Customers & leads (CRM)"],
  catalog: ["Produits & Services", "Products & services"],
  booking: ["Réservations", "Bookings"],
  commerce: ["Commandes & E-commerce", "Orders & e-commerce"],
  finance: ["Devis & Factures", "Quotes & invoices"],
  workflow: ["Automatisations", "Automations"],
  communication: ["Communication", "Messages"],
  analytics: ["Statistiques", "Statistics"],
  ai: ["Assistant IA", "AI assistant"],
  website: ["Site web", "Website"],
  marketing: ["Marketing", "Marketing"],
};

/** The countries KORVA bills in, with their currency — shared with the public pricing section
 *  so the two can never offer a country the other does not (see @korva/types/plan-tiers.ts). */
const COUNTRIES = BILLABLE_COUNTRIES;

/** The visitor's country, guessed from the browser's time zone (Abidjan → Côte d'Ivoire). */
const DEFAULT_COUNTRY =
  typeof Intl !== "undefined"
    ? (COUNTRIES.find((country) =>
        country.timeZones.includes(Intl.DateTimeFormat().resolvedOptions().timeZone),
      )?.code ?? "FR")
    : "FR";

// See the matching comment in dashboard/settings/page.tsx — one shared list, because it now
// also determines which Plan documents are seeded.
/**
 * Every organization is created on the free plan, so these are the only modules it can actually
 * be given: PATCH /organizations/me runs assertModulesAllowed against the plan, and a checkbox
 * for anything else is a checkbox that returns 403. The form used to offer all eleven
 * KORVA_MODULES, which only ever worked because `free` wrongly granted all eleven (see
 * @korva/types/plan-tiers.ts).
 */
const FREE_PLAN_MODULES = modulesForPlan("free");

// createOrganizationSchema (packages/validation/src/organization.ts) already requires and
// accepts `timezone: z.string().min(1)` — the payload below was already sending it, just
// silently defaulted to the browser's own resolved zone and never exposed as an editable
// field (Wave 2 audit finding). Intl.supportedValuesOf("timeZone") gives the full real IANA
// list without hardcoding one, and is available in every runtime this app targets (Node >=22.6
// per the repo's engines field, and all evergreen browsers).
const TIMEZONES = Intl.supportedValuesOf("timeZone");

/** Current UTC offset of a zone, in minutes. Read from Intl rather than a table so it follows
 *  daylight saving automatically. */
function timezoneOffsetMinutes(timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(new Date());
  const name = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!match) return 0;
  return (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
}

/**
 * The browser's own zone, guaranteed to be one of the options actually rendered.
 *
 * `resolvedOptions().timeZone` and `supportedValuesOf("timeZone")` do not agree: the former
 * returns whatever the system reports, the latter lists only canonical IANA names. A machine set
 * to UTC reports "UTC", which appears in neither list — not even as "Etc/UTC". The select then
 * had a default value matching no option at all, so the field rendered empty and the form could
 * be submitted with no timezone.
 *
 * Not a CI-only curiosity: every CI runner is UTC, and so is any browser with fingerprint
 * resistance enabled (Firefox's `privacy.resistFingerprinting` always reports UTC). Those users
 * reached onboarding with a blank, required field.
 *
 * Falls back by matching the real UTC offset rather than hardcoding an alias, so any unlisted
 * zone — not just UTC — resolves to a listed zone showing the same time.
 */
function resolveDefaultTimezone(): string {
  const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (TIMEZONES.includes(resolved)) return resolved;
  const target = timezoneOffsetMinutes(resolved);
  return (
    TIMEZONES.find((zone) => timezoneOffsetMinutes(zone) === target) ??
    TIMEZONES[0]
  );
}

/**
 * The API keeps businessModel optional (organizations created through it before the field
 * existed, scripts, tests), but a new owner must choose one: it decides their kind of site and the
 * tools they see (docs/KORVA_OS_V3_STRUCTURE_PRODUIT.md §2.1). Picking a trade fills it in.
 */
const onboardingSchema = createOrganizationSchema.extend({
  businessModel: z.enum(BUSINESS_MODELS, { message: "Choisissez votre type d'activité." }),
});

interface ImportPreview {
  name?: string;
  tagline?: string;
  logo?: string;
}

export default function OnboardingPage() {
  const locale = useDashboardLocale();
  const t = useT();
  const router = useRouter();
  const setActiveOrganization = useAuthStore((state) => state.setActiveOrganization);
  const [selectedVertical, setSelectedVertical] = useState<string | null>(null);
  const [verticalFilter, setVerticalFilter] = useState("");
  const filteredVerticals = VERTICAL_TEMPLATES.filter((template) =>
    `${template.label} ${template.description}`.toLowerCase().includes(verticalFilter.trim().toLowerCase()),
  );
  const [importUrl, setImportUrl] = useState("");
  const [imported, setImported] = useState<ImportPreview | null>(null);
  // Mirrors the hidden `currency` form field purely so it can be shown. Kept as state rather
  // than read with react-hook-form's watch(), which the React Compiler cannot memoize (see the
  // react-hooks/incompatible-library warnings this repo already carries) — the value only ever
  // changes in the country field's onChange below, so there is nothing to subscribe to.
  const [billingCurrency, setBillingCurrency] = useState(currencyForCountry(DEFAULT_COUNTRY));
  // Three short steps instead of one long form (2026-11-07): the activity, where, the tools.
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const {
    register,
    handleSubmit,
    setValue,
    trigger,
    control,
    formState: { errors },
  } = useForm<CreateOrganizationInput>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      country: DEFAULT_COUNTRY,
      currency: currencyForCountry(DEFAULT_COUNTRY),
      timezone: resolveDefaultTimezone(),
      language: locale,
    },
  });

  const businessModel = useWatch({ control, name: "businessModel" }) as BusinessModel | undefined;

  // Arrived through a parrainage link: that is how they heard of KORVA (they can change it).
  useEffect(() => {
    if (readReferral()) setValue("acquisitionSource", "referral");
  }, [setValue]);

  // Registered once and spread manually below so the select can run register()'s own onChange
  // AND derive the billing currency from the same event.
  const countryField = register("country");

  const enabledModulesControl = useForm<{ modules: KorvaModule[] }>({ defaultValues: { modules: [] } });

  const importMutation = useMutation({
    mutationFn: (input: ImportOrganizationPreviewInput) =>
      apiClient.post<ImportPreview>("/organizations/import-preview", input, {
        withOrganization: false,
      }),
    onSuccess: (preview) => {
      setImported(preview);
      if (preview.name) setValue("name", preview.name);
    },
  });

  function applyVerticalTemplate(key: string) {
    const template = VERTICAL_TEMPLATES.find((t) => t.key === key);
    if (!template) return;
    setSelectedVertical(key);
    setValue("type", template.suggestedType);
    setValue("businessModel", template.businessModel, { shouldValidate: true });
    // Clamped to the free plan: a template's suggestedModules describe the vertical in full
    // (they include `workflow`, and `marketing` for some), but a brand-new organization is on
    // free, and PATCH /organizations/me rejects the whole update if it names a module the plan
    // does not grant. Sending the full list would 403 the last step of onboarding.
    enabledModulesControl.setValue(
      "modules",
      template.suggestedModules.filter((module) => FREE_PLAN_MODULES.includes(module)),
    );
  }

  const mutation = useMutation({
    mutationFn: async (data: CreateOrganizationInput) => {
      const referralCode = readReferral();
      const organization = await apiClient.post<Organization>(
        "/organizations",
        { ...data, ...(referralCode ? { referralCode } : {}) },
        { withOrganization: false },
      );
      setActiveOrganization(organization.id);

      const modules = enabledModulesControl.getValues("modules");
      // Branding imported from an existing site (tagline/logo) is applied here, right after
      // creation — createOrganizationSchema itself has no room for these fields (they're
      // storefront presentation, not the base org record), so this piggybacks on the same
      // PATCH /organizations/me call the module-selection step already makes.
      const brandingUpdate: { tagline?: string; logo?: string } = {};
      if (imported?.tagline) brandingUpdate.tagline = imported.tagline;
      if (imported?.logo) brandingUpdate.logo = imported.logo;
      // No explicit storefrontTemplate PATCH here: PublicService#resolveStorefrontTheme already
      // falls back to the vertical's defaultStorefrontTemplate from `organization.type` alone
      // (set above via `type: template.suggestedType`), clamped to whatever the org's plan
      // covers. Since the sector templates became free this would no longer be rejected — it is
      // simply still redundant, and storing a value the resolver already derives would mean two
      // places to keep in step.
      if (modules.length > 0 || Object.keys(brandingUpdate).length > 0) {
        await apiClient.patch<Organization>("/organizations/me", {
          ...(modules.length > 0 ? { enabledModules: modules } : {}),
          ...brandingUpdate,
        });
      }

      // Signup trial (SIGNUP_TRIAL): Pro for 14 days. Best-effort — the organization exists and
      // works on Free either way, so a failure here must not block the owner at the last step.
      try {
        await apiClient.post("/subscriptions/trial");
      } catch {
        // Already used or unavailable: the free plan simply applies.
      }

      // Starter workflow: only created when the vertical that suggested it is still selected
      // and its module ended up in the final list — a user can freely edit both after picking
      // a template, so this must reflect what was actually submitted, not just what the
      // template originally suggested.
      const template = VERTICAL_TEMPLATES.find((t) => t.key === selectedVertical);
      if (template?.starterWorkflow && modules.includes("workflow")) {
        await apiClient.post<Workflow>("/workflows", {
          name: template.starterWorkflow.name,
          trigger: template.starterWorkflow.trigger,
          actions: [template.starterWorkflow.action],
        });
      }

      return organization;
    },
    onSuccess: (organization) => {
      forgetReferral();
      setActiveOrganization(organization.id);
      // Not straight to the dashboard: one more step puts an offer online, so the new site is
      // not empty on day one (see first-offer/page.tsx). It can be skipped.
      router.replace("/onboarding/first-offer");
    },
  });

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">{t("Configurez votre entreprise", "Set up your business")}</h1>
          <p className="mt-1 text-sm text-text-muted">
            {t(
              `Les ${SIGNUP_TRIAL.days} premiers jours, toutes les fonctions de la formule ${PLAN_NAMES[SIGNUP_TRIAL.plan]} sont offertes, sans carte bancaire.`,
              `For the first ${SIGNUP_TRIAL.days} days, every feature of the ${planName(SIGNUP_TRIAL.plan, locale)} plan is free, no credit card needed.`,
            )}
          </p>
        </div>

        {/* Where the owner is: three steps, each one screen. */}
        <div>
          <p className="text-sm font-medium text-text">
            {t(`Étape ${step} sur 3`, `Step ${step} of 3`)} —{" "}
            {step === 1
              ? t("Votre activité", "Your business")
              : step === 2
                ? t("Où travaillez-vous ?", "Where do you work?")
                : t("Vos outils", "Your tools")}
          </p>
          <div className="mt-2 grid grid-cols-3 gap-1.5" aria-hidden="true">
            {[1, 2, 3].map((index) => (
              <span key={index} className={`h-1.5 rounded-full ${index <= step ? "bg-action" : "bg-surface-muted"}`} />
            ))}
          </div>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit((data) => mutation.mutate(data))}>
          {/* Every step stays mounted (hidden, not removed), so what was typed is kept. */}
          <div className={step === 1 ? "space-y-4" : "hidden"}>
          <details className="rounded-xl border border-border bg-surface p-4" open={Boolean(imported)}>
          <summary className="cursor-pointer text-sm font-medium">{t(
            "J'ai déjà un site web (facultatif)",
            "I already have a website (optional)",
          )}</summary>
          <div className="mt-2 space-y-2">
          <p className="text-xs text-text-muted">
            {t(
              "Vous avez déjà un site web ? Collez son adresse pour préremplir le nom, le slogan et le logo ci-dessous — tout reste modifiable avant de valider.",
              "Already have a website? Paste its address to pre-fill the name, tagline and logo below — everything stays editable before you confirm.",
            )}
          </p>
          <div className="flex gap-2">
            <Input
              type="url"
              placeholder={t("https://mon-entreprise.com", "https://my-business.com")}
              value={importUrl}
              onChange={(event) => setImportUrl(event.target.value)}
              className="flex-1"
            />
            <Button
              type="button"
              variant="secondary"
              loading={importMutation.isPending}
              disabled={!importUrl.trim()}
              onClick={() => importMutation.mutate({ url: importUrl.trim() })}
            >
              {importMutation.isPending ? t("Analyse...", "Analysing...") : t("Analyser", "Analyse")}
            </Button>
          </div>
          {importMutation.isError && (
            <p className="text-xs text-red-600">
              {importMutation.error instanceof ApiError
                ? importMutation.error.message
                : t("Impossible d'analyser ce site.", "This website could not be analysed.")}
            </p>
          )}
          {imported && (
            <p className="text-xs text-green-700">
              {t(
                "Informations importées — vérifiez-les ci-dessous avant de continuer.",
                "Details imported — check them below before you continue.",
              )}
            </p>
          )}
          </div>
          </details>

          <div>
            <label className="block text-sm font-medium" htmlFor="name">
              {t("Nom de l'entreprise", "Business name")}
            </label>
            <Input id="name" className="mt-1 w-full" {...register("name")} />
            {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
          </div>

          <div>
            <p className="block text-sm font-medium">{t(
              "Quel est votre secteur ?",
              "What is your line of business?",
            )}</p>
            <p className="mt-1 text-xs text-text-muted">
              {t(
                "Choisissez le plus proche : votre site, vos outils et vos premières offres sont préparés pour lui. Tout reste modifiable.",
                "Pick the closest: your website, tools and first offers are prepared for it. Everything stays editable.",
              )}
            </p>
            <Input
              type="search"
              placeholder={t(
                "Rechercher un secteur (ex: restaurant, artisanat, immobilier...)",
                "Search for a line of business (e.g. restaurant, crafts, real estate...)",
              )}
              value={verticalFilter}
              onChange={(event) => setVerticalFilter(event.target.value)}
              className="mt-2 w-full"
            />
            {filteredVerticals.length === 0 && (
              <p className="mt-2 text-xs text-text-muted">{t(
                "Aucun secteur ne correspond à cette recherche.",
                "No line of business matches this search.",
              )}</p>
            )}
            {errors.businessModel && !selectedVertical && (
              <p className="mt-2 text-xs text-red-600" role="alert">
                {t(
                  "Choisissez votre secteur ci-dessous, ou ouvrez « Mon activité n'est pas dans la liste ».",
                  "Pick your line of business below, or open “My business is not in the list”.",
                )}
              </p>
            )}
            {/* Two columns even on a phone, the name only there: nineteen full cards were a scroll
                of their own. The chosen one is unmistakable. */}
            <div className="mt-2 grid grid-cols-2 gap-2">
              {filteredVerticals.map((template) => {
                const chosen = selectedVertical === template.key;
                return (
                  <button
                    key={template.key}
                    type="button"
                    aria-pressed={chosen}
                    onClick={() => applyVerticalTemplate(template.key)}
                    className={`flex min-h-12 items-start gap-2 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                      chosen ? "border-action bg-action-soft ring-1 ring-action" : "border-border bg-surface hover:bg-surface-muted"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium leading-snug">{verticalText(template, locale).label}</span>
                      <span className="mt-0.5 hidden text-xs text-text-muted sm:block">{verticalText(template, locale).description}</span>
                    </span>
                    {chosen && <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-action" />}
                  </button>
                );
              })}
            </div>
          </div>

          <details className="rounded-xl border border-border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              {selectedVertical
                ? t("Ajuster le secteur et le type d'activité", "Adjust the line and type of business")
                : t("Mon activité n'est pas dans la liste", "My business is not in the list")}
            </summary>
            <div className="mt-3 space-y-4">
          <div>
            <label className="block text-sm font-medium" htmlFor="type">
              {t("Secteur d'activité", "Line of business")}
            </label>
            <Input
              id="type"
              placeholder={t("ex: commerce, service, réservation...", "e.g. retail, service, booking...")}
              className="mt-1 w-full"
              {...register("type")}
            />
            {errors.type && <p className="mt-1 text-xs text-red-600">{errors.type.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium" htmlFor="business-model">
              {t("Type d'activité", "Type of business")}
            </label>
            <Select
              id="business-model"
              className="mt-1 w-full"
              defaultValue=""
              {...register("businessModel", {
                setValueAs: (v: string) => (v === "" ? undefined : v),
              })}
            >
              <option value="" disabled>
                {t("Choisir votre type d'activité", "Choose your type of business")}
              </option>
              {BUSINESS_MODELS.map((model) => (
                <option key={model} value={model}>
                  {businessModelText(BUSINESS_MODEL_DEFINITIONS[model], locale).label} —{" "}
                  {businessModelText(BUSINESS_MODEL_DEFINITIONS[model], locale).description}
                </option>
              ))}
            </Select>
            {businessModel ? (
              <p className="mt-1 text-xs text-text-muted">
                {t("Votre site :", "Your website:")}{" "}
                {businessModelText(BUSINESS_MODEL_DEFINITIONS[businessModel], locale).siteKind}.
              </p>
            ) : null}
            {errors.businessModel && (
              <p className="mt-1 text-xs text-red-600">
                {t("Choisissez votre type d'activité.", "Choose your type of business.")}
              </p>
            )}
          </div>

            </div>
          </details>
          </div>

          <div className={step === 2 ? "space-y-4" : "hidden"}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium" htmlFor="country">
                {t("Pays", "Country")}
              </label>
              <select
                id="country"
                className="mt-1 w-full rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
                {...countryField}
                onChange={(event) => {
                  void countryField.onChange(event);
                  const currency = currencyForCountry(event.target.value);
                  setValue("currency", currency);
                  setBillingCurrency(currency);
                  // The country's own time zone: nobody should have to find "Africa/Abidjan" in a
                  // list of four hundred.
                  const zone = COUNTRIES.find((country) => country.code === event.target.value)?.timeZones[0];
                  if (zone && TIMEZONES.includes(zone)) setValue("timezone", zone);
                }}
              >
                {COUNTRIES.map((country) => (
                  <option key={country.code} value={country.code}>
                    {new Intl.DisplayNames([intlLocale(locale)], { type: "region" }).of(country.code) ?? country.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <p className="block text-sm font-medium">{t("Devise de facturation", "Billing currency")}</p>
              {/* Derived from the country, never chosen separately. This was an independent
                  five-currency dropdown defaulting to EUR, so a merchant in Morocco was billed
                  in euros unless they spotted it — and a Subscription is bound for good to the
                  currency it was sold in (see the unique index note in plan.schema.ts), so that
                  default could not be undone for that subscription afterwards. Registered as a
                  hidden field so react-hook-form still tracks and submits it. */}
              <p className="mt-1 rounded-md border border-dashed border-border-input px-3 py-2 text-sm text-text-muted">
                {billingCurrency}
                <span className="ml-2 text-xs">{t("selon votre pays", "based on your country")}</span>
              </p>
              <input type="hidden" {...register("currency")} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium" htmlFor="timezone">
              {t("Fuseau horaire", "Time zone")}
            </label>
            <Select id="timezone" className="mt-1 w-full" {...register("timezone")}>
              {TIMEZONES.map((timezone) => (
                <option key={timezone} value={timezone}>
                  {timezone}
                </option>
              ))}
            </Select>
            {errors.timezone && (
              <p className="mt-1 text-xs text-red-600">{errors.timezone.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium" htmlFor="acquisitionSource">
              {t("Comment avez-vous connu KORVA ?", "How did you hear about KORVA?")}{" "}
              <span className="font-normal text-text-muted">{t("(facultatif)", "(optional)")}</span>
            </label>
            <Select
              id="acquisitionSource"
              className="mt-1 w-full"
              {...register("acquisitionSource", {
                setValueAs: (value: string) => (value === "" ? undefined : value),
              })}
            >
              <option value="">{t("Choisir une réponse", "Choose an answer")}</option>
              {ACQUISITION_SOURCES.map((source) => (
                <option key={source} value={source}>
                  {acquisitionSourceLabel(source, locale)}
                </option>
              ))}
            </Select>
          </div>

          </div>

          <div className={step === 3 ? "space-y-4" : "hidden"}>
          <div>
            <p className="block text-sm font-medium">{t(
              "Que souhaitez-vous gérer ?",
              "What do you want to manage?",
            )}</p>
            <p className="mt-1 text-xs text-text-muted">
              {t(
                "En formule Gratuite, choisissez un seul mode de vente : réservations ou commandes. Les deux ensemble sont inclus à partir de la formule Starter.",
                "On the Free plan, choose one way of selling: bookings or orders. Both together are included from the Starter plan.",
              )}
            </p>
            <Controller
              control={enabledModulesControl.control}
              name="modules"
              render={({ field }) => (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {FREE_PLAN_MODULES.map((module) => (
                    <label key={module} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={field.value.includes(module)}
                        onChange={(event) => {
                          if (!event.target.checked) {
                            field.onChange(field.value.filter((m) => m !== module));
                            return;
                          }
                          // One sales channel on the free plan (PLAN_FEATURE_MIN_PLAN
                          // .both_channels): ticking bookings unticks orders and the reverse,
                          // rather than letting the last step of onboarding be refused.
                          const other =
                            module === "booking" ? "commerce" : module === "commerce" ? "booking" : null;
                          field.onChange([
                            ...field.value.filter((m) => m !== other),
                            module,
                          ]);
                        }}
                      />
                      {t(...MODULE_LABELS[module])}
                    </label>
                  ))}
                </div>
              )}
            />
            {/* Names the tiers from MODULE_MIN_PLAN rather than hardcoding which module sits
                where: this sentence was already wrong once, claiming automations were a paid
                feature after `workflow` moved to the free plan. */}
            <p className="mt-1 text-xs text-text-muted">
              {t(
                `Déjà cochés pour votre métier. Vous pourrez en activer d'autres plus tard ; les devis, factures et campagnes arrivent avec la formule ${PLAN_NAMES[MODULE_MIN_PLAN.finance]}${MODULE_MIN_PLAN.ai === "free" ? "" : `, l'assistant IA avec la formule ${PLAN_NAMES[MODULE_MIN_PLAN.ai]}`}.`,
                `Already ticked for your trade. You can turn on others later; quotes, invoices and campaigns come with the ${planName(MODULE_MIN_PLAN.finance, locale)} plan${MODULE_MIN_PLAN.ai === "free" ? "" : `, the AI assistant with the ${planName(MODULE_MIN_PLAN.ai, locale)} plan`}.`,
              )}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium" htmlFor="business-description">
              {t(
                "Décrivez vos produits ou services (optionnel)",
                "Describe your products or services (optional)",
              )}
            </label>
            <p className="mt-1 text-xs text-text-muted">
              {t(
                "Utilisé pour préremplir le slogan et le texte \"À propos\" de votre page publique — tout reste modifiable ensuite dans Réglages.",
                "Used to pre-fill the tagline and the “About” text of your public page — everything stays editable later in Settings.",
              )}
            </p>
            <textarea
              id="business-description"
              className="mt-2 w-full rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
              rows={3}
              maxLength={2000}
              placeholder={t(
                "ex: Nous proposons des coupes, colorations et soins capillaires bio à Paris.",
                "e.g. We offer organic haircuts, colouring and hair care in London.",
              )}
              {...register("businessDescription", {
                setValueAs: (v: string) => (v === "" ? undefined : v),
              })}
            />
            {errors.businessDescription && (
              <p className="mt-1 text-xs text-red-600">{errors.businessDescription.message}</p>
            )}
          </div>

          </div>

          {mutation.isError && (
            <p className="text-sm text-red-600">
              {mutation.error instanceof ApiError ? mutation.error.message : t("Une erreur est survenue.", "Something went wrong.")}
            </p>
          )}

          <div className="flex gap-2">
            {step > 1 && (
              <Button type="button" variant="secondary" onClick={() => setStep((current) => (current - 1) as 1 | 2 | 3)}>
                {t("Retour", "Back")}
              </Button>
            )}
            {step < 3 && (
              <Button
                type="button"
                className="flex-1"
                onClick={async () => {
                  const fields = step === 1 ? (["name", "type", "businessModel"] as const) : (["country", "timezone"] as const);
                  if (await trigger([...fields])) setStep((current) => (current + 1) as 1 | 2 | 3);
                }}
              >
                {t("Continuer", "Continue")}
              </Button>
            )}
            {/* Mounted on every step (shown on the last), so the form keeps one submit. */}
            <Button type="submit" loading={mutation.isPending} className={step === 3 ? "flex-1" : "hidden"}>
              {mutation.isPending ? t("Création...", "Creating...") : t("Créer mon organisation", "Create my organization")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
