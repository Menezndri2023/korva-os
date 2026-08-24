"use client";

import { Fragment, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createPipelineSchema,
  createLeadSchema,
  type CreateLeadInput,
  type UpdateLeadInput,
} from "@korva/validation";
import { LEAD_STATUSES } from "@korva/types";
import type { Contact, Lead, Pipeline } from "@korva/types";
import { Button, Card, Input } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { LEAD_STATUS_LABELS } from "@/lib/analytics-format";

function usePipelines(enabled: boolean) {
  return useQuery({
    queryKey: ["pipelines"],
    queryFn: () => apiClient.get<Pipeline[]>("/pipelines"),
    enabled,
  });
}

export default function LeadsPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const authReady = useAuthReady();

  const { data: pipelines, isLoading: pipelinesLoading } = usePipelines(authReady);
  const { data: contacts } = useQuery({
    queryKey: ["contacts", ""],
    queryFn: () => apiClient.get<Contact[]>("/contacts"),
    enabled: authReady,
  });
  const { data: leads, isLoading: leadsLoading } = useQuery({
    queryKey: ["leads"],
    queryFn: () => apiClient.get<Lead[]>("/leads"),
    enabled: authReady,
  });

  const defaultPipeline = pipelines?.find((p) => p.isDefault) ?? pipelines?.[0];

  const seedPipelineMutation = useMutation({
    mutationFn: () =>
      apiClient.post<Pipeline>(
        "/pipelines",
        createPipelineSchema.parse({
          name: "Ventes",
          isDefault: true,
          stages: [
            { name: "Nouveau", order: 0 },
            { name: "Gagné", order: 1 },
          ],
        }),
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["pipelines"] }),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateLeadInput>({ resolver: zodResolver(createLeadSchema) });

  const createLeadMutation = useMutation({
    mutationFn: (input: CreateLeadInput) => apiClient.post<Lead>("/leads", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      reset();
      setShowForm(false);
    },
  });

  // Non optimiste, comme modulesMutation (F1) / inviteMemberMutation (F2) : le statut et
  // l'étape affichés dérivent toujours de la query ["leads"], jamais d'une copie locale — en
  // cas d'erreur, le <select> revient donc naturellement à la valeur serveur, sans rollback à
  // écrire. onSuccess retourne (pas `void`) la promesse d'invalidateQueries pour que isPending
  // couvre tout le refetch, pas seulement le PATCH.
  const updateLeadMutation = useMutation({
    mutationFn: ({ id, ...input }: { id: string } & UpdateLeadInput) =>
      apiClient.patch<Lead>(`/leads/${id}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["leads"] }),
  });

  function pipelineForLead(lead: Lead): Pipeline | undefined {
    return pipelines?.find((p) => p.id === lead.pipelineId);
  }
  function contactName(lead: Lead): string {
    const contact = contacts?.find((c) => c.id === lead.contactId);
    if (!contact) return "—";
    return [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.company || "—";
  }

  if (!pipelinesLoading && pipelines?.length === 0) {
    return (
      <Card className="p-6 text-sm text-zinc-600">
        <p className="mb-3">Aucun pipeline n&apos;a encore été créé pour gérer vos prospects.</p>
        <Button onClick={() => seedPipelineMutation.mutate()} loading={seedPipelineMutation.isPending}>
          {seedPipelineMutation.isPending ? "Création..." : "Créer un pipeline par défaut"}
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Annuler" : "Nouveau prospect"}
        </Button>
      </div>

      {showForm && defaultPipeline && (
        <form
          onSubmit={handleSubmit((values) => createLeadMutation.mutate(values))}
          // Not migrated to <Card>: this wrapper is the <form> element itself (it carries
          // onSubmit), and Card renders a <div> — same exclusion already documented in
          // dashboard/crm/page.tsx (F2-B.7).
          className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 bg-white p-4"
        >
          <select
            className="col-span-2 rounded-md border border-zinc-300 px-3 py-2 text-sm"
            defaultValue=""
            {...register("contactId")}
          >
            <option value="" disabled>
              Choisir un contact
            </option>
            {contacts?.map((c) => (
              <option key={c.id} value={c.id}>
                {[c.firstName, c.lastName].filter(Boolean).join(" ") || c.company || c.email}
              </option>
            ))}
          </select>
          {errors.contactId && (
            <p className="col-span-2 text-xs text-red-600">{errors.contactId.message}</p>
          )}

          <input type="hidden" value={defaultPipeline.id} {...register("pipelineId")} />
          <select
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
            defaultValue={defaultPipeline.stages[0]?.id}
            {...register("stageId")}
          >
            {defaultPipeline.stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </select>
          <Input
            type="number"
            placeholder="Valeur estimée"
            {...register("estimatedValue", { valueAsNumber: true })}
          />

          {createLeadMutation.isError && (
            <p className="col-span-2 text-sm text-red-600">
              {createLeadMutation.error instanceof ApiError ? createLeadMutation.error.message : "Erreur"}
            </p>
          )}
          <Button type="submit" loading={createLeadMutation.isPending} className="col-span-2">
            {createLeadMutation.isPending ? "Création..." : "Créer le prospect"}
          </Button>
        </form>
      )}

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-2">Contact</th>
              <th className="px-4 py-2">Étape</th>
              <th className="px-4 py-2">Statut</th>
              <th className="px-4 py-2">Valeur estimée</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {leadsLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-zinc-500">
                  Chargement...
                </td>
              </tr>
            )}
            {!leadsLoading && leads?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-zinc-500">
                  Aucun prospect.
                </td>
              </tr>
            )}
            {leads?.map((lead) => {
              const pipeline = pipelineForLead(lead);
              const isRowPending =
                updateLeadMutation.isPending && updateLeadMutation.variables?.id === lead.id;
              const rowError =
                updateLeadMutation.isError && updateLeadMutation.variables?.id === lead.id
                  ? updateLeadMutation.error
                  : null;
              return (
                <Fragment key={lead.id}>
                  <tr>
                    <td className="px-4 py-2 font-medium">{contactName(lead)}</td>
                    <td className="px-4 py-2 text-zinc-600">
                      <select
                        aria-label={`Étape de ${contactName(lead)}`}
                        value={lead.stageId}
                        disabled={isRowPending || !pipeline}
                        onChange={(e) =>
                          updateLeadMutation.mutate({ id: lead.id, stageId: e.target.value })
                        }
                        className="rounded-md border border-zinc-300 px-2 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {pipeline?.stages.map((stage) => (
                          <option key={stage.id} value={stage.id}>
                            {stage.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2 text-zinc-600">
                      <select
                        aria-label={`Statut de ${contactName(lead)}`}
                        value={lead.status}
                        disabled={isRowPending}
                        onChange={(e) =>
                          updateLeadMutation.mutate({
                            id: lead.id,
                            status: e.target.value as Lead["status"],
                          })
                        }
                        className="rounded-md border border-zinc-300 px-2 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {LEAD_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {LEAD_STATUS_LABELS[status] ?? status}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2 text-zinc-600">{lead.estimatedValue ?? "—"}</td>
                  </tr>
                  {rowError && (
                    <tr>
                      <td colSpan={4} className="px-4 pb-2 text-xs text-red-600">
                        {rowError instanceof ApiError
                          ? rowError.message
                          : "Impossible de mettre à jour le prospect."}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
