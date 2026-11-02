"use client";

import Link from "next/link";
import { useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createResourceSchema, type CreateResourceInput } from "@korva/validation";
import {
  RESOURCE_KINDS,
  RESOURCE_KIND_LABELS,
  RESOURCE_KIND_LABELS_EN,
  WEEKDAY_SHORT,
  type Locale,
  type BusinessModel,
  type Resource,
  type ResourceKind,
} from "@korva/types";
import { Button, Card, Input, Select } from "@korva/ui";
import { apiClient, ApiError, uploadFile } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { useActiveOrganization } from "@/lib/use-active-organization";
import { useDashboardLocale, useT } from "@/lib/dashboard-locale";

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

/** What a new resource most likely is for this type of activity: a salon books people, a
 *  restaurant books tables, a guesthouse books rooms. Only a default — any kind can be chosen. */
function defaultKind(businessModel: BusinessModel | undefined): ResourceKind {
  return businessModel === "restaurant" || businessModel === "lodging" ? "room" : "person";
}

function kindLabel(type: string, locale: Locale): string {
  return ((locale === "en" ? RESOURCE_KIND_LABELS_EN : RESOURCE_KIND_LABELS) as Record<string, string>)[type] ?? type;
}

export default function ResourcesPage() {
  const [showForm, setShowForm] = useState(false);
  const queryClient = useQueryClient();
  const authReady = useAuthReady();
  const { data: organization } = useActiveOrganization();
  const locale = useDashboardLocale();
  const t = useT();
  const DAY_LABELS = WEEKDAY_SHORT[locale];
  const [photo, setPhoto] = useState<string | undefined>();
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const { data: resources, isLoading } = useQuery({
    queryKey: ["resources"],
    queryFn: () => apiClient.get<Resource[]>("/resources"),
    enabled: authReady,
  });
  const { data: members } = useQuery({
    queryKey: ["organizations", "me", "members"],
    queryFn: () => apiClient.get<MemberOption[]>("/organizations/me/members"),
    enabled: authReady,
  });
  function assignedStaffName(membershipId?: string): string {
    const member = members?.find((m) => m.id === membershipId);
    return member ? memberName(member) : "—";
  }

  const { register, control, handleSubmit, reset } = useForm<CreateResourceInput>({
    resolver: zodResolver(createResourceSchema),
    defaultValues: { type: "person", capacity: 1, active: true, weeklyAvailability: [] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "weeklyAvailability" });
  const kind = useWatch({ control, name: "type" });

  function openForm() {
    reset({
      type: defaultKind(organization?.businessModel),
      capacity: 1,
      active: true,
      weeklyAvailability: [],
    });
    setPhoto(undefined);
    setPhotoError(null);
    setShowForm(true);
  }

  async function handlePhoto(file: File | undefined) {
    if (!file) return;
    setPhotoError(null);
    setPhotoUploading(true);
    try {
      setPhoto((await uploadFile(file)).url);
    } catch (error) {
      setPhotoError(error instanceof ApiError ? error.message : t("Échec de l'envoi de la photo.", "The photo could not be uploaded."));
    } finally {
      setPhotoUploading(false);
    }
  }

  const createMutation = useMutation({
    mutationFn: (input: CreateResourceInput) => apiClient.post<Resource>("/resources", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["resources"] });
      reset();
      setPhoto(undefined);
      setShowForm(false);
    },
  });

  const isPerson = kind === "person";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-text-muted">
          {t(
            "Ce que vos clients réservent : les membres de l'équipe (coiffeurs, coachs, formateurs), les lieux (salles, cabines, tables, chambres) et les équipements. Un membre de l'équipe n'a pas besoin de compte et ne compte pas comme utilisateur de votre abonnement.",
            "What your customers book: team members (hairdressers, coaches, trainers), places (rooms, booths, tables, bedrooms) and equipment. A team member needs no account and does not count as a user of your subscription.",
          )}
        </p>
        <Button onClick={() => (showForm ? setShowForm(false) : openForm())}>
          {showForm ? t("Annuler", "Cancel") : t("Nouvelle ressource", "New resource")}
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit((values) =>
            createMutation.mutate({ ...values, photo: isPerson ? photo : undefined }),
          )}
          // Not migrated to <Card>: this wrapper is the <form> element itself (it carries
          // onSubmit), and Card renders a <div> — same exclusion documented on the other
          // migrated create-forms (dashboard/crm, dashboard/bookings).
          className="space-y-3 rounded-lg border border-border bg-surface p-4"
        >
          <div className="grid gap-2 sm:grid-cols-3">
            <Select aria-label={t("Nature", "Kind")} {...register("type")}>
              {RESOURCE_KINDS.map((value) => (
                <option key={value} value={value}>
                  {kindLabel(value, locale)}
                </option>
              ))}
            </Select>
            <Input
              aria-label={t("Nom", "Name")}
              placeholder={isPerson ? t("Prénom (ex: Awa)", "First name (e.g. Awa)") : t("Nom (ex: Salle 1)", "Name (e.g. Room 1)")}
              className="sm:col-span-2"
              {...register("name")}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-text">
            {isPerson ? t("Clients en même temps", "Customers at the same time") : t("Capacité", "Capacity")}
            <Input
              type="number"
              min="1"
              aria-label={t("Capacité", "Capacity")}
              className="w-24"
              {...register("capacity", { valueAsNumber: true })}
            />
          </label>
          {kind === "room" && (
            <label className="flex items-center gap-2 text-sm text-text">
              {t("Places assises (pour une table de restaurant)", "Seats (for a restaurant table)")}
              <Input
                type="number"
                min="1"
                aria-label={t("Places assises", "Seats")}
                className="w-24"
                {...register("seats", {
                  setValueAs: (v: string) => (v === "" ? undefined : Number(v)),
                })}
              />
            </label>
          )}
          <textarea
            aria-label={t("Présentation", "Introduction")}
            placeholder={
              isPerson
                ? t(
                    "Présentation (optionnel), affichée aux clients : spécialités, expérience...",
                    "Introduction (optional), shown to customers: specialities, experience...",
                  )
                : t("Description (optionnel)", "Description (optional)")
            }
            rows={2}
            className="w-full rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            {...register("description", {
              setValueAs: (v: string) => (v === "" ? undefined : v),
            })}
          />
          {isPerson && (
            <div className="flex items-center gap-3">
              {photo && (
                // eslint-disable-next-line @next/next/no-img-element -- arbitrary/uploaded URL, not a static asset
                <img src={photo} alt="" className="h-12 w-12 rounded-full object-cover" />
              )}
              <label className="text-sm text-text">
                <span className="mr-2">{photoUploading ? t("Envoi...", "Uploading...") : t("Photo (optionnel)", "Photo (optional)")}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  aria-label={t("Photo", "Photo")}
                  onChange={(e) => void handlePhoto(e.target.files?.[0])}
                  className="text-xs"
                />
              </label>
              {photoError && <p className="text-xs text-destructive">{photoError}</p>}
            </div>
          )}
          {/* setValueAs: optional + format-constrained (.url()) — an untouched field always
              submits "" (never undefined), which fails validation unless converted here; same
              pattern as dashboard/settings/page.tsx's brandColor/logo/heroImage fields. */}
          <Input
            placeholder={t("URL calendrier externe (ICS, optionnel)", "External calendar URL (ICS, optional)")}
            {...register("externalCalendarUrl", {
              setValueAs: (v: string) => (v === "" ? undefined : v),
            })}
          />
          {isPerson && (
            <label className="block text-sm text-text">
              <span className="mb-1 block text-xs text-text-muted">
                {t(
                  "Optionnel : relier à un utilisateur du tableau de bord, s'il en a un, pour qu'il voie son propre planning.",
                  "Optional: link to a dashboard user, if they have one, so they see their own schedule.",
                )}
              </span>
              <select
                aria-label={t("Compte utilisateur lié", "Linked user account")}
                className="rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
                defaultValue=""
                {...register("membershipId", {
                  setValueAs: (v: string) => (v === "" ? undefined : v),
                })}
              >
                <option value="">{t("Aucun compte (cas le plus courant)", "No account (the usual case)")}</option>
                {members?.map((member) => (
                  <option key={member.id} value={member.id}>
                    {memberName(member)}
                  </option>
                ))}
              </select>
            </label>
          )}

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
                <Input type="time" className="col-span-3" {...register(`weeklyAvailability.${index}.startTime`)} />
                <Input type="time" className="col-span-3" {...register(`weeklyAvailability.${index}.endTime`)} />
                <button
                  type="button"
                  onClick={() => remove(index)}
                  className="col-span-2 text-sm text-destructive hover:underline"
                >
                  {t("Retirer", "Remove")}
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => append({ dayOfWeek: 1, startTime: "09:00", endTime: "18:00" })}
              className="text-sm text-text-muted hover:underline"
            >
              + {t("Ajouter un créneau", "Add a slot")}
            </button>
          </div>

          {createMutation.isError && (
            <p className="text-sm text-destructive">
              {createMutation.error instanceof ApiError ? createMutation.error.message : t("Erreur", "Error")}
            </p>
          )}
          <Button type="submit" loading={createMutation.isPending}>
            {createMutation.isPending ? t("Création...", "Creating...") : t("Créer la ressource", "Create the resource")}
          </Button>
        </form>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium text-text-muted">
              <tr>
                <th className="px-4 py-2">{t("Nom", "Name")}</th>
                <th className="px-4 py-2">{t("Nature", "Kind")}</th>
                <th className="px-4 py-2">{t("Capacité", "Capacity")}</th>
                <th className="px-4 py-2">{t("Horaires", "Hours")}</th>
                <th className="px-4 py-2">{t("Compte lié", "Linked account")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-text-muted">
                    {t("Chargement...", "Loading...")}
                  </td>
                </tr>
              )}
              {!isLoading && resources?.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-text-muted">
                    {t("Aucune ressource.", "No resources.")}
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
                  <td className="px-4 py-2 text-text-muted">{kindLabel(resource.type, locale)}</td>
                  <td className="px-4 py-2 text-text-muted">{resource.capacity}</td>
                  <td className="px-4 py-2 text-text-muted">
                    {resource.weeklyAvailability
                      .map((w) => `${DAY_LABELS[w.dayOfWeek]} ${w.startTime}-${w.endTime}`)
                      .join(", ") || "—"}
                  </td>
                  <td className="px-4 py-2 text-text-muted">
                    {assignedStaffName(resource.membershipId)}
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
