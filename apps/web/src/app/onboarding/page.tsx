"use client";

import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { createOrganizationSchema, type CreateOrganizationInput } from "@korva/validation";
import { KORVA_MODULES, type KorvaModule, type Organization } from "@korva/types";
import { Button, Input } from "@korva/ui";
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

export default function OnboardingPage() {
  const router = useRouter();
  const setActiveOrganization = useAuthStore((state) => state.setActiveOrganization);

  const {
    register,
    handleSubmit,
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

  const mutation = useMutation({
    mutationFn: async (data: CreateOrganizationInput) => {
      const organization = await apiClient.post<Organization>("/organizations", data, { withOrganization: false });
      const modules = enabledModulesControl.getValues("modules");
      if (modules.length > 0) {
        setActiveOrganization(organization.id);
        await apiClient.patch<Organization>("/organizations/me", { enabledModules: modules });
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

        <form className="space-y-4" onSubmit={handleSubmit((data) => mutation.mutate(data))}>
          <div>
            <label className="block text-sm font-medium" htmlFor="name">
              Nom de l&apos;entreprise
            </label>
            <Input id="name" className="mt-1 w-full" {...register("name")} />
            {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
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
