"use client";

import Link from "next/link";
import { useState } from "react";
import type { DragEvent } from "react";
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
import type { Contact, CustomFieldValues, Lead, Pipeline } from "@korva/types";
import { Button, Card, Input, Pagination, Select, cn } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { LEAD_STATUS_LABELS } from "@/lib/analytics-format";
import { CustomFieldsFieldset } from "@/components/custom-fields-fieldset";

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
  const [page, setPage] = useState(1);
  const authReady = useAuthReady();

  const { data: pipelines, isLoading: pipelinesLoading } = usePipelines(authReady);
  const { data: contacts } = useQuery({
    queryKey: ["contacts", ""],
    queryFn: () => apiClient.get<Contact[]>("/contacts"),
    enabled: authReady,
  });
  const { data: leadsPage, isLoading: leadsLoading } = useQuery({
    queryKey: ["leads", page],
    queryFn: () => apiClient.getList<Lead>(`/leads?page=${page}`),
    enabled: authReady,
  });
  const leads = leadsPage?.data;

  const defaultPipeline = pipelines?.find((p) => p.isDefault) ?? pipelines?.[0];
  // Which pipeline's board is currently shown — defaults to the default pipeline, but an
  // organization with several pipelines (e.g. one per product line, or per sales team) can
  // switch between them instead of only ever seeing the default one's stages as columns.
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | undefined>(undefined);
  const selectedPipeline =
    pipelines?.find((p) => p.id === selectedPipelineId) ?? defaultPipeline;

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

  const [createCustomFields, setCreateCustomFields] = useState<CustomFieldValues>({});
  const createLeadMutation = useMutation({
    mutationFn: (input: CreateLeadInput) => apiClient.post<Lead>("/leads", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      reset();
      setCreateCustomFields({});
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

  // Drag-and-drop between stage columns, using the browser's native HTML5 DnD API (no extra
  // dependency: packages/ui and apps/web only declare what F2-B already listed, and adding a
  // DnD library here would touch package.json/the pnpm lockfile other agents are editing this
  // same wave). Dropping a card calls the exact same updateLeadMutation.mutate({ id, stageId })
  // already used by the per-card <Select> below — same endpoint, same optimistic-free
  // "no rollback needed" reasoning documented above.
  function handleCardDragStart(leadId: string) {
    return (event: DragEvent<HTMLDivElement>) => {
      event.dataTransfer.setData("text/plain", leadId);
      event.dataTransfer.effectAllowed = "move";
    };
  }
  function handleColumnDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }
  function handleColumnDrop(stageId: string) {
    return (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const leadId = event.dataTransfer.getData("text/plain");
      const lead = leads?.find((l) => l.id === leadId);
      if (!lead || lead.stageId === stageId) return;
      updateLeadMutation.mutate({ id: leadId, stageId });
    };
  }

  if (!pipelinesLoading && pipelines?.length === 0) {
    return (
      <Card className="p-6 text-sm text-text-muted">
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

      {showForm && selectedPipeline && (
        <form
          onSubmit={handleSubmit((values) =>
            createLeadMutation.mutate({ ...values, customFields: createCustomFields }),
          )}
          // Not migrated to <Card>: this wrapper is the <form> element itself (it carries
          // onSubmit), and Card renders a <div> — same exclusion already documented in
          // dashboard/crm/page.tsx (F2-B.7).
          className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface p-4"
        >
          <Select className="col-span-2" defaultValue="" {...register("contactId")}>
            <option value="" disabled>
              Choisir un contact
            </option>
            {contacts?.map((c) => (
              <option key={c.id} value={c.id}>
                {[c.firstName, c.lastName].filter(Boolean).join(" ") || c.company || c.email}
              </option>
            ))}
          </Select>
          {errors.contactId && (
            <p className="col-span-2 text-xs text-destructive">{errors.contactId.message}</p>
          )}

          {/* New leads are created directly in whichever pipeline the board is currently
              showing, not always the default one. */}
          <input type="hidden" value={selectedPipeline.id} {...register("pipelineId")} />
          <Select defaultValue={selectedPipeline.stages[0]?.id} {...register("stageId")}>
            {selectedPipeline.stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </Select>
          <Input
            type="number"
            placeholder="Valeur estimée"
            {...register("estimatedValue", {
              setValueAs: (v: string) => (v === "" ? undefined : Number(v)),
            })}
          />

          <CustomFieldsFieldset
            entity="leads"
            values={createCustomFields}
            onChange={setCreateCustomFields}
            idPrefix="lead-create"
          />

          {createLeadMutation.isError && (
            <p className="col-span-2 text-sm text-destructive">
              {createLeadMutation.error instanceof ApiError ? createLeadMutation.error.message : "Erreur"}
            </p>
          )}
          <Button type="submit" loading={createLeadMutation.isPending} className="col-span-2">
            {createLeadMutation.isPending ? "Création..." : "Créer le prospect"}
          </Button>
        </form>
      )}

      {pipelines && pipelines.length > 1 && (
        <label className="flex items-center gap-2 text-sm text-text-muted">
          Pipeline
          <Select
            value={selectedPipeline?.id ?? ""}
            onChange={(e) => setSelectedPipelineId(e.target.value)}
            className="w-56"
          >
            {pipelines.map((pipeline) => (
              <option key={pipeline.id} value={pipeline.id}>
                {pipeline.name}
              </option>
            ))}
          </Select>
        </label>
      )}

      {leadsLoading && <p className="text-sm text-text-muted">Chargement...</p>}
      {!leadsLoading && leads?.length === 0 && (
        <p className="text-sm text-text-muted">Aucun prospect.</p>
      )}

      {/* Kanban board: one column per stage of the currently-selected pipeline (see the
          pipeline picker above — not always the default one), cards draggable between columns
          (F2 audit — plain <select> for stage changes, no board). Each card keeps the same
          per-lead stage/status <select> as before (same aria-label, same disabled-while-
          pending, same rowError message) as a non-drag, keyboard-reachable fallback — native
          HTML5 drag-and-drop has no keyboard equivalent on its own, so removing the select
          entirely would regress accessibility even though the board makes it redundant for a
          mouse/touch user. Only leads in the *selected* pipeline are shown as columns (a
          board's columns are one pipeline's stages); a lead belonging to a different pipeline
          shows up once that pipeline is selected instead. */}
      <div className="overflow-x-auto pb-2">
        <div className="flex gap-4">
          {[...(selectedPipeline?.stages ?? [])]
            .sort((a, b) => a.order - b.order)
            .map((stage) => {
              const stageLeads = leads?.filter(
                (lead) => lead.pipelineId === selectedPipeline?.id && lead.stageId === stage.id,
              );
              return (
                <div
                  key={stage.id}
                  onDragOver={handleColumnDragOver}
                  onDrop={handleColumnDrop(stage.id)}
                  className="w-72 shrink-0 rounded-lg border border-border bg-surface-muted p-3"
                >
                  <h3
                    aria-label={`${stage.name} — ${stageLeads?.length ?? 0} prospect(s)`}
                    className="mb-3 flex items-center justify-between text-xs font-medium uppercase text-text-muted"
                  >
                    <span aria-hidden="true">{stage.name}</span>
                    <span aria-hidden="true" className="rounded-full bg-surface px-2 py-0.5 text-text-muted">
                      {stageLeads?.length ?? 0}
                    </span>
                  </h3>
                  <div className="space-y-2">
                    {stageLeads?.map((lead) => {
                      const pipeline = pipelineForLead(lead);
                      const isRowPending =
                        updateLeadMutation.isPending &&
                        updateLeadMutation.variables?.id === lead.id;
                      const rowError =
                        updateLeadMutation.isError && updateLeadMutation.variables?.id === lead.id
                          ? updateLeadMutation.error
                          : null;
                      return (
                        <div
                          key={lead.id}
                          draggable={!isRowPending}
                          onDragStart={handleCardDragStart(lead.id)}
                          className={cn(
                            "space-y-2 rounded-md border border-border bg-surface p-2 text-sm shadow-sm",
                            isRowPending ? "cursor-wait opacity-60" : "cursor-grab",
                          )}
                        >
                          <Link
                            href={`/dashboard/crm/leads/${lead.id}`}
                            className="block font-medium text-text underline-offset-2 hover:underline"
                          >
                            {contactName(lead)}
                          </Link>
                          <p className="text-text-muted">{lead.estimatedValue ?? "—"}</p>
                          <select
                            aria-label={`Étape de ${contactName(lead)}`}
                            value={lead.stageId}
                            disabled={isRowPending || !pipeline}
                            onChange={(e) =>
                              updateLeadMutation.mutate({ id: lead.id, stageId: e.target.value })
                            }
                            className="w-full rounded-md border border-border-input px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {pipeline?.stages.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
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
                            className="w-full rounded-md border border-border-input px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {LEAD_STATUSES.map((status) => (
                              <option key={status} value={status}>
                                {LEAD_STATUS_LABELS[status] ?? status}
                              </option>
                            ))}
                          </select>
                          {rowError && (
                            <p className="text-xs text-destructive">
                              {rowError instanceof ApiError
                                ? rowError.message
                                : "Impossible de mettre à jour le prospect."}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      <Pagination
        page={page}
        totalPages={leadsPage?.pagination.totalPages ?? 1}
        onPageChange={setPage}
        disabled={leadsLoading}
      />
    </div>
  );
}
