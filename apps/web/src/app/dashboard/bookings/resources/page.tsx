"use client";

import Link from "next/link";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createResourceSchema, type CreateResourceInput } from "@korva/validation";
import type { Resource } from "@korva/types";
import { Button, Card, Input } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";

const DAY_LABELS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

export default function ResourcesPage() {
  const [showForm, setShowForm] = useState(false);
  const queryClient = useQueryClient();
  const authReady = useAuthReady();

  const { data: resources, isLoading } = useQuery({
    queryKey: ["resources"],
    queryFn: () => apiClient.get<Resource[]>("/resources"),
    enabled: authReady,
  });

  const { register, control, handleSubmit, reset } = useForm<CreateResourceInput>({
    resolver: zodResolver(createResourceSchema),
    defaultValues: { type: "room", capacity: 1, active: true, weeklyAvailability: [] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "weeklyAvailability" });

  const createMutation = useMutation({
    mutationFn: (input: CreateResourceInput) => apiClient.post<Resource>("/resources", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["resources"] });
      reset();
      setShowForm(false);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setShowForm((v) => !v)}>{showForm ? "Annuler" : "Nouvelle ressource"}</Button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit((values) => createMutation.mutate(values))}
          // Not migrated to <Card>: this wrapper is the <form> element itself (it carries
          // onSubmit), and Card renders a <div> — same exclusion documented on the other
          // migrated create-forms (dashboard/crm, dashboard/bookings).
          className="space-y-3 rounded-lg border border-border bg-surface p-4"
        >
          <div className="grid grid-cols-3 gap-2">
            <Input placeholder="Nom (ex: Salle 1)" className="col-span-2" {...register("name")} />
            <Input placeholder="Type (room, vehicle...)" {...register("type")} />
          </div>
          <Input type="number" placeholder="Capacité" className="w-32" {...register("capacity", { valueAsNumber: true })} />
          {/* setValueAs: optional + format-constrained (.url()) — an untouched field always
              submits "" (never undefined), which fails validation unless converted here; same
              pattern as dashboard/settings/page.tsx's brandColor/logo/heroImage fields. */}
          <Input
            placeholder="URL calendrier externe (ICS, optionnel)"
            {...register("externalCalendarUrl", {
              setValueAs: (v: string) => (v === "" ? undefined : v),
            })}
          />

          <div className="space-y-2">
            <p className="text-sm font-medium text-text">Horaires hebdomadaires</p>
            {fields.map((field, index) => (
              <div key={field.id} className="grid grid-cols-12 gap-2">
                <select
                  className="col-span-4 rounded-md border border-border-input px-2 py-1.5 text-sm focus:border-focus focus:outline-none"
                  {...register(`weeklyAvailability.${index}.dayOfWeek`, { valueAsNumber: true })}
                >
                  {DAY_LABELS.map((label, day) => (
                    <option key={day} value={day}>
                      {label}
                    </option>
                  ))}
                </select>
                <Input type="time" className="col-span-3" {...register(`weeklyAvailability.${index}.startTime`)} />
                <Input type="time" className="col-span-3" {...register(`weeklyAvailability.${index}.endTime`)} />
                <button
                  type="button"
                  onClick={() => remove(index)}
                  className="col-span-2 text-sm text-destructive hover:underline"
                >
                  Retirer
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => append({ dayOfWeek: 1, startTime: "09:00", endTime: "18:00" })}
              className="text-sm text-text-muted hover:underline"
            >
              + Ajouter un créneau
            </button>
          </div>

          {createMutation.isError && (
            <p className="text-sm text-destructive">
              {createMutation.error instanceof ApiError ? createMutation.error.message : "Erreur"}
            </p>
          )}
          <Button type="submit" loading={createMutation.isPending}>
            {createMutation.isPending ? "Création..." : "Créer la ressource"}
          </Button>
        </form>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium uppercase text-text-muted">
              <tr>
                <th className="px-4 py-2">Nom</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Capacité</th>
                <th className="px-4 py-2">Horaires</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-text-muted">
                    Chargement...
                  </td>
                </tr>
              )}
              {!isLoading && resources?.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-text-muted">
                    Aucune ressource.
                  </td>
                </tr>
              )}
              {resources?.map((resource) => (
                <tr key={resource.id}>
                  <td className="px-4 py-2 font-medium">
                    <Link
                      href={`/dashboard/bookings/resources/${resource.id}`}
                      className="text-text underline-offset-2 hover:underline"
                    >
                      {resource.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-text-muted">{resource.type}</td>
                  <td className="px-4 py-2 text-text-muted">{resource.capacity}</td>
                  <td className="px-4 py-2 text-text-muted">
                    {resource.weeklyAvailability
                      .map((w) => `${DAY_LABELS[w.dayOfWeek]} ${w.startTime}-${w.endTime}`)
                      .join(", ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
