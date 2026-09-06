"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { updateTicketSchema, type UpdateTicketInput } from "@korva/validation";
import {
  TICKET_PRIORITIES,
  type Contact,
  type Ticket,
  type TicketPriority,
  type TicketStatus,
} from "@korva/types";
import { Badge, Button, Card, Input, Select } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { CustomFieldsDisplay } from "@/components/custom-fields-display";

interface MemberRow {
  id: string;
  userId: { id: string; email: string; firstName?: string; lastName?: string };
}

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

function memberName(member: MemberRow): string {
  return (
    [member.userId.firstName, member.userId.lastName].filter(Boolean).join(" ") ||
    member.userId.email
  );
}

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [editing, setEditing] = useState(false);
  const [assigneeId, setAssigneeId] = useState("");
  const queryClient = useQueryClient();
  const authReady = useAuthReady();

  const { data: ticket, isLoading } = useQuery({
    queryKey: ["tickets", id],
    queryFn: () => apiClient.get<Ticket>(`/tickets/${id}`),
    enabled: authReady && !!id,
  });

  const { data: contact } = useQuery({
    queryKey: ["contacts", ticket?.contactId],
    queryFn: () => apiClient.get<Contact>(`/contacts/${ticket?.contactId}`),
    enabled: authReady && !!ticket?.contactId,
  });

  const { data: members } = useQuery({
    queryKey: ["organizations", "me", "members"],
    queryFn: () => apiClient.get<MemberRow[]>("/organizations/me/members"),
    enabled: authReady,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<UpdateTicketInput>({ resolver: zodResolver(updateTicketSchema) });

  useEffect(() => {
    if (ticket) {
      reset({ subject: ticket.subject, description: ticket.description, priority: ticket.priority });
    }
  }, [ticket, reset]);

  const updateMutation = useMutation({
    mutationFn: (input: UpdateTicketInput) =>
      apiClient.patch<Ticket>(`/tickets/${id}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tickets", id] });
      setEditing(false);
    },
  });

  const transitionMutation = useMutation({
    mutationFn: (action: "resolve" | "close" | "reopen") =>
      apiClient.post<Ticket>(`/tickets/${id}/${action}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["tickets", id] }),
  });

  const assignMutation = useMutation({
    mutationFn: (assigneeMembershipId: string) =>
      apiClient.post<Ticket>(`/tickets/${id}/assign`, { assigneeMembershipId }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["tickets", id] }),
  });

  if (isLoading || !ticket) {
    return <p className="text-sm text-text-muted">Chargement...</p>;
  }

  const assignee = members?.find((m) => m.id === ticket.assigneeMembershipId);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{ticket.subject}</h1>
          <div className="mt-1 flex items-center gap-2">
            <Badge variant={STATUS_VARIANTS[ticket.status]}>{STATUS_LABELS[ticket.status]}</Badge>
            <Badge>{PRIORITY_LABELS[ticket.priority]}</Badge>
          </div>
        </div>
        <div className="flex gap-2">
          {ticket.status !== "closed" && ticket.status !== "resolved" && (
            <Button
              variant="secondary"
              loading={transitionMutation.isPending}
              onClick={() => transitionMutation.mutate("resolve")}
            >
              Résoudre
            </Button>
          )}
          {ticket.status !== "closed" && (
            <Button
              variant="secondary"
              loading={transitionMutation.isPending}
              onClick={() => transitionMutation.mutate("close")}
            >
              Fermer
            </Button>
          )}
          {ticket.status === "closed" && (
            <Button
              variant="secondary"
              loading={transitionMutation.isPending}
              onClick={() => transitionMutation.mutate("reopen")}
            >
              Réouvrir
            </Button>
          )}
        </div>
      </div>

      {transitionMutation.isError && (
        <p className="text-sm text-destructive">
          {errorMessage(transitionMutation.error, "Action impossible.")}
        </p>
      )}

      <Card className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-text">Détails</p>
          <button
            onClick={() => setEditing((v) => !v)}
            className="text-xs font-medium text-text underline"
          >
            {editing ? "Annuler" : "Modifier"}
          </button>
        </div>

        {!editing ? (
          <div className="mt-3 space-y-2 text-sm">
            <p className="text-text-muted">{ticket.description || "Aucune description."}</p>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit((values) => updateMutation.mutate(values))}
            className="mt-3 space-y-3"
          >
            <Input placeholder="Sujet" {...register("subject")} />
            {errors.subject && <p className="text-xs text-destructive">{errors.subject.message}</p>}
            <Select {...register("priority")}>
              {TICKET_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {PRIORITY_LABELS[priority]}
                </option>
              ))}
            </Select>
            <textarea
              placeholder="Description"
              className="w-full rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
              rows={3}
              {...register("description")}
            />
            {updateMutation.isError && (
              <p className="text-sm text-destructive">
                {errorMessage(updateMutation.error, "Impossible de mettre à jour ce ticket.")}
              </p>
            )}
            <Button type="submit" loading={updateMutation.isPending}>
              Enregistrer
            </Button>
          </form>
        )}

        <div className="mt-4 border-t border-border pt-3">
          <CustomFieldsDisplay entity="tickets" values={ticket.customFields} />
        </div>
      </Card>

      <Card className="p-4">
        <p className="text-sm font-medium text-text">Contact</p>
        {contact && (
          <Link
            href={`/dashboard/crm/${contact.id}`}
            className="mt-1 block text-sm text-text hover:underline"
          >
            {[contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
              contact.company ||
              contact.email}
          </Link>
        )}
      </Card>

      <Card className="p-4">
        <p className="text-sm font-medium text-text">Assigné à</p>
        <div className="mt-2 flex items-center gap-2">
          <p className="text-sm text-text-muted">
            {assignee ? memberName(assignee) : "Non assigné"}
          </p>
          <Select
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            className="ml-auto"
          >
            <option value="">Sélectionner un membre</option>
            {members?.map((member) => (
              <option key={member.id} value={member.id}>
                {memberName(member)}
              </option>
            ))}
          </Select>
          <Button
            variant="secondary"
            size="sm"
            disabled={!assigneeId}
            loading={assignMutation.isPending}
            onClick={() => assignMutation.mutate(assigneeId)}
          >
            Assigner
          </Button>
        </div>
        {assignMutation.isError && (
          <p className="mt-2 text-xs text-destructive">
            {errorMessage(assignMutation.error, "Impossible d'assigner ce ticket.")}
          </p>
        )}
      </Card>
    </div>
  );
}
