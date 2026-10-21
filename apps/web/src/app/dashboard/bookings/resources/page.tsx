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
  type BusinessModel,
  type Resource,
  type ResourceKind,
} from "@korva/types";
import { Button, Card, Input, Select } from "@korva/ui";
import { apiClient, ApiError, uploadFile } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { useActiveOrganization } from "@/lib/use-active-organization";

const DAY_LABELS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

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

function kindLabel(type: string): string {
  return (RESOURCE_KIND_LABELS as Record<string, string>)[type] ?? type;
}

export default function ResourcesPage() {
  const [showForm, setShowForm] = useState(false);
  const queryClient = useQueryClient();
  const authReady = useAuthReady();
  const { data: organization } = useActiveOrganization();
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
      setPhotoError(error instanceof ApiError ? error.message : "Échec de l'envoi de la photo.");
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
          Ce que vos clients réservent : les membres de l&apos;équipe (coiffeurs, coachs,
          formateurs), les lieux (salles, cabines, tables, chambres) et les équipements. Un membre
          de l&apos;équipe n&apos;a pas besoin de compte et ne compte pas comme utilisateur de
          votre abonnement.
        </p>
        <Button onClick={() => (showForm ? setShowForm(false) : openForm())}>
          {showForm ? "Annuler" : "Nouvelle ressource"}
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
            <Select aria-label="Nature" {...register("type")}>
              {RESOURCE_KINDS.map((value) => (
                <option key={value} value={value}>
                  {RESOURCE_KIND_LABELS[value]}
                </option>
              ))}
            </Select>
            <Input
              aria-label="Nom"
              placeholder={isPerson ? "Prénom (ex: Awa)" : "Nom (ex: Salle 1)"}
              className="sm:col-span-2"
              {...register("name")}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-text">
            {isPerson ? "Clients en même temps" : "Capacité"}
            <Input
              type="number"
              min="1"
              aria-label="Capacité"
              className="w-24"
              {...register("capacity", { valueAsNumber: true })}
            />
          </label>
          {kind === "room" && (
            <label className="flex items-center gap-2 text-sm text-text">
              Places assises (pour une table de restaurant)
              <Input
                type="number"
                min="1"
                aria-label="Places assises"
                className="w-24"
                {...register("seats", {
                  setValueAs: (v: string) => (v === "" ? undefined : Number(v)),
                })}
              />
            </label>
          )}
          <textarea
            aria-label="Présentation"
            placeholder={
              isPerson
                ? "Présentation (optionnel), affichée aux clients : spécialités, expérience..."
                : "Description (optionnel)"
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
                <span className="mr-2">{photoUploading ? "Envoi..." : "Photo (optionnel)"}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  aria-label="Photo"
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
            placeholder="URL calendrier externe (ICS, optionnel)"
            {...register("externalCalendarUrl", {
              setValueAs: (v: string) => (v === "" ? undefined : v),
            })}
          />
          {isPerson && (
            <label className="block text-sm text-text">
              <span className="mb-1 block text-xs text-text-muted">
                Optionnel : relier à un utilisateur du tableau de bord, s&apos;il en a un, pour
                qu&apos;il voie son propre planning.
              </span>
              <select
                aria-label="Compte utilisateur lié"
                className="rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
                defaultValue=""
                {...register("membershipId", {
                  setValueAs: (v: string) => (v === "" ? undefined : v),
                })}
              >
                <option value="">Aucun compte (cas le plus courant)</option>
                {members?.map((member) => (
                  <option key={member.id} value={member.id}>
                    {memberName(member)}
                  </option>
                ))}
              </select>
            </label>
          )}

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
            <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium text-text-muted">
              <tr>
                <th className="px-4 py-2">Nom</th>
                <th className="px-4 py-2">Nature</th>
                <th className="px-4 py-2">Capacité</th>
                <th className="px-4 py-2">Horaires</th>
                <th className="px-4 py-2">Compte lié</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-text-muted">
                    Chargement...
                  </td>
                </tr>
              )}
              {!isLoading && resources?.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-text-muted">
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
                  <td className="px-4 py-2 text-text-muted">{kindLabel(resource.type)}</td>
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
