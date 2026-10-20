"use client";

import { useState } from "react";
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
  BILLABLE_COUNTRIES,
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
import { Button, Card, Input, Select } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";

const MODULE_LABELS: Record<KorvaModule, string> = {
  crm: "Clients & Prospects (CRM)",
  catalog: "Produits & Services",
  booking: "Réservations",
  commerce: "Commandes & E-commerce",
  finance: "Devis & Factures",
  workflow: "Automatisations",
  communication: "Communication",
  analytics: "Statistiques",
  ai: "Assistant IA",
  website: "Site web",
  marketing: "Marketing",
};

/** The countries KORVA bills in, with their currency — shared with the public pricing section
 *  so the two can never offer a country the other does not (see @korva/types/plan-tiers.ts). */
const COUNTRIES = BILLABLE_COUNTRIES;

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
  const [billingCurrency, setBillingCurrency] = useState(currencyForCountry("FR"));

  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors },
  } = useForm<CreateOrganizationInput>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      country: "FR",
      currency: currencyForCountry("FR"),
      timezone: resolveDefaultTimezone(),
      language: "fr",
    },
  });

  const businessModel = useWatch({ control, name: "businessModel" }) as BusinessModel | undefined;

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
      const organization = await apiClient.post<Organization>("/organizations", data, { withOrganization: false });
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
      setActiveOrganization(organization.id);
      router.replace("/dashboard");
    },
  });

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">Configurez votre entreprise</h1>
          <p className="mt-1 text-sm text-zinc-500">Quelques informations pour démarrer sur KORVA OS.</p>
          <p className="mt-1 text-sm font-medium text-text">
            Les {SIGNUP_TRIAL.days} premiers jours, toutes les fonctions de la formule{" "}
            {PLAN_NAMES[SIGNUP_TRIAL.plan]} sont offertes, sans carte bancaire.
          </p>
        </div>

        <Card className="space-y-2 p-4">
          <p className="text-sm font-medium">Importer mon entreprise (optionnel)</p>
          <p className="text-xs text-zinc-500">
            Vous avez déjà un site web ? Collez son adresse pour préremplir le nom, le slogan et
            le logo ci-dessous — tout reste modifiable avant de valider.
          </p>
          <div className="flex gap-2">
            <Input
              type="url"
              placeholder="https://mon-entreprise.com"
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
              {importMutation.isPending ? "Analyse..." : "Analyser"}
            </Button>
          </div>
          {importMutation.isError && (
            <p className="text-xs text-red-600">
              {importMutation.error instanceof ApiError
                ? importMutation.error.message
                : "Impossible d'analyser ce site."}
            </p>
          )}
          {imported && (
            <p className="text-xs text-green-700">
              Informations importées — vérifiez-les ci-dessous avant de continuer.
            </p>
          )}
        </Card>

        <form className="space-y-4" onSubmit={handleSubmit((data) => mutation.mutate(data))}>
          <div>
            <label className="block text-sm font-medium" htmlFor="name">
              Nom de l&apos;entreprise
            </label>
            <Input id="name" className="mt-1 w-full" {...register("name")} />
            {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
          </div>

          <div>
            <p className="block text-sm font-medium">Quel est votre secteur ?</p>
            <p className="mt-1 text-xs text-zinc-500">
              Optionnel — préremplit le secteur et les modules suggérés ci-dessous, modifiables
              librement.
            </p>
            <Input
              type="search"
              placeholder="Rechercher un secteur (ex: restaurant, artisanat, immobilier...)"
              value={verticalFilter}
              onChange={(event) => setVerticalFilter(event.target.value)}
              className="mt-2 w-full"
            />
            {filteredVerticals.length === 0 && (
              <p className="mt-2 text-xs text-zinc-500">Aucun secteur ne correspond à cette recherche.</p>
            )}
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {filteredVerticals.map((template) => (
                <button
                  key={template.key}
                  type="button"
                  onClick={() => applyVerticalTemplate(template.key)}
                  className="text-left"
                >
                  <Card
                    className={`p-3 transition-colors hover:bg-zinc-50 ${
                      selectedVertical === template.key ? "border-zinc-900" : ""
                    }`}
                  >
                    <p className="text-sm font-medium">{template.label}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">{template.description}</p>
                  </Card>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium" htmlFor="type">
              Secteur d&apos;activité
            </label>
            <Input
              id="type"
              placeholder="ex: commerce, service, réservation..."
              className="mt-1 w-full"
              {...register("type")}
            />
            {errors.type && <p className="mt-1 text-xs text-red-600">{errors.type.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium" htmlFor="business-model">
              Type d&apos;activité
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
                Choisir votre type d&apos;activité
              </option>
              {BUSINESS_MODELS.map((model) => (
                <option key={model} value={model}>
                  {BUSINESS_MODEL_DEFINITIONS[model].label} —{" "}
                  {BUSINESS_MODEL_DEFINITIONS[model].description}
                </option>
              ))}
            </Select>
            {businessModel ? (
              <p className="mt-1 text-xs text-zinc-500">
                Votre site : {BUSINESS_MODEL_DEFINITIONS[businessModel].siteKind}.
              </p>
            ) : null}
            {errors.businessModel && (
              <p className="mt-1 text-xs text-red-600">{errors.businessModel.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium" htmlFor="business-description">
              Décrivez vos produits ou services (optionnel)
            </label>
            <p className="mt-1 text-xs text-zinc-500">
              Utilisé pour préremplir le slogan et le texte &quot;À propos&quot; de votre page
              publique — tout reste modifiable ensuite dans Réglages.
            </p>
            <textarea
              id="business-description"
              className="mt-2 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
              rows={3}
              maxLength={2000}
              placeholder="ex: Nous proposons des coupes, colorations et soins capillaires bio à Paris."
              {...register("businessDescription", {
                setValueAs: (v: string) => (v === "" ? undefined : v),
              })}
            />
            {errors.businessDescription && (
              <p className="mt-1 text-xs text-red-600">{errors.businessDescription.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium" htmlFor="country">
                Pays
              </label>
              <select
                id="country"
                className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
                {...countryField}
                onChange={(event) => {
                  void countryField.onChange(event);
                  const currency = currencyForCountry(event.target.value);
                  setValue("currency", currency);
                  setBillingCurrency(currency);
                }}
              >
                {COUNTRIES.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <p className="block text-sm font-medium">Devise de facturation</p>
              {/* Derived from the country, never chosen separately. This was an independent
                  five-currency dropdown defaulting to EUR, so a merchant in Morocco was billed
                  in euros unless they spotted it — and a Subscription is bound for good to the
                  currency it was sold in (see the unique index note in plan.schema.ts), so that
                  default could not be undone for that subscription afterwards. Registered as a
                  hidden field so react-hook-form still tracks and submits it. */}
              <p className="mt-1 rounded-md border border-dashed border-border-input px-3 py-2 text-sm text-text-muted">
                {billingCurrency}
                <span className="ml-2 text-xs">selon votre pays</span>
              </p>
              <input type="hidden" {...register("currency")} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium" htmlFor="timezone">
              Fuseau horaire
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
            <p className="block text-sm font-medium">Que souhaitez-vous gérer ?</p>
            <p className="mt-1 text-xs text-zinc-500">
              En formule Gratuite, choisissez un seul mode de vente : réservations ou commandes.
              Les deux ensemble sont inclus à partir de la formule Starter.
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
                      {MODULE_LABELS[module]}
                    </label>
                  ))}
                </div>
              )}
            />
            {/* Names the tiers from MODULE_MIN_PLAN rather than hardcoding which module sits
                where: this sentence was already wrong once, claiming automations were a paid
                feature after `workflow` moved to the free plan. */}
            <p className="mt-1 text-xs text-text-muted">
              Vous pourrez en activer d&apos;autres plus tard. Les devis, factures et campagnes
              arrivent avec la formule {PLAN_NAMES[MODULE_MIN_PLAN.finance]} ; l&apos;assistant IA
              avec la formule {PLAN_NAMES[MODULE_MIN_PLAN.ai]}.
            </p>
          </div>

          {mutation.isError && (
            <p className="text-sm text-red-600">
              {mutation.error instanceof ApiError ? mutation.error.message : "Une erreur est survenue."}
            </p>
          )}

          <Button type="submit" loading={mutation.isPending} className="w-full">
            {mutation.isPending ? "Création..." : "Créer mon organisation"}
          </Button>
        </form>
      </div>
    </div>
  );
}
