"use client";

import Link from "next/link";
import { Card } from "@korva/ui";
import { useT } from "@/lib/dashboard-locale";

export default function DashboardNotFound() {
  const t = useT();
  return (
    <Card className="p-6 text-center">
      <h1 className="text-lg font-semibold">{t("Page introuvable", "Page not found")}</h1>
      <p className="mt-1 text-sm text-text-muted">
        {t("Cette page n'existe pas ou a été déplacée.", "This page does not exist or has moved.")}
      </p>
      <Link
        href="/dashboard"
        className="mt-3 inline-block text-sm font-medium text-text underline"
      >
        {t("Retour au tableau de bord", "Back to the dashboard")}
      </Link>
    </Card>
  );
}
