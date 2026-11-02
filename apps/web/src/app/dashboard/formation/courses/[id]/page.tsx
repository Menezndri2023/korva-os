"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCohortSchema,
  createQuizSchema,
  scheduleCohortSessionSchema,
  type CreateCohortInput,
  type CreateQuizInput,
  type ScheduleCohortSessionInput,
} from "@korva/validation";
import type {
  Cohort,
  CohortSession,
  CohortStatus,
  Contact,
  Course,
  CourseStatus,
  Quiz,
  Resource,
} from "@korva/types";
import { COHORT_STATUSES } from "@korva/types";
import { Button, Card, Input } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { intlLocale, useDashboardLocale, useT } from "@/lib/dashboard-locale";

interface MemberOption {
  id: string;
  userId: { firstName?: string; lastName?: string; email: string };
}
function memberName(member: MemberOption): string {
  return (
    [member.userId.firstName, member.userId.lastName].filter(Boolean).join(" ") ||
    member.userId.email
  );
}

const COURSE_STATUS_LABELS: Record<CourseStatus, [string, string]> = {
  draft: ["Brouillon", "Draft"],
  published: ["Publié", "Published"],
  archived: ["Archivé", "Archived"],
};
const COHORT_STATUS_LABELS: Record<CohortStatus, [string, string]> = {
  upcoming: ["À venir", "Upcoming"],
  active: ["En cours", "In progress"],
  completed: ["Terminée", "Completed"],
  cancelled: ["Annulée", "Cancelled"],
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export default function CourseDetailPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const authReady = useAuthReady();
  const [showCohortForm, setShowCohortForm] = useState(false);
  const [showQuizForm, setShowQuizForm] = useState(false);
  const [schedulingCohortId, setSchedulingCohortId] = useState<string | null>(null);

  const courseQuery = useQuery({
    queryKey: ["courses", id],
    queryFn: () => apiClient.get<Course>(`/courses/${id}`),
    enabled: authReady,
  });
  const cohortsQuery = useQuery({
    queryKey: ["cohorts", "course", id],
    queryFn: () => apiClient.getList<Cohort>(`/cohorts?courseId=${id}`),
    enabled: authReady,
  });
  const quizzesQuery = useQuery({
    queryKey: ["quizzes", "course", id],
    queryFn: () => apiClient.get<Quiz[]>(`/quizzes?courseId=${id}`),
    enabled: authReady,
  });
  const { data: contacts } = useQuery({
    queryKey: ["contacts", ""],
    queryFn: () => apiClient.get<Contact[]>("/contacts"),
    enabled: authReady,
  });
  const { data: resources } = useQuery({
    queryKey: ["resources", ""],
    queryFn: () => apiClient.get<Resource[]>("/resources"),
    enabled: authReady,
  });
  const { data: members } = useQuery({
    queryKey: ["organizations", "me", "members"],
    queryFn: () => apiClient.get<MemberOption[]>("/organizations/me/members"),
    enabled: authReady,
  });

  function contactName(contactId: string): string {
    const contact = contacts?.find((c) => c.id === contactId);
    if (!contact) return "—";
    return (
      [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
      contact.company ||
      "—"
    );
  }
  function instructorName(membershipId?: string): string | null {
    if (!membershipId) return null;
    const member = members?.find((m) => m.id === membershipId);
    return member ? memberName(member) : null;
  }

  const statusMutation = useMutation({
    mutationFn: (status: CourseStatus) =>
      apiClient.patch(`/courses/${id}`, { status }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["courses", id] }),
  });

  const {
    register: registerCohort,
    handleSubmit: handleCohortSubmit,
    reset: resetCohortForm,
    formState: { errors: cohortErrors },
  } = useForm<CreateCohortInput>({
    resolver: zodResolver(createCohortSchema),
    defaultValues: { courseId: id, enrolledContactIds: [] },
  });
  const [selectedEnrollees, setSelectedEnrollees] = useState<Set<string>>(new Set());
  function toggleEnrollee(contactId: string) {
    setSelectedEnrollees((prev) => {
      const next = new Set(prev);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  }

  const createCohortMutation = useMutation({
    mutationFn: (input: CreateCohortInput) =>
      apiClient.post<Cohort>("/cohorts", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cohorts", "course", id] });
      resetCohortForm({ courseId: id, enrolledContactIds: [] });
      setSelectedEnrollees(new Set());
      setShowCohortForm(false);
    },
  });

  const {
    register: registerQuiz,
    control: quizControl,
    handleSubmit: handleQuizSubmit,
    reset: resetQuizForm,
    formState: { errors: quizErrors },
  } = useForm<CreateQuizInput>({
    resolver: zodResolver(createQuizSchema),
    defaultValues: {
      courseId: id,
      passingScorePercent: 60,
      questions: [{ text: "", options: ["", ""], correctOptionIndex: 0 }],
    },
  });
  const { fields: questionFields, append: appendQuestion, remove: removeQuestion } =
    useFieldArray({ control: quizControl, name: "questions" });

  const createQuizMutation = useMutation({
    mutationFn: (input: CreateQuizInput) => apiClient.post<Quiz>("/quizzes", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["quizzes", "course", id] });
      resetQuizForm({
        courseId: id,
        passingScorePercent: 60,
        questions: [{ text: "", options: ["", ""], correctOptionIndex: 0 }],
      });
      setShowQuizForm(false);
    },
  });

  if (courseQuery.isLoading) {
    return <p className="text-sm text-text-muted">{t("Chargement...", "Loading...")}</p>;
  }
  if (courseQuery.isError || !courseQuery.data) {
    return (
      <Card className="p-6">
        <p className="text-sm text-destructive">
          {errorMessage(courseQuery.error, t(
            "Impossible de charger ce programme.",
            "This programme could not be loaded.",
          ))}
        </p>
      </Card>
    );
  }
  const course = courseQuery.data;

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">{course.name}</h1>
            {course.description && (
              <p className="mt-1 text-sm text-text-muted">{course.description}</p>
            )}
          </div>
          <select
            className="rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            value={course.status}
            onChange={(e) => statusMutation.mutate(e.target.value as CourseStatus)}
          >
            {(["draft", "published", "archived"] as const).map((status) => (
              <option key={status} value={status}>
                {t(...COURSE_STATUS_LABELS[status])}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-4">
          <p className="text-sm font-medium text-text">{t("Modules", "Modules")}</p>
          <ol className="mt-2 space-y-1 text-sm text-text-muted">
            {course.modules.map((m, index) => (
              <li key={index}>
                {index}. {m.title}
                {m.durationMinutes && ` (${m.durationMinutes} min)`}
                {instructorName(m.instructorMembershipId) &&
                  ` — ${instructorName(m.instructorMembershipId)}`}
              </li>
            ))}
          </ol>
        </div>
      </Card>

      <div>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{t("Promotions", "Cohorts")}</h2>
          <Button size="sm" onClick={() => setShowCohortForm((v) => !v)}>
            {showCohortForm ? t("Annuler", "Cancel") : t("Nouvelle promotion", "New cohort")}
          </Button>
        </div>

        {showCohortForm && (
          <form
            onSubmit={handleCohortSubmit((values) =>
              createCohortMutation.mutate({
                ...values,
                enrolledContactIds: [...selectedEnrollees],
              }),
            )}
            className="mt-3 space-y-3 rounded-lg border border-border bg-surface p-4"
          >
            <Input placeholder={t("Nom de la promotion", "Cohort name")} {...registerCohort("name")} />
            {cohortErrors.name && (
              <p className="text-xs text-destructive">{cohortErrors.name.message}</p>
            )}
            <Input type="date" aria-label={t("Date de début", "Start date")} {...registerCohort("startDate", {
              setValueAs: (value: string) => (value ? new Date(value).toISOString() : value),
            })} />

            <div>
              <p className="text-sm font-medium text-text">{t("Apprenants inscrits", "Enrolled learners")}</p>
              <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                {contacts?.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedEnrollees.has(c.id)}
                      onChange={() => toggleEnrollee(c.id)}
                    />
                    {[c.firstName, c.lastName].filter(Boolean).join(" ") || c.company || c.email}
                  </label>
                ))}
              </div>
            </div>

            {createCohortMutation.isError && (
              <p className="text-sm text-destructive">
                {errorMessage(createCohortMutation.error, t(
                  "Impossible de créer cette promotion.",
                  "This cohort could not be created.",
                ))}
              </p>
            )}
            <Button type="submit" loading={createCohortMutation.isPending}>
              {t("Créer la promotion", "Create the cohort")}
            </Button>
          </form>
        )}

        <div className="mt-3 space-y-3">
          {cohortsQuery.data?.data.length === 0 && (
            <Card className="p-4 text-center text-sm text-text-muted">{t("Aucune promotion.", "No cohorts.")}</Card>
          )}
          {cohortsQuery.data?.data.map((cohort) => (
            <CohortCard
              key={cohort.id}
              cohort={cohort}
              course={course}
              contactName={contactName}
              instructorName={instructorName}
              resources={resources}
              scheduling={schedulingCohortId === cohort.id}
              onToggleScheduling={() =>
                setSchedulingCohortId((prev) => (prev === cohort.id ? null : cohort.id))
              }
            />
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{t("Quiz", "Quiz")}</h2>
          <Button size="sm" onClick={() => setShowQuizForm((v) => !v)}>
            {showQuizForm ? t("Annuler", "Cancel") : t("Nouveau quiz", "New quiz")}
          </Button>
        </div>

        {showQuizForm && (
          <form
            onSubmit={handleQuizSubmit((values) => createQuizMutation.mutate(values))}
            className="mt-3 space-y-3 rounded-lg border border-border bg-surface p-4"
          >
            <Input placeholder={t("Titre du quiz", "Quiz title")} {...registerQuiz("title")} />
            {quizErrors.title && (
              <p className="text-xs text-destructive">{quizErrors.title.message}</p>
            )}

            <select
              className="w-full rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
              defaultValue=""
              {...registerQuiz("moduleIndex", {
                setValueAs: (v: string) => (v === "" ? undefined : Number(v)),
              })}
            >
              <option value="">{t(
                "Évaluation finale (tout le programme)",
                "Final assessment (whole programme)",
              )}</option>
              {course.modules.map((m, index) => (
                <option key={index} value={index}>
                  Module {index} — {m.title}
                </option>
              ))}
            </select>

            <Input
              type="number"
              min={0}
              max={100}
              aria-label={t("Score de réussite (%)", "Pass mark (%)")}
              {...registerQuiz("passingScorePercent", { valueAsNumber: true })}
            />

            <div className="space-y-3">
              {questionFields.map((field, qIndex) => (
                <div key={field.id} className="space-y-2 rounded-md border border-border p-3">
                  <Input
                    placeholder={t("Question", "Question")}
                    {...registerQuiz(`questions.${qIndex}.text`)}
                  />
                  {[0, 1].map((optIndex) => (
                    <Input
                      key={optIndex}
                      placeholder={`Option ${optIndex + 1}`}
                      {...registerQuiz(`questions.${qIndex}.options.${optIndex}`)}
                    />
                  ))}
                  <label className="flex items-center gap-2 text-xs text-text-muted">
                    {t("Bonne réponse (index) :", "Correct answer (index):")}
                    <input
                      type="number"
                      min={0}
                      className="w-16 rounded-md border border-border-input px-2 py-1"
                      {...registerQuiz(`questions.${qIndex}.correctOptionIndex`, {
                        valueAsNumber: true,
                      })}
                    />
                  </label>
                  {questionFields.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeQuestion(qIndex)}
                      className="text-xs text-destructive hover:underline"
                    >
                      {t("Retirer cette question", "Remove this question")}
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  appendQuestion({ text: "", options: ["", ""], correctOptionIndex: 0 })
                }
                className="text-sm text-text underline"
              >
                {t("+ Ajouter une question", "+ Add a question")}
              </button>
            </div>

            {createQuizMutation.isError && (
              <p className="text-sm text-destructive">
                {errorMessage(createQuizMutation.error, t(
                  "Impossible de créer ce quiz.",
                  "This quiz could not be created.",
                ))}
              </p>
            )}
            <Button type="submit" loading={createQuizMutation.isPending}>
              {t("Créer le quiz", "Create the quiz")}
            </Button>
          </form>
        )}

        <div className="mt-3 space-y-2">
          {quizzesQuery.data?.length === 0 && (
            <Card className="p-4 text-center text-sm text-text-muted">{t("Aucun quiz.", "No quizzes.")}</Card>
          )}
          {quizzesQuery.data?.map((quiz) => (
            <Card key={quiz.id} className="p-3 text-sm">
              <p className="font-medium text-text">{quiz.title}</p>
              <p className="text-xs text-text-muted">
                {t(
                  `${quiz.questions.length} question(s) — seuil de réussite ${quiz.passingScorePercent}%`,
                  `${quiz.questions.length} question(s) — pass mark ${quiz.passingScorePercent}%`,
                )}
              </p>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

function CohortCard({
  cohort,
  course,
  contactName,
  instructorName,
  resources,
  scheduling,
  onToggleScheduling,
}: {
  cohort: Cohort;
  course: Course;
  contactName: (id: string) => string;
  instructorName: (membershipId?: string) => string | null;
  resources: Resource[] | undefined;
  scheduling: boolean;
  onToggleScheduling: () => void;
}) {
  const locale = useDashboardLocale();
  const t = useT();
  const queryClient = useQueryClient();
  const authReady = useAuthReady();

  const sessionsQuery = useQuery({
    queryKey: ["cohorts", cohort.id, "sessions"],
    queryFn: () => apiClient.get<CohortSession[]>(`/cohorts/${cohort.id}/sessions`),
    enabled: authReady,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ScheduleCohortSessionInput>({
    resolver: zodResolver(scheduleCohortSessionSchema),
    defaultValues: { moduleIndex: 0 },
  });

  const scheduleMutation = useMutation({
    mutationFn: (input: ScheduleCohortSessionInput) =>
      apiClient.post<CohortSession>(`/cohorts/${cohort.id}/sessions`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cohorts", cohort.id, "sessions"] });
      reset({ moduleIndex: 0 });
    },
  });

  const scheduledModuleIndexes = new Set(
    sessionsQuery.data?.map((s) => s.moduleIndex) ?? [],
  );

  const statusMutation = useMutation({
    mutationFn: (status: CohortStatus) =>
      apiClient.patch(`/cohorts/${cohort.id}`, { status }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["cohorts", "course", course.id] }),
  });

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium text-text">{cohort.name}</p>
          <p className="text-xs text-text-muted">
            {t(`${cohort.enrolledContactIds.length} apprenant(s)`, `${cohort.enrolledContactIds.length} learner(s)`)} —{" "}
            {new Date(cohort.startDate).toLocaleDateString(intlLocale(locale))}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="rounded-md border border-border-input px-2 py-1 text-xs focus:border-focus focus:outline-none"
            value={cohort.status}
            onChange={(e) => statusMutation.mutate(e.target.value as CohortStatus)}
          >
            {COHORT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(...COHORT_STATUS_LABELS[status])}
              </option>
            ))}
          </select>
          <Button size="sm" variant="secondary" onClick={onToggleScheduling}>
            {scheduling ? t("Fermer", "Close") : t("Planifier une session", "Schedule a session")}
          </Button>
        </div>
      </div>

      <p className="mt-2 text-xs text-text-muted">
        {cohort.enrolledContactIds.map(contactName).join(", ") || t("Aucun apprenant", "No learners")}
      </p>

      {sessionsQuery.data && sessionsQuery.data.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-text-muted">
          {sessionsQuery.data.map((session) => (
            <li key={session.id}>
              {t("Module", "Module")} {session.moduleIndex} —{" "}
              {new Date(session.startAt).toLocaleString(intlLocale(locale))} (
              {t(`${session.bookingIds.length} inscrit(s)`, `${session.bookingIds.length} enrolled`)})
              {instructorName(session.instructorMembershipId) &&
                ` — ${instructorName(session.instructorMembershipId)}`}
            </li>
          ))}
        </ul>
      )}

      {scheduling && (
        <form
          onSubmit={handleSubmit((values) => scheduleMutation.mutate(values))}
          className="mt-3 grid grid-cols-2 gap-2 rounded-md border border-border p-3"
        >
          <select
            className="col-span-2 rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            {...register("moduleIndex", { valueAsNumber: true })}
          >
            {course.modules.map((m, index) => (
              <option key={index} value={index} disabled={scheduledModuleIndexes.has(index)}>
                Module {index} — {m.title}
                {scheduledModuleIndexes.has(index) ? t("(déjà planifié)", "(already scheduled)") : ""}
              </option>
            ))}
          </select>

          <select
            className="col-span-2 rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            defaultValue=""
            {...register("resourceId")}
          >
            <option value="" disabled>
              {t("Salle...", "Room...")}
            </option>
            {resources?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          {errors.resourceId && (
            <p className="col-span-2 text-xs text-destructive">{errors.resourceId.message}</p>
          )}

          <Input
            type="datetime-local"
            aria-label={t("Début", "Start")}
            {...register("startAt", {
              setValueAs: (v: string) => (v ? new Date(v).toISOString() : v),
            })}
          />
          <Input
            type="datetime-local"
            aria-label={t("Fin", "End")}
            {...register("endAt", {
              setValueAs: (v: string) => (v ? new Date(v).toISOString() : v),
            })}
          />

          {scheduleMutation.isError && (
            <p className="col-span-2 text-xs text-destructive">
              {errorMessage(scheduleMutation.error, t(
                "Impossible de planifier cette session.",
                "This session could not be scheduled.",
              ))}
            </p>
          )}
          <Button type="submit" size="sm" loading={scheduleMutation.isPending} className="col-span-2">
            {t("Planifier", "Schedule")}
          </Button>
        </form>
      )}
    </Card>
  );
}
