"use client";

import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createResourceSchema, type CreateResourceInput } from "@korva/validation";
import type { Resource } from "@korva/types";
import { apiClient, ApiError } from "@/lib/api-client";

const DAY_LABELS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

export default function ResourcesPage() {
  const [showForm, setShowForm] = useState(false);
  const queryClient = useQueryClient();

  const { data: resources, isLoading } = useQuery({
    queryKey: ["resources"],
    queryFn: () => apiClient.get<Resource[]>("/resources"),
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
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          {showForm ? "Annuler" : "Nouvelle ressource"}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit((values) => createMutation.mutate(values))}
          className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4"
        >
          <div className="grid grid-cols-3 gap-2">
            <input
              placeholder="Nom (ex: Salle 1)"
              className="col-span-2 rounded-md border border-zinc-300 px-3 py-2 text-sm"
              {...register("name")}
            />
            <input
              placeholder="Type (room, vehicle...)"
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
              {...register("type")}
            />
          </div>
          <input
            type="number"
            placeholder="Capacité"
            className="w-32 rounded-md border border-zinc-300 px-3 py-2 text-sm"
            {...register("capacity", { valueAsNumber: true })}
          />

          <div className="space-y-2">
            <p className="text-sm font-medium text-zinc-700">Horaires hebdomadaires</p>
            {fields.map((field, index) => (
              <div key={field.id} className="grid grid-cols-12 gap-2">
                <select
                  className="col-span-4 rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
                  {...register(`weeklyAvailability.${index}.dayOfWeek`, { valueAsNumber: true })}
                >
                  {DAY_LABELS.map((label, day) => (
                    <option key={day} value={day}>
                      {label}
                    </option>
                  ))}
                </select>
                <input
                  type="time"
                  className="col-span-3 rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
                  {...register(`weeklyAvailability.${index}.startTime`)}
                />
                <input
                  type="time"
                  className="col-span-3 rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
                  {...register(`weeklyAvailability.${index}.endTime`)}
                />
                <button
                  type="button"
                  onClick={() => remove(index)}
                  className="col-span-2 text-sm text-red-600 hover:underline"
                >
                  Retirer
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => append({ dayOfWeek: 1, startTime: "09:00", endTime: "18:00" })}
              className="text-sm text-zinc-600 hover:underline"
            >
              + Ajouter un créneau
            </button>
          </div>

          {createMutation.isError && (
            <p className="text-sm text-red-600">
              {createMutation.error instanceof ApiError ? createMutation.error.message : "Erreur"}
            </p>
          )}
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
          >
            {createMutation.isPending ? "Création..." : "Créer la ressource"}
          </button>
        </form>
      )}

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-2">Nom</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Capacité</th>
              <th className="px-4 py-2">Horaires</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-zinc-500">
                  Chargement...
                </td>
              </tr>
            )}
            {!isLoading && resources?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-zinc-500">
                  Aucune ressource.
                </td>
              </tr>
            )}
            {resources?.map((resource) => (
              <tr key={resource.id}>
                <td className="px-4 py-2 font-medium">{resource.name}</td>
                <td className="px-4 py-2 text-zinc-600">{resource.type}</td>
                <td className="px-4 py-2 text-zinc-600">{resource.capacity}</td>
                <td className="px-4 py-2 text-zinc-600">
                  {resource.weeklyAvailability
                    .map((w) => `${DAY_LABELS[w.dayOfWeek]} ${w.startTime}-${w.endTime}`)
                    .join(", ") || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
