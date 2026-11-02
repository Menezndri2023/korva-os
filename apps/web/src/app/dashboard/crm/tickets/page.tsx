"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createTicketSchema, type CreateTicketInput } from "@korva/validation";
import {
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type Contact,
  type Ticket,
  type TicketPriority,
  type TicketStatus,
} from "@korva/types";
import { Badge, Button, Card, Input, Select } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { useT } from "@/lib/dashboard-locale";

const STATUS_LABELS: Record<TicketStatus, [string, string]> = {
  open: ["Ouvert", "Open"],
  in_progress: ["En cours", "In progress"],
  resolved: ["Résolu", "Resolved"],
  closed: ["Fermé", "Closed"],
};

const STATUS_VARIANTS: Record<TicketStatus, "default" | "success" | "warning"> = {
  open: "warning",
  in_progress: "warning",
  resolved: "success",
  closed: "default",
};

const PRIORITY_LABELS: Record<TicketPriority, [string, string]> = {
  low: ["Basse", "Low"],
  medium: ["Normale", "Normal"],
  high: ["Haute", "High"],
  urgent: ["Urgente", "Urgent"],
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export default function TicketsPage() {
  const t = useT();
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const queryClient = useQueryClient();
  const authReady = useAuthReady();

  const { data: tickets, isLoading, isError, refetch } = useQuery({
    queryKey: ["tickets", statusFilter],
    queryFn: () =>
      apiClient.get<Ticket[]>(`/tickets${statusFilter ? `?status=${statusFilter}` : ""}`),
    enabled: authReady,
  });

  const { data: contacts } = useQuery({
    queryKey: ["contacts", ""],
    queryFn: () => apiClient.get<Contact[]>("/contacts"),
    enabled: authReady,
  });

  function contactName(contactId: string): string {
    const contact = contacts?.find((c) => c.id === contactId);
    if (!contact) return "—";
    return (
      [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
      contact.company ||
      contact.email ||
      "—"
    );
  }

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateTicketInput>({
    resolver: zodResolver(createTicketSchema),
    defaultValues: { priority: "medium" },
  });

  const createMutation = useMutation({
    mutationFn: (input: CreateTicketInput) => apiClient.post<Ticket>("/tickets", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tickets"] });
      reset({ priority: "medium" });
      setShowForm(false);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <p className="text-sm text-text-muted">{t(
            "Demandes de support client.",
            "Customer support requests.",
          )}</p>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">{t("Tous les statuts", "All statuses")}</option>
            {TICKET_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(...STATUS_LABELS[status])}
              </option>
            ))}
          </Select>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? t("Annuler", "Cancel") : t("Nouveau ticket", "New ticket")}
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit((values) => createMutation.mutate(values))}
          className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface p-4"
        >
          <Input placeholder={t("Sujet", "Subject")} className="col-span-2" {...register("subject")} />
          {errors.subject && (
            <p className="col-span-2 text-xs text-destructive">{errors.subject.message}</p>
          )}

          <Select {...register("contactId")}>
            <option value="">{t("Sélectionner un contact", "Select a contact")}</option>
            {contacts?.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {[contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
                  contact.company ||
                  contact.email}
              </option>
            ))}
          </Select>
          {errors.contactId && (
            <p className="text-xs text-destructive">{errors.contactId.message}</p>
          )}

          <Select {...register("priority")}>
            {TICKET_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {t(...PRIORITY_LABELS[priority])}
              </option>
            ))}
          </Select>

          <textarea
            placeholder={t("Description (optionnel)", "Description (optional)")}
            className="col-span-2 w-full rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            rows={3}
            {...register("description")}
          />

          {createMutation.isError && (
            <p className="col-span-2 text-sm text-destructive">
              {errorMessage(createMutation.error, t(
                "Impossible de créer ce ticket.",
                "This ticket could not be created.",
              ))}
            </p>
          )}
          <Button type="submit" loading={createMutation.isPending} className="col-span-2">
            {createMutation.isPending ? t("Création...", "Creating...") : t("Créer le ticket", "Create the ticket")}
          </Button>
        </form>
      )}

      {isError && (
        <Card className="p-6">
          <p className="text-sm text-destructive">{t(
            "Impossible de charger les tickets.",
            "Tickets could not be loaded.",
          )}</p>
          <button onClick={() => refetch()} className="mt-2 text-sm font-medium text-text underline">
            {t("Réessayer", "Try again")}
          </button>
        </Card>
      )}

      {!isError && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium text-text-muted">
                <tr>
                  <th className="px-4 py-2">{t("Sujet", "Subject")}</th>
                  <th className="px-4 py-2">{t("Contact", "Contact")}</th>
                  <th className="px-4 py-2">{t("Priorité", "Priority")}</th>
                  <th className="px-4 py-2">{t("Statut", "Status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-text-muted">
                      {t("Chargement...", "Loading...")}
                    </td>
                  </tr>
                )}
                {!isLoading && tickets?.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-text-muted">
                      {t("Aucun ticket.", "No tickets.")}
                    </td>
                  </tr>
                )}
                {tickets?.map((ticket) => (
                  <tr key={ticket.id}>
                    <td className="px-4 py-2 font-medium">
                      <Link href={`/dashboard/crm/tickets/${ticket.id}`} className="hover:underline">
                        {ticket.subject}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-text-muted">{contactName(ticket.contactId)}</td>
                    <td className="px-4 py-2 text-text-muted">{t(...PRIORITY_LABELS[ticket.priority])}</td>
                    <td className="px-4 py-2">
                      <Badge variant={STATUS_VARIANTS[ticket.status]}>
                        {t(...STATUS_LABELS[ticket.status])}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
