"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  convertLeadSchema,
  createLeadSchema,
  type ConvertLeadInput,
  type CreateLeadInput,
} from "@korva/validation";
import { LEAD_STATUSES } from "@korva/types";
import type { Contact, CustomFieldValues, Deal, Lead, Pipeline } from "@korva/types";
import { Badge, Button, Card, Input, Pagination, Select } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { LEAD_STATUS_LABELS } from "@/lib/analytics-format";
import { CustomFieldsFieldset } from "@/components/custom-fields-fieldset";

export default function LeadsPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [page, setPage] = useState(1);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const authReady = useAuthReady();

  const { data: contacts } = useQuery({
    queryKey: ["contacts", ""],
    queryFn: () => apiClient.get<Contact[]>("/contacts"),
    enabled: authReady,
  });
  const { data: pipelines } = useQuery({
    queryKey: ["pipelines"],
    queryFn: () => apiClient.get<Pipeline[]>("/pipelines"),
    enabled: authReady,
  });
  const { data: leadsPage, isLoading: leadsLoading } = useQuery({
    queryKey: ["leads", page, statusFilter],
    queryFn: () =>
      apiClient.getList<Lead>(
        `/leads?page=${page}${statusFilter ? `&status=${statusFilter}` : ""}`,
      ),
    enabled: authReady,
  });
  const leads = leadsPage?.data;

  function contactName(contactId: string): string {
    const contact = contacts?.find((c) => c.id === contactId);
    if (!contact) return "—";
    return [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.company || "—";
  }

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

  const defaultPipeline = pipelines?.find((p) => p.isDefault) ?? pipelines?.[0];
  const {
    register: registerConvert,
    handleSubmit: handleConvertSubmit,
    reset: resetConvertForm,
    watch: watchConvert,
    formState: { errors: convertErrors },
  } = useForm<ConvertLeadInput>({ resolver: zodResolver(convertLeadSchema) });
  const convertPipelineId = watchConvert("pipelineId");
  const convertPipeline = pipelines?.find((p) => p.id === convertPipelineId) ?? defaultPipeline;

  const convertMutation = useMutation({
    mutationFn: ({ id, ...input }: { id: string } & ConvertLeadInput) =>
      apiClient.post<{ lead: Lead; deal: Deal }>(`/leads/${id}/convert`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      void queryClient.invalidateQueries({ queryKey: ["deals"] });
      resetConvertForm();
      setConvertingId(null);
    },
  });

  function startConvert(leadId: string) {
    setConvertingId(leadId);
    resetConvertForm({
      pipelineId: defaultPipeline?.id ?? "",
      stageId: defaultPipeline?.stages[0]?.id ?? "",
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-56">
          <option value="">Tous les statuts</option>
          {LEAD_STATUSES.map((status) => (
            <option key={status} value={status}>
              {LEAD_STATUS_LABELS[status] ?? status}
            </option>
          ))}
        </Select>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Annuler" : "Nouveau prospect"}
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit((values) =>
            createLeadMutation.mutate({ ...values, customFields: createCustomFields }),
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

          <Input className="col-span-2" placeholder="Source (optionnel)" {...register("source")} />

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

      {leadsLoading && <p className="text-sm text-text-muted">Chargement...</p>}
      {!leadsLoading && leads?.length === 0 && (
        <p className="text-sm text-text-muted">Aucun prospect.</p>
      )}

      {!leadsLoading && leads && leads.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium text-text-muted">
                <tr>
                  <th className="px-4 py-2">Contact</th>
                  <th className="px-4 py-2">Source</th>
                  <th className="px-4 py-2">Statut</th>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {leads.map((lead) => (
                  <tr key={lead.id}>
                    <td className="px-4 py-2 font-medium">
                      <Link href={`/dashboard/crm/leads/${lead.id}`} className="hover:underline">
                        {contactName(lead.contactId)}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-text-muted">{lead.source ?? "—"}</td>
                    <td className="px-4 py-2">
                      <Badge>{LEAD_STATUS_LABELS[lead.status] ?? lead.status}</Badge>
                    </td>
                    <td className="px-4 py-2 text-text-muted">
                      {new Date(lead.createdAt).toLocaleDateString("fr-FR")}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {lead.status !== "converted" && (
                        <Button variant="ghost" size="sm" onClick={() => startConvert(lead.id)}>
                          Convertir en affaire
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {convertingId && (
        <form
          onSubmit={handleConvertSubmit((values) =>
            convertMutation.mutate({ id: convertingId, ...values }),
          )}
          className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface p-4"
        >
          <p className="col-span-2 text-sm font-medium text-text">
            Convertir {contactName(leads?.find((l) => l.id === convertingId)?.contactId ?? "")} en affaire
          </p>
          <Select {...registerConvert("pipelineId")}>
            {pipelines?.map((pipeline) => (
              <option key={pipeline.id} value={pipeline.id}>
                {pipeline.name}
              </option>
            ))}
          </Select>
          <Select {...registerConvert("stageId")}>
            {convertPipeline?.stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </Select>
          <Input
            type="number"
            placeholder="Valeur estimée"
            {...registerConvert("estimatedValue", {
              setValueAs: (v: string) => (v === "" ? undefined : Number(v)),
            })}
          />
          <Input
            type="number"
            placeholder="Probabilité (%)"
            {...registerConvert("probability", {
              setValueAs: (v: string) => (v === "" ? undefined : Number(v)),
            })}
          />
          {convertErrors.pipelineId && (
            <p className="col-span-2 text-xs text-destructive">{convertErrors.pipelineId.message}</p>
          )}
          {convertMutation.isError && (
            <p className="col-span-2 text-sm text-destructive">
              {convertMutation.error instanceof ApiError
                ? convertMutation.error.message
                : "Impossible de convertir ce prospect."}
            </p>
          )}
          <div className="col-span-2 flex gap-2">
            <Button type="submit" loading={convertMutation.isPending}>
              {convertMutation.isPending ? "Conversion..." : "Convertir"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setConvertingId(null)}>
              Annuler
            </Button>
          </div>
        </form>
      )}

      <Pagination
        page={page}
        totalPages={leadsPage?.pagination.totalPages ?? 1}
        onPageChange={setPage}
        disabled={leadsLoading}
      />
    </div>
  );
}
