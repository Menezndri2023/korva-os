"use client";

import { useEffect } from "react";
import { Button, Card } from "@korva/ui";

export default function DashboardError({
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
    <Card className="p-6 text-center">
      <h1 className="text-lg font-semibold">Une erreur est survenue</h1>
      <p className="mt-1 text-sm text-text-muted">
        Quelque chose s&apos;est mal passé sur cette page. Vous pouvez réessayer.
      </p>
      <Button className="mt-3" onClick={() => reset()}>
        Réessayer
      </Button>
    </Card>
  );
}
