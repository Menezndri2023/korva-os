"use client";

import { useEffect } from "react";
import { Button, Card } from "@korva/ui";
import { useT } from "@/lib/dashboard-locale";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Card className="p-6 text-center">
      <h1 className="text-lg font-semibold">{t("Une erreur est survenue", "Something went wrong")}</h1>
      <p className="mt-1 text-sm text-text-muted">
        {t(
          "Quelque chose s'est mal passé sur cette page. Vous pouvez réessayer.",
          "Something went wrong on this page. You can try again.",
        )}
      </p>
      <Button className="mt-3" onClick={() => reset()}>
        {t("Réessayer", "Try again")}
      </Button>
    </Card>
  );
}
