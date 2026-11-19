"use client";

import { useEffect } from "react";
import { reportClientError } from "@korva/ui";
import "./globals.css";

/**
 * Last resort: the root layout itself crashed, so this replaces it — its own <html> and <body>,
 * and no provider, so the visitor's language is unknown and the page says it in both.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
    reportClientError(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1"}/client-errors`, "web", error);
  }, [error]);

  return (
    <html lang="fr">
      <body className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-4 text-center text-text">
        <h1 className="text-2xl font-semibold">Une erreur est survenue</h1>
        <p className="text-sm text-text-muted" lang="en">Something went wrong</p>
        <button
          type="button"
          onClick={() => retry()}
          className="mt-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-on-primary"
        >
          Réessayer · <span lang="en">Try again</span>
        </button>
      </body>
    </html>
  );
}
