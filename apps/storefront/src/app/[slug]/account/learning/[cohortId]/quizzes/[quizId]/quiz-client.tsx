"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Card } from "@korva/ui";
import { publicApiClient, PublicApiError } from "@/lib/public-api-client";
import { useCustomerAuth } from "@/lib/use-customer-auth";
import type { PublicQuiz, QuizAttempt } from "@korva/types";
import { AccountShell } from "../../../../account-shell";

interface QuizForCohort {
  quiz: PublicQuiz;
  attempts: QuizAttempt[];
}

export default function QuizClient({
  slug,
  cohortId,
  quizId,
}: {
  slug: string;
  cohortId: string;
  quizId: string;
}) {
  const router = useRouter();
  const { hydrated, isAuthenticated, authFetch } = useCustomerAuth(slug);
  const [answers, setAnswers] = useState<Record<number, number>>({});

  useEffect(() => {
    if (hydrated && !isAuthenticated) {
      router.replace(`/${slug}/account/login`);
    }
  }, [hydrated, isAuthenticated, slug, router]);

  const quizQuery = useQuery({
    queryKey: ["customer-quiz", slug, cohortId, quizId],
    queryFn: () =>
      authFetch((token) =>
        publicApiClient.get<QuizForCohort>(
          `/public/${slug}/account/cohorts/${cohortId}/quizzes/${quizId}`,
          token,
        ),
      ),
    enabled: hydrated && isAuthenticated,
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      authFetch((token) =>
        publicApiClient.post<QuizAttempt>(
          `/public/${slug}/account/quizzes/${quizId}/attempts`,
          { cohortId, answers: quizQuery.data!.quiz.questions.map((_, i) => answers[i]) },
          token,
        ),
      ),
  });

  if (quizQuery.isLoading) {
    return (
      <AccountShell slug={slug} title="Quiz">
        <Card className="p-6 text-center text-sm text-text-muted">Chargement…</Card>
      </AccountShell>
    );
  }

  if (!quizQuery.data) {
    return (
      <AccountShell slug={slug} title="Quiz">
        <Card className="p-6 text-center text-sm text-destructive">
          Impossible de charger ce quiz.
        </Card>
      </AccountShell>
    );
  }

  const { quiz, attempts } = quizQuery.data;
  const allAnswered = quiz.questions.every((_, i) => answers[i] !== undefined);

  return (
    <AccountShell slug={slug} title={quiz.title}>
      <Link
        href={`/${slug}/account/learning/${cohortId}`}
        className="text-sm text-text-muted hover:underline"
      >
        ← Retour
      </Link>

      {attempts.length > 0 && !submitMutation.isSuccess && (
        <Card className="p-4 text-sm">
          <p className="font-medium text-text">Vos tentatives précédentes</p>
          <ul className="mt-1 space-y-0.5 text-text-muted">
            {attempts.map((attempt, i) => (
              <li key={i}>
                {attempt.scorePercent}% — {attempt.passed ? "Réussi" : "Non réussi"}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {submitMutation.isSuccess ? (
        <Card className="p-6 text-center text-sm">
          <p className="text-2xl font-semibold text-text">
            {submitMutation.data.scorePercent}%
          </p>
          <p className="mt-1 text-text-muted">
            {submitMutation.data.passed ? "Quiz réussi !" : "Quiz non réussi."}
          </p>
        </Card>
      ) : (
        <Card className="space-y-4 p-4">
          {quiz.questions.map((question, qIndex) => (
            <fieldset key={qIndex} className="space-y-2">
              <legend className="text-sm font-medium text-text">
                {qIndex + 1}. {question.text}
              </legend>
              {question.options.map((option, optIndex) => (
                <label key={optIndex} className="flex items-center gap-2 text-sm text-text-muted">
                  <input
                    type="radio"
                    name={`question-${qIndex}`}
                    checked={answers[qIndex] === optIndex}
                    onChange={() => setAnswers((prev) => ({ ...prev, [qIndex]: optIndex }))}
                  />
                  {option}
                </label>
              ))}
            </fieldset>
          ))}

          {submitMutation.isError && (
            <p className="text-sm text-destructive">
              {submitMutation.error instanceof PublicApiError
                ? submitMutation.error.message
                : "Impossible d'envoyer vos réponses."}
            </p>
          )}

          <Button
            type="button"
            disabled={!allAnswered}
            loading={submitMutation.isPending}
            onClick={() => submitMutation.mutate()}
          >
            Envoyer mes réponses
          </Button>
        </Card>
      )}
    </AccountShell>
  );
}
