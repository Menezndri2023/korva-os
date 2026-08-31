"use client";

import Link from "next/link";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createCourseSchema, type CreateCourseInput } from "@korva/validation";
import type { Course, CourseStatus, Offer } from "@korva/types";
import { Badge, Button, Card, Input, Pagination } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";

const STATUS_LABELS: Record<CourseStatus, string> = {
  draft: "Brouillon",
  published: "Publié",
  archived: "Archivé",
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export default function CoursesPage() {
  const [showForm, setShowForm] = useState(false);
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const authReady = useAuthReady();

  const {
    data: coursesPage,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["courses", page],
    queryFn: () => apiClient.getList<Course>(`/courses?page=${page}`),
    enabled: authReady,
  });
  const courses = coursesPage?.data;

  const { data: offers } = useQuery({
    queryKey: ["offers", ""],
    queryFn: () => apiClient.get<Offer[]>("/offers"),
    enabled: authReady,
  });

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateCourseInput>({
    resolver: zodResolver(createCourseSchema),
    defaultValues: { modules: [] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "modules" });

  const createMutation = useMutation({
    mutationFn: (input: CreateCourseInput) =>
      apiClient.post<Course>("/courses", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["courses"] });
      reset({ modules: [] });
      setShowForm(false);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Formations</h1>
          <p className="mt-1 text-sm text-text-muted">
            Programmes de formation — modules, promotions et sessions planifiées.
          </p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Annuler" : "Nouveau programme"}
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit((values) => createMutation.mutate(values))}
          className="space-y-3 rounded-lg border border-border bg-surface p-4"
        >
          <Input placeholder="Nom du programme" {...register("name")} />
          {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}

          <select
            className="w-full rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            defaultValue=""
            {...register("offerId")}
          >
            <option value="" disabled>
              Offre associée (session facturable)...
            </option>
            {offers?.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.pricing.amount} {o.pricing.currency})
              </option>
            ))}
          </select>
          {errors.offerId && (
            <p className="text-xs text-destructive">{errors.offerId.message}</p>
          )}

          <div className="space-y-2">
            <p className="text-sm font-medium text-text">Modules</p>
            {fields.map((field, index) => (
              <div key={field.id} className="flex gap-2">
                <Input
                  placeholder={`Module ${index + 1}`}
                  {...register(`modules.${index}.title`)}
                  className="flex-1"
                />
                <button
                  type="button"
                  onClick={() => remove(index)}
                  className="text-xs text-destructive hover:underline"
                >
                  Retirer
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => append({ title: "" })}
              className="text-sm text-text underline"
            >
              + Ajouter un module
            </button>
          </div>

          {createMutation.isError && (
            <p className="text-sm text-destructive">
              {errorMessage(createMutation.error, "Impossible de créer ce programme.")}
            </p>
          )}
          <Button type="submit" loading={createMutation.isPending}>
            {createMutation.isPending ? "Création..." : "Créer le programme"}
          </Button>
        </form>
      )}

      {isError && (
        <Card className="p-6">
          <p className="text-sm text-destructive">Impossible de charger les programmes.</p>
          <button onClick={() => refetch()} className="mt-2 text-sm font-medium text-text underline">
            Réessayer
          </button>
        </Card>
      )}

      {!isError && (
        <div className="grid gap-3 sm:grid-cols-2">
          {isLoading && <p className="text-sm text-text-muted">Chargement...</p>}
          {!isLoading && courses?.length === 0 && (
            <Card className="p-6 text-center text-sm text-text-muted sm:col-span-2">
              Aucun programme.
            </Card>
          )}
          {courses?.map((course) => (
            <Link key={course.id} href={`/dashboard/formation/courses/${course.id}`}>
              <Card className="p-4 hover:bg-surface-muted">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-text">{course.name}</p>
                  <Badge variant={course.status === "published" ? "success" : "default"}>
                    {STATUS_LABELS[course.status]}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-text-muted">
                  {course.modules.length} module(s)
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Pagination
        page={page}
        totalPages={coursesPage?.pagination.totalPages ?? 1}
        onPageChange={setPage}
        disabled={isLoading}
      />
    </div>
  );
}
