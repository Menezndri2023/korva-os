"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Contact, ReturnRequest, ReturnRequestStatus } from "@korva/types";
import { Badge, Card, Pagination } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";

const STATUS_LABELS: Record<ReturnRequestStatus, string> = {
  pending: "En attente",
  approved: "Approuvé",
  rejected: "Refusé",
};

const STATUS_VARIANT: Record<
  ReturnRequestStatus,
  "default" | "success" | "warning" | "destructive"
> = {
  pending: "warning",
  approved: "success",
  rejected: "destructive",
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("fr-FR");
}

export default function ReturnsPage() {
  const [statusFilter, setStatusFilter] = useState<ReturnRequestStatus | "">(
    "pending",
  );
  const [page, setPage] = useState(1);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const authReady = useAuthReady();

  const {
    data: returnsPage,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["returns", statusFilter, page],
    queryFn: () =>
      apiClient.getList<ReturnRequest>(
        `/returns?page=${page}${statusFilter ? `&status=${statusFilter}` : ""}`,
      ),
    enabled: authReady,
  });
  const returns = returnsPage?.data;

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
      "—"
    );
  }

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["returns"] });

  const approveMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.post<ReturnRequest>(`/returns/${id}/approve`),
    onSuccess: invalidate,
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.post<ReturnRequest>(`/returns/${id}/reject`, {}),
    onSuccess: () => {
      invalidate();
      setRejectingId(null);
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Retours</h1>
        <p className="mt-1 text-sm text-text-muted">
          Les clients demandent un retour depuis leur espace client — approuvez
          ou refusez la demande ici. Une approbation déclenche un remboursement
          réel et remet le stock à jour automatiquement.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["pending", "approved", "rejected", ""] as const).map((status) => (
          <button
            key={status || "all"}
            onClick={() => {
              setStatusFilter(status);
              setPage(1);
            }}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              statusFilter === status
                ? "border-primary bg-sidebar text-white"
                : "border-border text-text-muted hover:text-text"
            }`}
          >
            {status ? STATUS_LABELS[status] : "Tous"}
          </button>
        ))}
      </div>

      {isError && (
        <Card className="p-6">
          <p className="text-sm text-destructive">
            Impossible de charger les demandes de retour.
          </p>
          <button
            onClick={() => refetch()}
            className="mt-2 text-sm font-medium text-text underline"
          >
            Réessayer
          </button>
        </Card>
      )}

      {!isError && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium text-text-muted">
                <tr>
                  <th className="px-4 py-2">Client</th>
                  <th className="px-4 py-2">Commande</th>
                  <th className="px-4 py-2">Motif</th>
                  <th className="px-4 py-2">Montant</th>
                  <th className="px-4 py-2">Demandé le</th>
                  <th className="px-4 py-2">Statut</th>
                  <th className="px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-text-muted">
                      Chargement...
                    </td>
                  </tr>
                )}
                {!isLoading && returns?.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-text-muted">
                      Aucune demande de retour.
                    </td>
                  </tr>
                )}
                {returns?.map((returnRequest) => (
                  <tr key={returnRequest.id}>
                    <td className="px-4 py-2 font-medium">
                      {contactName(returnRequest.contactId)}
                    </td>
                    <td className="px-4 py-2">
                      <Link
                        href={`/dashboard/orders/${returnRequest.orderId}`}
                        className="text-text underline"
                      >
                        Voir la commande
                      </Link>
                    </td>
                    <td className="max-w-xs truncate px-4 py-2 text-text-muted">
                      {returnRequest.reason}
                    </td>
                    <td className="px-4 py-2 text-text-muted">
                      {returnRequest.refundAmount} {returnRequest.currency}
                    </td>
                    <td className="px-4 py-2 text-text-muted">
                      {formatDate(returnRequest.createdAt)}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant={STATUS_VARIANT[returnRequest.status]}>
                        {STATUS_LABELS[returnRequest.status]}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">
                      {returnRequest.status === "pending" && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => approveMutation.mutate(returnRequest.id)}
                            disabled={
                              approveMutation.isPending &&
                              approveMutation.variables === returnRequest.id
                            }
                            className="text-xs font-medium text-emerald-700 hover:underline"
                          >
                            Approuver (rembourser)
                          </button>
                          {rejectingId === returnRequest.id ? (
                            <button
                              onClick={() => rejectMutation.mutate(returnRequest.id)}
                              disabled={
                                rejectMutation.isPending &&
                                rejectMutation.variables === returnRequest.id
                              }
                              className="text-xs font-medium text-destructive hover:underline"
                            >
                              Confirmer ?
                            </button>
                          ) : (
                            <button
                              onClick={() => setRejectingId(returnRequest.id)}
                              className="text-xs text-destructive hover:underline"
                            >
                              Refuser
                            </button>
                          )}
                        </div>
                      )}
                      {approveMutation.isError &&
                        approveMutation.variables === returnRequest.id && (
                          <p className="mt-1 text-xs text-destructive">
                            {errorMessage(
                              approveMutation.error,
                              "Impossible d'approuver ce retour.",
                            )}
                          </p>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Pagination
        page={page}
        totalPages={returnsPage?.pagination.totalPages ?? 1}
        onPageChange={setPage}
        disabled={isLoading}
      />
    </div>
  );
}
