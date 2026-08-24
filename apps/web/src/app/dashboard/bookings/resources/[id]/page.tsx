"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addBlockedSlotSchema,
  updateResourceSchema,
  type AddBlockedSlotInput,
  type UpdateResourceInput,
} from "@korva/validation";
import type { Resource } from "@korva/types";
import { Badge, Button, Card, Input } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";

const DAY_LABELS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

interface BlockedSlotFormValues {
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
}

export default function ResourceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const authReady = useAuthReady();
  const [isEditing, setIsEditing] = useState(false);

  const resourceQuery = useQuery({
    queryKey: ["resources", id],
    queryFn: () => apiClient.get<Resource>(`/resources/${id}`),
    enabled: authReady,
  });

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<UpdateResourceInput>({ resolver: zodResolver(updateResourceSchema) });
  const { fields, append, remove } = useFieldArray({ control, name: "weeklyAvailability" });

  function startEdit(resource: Resource) {
    setIsEditing(true);
    reset({
      name: resource.name,
      type: resource.type,
      capacity: resource.capacity,
      active: resource.active,
      weeklyAvailability: resource.weeklyAvailability,
    });
  }
  function cancelEdit() {
    setIsEditing(false);
    reset();
  }

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["resources"] });

  const updateMutation = useMutation({
    mutationFn: (input: UpdateResourceInput) => apiClient.patch<Resource>(`/resources/${id}`, input),
    onSuccess: () => {
      setIsEditing(false);
      return invalidate();
    },
  });

  const { register: registerSlot, handleSubmit: handleSlotSubmit, reset: resetSlotForm } =
    useForm<BlockedSlotFormValues>({ defaultValues: { reason: "" } });
  const addSlotMutation = useMutation({
    mutationFn: (input: AddBlockedSlotInput) =>
      apiClient.post<Resource>(`/resources/${id}/blocked-slots`, input),
    onSuccess: () => {
      resetSlotForm({ date: "", startTime: "", endTime: "", reason: "" });
      return invalidate();
    },
  });
  const removeSlotMutation = useMutation({
    mutationFn: (slotId: string) =>
      apiClient.delete<Resource>(`/resources/${id}/blocked-slots/${slotId}`),
    onSuccess: invalidate,
  });

  function submitBlockedSlot(values: BlockedSlotFormValues) {
    const result = addBlockedSlotSchema.safeParse({
      startAt: new Date(`${values.date}T${values.startTime}:00.000Z`).toISOString(),
      endAt: new Date(`${values.date}T${values.endTime}:00.000Z`).toISOString(),
      reason: values.reason || undefined,
    });
    if (result.success) {
      addSlotMutation.mutate(result.data);
    }
  }

  if (resourceQuery.isLoading) {
    return <p className="text-sm text-text-muted">Chargement...</p>;
  }

  if (resourceQuery.isError || !resourceQuery.data) {
    const error = resourceQuery.error;
    const message =
      error instanceof ApiError ? error.message : "Impossible de charger cette ressource.";
    return (
      <Card className="p-6">
        <p className="text-sm text-destructive">{message}</p>
        <Link
          href="/dashboard/bookings/resources"
          className="mt-2 inline-block text-sm font-medium text-text underline"
        >
          Retour aux ressources
        </Link>
      </Card>
    );
  }

  const resource = resourceQuery.data;

  return (
    <div className="space-y-4">
      <Link
        href="/dashboard/bookings/resources"
        className="text-sm text-text-muted hover:underline"
      >
        ← Ressources
      </Link>

      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">{resource.name}</h1>
            <p className="text-sm text-text-muted">
              {resource.type} · capacité {resource.capacity}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={resource.active ? "success" : "default"}>
              {resource.active ? "Active" : "Inactive"}
            </Badge>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => (isEditing ? cancelEdit() : startEdit(resource))}
            >
              {isEditing ? "Annuler" : "Modifier"}
            </Button>
          </div>
        </div>

        {!isEditing ? (
          resource.description && (
            <div className="mt-4">
              <dt className="text-sm text-text-muted">Description</dt>
              <dd className="mt-0.5 text-sm text-text">{resource.description}</dd>
            </div>
          )
        ) : (
          <form
            onSubmit={handleSubmit((values) => updateMutation.mutate(values))}
            className="mt-4 space-y-3 rounded-lg border border-border bg-surface p-4"
          >
            <div className="grid grid-cols-3 gap-2">
              <Input placeholder="Nom" className="col-span-2" {...register("name")} />
              <Input placeholder="Type" {...register("type")} />
            </div>
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            <div className="flex items-center gap-3">
              <Input
                type="number"
                placeholder="Capacité"
                className="w-32"
                {...register("capacity", { valueAsNumber: true })}
              />
              <label className="flex items-center gap-2 text-sm text-text">
                <input type="checkbox" {...register("active")} />
                Active
              </label>
            </div>

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
                  <Input
                    type="time"
                    className="col-span-3"
                    {...register(`weeklyAvailability.${index}.startTime`)}
                  />
                  <Input
                    type="time"
                    className="col-span-3"
                    {...register(`weeklyAvailability.${index}.endTime`)}
                  />
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

            {updateMutation.isError && (
              <p className="text-sm text-destructive">
                {updateMutation.error instanceof ApiError
                  ? updateMutation.error.message
                  : "Impossible d'enregistrer la ressource."}
              </p>
            )}
            <div className="flex gap-2">
              <Button type="submit" loading={updateMutation.isPending}>
                {updateMutation.isPending ? "Enregistrement..." : "Enregistrer"}
              </Button>
              <Button type="button" variant="ghost" onClick={cancelEdit}>
                Annuler
              </Button>
            </div>
          </form>
        )}
      </Card>

      <Card className="p-6">
        <h2 className="text-sm font-semibold text-text">Indisponibilités</h2>

        <form
          onSubmit={handleSlotSubmit(submitBlockedSlot)}
          className="mt-3 flex flex-wrap items-center gap-2"
        >
          <Input type="date" aria-label="Date" {...registerSlot("date", { required: true })} />
          <Input
            type="time"
            aria-label="Début"
            {...registerSlot("startTime", { required: true })}
          />
          <Input type="time" aria-label="Fin" {...registerSlot("endTime", { required: true })} />
          <Input
            placeholder="Raison (optionnel)"
            aria-label="Raison"
            {...registerSlot("reason")}
          />
          <Button type="submit" size="sm" loading={addSlotMutation.isPending}>
            Ajouter
          </Button>
        </form>
        {addSlotMutation.isError && (
          <p className="mt-2 text-xs text-destructive">
            {addSlotMutation.error instanceof ApiError
              ? addSlotMutation.error.message
              : "Impossible d'ajouter cette indisponibilité."}
          </p>
        )}

        <div className="mt-4">
          {resource.blockedSlots.length === 0 ? (
            <p className="text-sm text-text-muted">Aucune indisponibilité.</p>
          ) : (
            <ul className="divide-y divide-border">
              {resource.blockedSlots.map((slot) => (
                <li key={slot.id} className="flex items-center justify-between py-2 text-sm">
                  <span>
                    {new Date(slot.startAt).toLocaleString("fr-FR")} →{" "}
                    {new Date(slot.endAt).toLocaleString("fr-FR")}
                    {slot.reason ? ` — ${slot.reason}` : ""}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={
                      removeSlotMutation.isPending && removeSlotMutation.variables === slot.id
                    }
                    onClick={() => removeSlotMutation.mutate(slot.id)}
                  >
                    Retirer
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
