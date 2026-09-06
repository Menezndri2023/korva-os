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

const STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Ouvert",
  in_progress: "En cours",
  resolved: "Résolu",
  closed: "Fermé",
};

const STATUS_VARIANTS: Record<TicketStatus, "default" | "success" | "warning"> = {
  open: "warning",
  in_progress: "warning",
  resolved: "success",
  closed: "default",
};

const PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: "Basse",
  medium: "Normale",
  high: "Haute",
  urgent: "Urgente",
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export default function TicketsPage() {
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
          <p className="text-sm text-text-muted">Demandes de support client.</p>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Tous les statuts</option>
            {TICKET_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Annuler" : "Nouveau ticket"}
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit((values) => createMutation.mutate(values))}
          className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface p-4"
        >
          <Input placeholder="Sujet" className="col-span-2" {...register("subject")} />
          {errors.subject && (
            <p className="col-span-2 text-xs text-destructive">{errors.subject.message}</p>
          )}

          <Select {...register("contactId")}>
            <option value="">Sélectionner un contact</option>
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
                {PRIORITY_LABELS[priority]}
              </option>
            ))}
          </Select>

          <textarea
            placeholder="Description (optionnel)"
            className="col-span-2 w-full rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            rows={3}
            {...register("description")}
          />

          {createMutation.isError && (
            <p className="col-span-2 text-sm text-destructive">
              {errorMessage(createMutation.error, "Impossible de créer ce ticket.")}
            </p>
          )}
          <Button type="submit" loading={createMutation.isPending} className="col-span-2">
            {createMutation.isPending ? "Création..." : "Créer le ticket"}
          </Button>
        </form>
      )}

      {isError && (
        <Card className="p-6">
          <p className="text-sm text-destructive">Impossible de charger les tickets.</p>
          <button onClick={() => refetch()} className="mt-2 text-sm font-medium text-text underline">
            Réessayer
          </button>
        </Card>
      )}

      {!isError && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium uppercase text-text-muted">
                <tr>
                  <th className="px-4 py-2">Sujet</th>
                  <th className="px-4 py-2">Contact</th>
                  <th className="px-4 py-2">Priorité</th>
                  <th className="px-4 py-2">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-text-muted">
                      Chargement...
                    </td>
                  </tr>
                )}
                {!isLoading && tickets?.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-text-muted">
                      Aucun ticket.
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
                    <td className="px-4 py-2 text-text-muted">{PRIORITY_LABELS[ticket.priority]}</td>
                    <td className="px-4 py-2">
                      <Badge variant={STATUS_VARIANTS[ticket.status]}>
                        {STATUS_LABELS[ticket.status]}
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
