"use client";

import { useEffect } from "react";
import { Button } from "@korva/ui";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-2xl font-semibold">Une erreur est survenue</h1>
        <p className="text-sm text-text-muted">
          Quelque chose s&apos;est mal passé. Vous pouvez réessayer.
        </p>
        <Button onClick={() => reset()}>Réessayer</Button>
      </div>
    </div>
  );
}
