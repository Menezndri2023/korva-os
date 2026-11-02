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
  type Project,
  type TimeEntry,
  type TimeEntryStatus,
} from "@korva/types";
import { Badge, Button, Card, Dialog, Input, Pagination } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import type { Locale } from "@korva/types";
import { intlLocale, useDashboardLocale, useT } from "@/lib/dashboard-locale";

const STATUS_LABELS: Record<TimeEntryStatus, [string, string]> = {
  unbilled: ["Non facturé", "Unbilled"],
  approved: ["Approuvé", "Approved"],
  invoiced: ["Facturé", "Invoiced"],
  voided: ["Annulé", "Cancelled"],
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

function formatHours(durationMinutes: number, locale: Locale): string {
  return (durationMinutes / 60).toLocaleString(intlLocale(locale), {
    maximumFractionDigits: 2,
  });
}

export default function TimeEntriesPage() {
  const locale = useDashboardLocale();
  const t = useT();
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

  const { data: projects } = useQuery({
    queryKey: ["projects", ""],
    queryFn: () => apiClient.get<Project[]>("/projects"),
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
        <h1 className="text-2xl font-semibold">{t("Suivi du temps", "Time tracking")}</h1>
        <p className="mt-1 text-sm text-text-muted">
          {t(
            "Heures facturables saisies pour vos clients — approuvez-les puis générez une facture.",
            "Billable hours entered for your customers — approve them, then generate an invoice.",
          )}
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
          <option value="">{t("Tous les statuts", "All statuses")}</option>
          {TIME_ENTRY_STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(...STATUS_LABELS[status])}
            </option>
          ))}
        </select>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? t("Annuler", "Cancel") : t("Nouvelle entrée", "New entry")}
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
              {t("Choisir un client", "Choose a customer")}
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

          <select
            className="col-span-2 rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            defaultValue=""
            {...register("projectId", {
              setValueAs: (v: string) => (v === "" ? undefined : v),
            })}
          >
            <option value="">{t("Aucun projet (optionnel)", "No project (optional)")}</option>
            {projects?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <Input
            placeholder={t("Description", "Description")}
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
            aria-label={t("Date", "Date")}
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
            placeholder={t("Heures", "Hours")}
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
            placeholder={t("Taux horaire (auto si vide)", "Hourly rate (automatic if empty)")}
            {...register("hourlyRate", {
              setValueAs: (value: string) => (value === "" ? undefined : Number(value)),
            })}
          />
          <Input placeholder={t("Devise (EUR)", "Currency (EUR)")} {...register("currency")} />
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
            {t("Facturable", "Billable")}
          </label>

          <textarea
            placeholder={t("Notes (optionnel)", "Notes (optional)")}
            className="col-span-2 rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            rows={2}
            {...register("notes")}
          />

          {createMutation.isError && (
            <p className="col-span-2 text-sm text-destructive">
              {errorMessage(
                createMutation.error, t(
                  "Impossible d'enregistrer l'entrée de temps.",
                  "The time entry could not be saved.",
                ),
              )}
            </p>
          )}
          <Button
            type="submit"
            loading={createMutation.isPending}
            className="col-span-2"
          >
            {createMutation.isPending ? t("Enregistrement...", "Saving...") : t("Enregistrer", "Save")}
          </Button>
        </form>
      )}

      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-surface p-3">
          <div className="text-sm text-text-muted">
            {t(
              `${selectedIds.size} entrée${selectedIds.size > 1 ? "s" : ""} sélectionnée${selectedIds.size > 1 ? "s" : ""}`,
              `${selectedIds.size} entr${selectedIds.size === 1 ? "y" : "ies"} selected`,
            )}
            {selectionMixed && (
              <span className="ml-2 text-destructive">
                {t(
                  "— la sélection doit concerner un seul client et une seule devise",
                  "— the selection must be for one customer and one currency",
                )}
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
            {t("Générer une facture", "Generate an invoice")}
          </Button>
        </div>
      )}
      {generateInvoiceMutation.isError && (
        <p className="text-sm text-destructive">
          {errorMessage(
            generateInvoiceMutation.error, t(
              "Impossible de générer la facture.",
              "The invoice could not be generated.",
            ),
          )}
        </p>
      )}

      {isError && (
        <Card className="p-6">
          <p className="text-sm text-destructive">
            {t("Impossible de charger les entrées de temps.", "Time entries could not be loaded.")}
          </p>
          <button
            onClick={() => refetch()}
            className="mt-2 text-sm font-medium text-text underline"
          >
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
                  <th className="px-4 py-2" />
                  <th className="px-4 py-2">{t("Date", "Date")}</th>
                  <th className="px-4 py-2">{t("Client", "Customer")}</th>
                  <th className="px-4 py-2">{t("Description", "Description")}</th>
                  <th className="px-4 py-2">{t("Durée", "Length")}</th>
                  <th className="px-4 py-2">{t("Taux", "Rate")}</th>
                  <th className="px-4 py-2">{t("Montant", "Amount")}</th>
                  <th className="px-4 py-2">{t("Statut", "Status")}</th>
                  <th className="px-4 py-2">{t("Actions", "Actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading && (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-6 text-center text-text-muted"
                    >
                      {t("Chargement...", "Loading...")}
                    </td>
                  </tr>
                )}
                {!isLoading && entries?.length === 0 && (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-6 text-center text-text-muted"
                    >
                      <p>{t("Aucune entrée de temps.", "No time entries.")}</p>
                      <p className="mt-1">
                        {t(
                          "Saisissez les heures travaillées pour un client afin de les approuver puis les facturer.",
                          "Enter the hours worked for a customer to approve them and then invoice them.",
                        )}
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
                      {new Date(entry.date).toLocaleDateString(intlLocale(locale))}
                    </td>
                    <td className="px-4 py-2 text-text-muted">
                      {contactName(entry.contactId)}
                    </td>
                    <td className="px-4 py-2 text-text-muted">
                      {entry.description}
                    </td>
                    <td className="px-4 py-2 text-text-muted">
                      {formatHours(entry.durationMinutes, locale)}h
                    </td>
                    <td className="px-4 py-2 text-text-muted">
                      {entry.hourlyRate ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-text-muted">
                      {entry.hourlyRate
                        ? `${(
                            (entry.durationMinutes / 60) *
                            entry.hourlyRate
                          ).toLocaleString(intlLocale(locale), {
                            maximumFractionDigits: 2,
                          })} ${entry.currency}`
                        : "—"}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant={STATUS_VARIANT[entry.status]}>
                        {t(...STATUS_LABELS[entry.status])}
                      </Badge>
                    </td>
                    <td className="space-x-2 px-4 py-2">
                      {entry.status === "unbilled" && (
                        <button
                          onClick={() => approveMutation.mutate(entry.id)}
                          disabled={approveMutation.isPending}
                          className="text-xs text-text-muted hover:underline"
                        >
                          {t("Approuver", "Approve")}
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
                              {voidMutation.isPending ? "..." : t("Confirmer ?", "Confirm?")}
                            </button>
                            <button
                              onClick={() => setVoidingId(null)}
                              disabled={voidMutation.isPending}
                              className="text-xs text-text-muted hover:underline"
                            >
                              {t("Retour", "Back")}
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setVoidingId(entry.id)}
                            className="text-xs text-text-muted hover:underline"
                          >
                            {t("Annuler", "Cancel")}
                          </button>
                        ))}
                      {entry.status !== "invoiced" && (
                        <button
                          onClick={() => setDeletingEntry(entry)}
                          className="text-xs text-destructive hover:underline"
                        >
                          {t("Supprimer", "Delete")}
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
            deleteMutation.error, t(
              "Impossible de supprimer l'entrée de temps.",
              "The time entry could not be deleted.",
            ),
          )}
        </p>
      )}

      <Dialog
        open={deletingEntry !== null}
        onClose={() => setDeletingEntry(null)}
        title={t("Supprimer l'entrée de temps ?", "Delete the time entry?")}
      >
        <p className="text-sm text-text-muted">
          {t(
            "Cette action est définitive. Voulez-vous vraiment supprimer cette entrée de temps ?",
            "This cannot be undone. Do you really want to delete this time entry?",
          )}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={deleteMutation.isPending}
            onClick={() => setDeletingEntry(null)}
          >
            {t("Annuler", "Cancel")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={deleteMutation.isPending}
            onClick={() =>
              deletingEntry && deleteMutation.mutate(deletingEntry.id)
            }
          >
            {deleteMutation.isPending ? t("Suppression...", "Deleting...") : t("Confirmer ?", "Confirm?")}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
