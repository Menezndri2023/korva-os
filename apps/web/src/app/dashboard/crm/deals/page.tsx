"use client";

import Link from "next/link";
import { useState } from "react";
import type { DragEvent } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createPipelineSchema,
  createDealSchema,
  loseDealSchema,
  type CreateDealInput,
  type LoseDealInput,
} from "@korva/validation";
import type { Contact, CustomFieldValues, Deal, Pipeline } from "@korva/types";
import { Button, Card, Input, Pagination, Select, cn } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { CustomFieldsFieldset } from "@/components/custom-fields-fieldset";

function usePipelines(enabled: boolean) {
  return useQuery({
    queryKey: ["pipelines"],
    queryFn: () => apiClient.get<Pipeline[]>("/pipelines"),
    enabled,
  });
}

export default function DealsPage() {
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
  const { data: dealsPage, isLoading: dealsLoading } = useQuery({
    queryKey: ["deals", page],
    queryFn: () => apiClient.getList<Deal>(`/deals?page=${page}`),
    enabled: authReady,
  });
  const deals = dealsPage?.data;

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
  } = useForm<CreateDealInput>({ resolver: zodResolver(createDealSchema) });

  const [createCustomFields, setCreateCustomFields] = useState<CustomFieldValues>({});
  const createDealMutation = useMutation({
    mutationFn: (input: CreateDealInput) => apiClient.post<Deal>("/deals", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["deals"] });
      reset();
      setCreateCustomFields({});
      setShowForm(false);
    },
  });

  // Non optimiste : le statut et l'étape affichés dérivent toujours de la query ["deals"],
  // jamais d'une copie locale — en cas d'erreur, le <select> revient donc naturellement à la
  // valeur serveur, sans rollback à écrire.
  const moveStageMutation = useMutation({
    mutationFn: ({ id, stageId }: { id: string; stageId: string }) =>
      apiClient.post<Deal>(`/deals/${id}/move-stage`, { stageId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["deals"] }),
  });
  const winMutation = useMutation({
    mutationFn: (id: string) => apiClient.post<Deal>(`/deals/${id}/win`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["deals"] }),
  });
  const loseMutation = useMutation({
    mutationFn: ({ id, ...input }: { id: string } & LoseDealInput) =>
      apiClient.post<Deal>(`/deals/${id}/lose`, loseDealSchema.parse(input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["deals"] }),
  });
  const reopenMutation = useMutation({
    mutationFn: (id: string) => apiClient.post<Deal>(`/deals/${id}/reopen`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["deals"] }),
  });

  function pipelineForDeal(deal: Deal): Pipeline | undefined {
    return pipelines?.find((p) => p.id === deal.pipelineId);
  }
  function contactName(deal: Deal): string {
    const contact = contacts?.find((c) => c.id === deal.contactId);
    if (!contact) return "—";
    return [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.company || "—";
  }

  // Drag-and-drop between stage columns, using the browser's native HTML5 DnD API — mirrors the
  // leads board this page replaces. Dropping a card calls the same moveStageMutation already
  // used by the per-card <select> below.
  function handleCardDragStart(dealId: string) {
    return (event: DragEvent<HTMLDivElement>) => {
      event.dataTransfer.setData("text/plain", dealId);
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
      const dealId = event.dataTransfer.getData("text/plain");
      const deal = deals?.find((d) => d.id === dealId);
      if (!deal || deal.stageId === stageId || deal.status !== "open") return;
      moveStageMutation.mutate({ id: dealId, stageId });
    };
  }

  if (!pipelinesLoading && pipelines?.length === 0) {
    return (
      <Card className="p-6 text-sm text-text-muted">
        <p className="mb-3">Aucun pipeline n&apos;a encore été créé pour gérer vos affaires.</p>
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
          {showForm ? "Annuler" : "Nouvelle affaire"}
        </Button>
      </div>

      {showForm && selectedPipeline && (
        <form
          onSubmit={handleSubmit((values) =>
            createDealMutation.mutate({ ...values, customFields: createCustomFields }),
          )}
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

          {/* New deals are created directly in whichever pipeline the board is currently
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
          <Input
            type="number"
            placeholder="Probabilité (%)"
            {...register("probability", {
              setValueAs: (v: string) => (v === "" ? undefined : Number(v)),
            })}
          />

          <CustomFieldsFieldset
            entity="deals"
            values={createCustomFields}
            onChange={setCreateCustomFields}
            idPrefix="deal-create"
          />

          {createDealMutation.isError && (
            <p className="col-span-2 text-sm text-destructive">
              {createDealMutation.error instanceof ApiError ? createDealMutation.error.message : "Erreur"}
            </p>
          )}
          <Button type="submit" loading={createDealMutation.isPending} className="col-span-2">
            {createDealMutation.isPending ? "Création..." : "Créer l'affaire"}
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

      {dealsLoading && <p className="text-sm text-text-muted">Chargement...</p>}
      {!dealsLoading && deals?.length === 0 && (
        <p className="text-sm text-text-muted">Aucune affaire.</p>
      )}

      {/* Kanban board: one column per stage of the currently-selected pipeline. Cards are
          draggable between columns; each card keeps the same per-deal stage <select> as a
          non-drag, keyboard-reachable fallback (native HTML5 DnD has no keyboard equivalent).
          Only deals in the *selected* pipeline are shown as columns. */}
      <div className="overflow-x-auto pb-2">
        <div className="flex gap-4">
          {[...(selectedPipeline?.stages ?? [])]
            .sort((a, b) => a.order - b.order)
            .map((stage) => {
              const stageDeals = deals?.filter(
                (deal) => deal.pipelineId === selectedPipeline?.id && deal.stageId === stage.id,
              );
              return (
                <div
                  key={stage.id}
                  onDragOver={handleColumnDragOver}
                  onDrop={handleColumnDrop(stage.id)}
                  className="w-72 shrink-0 rounded-lg border border-border bg-surface-muted p-3"
                >
                  <h3
                    aria-label={`${stage.name} — ${stageDeals?.length ?? 0} affaire(s)`}
                    className="mb-3 flex items-center justify-between text-xs font-medium uppercase text-text-muted"
                  >
                    <span aria-hidden="true">{stage.name}</span>
                    <span aria-hidden="true" className="rounded-full bg-surface px-2 py-0.5 text-text-muted">
                      {stageDeals?.length ?? 0}
                    </span>
                  </h3>
                  <div className="space-y-2">
                    {stageDeals?.map((deal) => {
                      const pipeline = pipelineForDeal(deal);
                      const isRowPending =
                        (moveStageMutation.isPending && moveStageMutation.variables?.id === deal.id) ||
                        (winMutation.isPending && winMutation.variables === deal.id) ||
                        (loseMutation.isPending && loseMutation.variables?.id === deal.id) ||
                        (reopenMutation.isPending && reopenMutation.variables === deal.id);
                      return (
                        <div
                          key={deal.id}
                          draggable={!isRowPending && deal.status === "open"}
                          onDragStart={handleCardDragStart(deal.id)}
                          className={cn(
                            "space-y-2 rounded-md border border-border bg-surface p-2 text-sm shadow-sm",
                            isRowPending ? "cursor-wait opacity-60" : "cursor-grab",
                          )}
                        >
                          <Link
                            href={`/dashboard/crm/deals/${deal.id}`}
                            className="block font-medium text-text underline-offset-2 hover:underline"
                          >
                            {contactName(deal)}
                          </Link>
                          <p className="text-text-muted">{deal.estimatedValue ?? "—"}</p>
                          {deal.status === "open" && (
                            <>
                              <select
                                aria-label={`Étape de ${contactName(deal)}`}
                                value={deal.stageId}
                                disabled={isRowPending || !pipeline}
                                onChange={(e) =>
                                  moveStageMutation.mutate({ id: deal.id, stageId: e.target.value })
                                }
                                className="w-full rounded-md border border-border-input px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {pipeline?.stages.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.name}
                                  </option>
                                ))}
                              </select>
                              <div className="flex gap-1">
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  className="flex-1"
                                  disabled={isRowPending}
                                  onClick={() => winMutation.mutate(deal.id)}
                                >
                                  Gagner
                                </Button>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  className="flex-1"
                                  disabled={isRowPending}
                                  onClick={() => {
                                    const lossReason = window.prompt("Raison de la perte (optionnel)") ?? undefined;
                                    loseMutation.mutate({ id: deal.id, lossReason });
                                  }}
                                >
                                  Perdre
                                </Button>
                              </div>
                            </>
                          )}
                          {deal.status !== "open" && (
                            <Button
                              variant="secondary"
                              size="sm"
                              className="w-full"
                              disabled={isRowPending}
                              onClick={() => reopenMutation.mutate(deal.id)}
                            >
                              Rouvrir
                            </Button>
                          )}
                          {((loseMutation.isError && loseMutation.variables?.id === deal.id) ||
                            (winMutation.isError && winMutation.variables === deal.id) ||
                            (moveStageMutation.isError && moveStageMutation.variables?.id === deal.id) ||
                            (reopenMutation.isError && reopenMutation.variables === deal.id)) && (
                            <p className="text-xs text-destructive">
                              Impossible de mettre à jour l&apos;affaire.
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
        totalPages={dealsPage?.pagination.totalPages ?? 1}
        onPageChange={setPage}
        disabled={dealsLoading}
      />
    </div>
  );
}
