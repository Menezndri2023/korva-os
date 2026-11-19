"use client";

import { useEffect } from "react";
import { reportClientError } from "@korva/ui";
import "./globals.css";

/**
 * Last resort: the root layout itself crashed, so this replaces it — its own <html> and <body>,
 * and no provider, so the business's language is unknown and the page says it in both.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
    reportClientError(
      `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1"}/client-errors`,
      "storefront",
      error,
    );
  }, [error]);

  return (
    <html lang="fr">
      <body className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center font-sans">
        <h1 className="text-lg font-semibold text-zinc-900">Une erreur est survenue</h1>
        <p className="text-sm text-zinc-500" lang="en">Something went wrong</p>
        <button
          type="button"
          onClick={() => retry()}
          className="mt-2 rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white"
        >
          Réessayer · <span lang="en">Try again</span>
        </button>
      </body>
    </html>
  );
}
