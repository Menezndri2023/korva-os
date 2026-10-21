"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, MessageCircle } from "lucide-react";
import {
  BUSINESS_MODEL_DEFINITIONS,
  VERTICAL_TEMPLATES,
  type Offer,
  type OfferType,
  type Organization,
} from "@korva/types";
import { updateOrganizationSchema } from "@korva/validation";
import { Button, Card, Input } from "@korva/ui";
import { OfferImagesEditor } from "@/components/offer-images-editor";
import { ApiError, apiClient } from "@/lib/api-client";
import { useActiveOrganization } from "@/lib/use-active-organization";
import { STOREFRONT_URL } from "@/lib/storefront-url";

/**
 * The step right after the organization is created: put one offer online.
 *
 * Without it, signing up ended on an empty dashboard and an empty public site — the state the
 * first real customer (freeworld) stayed in, with one draft offer and a site showing nothing. An
 * owner who leaves onboarding with a live site and its link has something to share the same day.
 *
 * Deliberately three fields: a name (one tap on a suggestion from the trade), a price and a photo
 * taken with the phone. Everything else — description, variants, stock — waits in the catalogue.
 * The WhatsApp number is asked here too, because in the markets KORVA serves it is how a visitor
 * turns into a customer. "Plus tard" always leads to the dashboard: this step helps, never blocks.
 */
export default function FirstOfferPage() {
  const queryClient = useQueryClient();
  const { data: organization } = useActiveOrganization();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [whatsapp, setWhatsapp] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const model = organization?.businessModel
    ? BUSINESS_MODEL_DEFINITIONS[organization.businessModel]
    : undefined;
  const offerType: OfferType = model?.offerTypes[0] ?? "product";
  const vertical = VERTICAL_TEMPLATES.find((v) => v.suggestedType === organization?.type);
  const suggestions = (vertical?.suggestedOffers ?? []).slice(0, 6);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!organization) throw new Error("organization not loaded");
      if (whatsapp.trim()) {
        await apiClient.patch<Organization>("/organizations/me", { whatsappNumber: whatsapp.trim() });
      }
      return apiClient.post<Offer>("/offers", {
        type: suggestions.find((s) => s.name === name.trim())?.type ?? offerType,
        name: name.trim(),
        pricing: { amount: Number(price), currency: organization.currency },
        images,
        status: "active",
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["organizations"] });
      void queryClient.invalidateQueries({ queryKey: ["offers"] });
    },
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!name.trim()) return setFormError("Donnez un nom à votre offre.");
    const amount = Number(price);
    if (price.trim() === "" || !Number.isFinite(amount) || amount < 0) {
      return setFormError("Indiquez un prix (0 si c'est gratuit).");
    }
    if (whatsapp.trim()) {
      const check = updateOrganizationSchema.shape.whatsappNumber.safeParse(whatsapp.trim());
      if (!check.success) return setFormError(check.error.issues[0]?.message ?? "Numéro WhatsApp invalide.");
    }
    mutation.mutate();
  }

  if (mutation.isSuccess && organization) {
    return <SiteIsLive organization={organization} offerName={name.trim()} />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-app-background px-4 py-12">
      <div className="w-full max-w-lg space-y-6">
        <div>
          <p className="text-sm font-medium text-accent">Dernière étape</p>
          <h1 className="mt-1 text-2xl font-semibold">Mettez votre première offre en ligne</h1>
          <p className="mt-1 text-sm text-text-muted">
            Votre site s&apos;affiche dès qu&apos;il a une offre. Une suffit pour commencer : vous
            ajouterez le reste depuis le catalogue.
          </p>
        </div>

        <Card className="p-5">
          <form className="space-y-5" onSubmit={submit}>
            <div>
              <label htmlFor="offer-name" className="block text-sm font-medium">
                Que proposez-vous ?
              </label>
              {suggestions.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion.name}
                      type="button"
                      onClick={() => setName(suggestion.name)}
                      aria-pressed={name === suggestion.name}
                      className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                        name === suggestion.name
                          ? "border-primary bg-primary font-semibold text-on-primary"
                          : "border-border-input bg-surface hover:bg-surface-muted"
                      }`}
                    >
                      {suggestion.name}
                    </button>
                  ))}
                </div>
              )}
              <Input
                id="offer-name"
                className="mt-2 w-full"
                placeholder="ex: Coupe femme, Plat du jour, Robe en wax…"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>

            <div>
              <label htmlFor="offer-price" className="block text-sm font-medium">
                Prix ({organization?.currency ?? "…"})
              </label>
              <Input
                id="offer-price"
                className="mt-1 w-full"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
              />
            </div>

            <div>
              <p className="text-sm font-medium">Une photo (conseillé)</p>
              <p className="mb-2 text-xs text-text-muted">
                Sur téléphone, vous pouvez la prendre directement.
              </p>
              <OfferImagesEditor images={images} onChange={setImages} />
            </div>

            <div>
              <label htmlFor="whatsapp" className="block text-sm font-medium">
                Votre numéro WhatsApp (optionnel)
              </label>
              <Input
                id="whatsapp"
                className="mt-1 w-full"
                type="tel"
                placeholder="+225 07 07 07 07 07"
                value={whatsapp}
                onChange={(event) => setWhatsapp(event.target.value)}
              />
              <p className="mt-1 text-xs text-text-muted">
                Vos clients pourront vous écrire et commander sur WhatsApp depuis votre site.
              </p>
            </div>

            {(formError || mutation.isError) && (
              <p role="alert" className="text-sm text-destructive">
                {formError ??
                  (mutation.error instanceof ApiError
                    ? mutation.error.message
                    : "Une erreur est survenue, réessayez.")}
              </p>
            )}

            <Button type="submit" size="lg" className="w-full" loading={mutation.isPending}>
              Mettre en ligne
            </Button>
          </form>
        </Card>

        <p className="text-center text-sm">
          <Link href="/dashboard" className="text-text-muted underline-offset-2 hover:underline">
            Plus tard, aller au tableau de bord
          </Link>
        </p>
      </div>
    </div>
  );
}

function SiteIsLive({ organization, offerName }: { organization: Organization; offerName: string }) {
  const siteUrl = `${STOREFRONT_URL}/${organization.slug}`;
  const shareText = `Découvrez ${organization.name} en ligne : ${siteUrl}`;

  return (
    <div className="flex min-h-screen items-center justify-center bg-app-background px-4 py-12">
      <Card className="w-full max-w-lg space-y-5 p-6 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success-soft text-success">
          <Check aria-hidden className="h-7 w-7" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold">Votre site est en ligne</h1>
          <p className="mt-1 text-sm text-text-muted">
            « {offerName} » est visible par vos clients dès maintenant.
          </p>
        </div>
        <p className="break-all rounded-lg bg-surface-muted px-3 py-2 font-mono text-sm">{siteUrl}</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <a
            href={siteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 font-semibold text-on-primary hover:bg-primary-hover"
          >
            Voir mon site
          </a>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-border-input bg-surface px-5 py-2.5 font-medium hover:bg-surface-muted"
          >
            <MessageCircle aria-hidden className="h-5 w-5" />
            Partager sur WhatsApp
          </a>
        </div>
        <Link href="/dashboard" className="block text-sm text-text-muted underline-offset-2 hover:underline">
          Aller au tableau de bord
        </Link>
      </Card>
    </div>
  );
}
