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
import { RESOURCE_KINDS, RESOURCE_KIND_LABELS, RESOURCE_KIND_LABELS_EN, WEEKDAY_SHORT, type Resource } from "@korva/types";
import { Badge, Button, Card, Input, Select } from "@korva/ui";
import { zonedTimeToUtc } from "@/lib/zoned-time";
import { useActiveOrganization } from "@/lib/use-active-organization";
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
  const locale = useDashboardLocale();
  const t = useT();
  const { data: organization } = useActiveOrganization();
  const DAY_LABELS = WEEKDAY_SHORT[locale];
  const kindLabels: Record<string, string> = locale === "en" ? RESOURCE_KIND_LABELS_EN : RESOURCE_KIND_LABELS;

  const resourceQuery = useQuery({
    queryKey: ["resources", id],
    queryFn: () => apiClient.get<Resource>(`/resources/${id}`),
    enabled: authReady,
  });
  const { data: members } = useQuery({
    queryKey: ["organizations", "me", "members"],
    queryFn: () => apiClient.get<MemberOption[]>("/organizations/me/members"),
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
      externalCalendarUrl: resource.externalCalendarUrl,
      membershipId: resource.membershipId,
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
    // The hours typed are the business's own: read in its timezone, not as UTC (a Paris salon's
    // 14:00 block used to land at 16:00). An end before the start runs past midnight.
    const timeZone = organization?.timezone ?? "UTC";
    const startAt = zonedTimeToUtc(values.date, values.startTime, timeZone);
    let endAt = zonedTimeToUtc(values.date, values.endTime, timeZone);
    if (endAt <= startAt) endAt = new Date(endAt.getTime() + 24 * 60 * 60 * 1000);
    const result = addBlockedSlotSchema.safeParse({
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      reason: values.reason || undefined,
    });
    if (result.success) {
      addSlotMutation.mutate(result.data);
    }
  }

  if (resourceQuery.isLoading) {
    return <p className="text-sm text-text-muted">{t("Chargement...", "Loading...")}</p>;
  }

  if (resourceQuery.isError || !resourceQuery.data) {
    const error = resourceQuery.error;
    const message =
      error instanceof ApiError ? error.message : t("Impossible de charger cette ressource.", "This resource could not be loaded.");
    return (
      <Card className="p-6">
        <p className="text-sm text-destructive">{message}</p>
        <Link
          href="/dashboard/bookings/resources"
          className="mt-2 inline-block text-sm font-medium text-text underline"
        >
          {t("Retour aux ressources", "Back to resources")}
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
        ← {t("Ressources", "Resources")}
      </Link>

      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">{resource.name}</h1>
            <p className="text-sm text-text-muted">
              {kindLabels[resource.type] ?? resource.type} · {t("capacité", "capacity")} {resource.capacity}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={resource.active ? "success" : "default"}>
              {resource.active ? t("Active", "Active") : t("Inactive", "Inactive")}
            </Badge>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => (isEditing ? cancelEdit() : startEdit(resource))}
            >
              {isEditing ? t("Annuler", "Cancel") : t("Modifier", "Edit")}
            </Button>
          </div>
        </div>

        {!isEditing ? (
          <>
            <div className="mt-4">
              <dt className="text-sm text-text-muted">{t("Compte utilisateur lié", "Linked user account")}</dt>
              <dd className="mt-0.5 text-sm text-text">
                {(() => {
                  const member = members?.find((m) => m.id === resource.membershipId);
                  return member ? memberName(member) : "—";
                })()}
              </dd>
            </div>
            {resource.description && (
              <div className="mt-4">
                <dt className="text-sm text-text-muted">{t("Description", "Description")}</dt>
                <dd className="mt-0.5 text-sm text-text">{resource.description}</dd>
              </div>
            )}
            {resource.externalCalendarUrl && (
              <div className="mt-4">
                <dt className="text-sm text-text-muted">{t("Calendrier externe synchronisé", "Synced external calendar")}</dt>
                <dd className="mt-0.5 truncate text-sm text-text">
                  {resource.externalCalendarUrl}
                </dd>
              </div>
            )}
          </>
        ) : (
          <form
            onSubmit={handleSubmit((values) => updateMutation.mutate(values))}
            className="mt-4 space-y-3 rounded-lg border border-border bg-surface p-4"
          >
            <div className="grid grid-cols-3 gap-2">
              <Input placeholder={t("Nom", "Name")} className="col-span-2" {...register("name")} />
              <Select aria-label={t("Nature", "Kind")} {...register("type")}>
                {RESOURCE_KINDS.map((value) => (
                  <option key={value} value={value}>
                    {kindLabels[value]}
                  </option>
                ))}
                {/* A free-text type from before the kinds existed stays selectable as it is. */}
                {!(RESOURCE_KINDS as readonly string[]).includes(resource.type) && (
                  <option value={resource.type}>{resource.type}</option>
                )}
              </Select>
            </div>
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            <div className="flex items-center gap-3">
              <Input
                type="number"
                placeholder={t("Capacité", "Capacity")}
                className="w-32"
                {...register("capacity", { valueAsNumber: true })}
              />
              <label className="flex items-center gap-2 text-sm text-text">
                <input type="checkbox" {...register("active")} />
                {t("Active", "Active")}
              </label>
            </div>
            {/* setValueAs: optional + format-constrained (.url()) — an untouched field always
                submits "" (never undefined), which fails validation unless converted here; same
                pattern as dashboard/settings/page.tsx's brandColor/logo/heroImage fields. */}
            <Input
              placeholder={t("URL calendrier externe (ICS, optionnel)", "External calendar URL (ICS, optional)")}
              {...register("externalCalendarUrl", {
                setValueAs: (v: string) => (v === "" ? undefined : v),
              })}
            />
            {errors.externalCalendarUrl && (
              <p className="text-xs text-destructive">{errors.externalCalendarUrl.message}</p>
            )}
            <select
              className="rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
              defaultValue=""
              {...register("membershipId", {
                setValueAs: (v: string) => (v === "" ? undefined : v),
              })}
            >
              <option value="">{t("Aucun membre assigné (ressource générique)", "No member assigned (generic resource)")}</option>
              {members?.map((member) => (
                <option key={member.id} value={member.id}>
                  {memberName(member)}
                </option>
              ))}
            </select>

            <div className="space-y-2">
              <p className="text-sm font-medium text-text">{t("Horaires hebdomadaires", "Weekly hours")}</p>
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
                    {t("Retirer", "Remove")}
                  </button>
                </div>
              ))}
              <p className="text-xs text-text-muted">
                {t(
                  "Une fermeture plus tôt que l'ouverture continue le lendemain : 18:00 → 02:00 pour un service du soir, 00:00 pour « jusqu'à minuit ».",
                  "A closing earlier than the opening carries on into the next day: 18:00 → 02:00 for an evening service, 00:00 for “until midnight”.",
                )}
              </p>
              <button
                type="button"
                onClick={() => append({ dayOfWeek: 1, startTime: "09:00", endTime: "18:00" })}
                className="text-sm text-text-muted hover:underline"
              >
                + {t("Ajouter un créneau", "Add a slot")}
              </button>
            </div>

            {updateMutation.isError && (
              <p className="text-sm text-destructive">
                {updateMutation.error instanceof ApiError
                  ? updateMutation.error.message
                  : t("Impossible d'enregistrer la ressource.", "The resource could not be saved.")}
              </p>
            )}
            <div className="flex gap-2">
              <Button type="submit" loading={updateMutation.isPending}>
                {updateMutation.isPending ? t("Enregistrement...", "Saving...") : t("Enregistrer", "Save")}
              </Button>
              <Button type="button" variant="ghost" onClick={cancelEdit}>
                {t("Annuler", "Cancel")}
              </Button>
            </div>
          </form>
        )}
      </Card>

      <Card className="p-6">
        <h2 className="text-sm font-semibold text-text">{t("Indisponibilités", "Unavailable times")}</h2>

        <form
          onSubmit={handleSlotSubmit(submitBlockedSlot)}
          className="mt-3 flex flex-wrap items-center gap-2"
        >
          <Input type="date" aria-label={t("Date", "Date")} {...registerSlot("date", { required: true })} />
          <Input
            type="time"
            aria-label={t("Début", "Start")}
            {...registerSlot("startTime", { required: true })}
          />
          <Input type="time" aria-label={t("Fin", "End")} {...registerSlot("endTime", { required: true })} />
          <Input
            placeholder={t("Raison (optionnel)", "Reason (optional)")}
            aria-label={t("Raison", "Reason")}
            {...registerSlot("reason")}
          />
          <Button type="submit" size="sm" loading={addSlotMutation.isPending}>
            {t("Ajouter", "Add")}
          </Button>
        </form>
        {addSlotMutation.isError && (
          <p className="mt-2 text-xs text-destructive">
            {addSlotMutation.error instanceof ApiError
              ? addSlotMutation.error.message
              : t("Impossible d'ajouter cette indisponibilité.", "This unavailable time could not be added.")}
          </p>
        )}

        <div className="mt-4">
          {resource.blockedSlots.length === 0 ? (
            <p className="text-sm text-text-muted">{t("Aucune indisponibilité.", "No unavailable times.")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {resource.blockedSlots.map((slot) => (
                <li key={slot.id} className="flex items-center justify-between py-2 text-sm">
                  <span>
                    {new Date(slot.startAt).toLocaleString(intlLocale(locale))} →{" "}
                    {new Date(slot.endAt).toLocaleString(intlLocale(locale))}
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
                    {t("Retirer", "Remove")}
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
