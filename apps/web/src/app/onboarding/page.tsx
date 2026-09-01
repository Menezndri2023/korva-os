"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import {
  createOrganizationSchema,
  type CreateOrganizationInput,
  type ImportOrganizationPreviewInput,
} from "@korva/validation";
import {
  KORVA_MODULES,
  VERTICAL_TEMPLATES,
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
};

const COUNTRIES = [
  { code: "FR", label: "France" },
  { code: "CI", label: "Côte d'Ivoire" },
  { code: "SN", label: "Sénégal" },
  { code: "MA", label: "Maroc" },
  { code: "BE", label: "Belgique" },
  { code: "CA", label: "Canada" },
];

const CURRENCIES = ["EUR", "XOF", "MAD", "USD", "CAD"];

// createOrganizationSchema (packages/validation/src/organization.ts) already requires and
// accepts `timezone: z.string().min(1)` — the payload below was already sending it, just
// silently defaulted to the browser's own resolved zone and never exposed as an editable
// field (Wave 2 audit finding). Intl.supportedValuesOf("timeZone") gives the full real IANA
// list without hardcoding one, and is available in every runtime this app targets (Node >=22.6
// per the repo's engines field, and all evergreen browsers).
const TIMEZONES = Intl.supportedValuesOf("timeZone");

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

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<CreateOrganizationInput>({
    resolver: zodResolver(createOrganizationSchema),
    defaultValues: {
      country: "FR",
      currency: "EUR",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      language: "fr",
    },
  });

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
    enabledModulesControl.setValue("modules", template.suggestedModules);
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
      // covers — sending it explicitly would just get rejected outright since every new
      // organization starts on the free plan (see @korva/types storefront-themes.ts minPlan).
      if (modules.length > 0 || Object.keys(brandingUpdate).length > 0) {
        await apiClient.patch<Organization>("/organizations/me", {
          ...(modules.length > 0 ? { enabledModules: modules } : {}),
          ...brandingUpdate,
        });
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium" htmlFor="country">
                Pays
              </label>
              <select
                id="country"
                className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
                {...register("country")}
              >
                {COUNTRIES.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium" htmlFor="currency">
                Devise
              </label>
              <select
                id="currency"
                className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
                {...register("currency")}
              >
                {CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
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
            <Controller
              control={enabledModulesControl.control}
              name="modules"
              render={({ field }) => (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {KORVA_MODULES.map((module) => (
                    <label key={module} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={field.value.includes(module)}
                        onChange={(event) => {
                          field.onChange(
                            event.target.checked
                              ? [...field.value, module]
                              : field.value.filter((m) => m !== module),
                          );
                        }}
                      />
                      {MODULE_LABELS[module]}
                    </label>
                  ))}
                </div>
              )}
            />
            <p className="mt-1 text-xs text-zinc-500">Vous pourrez activer d&apos;autres modules plus tard.</p>
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
