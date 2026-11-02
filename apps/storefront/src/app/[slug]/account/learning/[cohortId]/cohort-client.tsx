"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@korva/ui";
import { publicApiClient } from "@/lib/public-api-client";
import { useCustomerAuth } from "@/lib/use-customer-auth";
import type { Cohort, PublicQuiz } from "@korva/types";
import { AccountShell } from "../../account-shell";
import { useT } from "@/lib/storefront-locale";

export default function CohortClient({ slug, cohortId }: { slug: string; cohortId: string }) {
  const t = useT();
  const router = useRouter();
  const { hydrated, isAuthenticated, authFetch } = useCustomerAuth(slug);

  useEffect(() => {
    if (hydrated && !isAuthenticated) {
      router.replace(`/${slug}/account/login`);
    }
  }, [hydrated, isAuthenticated, slug, router]);

  const cohortQuery = useQuery({
    queryKey: ["customer-cohort", slug, cohortId],
    queryFn: () =>
      authFetch((token) =>
        publicApiClient.get<Cohort>(`/public/${slug}/account/cohorts/${cohortId}`, token),
      ),
    enabled: hydrated && isAuthenticated,
  });

  const quizzesQuery = useQuery({
    queryKey: ["customer-cohort-quizzes", slug, cohortId],
    queryFn: () =>
      authFetch((token) =>
        publicApiClient.get<PublicQuiz[]>(
          `/public/${slug}/account/cohorts/${cohortId}/quizzes`,
          token,
        ),
      ),
    enabled: hydrated && isAuthenticated,
  });

  return (
    <AccountShell slug={slug} title={cohortQuery.data?.name ?? t("Formation", "Course")}>
      <Link href={`/${slug}/account/learning`} className="text-sm text-text-muted hover:underline">
        {t("← Mes formations", "← My courses")}
      </Link>

      {(cohortQuery.isLoading || quizzesQuery.isLoading) && (
        <Card className="p-6 text-center text-sm text-text-muted">{t("Chargement…", "Loading…")}</Card>
      )}

      {quizzesQuery.isSuccess && quizzesQuery.data.length === 0 && (
        <Card className="p-6 text-center text-sm text-text-muted">
          {t("Aucun quiz disponible pour le moment.", "No quizzes available yet.")}
        </Card>
      )}

      {quizzesQuery.isSuccess && quizzesQuery.data.length > 0 && (
        <div className="space-y-3">
          {quizzesQuery.data.map((quiz) => (
            <Link
              key={quiz.id}
              href={`/${slug}/account/learning/${cohortId}/quizzes/${quiz.id}`}
            >
              <Card className="p-4 text-sm hover:bg-surface-muted">
                <p className="font-medium text-text">{quiz.title}</p>
                <p className="text-text-muted">
                  {t(
                    `${quiz.questions.length} question(s) — seuil de réussite ${quiz.passingScorePercent}%`,
                    `${quiz.questions.length} question(s) — pass mark ${quiz.passingScorePercent}%`,
                  )}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </AccountShell>
  );
}
