"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createTimeEntrySchema,
  type CreateTimeEntryInput,
} from "@korva/validation";
import {
  TIME_ENTRY_STATUSES,
  type Contact,
  type Invoice,
  type TimeEntry,
  type TimeEntryStatus,
} from "@korva/types";
import { Badge, Button, Card, Dialog, Input, Pagination } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";

const STATUS_LABELS: Record<TimeEntryStatus, string> = {
  unbilled: "Non facturé",
  approved: "Approuvé",
  invoiced: "Facturé",
  voided: "Annulé",
};

const STATUS_VARIANT: Record<
  TimeEntryStatus,
  "default" | "success" | "warning" | "destructive"
> = {
  unbilled: "warning",
  approved: "default",
  invoiced: "success",
  voided: "destructive",
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function formatHours(durationMinutes: number): string {
  return (durationMinutes / 60).toLocaleString("fr-FR", {
    maximumFractionDigits: 2,
  });
}

export default function TimeEntriesPage() {
  const [statusFilter, setStatusFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [page, setPage] = useState(1);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [deletingEntry, setDeletingEntry] = useState<TimeEntry | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const authReady = useAuthReady();
  const router = useRouter();

  const {
    data: entriesPage,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["time-entries", statusFilter, page],
    queryFn: () =>
      apiClient.getList<TimeEntry>(
        `/time-entries?page=${page}${statusFilter ? `&status=${statusFilter}` : ""}`,
      ),
    enabled: authReady,
  });
  const entries = entriesPage?.data;

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

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateTimeEntryInput>({
    resolver: zodResolver(createTimeEntrySchema),
    defaultValues: { currency: "EUR", billable: true },
  });

  const createMutation = useMutation({
    mutationFn: (input: CreateTimeEntryInput) =>
      apiClient.post<TimeEntry>("/time-entries", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["time-entries"] });
      reset();
      setShowForm(false);
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.post<TimeEntry>(`/time-entries/${id}/approve`),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["time-entries"] }),
  });

  const voidMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.post<TimeEntry>(`/time-entries/${id}/void`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["time-entries"] });
      setVoidingId(null);
    },
    onError: () => setVoidingId(null),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.delete<{ deleted: true }>(`/time-entries/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["time-entries"] });
      setDeletingEntry(null);
    },
  });

  const generateInvoiceMutation = useMutation({
    mutationFn: (timeEntryIds: string[]) =>
      apiClient.post<Invoice>("/time-entries/generate-invoice", {
        timeEntryIds,
      }),
    onSuccess: (invoice) => {
      void queryClient.invalidateQueries({ queryKey: ["time-entries"] });
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
      setSelectedIds(new Set());
      router.push(`/dashboard/finance/invoices/${invoice.id}`);
    },
  });

  const selectedEntries = (entries ?? []).filter((e) => selectedIds.has(e.id));
  const selectionContactIds = new Set(selectedEntries.map((e) => e.contactId));
  const selectionCurrencies = new Set(selectedEntries.map((e) => e.currency));
  const selectionMixed = selectionContactIds.size > 1 || selectionCurrencies.size > 1;

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Suivi du temps</h1>
        <p className="mt-1 text-sm text-text-muted">
          Heures facturables saisies pour vos clients — approuvez-les puis
          générez une facture.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
        >
          <option value="">Tous les statuts</option>
          {TIME_ENTRY_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Annuler" : "Nouvelle entrée"}
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit((values) => createMutation.mutate(values))}
          className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface p-4"
        >
          <select
            className="col-span-2 rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            defaultValue=""
            {...register("contactId")}
          >
            <option value="" disabled>
              Choisir un client
            </option>
            {contacts?.map((c) => (
              <option key={c.id} value={c.id}>
                {[c.firstName, c.lastName].filter(Boolean).join(" ") ||
                  c.company ||
                  c.email}
              </option>
            ))}
          </select>
          {errors.contactId && (
            <p className="col-span-2 text-xs text-destructive">
              {errors.contactId.message}
            </p>
          )}

          <Input
            placeholder="Description"
            className="col-span-2"
            {...register("description")}
          />
          {errors.description && (
            <p className="col-span-2 text-xs text-destructive">
              {errors.description.message}
            </p>
          )}

          <Input
            type="date"
            aria-label="Date"
            {...register("date", {
              setValueAs: (value: string) =>
                value ? new Date(value).toISOString() : value,
            })}
          />
          {errors.date && (
            <p className="text-xs text-destructive">{errors.date.message}</p>
          )}

          <Input
            type="number"
            step="0.25"
            placeholder="Heures"
            {...register("durationMinutes", {
              setValueAs: (value: string) =>
                value ? Math.round(parseFloat(value) * 60) : value,
            })}
          />
          {errors.durationMinutes && (
            <p className="text-xs text-destructive">
              {errors.durationMinutes.message}
            </p>
          )}

          <Input
            type="number"
            step="0.01"
            placeholder="Taux horaire (auto si vide)"
            {...register("hourlyRate", {
              setValueAs: (value: string) => (value === "" ? undefined : Number(value)),
            })}
          />
          <Input placeholder="Devise (EUR)" {...register("currency")} />
          {errors.hourlyRate && (
            <p className="text-xs text-destructive">
              {errors.hourlyRate.message}
            </p>
          )}
          {errors.currency && (
            <p className="text-xs text-destructive">
              {errors.currency.message}
            </p>
          )}

          <label className="col-span-2 flex items-center gap-2 text-sm text-text">
            <input type="checkbox" defaultChecked {...register("billable")} />
            Facturable
          </label>

          <textarea
            placeholder="Notes (optionnel)"
            className="col-span-2 rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            rows={2}
            {...register("notes")}
          />

          {createMutation.isError && (
            <p className="col-span-2 text-sm text-destructive">
              {errorMessage(
                createMutation.error,
                "Impossible d'enregistrer l'entrée de temps.",
              )}
            </p>
          )}
          <Button
            type="submit"
            loading={createMutation.isPending}
            className="col-span-2"
          >
            {createMutation.isPending ? "Enregistrement..." : "Enregistrer"}
          </Button>
        </form>
      )}

      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-surface p-3">
          <div className="text-sm text-text-muted">
            {selectedIds.size} entrée{selectedIds.size > 1 ? "s" : ""}{" "}
            sélectionnée{selectedIds.size > 1 ? "s" : ""}
            {selectionMixed && (
              <span className="ml-2 text-destructive">
                — la sélection doit concerner un seul client et une seule devise
              </span>
            )}
          </div>
          <Button
            size="sm"
            disabled={selectionMixed || generateInvoiceMutation.isPending}
            loading={generateInvoiceMutation.isPending}
            onClick={() =>
              generateInvoiceMutation.mutate(Array.from(selectedIds))
            }
          >
            Générer une facture
          </Button>
        </div>
      )}
      {generateInvoiceMutation.isError && (
        <p className="text-sm text-destructive">
          {errorMessage(
            generateInvoiceMutation.error,
            "Impossible de générer la facture.",
          )}
        </p>
      )}

      {isError && (
        <Card className="p-6">
          <p className="text-sm text-destructive">
            Impossible de charger les entrées de temps.
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
              <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium uppercase text-text-muted">
                <tr>
                  <th className="px-4 py-2" />
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Client</th>
                  <th className="px-4 py-2">Description</th>
                  <th className="px-4 py-2">Durée</th>
                  <th className="px-4 py-2">Taux</th>
                  <th className="px-4 py-2">Montant</th>
                  <th className="px-4 py-2">Statut</th>
                  <th className="px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading && (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-6 text-center text-text-muted"
                    >
                      Chargement...
                    </td>
                  </tr>
                )}
                {!isLoading && entries?.length === 0 && (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-6 text-center text-text-muted"
                    >
                      <p>Aucune entrée de temps.</p>
                      <p className="mt-1">
                        Saisissez les heures travaillées pour un client afin de
                        les approuver puis les facturer.
                      </p>
                    </td>
                  </tr>
                )}
                {entries?.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-4 py-2">
                      {entry.status === "approved" && (
                        <input
                          type="checkbox"
                          checked={selectedIds.has(entry.id)}
                          onChange={() => toggleSelected(entry.id)}
                        />
                      )}
                    </td>
                    <td className="px-4 py-2 text-text-muted">
                      {new Date(entry.date).toLocaleDateString("fr-FR")}
                    </td>
                    <td className="px-4 py-2 text-text-muted">
                      {contactName(entry.contactId)}
                    </td>
                    <td className="px-4 py-2 text-text-muted">
                      {entry.description}
                    </td>
                    <td className="px-4 py-2 text-text-muted">
                      {formatHours(entry.durationMinutes)}h
                    </td>
                    <td className="px-4 py-2 text-text-muted">
                      {entry.hourlyRate ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-text-muted">
                      {entry.hourlyRate
                        ? `${(
                            (entry.durationMinutes / 60) *
                            entry.hourlyRate
                          ).toLocaleString("fr-FR", {
                            maximumFractionDigits: 2,
                          })} ${entry.currency}`
                        : "—"}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant={STATUS_VARIANT[entry.status]}>
                        {STATUS_LABELS[entry.status]}
                      </Badge>
                    </td>
                    <td className="space-x-2 px-4 py-2">
                      {entry.status === "unbilled" && (
                        <button
                          onClick={() => approveMutation.mutate(entry.id)}
                          disabled={approveMutation.isPending}
                          className="text-xs text-text-muted hover:underline"
                        >
                          Approuver
                        </button>
                      )}
                      {(entry.status === "unbilled" ||
                        entry.status === "approved") &&
                        (voidingId === entry.id ? (
                          <>
                            <button
                              onClick={() => voidMutation.mutate(entry.id)}
                              disabled={voidMutation.isPending}
                              className="text-xs text-text-muted hover:underline"
                            >
                              {voidMutation.isPending ? "..." : "Confirmer ?"}
                            </button>
                            <button
                              onClick={() => setVoidingId(null)}
                              disabled={voidMutation.isPending}
                              className="text-xs text-text-muted hover:underline"
                            >
                              Retour
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setVoidingId(entry.id)}
                            className="text-xs text-text-muted hover:underline"
                          >
                            Annuler
                          </button>
                        ))}
                      {entry.status !== "invoiced" && (
                        <button
                          onClick={() => setDeletingEntry(entry)}
                          className="text-xs text-destructive hover:underline"
                        >
                          Supprimer
                        </button>
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
        totalPages={entriesPage?.pagination.totalPages ?? 1}
        onPageChange={setPage}
        disabled={isLoading}
      />

      {deleteMutation.isError && (
        <p className="text-sm text-destructive">
          {errorMessage(
            deleteMutation.error,
            "Impossible de supprimer l'entrée de temps.",
          )}
        </p>
      )}

      <Dialog
        open={deletingEntry !== null}
        onClose={() => setDeletingEntry(null)}
        title="Supprimer l'entrée de temps ?"
      >
        <p className="text-sm text-text-muted">
          Cette action est définitive. Voulez-vous vraiment supprimer cette
          entrée de temps ?
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={deleteMutation.isPending}
            onClick={() => setDeletingEntry(null)}
          >
            Annuler
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={deleteMutation.isPending}
            onClick={() =>
              deletingEntry && deleteMutation.mutate(deletingEntry.id)
            }
          >
            {deleteMutation.isPending ? "Suppression..." : "Confirmer ?"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
