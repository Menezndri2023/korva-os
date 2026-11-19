"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { reportClientError } from "@korva/ui";
import { useT } from "@/lib/storefront-locale";

/**
 * A page of a business's site crashed while rendering. Without this file the customer got a
 * blank page; here they get a sentence in the site's language (the [slug] layout's provider is
 * still mounted), a retry, and the way back to the shop's home — and the crash reaches Sentry
 * through POST /client-errors, which window.onerror never sees for a caught render error.
 */
export default function SiteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useT();
  const params = useParams<{ slug?: string }>();
  useEffect(() => {
    console.error(error);
    reportClientError(
      `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1"}/client-errors`,
      "storefront",
      error,
    );
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-lg font-semibold text-zinc-900">{t("Une erreur est survenue", "Something went wrong")}</h1>
      <p className="max-w-sm text-sm text-zinc-600">
        {t(
          "Cette page n'a pas pu s'afficher. Réessayez dans un instant ; votre panier et vos réservations ne sont pas perdus.",
          "This page could not be displayed. Try again in a moment; your cart and bookings are not lost.",
        )}
      </p>
      <div className="mt-2 flex items-center gap-4">
        <button
          type="button"
          onClick={() => retry()}
          className="rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white"
        >
          {t("Réessayer", "Try again")}
        </button>
        {params.slug && (
          <Link href={`/${params.slug}`} className="text-sm font-medium text-zinc-900 underline">
            {t("Retour à l'accueil du site", "Back to the site's home")}
          </Link>
        )}
      </div>
    </main>
  );
}
