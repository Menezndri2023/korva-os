"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Card } from "@korva/ui";
import { publicApiClient } from "@/lib/public-api-client";
import { useCustomerAuth } from "@/lib/use-customer-auth";
import type { Cohort, CohortStatus } from "@korva/types";
import { AccountShell } from "../account-shell";
import { intlLocale, useStorefrontLocale, useT } from "@/lib/storefront-locale";

const STATUS_LABELS: Record<CohortStatus, [string, string]> = {
  upcoming: ["À venir", "Upcoming"],
  active: ["En cours", "In progress"],
  completed: ["Terminée", "Completed"],
  cancelled: ["Annulée", "Cancelled"],
};

export default function LearningClient({ slug }: { slug: string }) {
  const locale = useStorefrontLocale();
  const t = useT();
  const router = useRouter();
  const { hydrated, isAuthenticated, authFetch } = useCustomerAuth(slug);

  useEffect(() => {
    if (hydrated && !isAuthenticated) {
      router.replace(`/${slug}/account/login`);
    }
  }, [hydrated, isAuthenticated, slug, router]);

  const cohortsQuery = useQuery({
    queryKey: ["customer-cohorts", slug],
    queryFn: () =>
      authFetch((token) =>
        publicApiClient.get<Cohort[]>(`/public/${slug}/account/cohorts`, token),
      ),
    enabled: hydrated && isAuthenticated,
  });

  return (
    <AccountShell slug={slug} title={t("Mes formations", "My courses")}>
      <Link href={`/${slug}/account`} className="text-sm text-text-muted hover:underline">
        {t("← Mon compte", "← My account")}
      </Link>

      {cohortsQuery.isLoading && (
        <Card className="p-6 text-center text-sm text-text-muted">{t("Chargement…", "Loading…")}</Card>
      )}

      {cohortsQuery.isSuccess && cohortsQuery.data.length === 0 && (
        <Card className="p-6 text-center text-sm text-text-muted">
          {t(
            "Vous n'êtes inscrit à aucune formation pour le moment.",
            "You are not enrolled in any course yet.",
          )}
        </Card>
      )}

      {cohortsQuery.isSuccess && cohortsQuery.data.length > 0 && (
        <div className="space-y-3">
          {cohortsQuery.data.map((cohort) => (
            <Link key={cohort.id} href={`/${slug}/account/learning/${cohort.id}`}>
              <Card className="flex items-center justify-between p-4 text-sm hover:bg-surface-muted">
                <div>
                  <p className="font-medium text-text">{cohort.name}</p>
                  <p className="text-text-muted">
                    {t("Début le", "Starts")}{" "}
                    {new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium" }).format(
                      new Date(cohort.startDate),
                    )}
                  </p>
                </div>
                <Badge variant={cohort.status === "cancelled" ? "destructive" : "default"}>
                  {t(...STATUS_LABELS[cohort.status])}
                </Badge>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </AccountShell>
  );
}
