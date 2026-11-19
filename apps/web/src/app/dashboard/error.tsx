"use client";

import { useEffect } from "react";
import { Button, Card, reportClientError } from "@korva/ui";
import { useT } from "@/lib/dashboard-locale";

export default function DashboardError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const t = useT();
  useEffect(() => {
    console.error(error);
    // Rendering crashes are caught here before window.onerror could see them.
    reportClientError(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1"}/client-errors`, "web", error);
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
      <Button className="mt-3" onClick={() => retry()}>
        {t("Réessayer", "Try again")}
      </Button>
    </Card>
  );
}
