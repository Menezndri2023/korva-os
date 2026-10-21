"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createExpenseSchema, type CreateExpenseInput } from "@korva/validation";
import { EXPENSE_STATUSES, type Contact, type Expense, type ExpenseStatus } from "@korva/types";
import { Badge, Button, Card, Dialog, Input, Pagination } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";

const STATUS_LABELS: Record<ExpenseStatus, string> = {
  recorded: "Enregistrée",
  invoiced: "Facturée",
  voided: "Annulée",
};

const STATUS_VARIANT: Record<ExpenseStatus, "default" | "success" | "warning"> = {
  recorded: "success",
  invoiced: "default",
  voided: "default",
};

function contactLabel(contact: Contact): string {
  return (
    [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
    contact.company ||
    "—"
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export default function ExpensesPage() {
  const [statusFilter, setStatusFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [page, setPage] = useState(1);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [deletingExpense, setDeletingExpense] = useState<Expense | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const queryClient = useQueryClient();
  const authReady = useAuthReady();

  const {
    data: expensesPage,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["expenses", statusFilter, page],
    queryFn: () =>
      apiClient.getList<Expense>(
        `/expenses?page=${page}${statusFilter ? `&status=${statusFilter}` : ""}`,
      ),
    enabled: authReady,
  });
  const expenses = expensesPage?.data;

  const { data: contacts } = useQuery({
    queryKey: ["contacts", ""],
    queryFn: () => apiClient.get<Contact[]>("/contacts"),
    enabled: authReady,
  });
  function contactName(contactId?: string): string {
    const contact = contacts?.find((c) => c.id === contactId);
    return contact ? contactLabel(contact) : "—";
  }

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<CreateExpenseInput>({
    resolver: zodResolver(createExpenseSchema),
    defaultValues: { currency: "EUR", billable: false },
  });
  const billable = watch("billable");

  const createMutation = useMutation({
    mutationFn: (input: CreateExpenseInput) => apiClient.post<Expense>("/expenses", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["expenses"] });
      reset({ currency: "EUR", billable: false });
      setShowForm(false);
    },
  });

  const generateInvoiceMutation = useMutation({
    mutationFn: (expenseIds: string[]) =>
      apiClient.post<{ id: string }>("/expenses/generate-invoice", { expenseIds }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["expenses"] });
      setSelectedIds([]);
    },
  });

  function toggleSelected(id: string) {
    setSelectedIds((ids) =>
      ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id],
    );
  }

  const voidMutation = useMutation({
    mutationFn: (id: string) => apiClient.post<Expense>(`/expenses/${id}/void`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["expenses"] });
      setVoidingId(null);
    },
    onError: () => setVoidingId(null),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete<{ deleted: true }>(`/expenses/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["expenses"] });
      setDeletingExpense(null);
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Dépenses</h1>
        <p className="mt-1 text-sm text-text-muted">
          Frais et achats professionnels réglés par l&apos;entreprise.
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
          {EXPENSE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Annuler" : "Nouvelle dépense"}
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit((values) => createMutation.mutate(values))}
          // Not migrated to <Card>: this wrapper is the <form> element itself (it carries
          // onSubmit), and Card renders a <div> — same exclusion documented on the other
          // create-forms (dashboard/catalog, dashboard/orders, dashboard/finance).
          className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface p-4"
        >
          <Input placeholder="Catégorie" {...register("category")} />
          <Input placeholder="Fournisseur (optionnel)" {...register("vendor")} />
          {errors.category && (
            <p className="text-xs text-destructive">{errors.category.message}</p>
          )}

          <Input placeholder="Description" className="col-span-2" {...register("description")} />
          {errors.description && (
            <p className="col-span-2 text-xs text-destructive">{errors.description.message}</p>
          )}

          <Input
            type="number"
            step="0.01"
            placeholder="Montant"
            {...register("amount", { valueAsNumber: true })}
          />
          <Input placeholder="Devise (EUR)" {...register("currency")} />
          {errors.amount && <p className="text-xs text-destructive">{errors.amount.message}</p>}
          {errors.currency && (
            <p className="text-xs text-destructive">{errors.currency.message}</p>
          )}

          <Input
            type="date"
            aria-label="Date"
            {...register("date", {
              setValueAs: (value: string) => (value ? new Date(value).toISOString() : value),
            })}
          />
          {errors.date && <p className="text-xs text-destructive">{errors.date.message}</p>}

          <label className="col-span-2 flex items-center gap-2 text-sm text-text-muted">
            <input type="checkbox" {...register("billable")} />
            Refacturable au client
          </label>
          {billable && (
            <select
              className="col-span-2 rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
              defaultValue=""
              {...register("contactId")}
            >
              <option value="" disabled>
                Choisir un client
              </option>
              {contacts?.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contactLabel(contact)}
                </option>
              ))}
            </select>
          )}
          {errors.contactId && (
            <p className="col-span-2 text-xs text-destructive">{errors.contactId.message}</p>
          )}

          <textarea
            placeholder="Notes (optionnel)"
            className="col-span-2 rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            rows={2}
            {...register("notes")}
          />

          {createMutation.isError && (
            <p className="col-span-2 text-sm text-destructive">
              {errorMessage(createMutation.error, "Impossible d'enregistrer la dépense.")}
            </p>
          )}
          <Button type="submit" loading={createMutation.isPending} className="col-span-2">
            {createMutation.isPending ? "Enregistrement..." : "Enregistrer la dépense"}
          </Button>
        </form>
      )}

      {isError && (
        <Card className="p-6">
          <p className="text-sm text-destructive">Impossible de charger les dépenses.</p>
          <button
            onClick={() => refetch()}
            className="mt-2 text-sm font-medium text-text underline"
          >
            Réessayer
          </button>
        </Card>
      )}

      {selectedIds.length > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-surface p-3">
          <p className="text-sm text-text-muted">
            {selectedIds.length} dépense(s) sélectionnée(s)
          </p>
          <Button
            size="sm"
            loading={generateInvoiceMutation.isPending}
            onClick={() => generateInvoiceMutation.mutate(selectedIds)}
          >
            {generateInvoiceMutation.isPending ? "Génération..." : "Générer une facture"}
          </Button>
        </div>
      )}
      {generateInvoiceMutation.isError && (
        <p className="text-sm text-destructive">
          {errorMessage(generateInvoiceMutation.error, "Impossible de générer la facture.")}
        </p>
      )}

      {!isError && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium text-text-muted">
                <tr>
                  <th className="px-4 py-2"></th>
                  <th className="px-4 py-2">N°</th>
                  <th className="px-4 py-2">Catégorie</th>
                  <th className="px-4 py-2">Description</th>
                  <th className="px-4 py-2">Montant</th>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Statut</th>
                  <th className="px-4 py-2">Client</th>
                  <th className="px-4 py-2">Fournisseur</th>
                  <th className="px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading && (
                  <tr>
                    <td colSpan={10} className="px-4 py-6 text-center text-text-muted">
                      Chargement...
                    </td>
                  </tr>
                )}
                {!isLoading && expenses?.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-6 text-center text-text-muted">
                      <p>Aucune dépense.</p>
                      <p className="mt-1">
                        Les dépenses sont les frais et achats professionnels réglés par votre
                        entreprise (fournisseurs, matériel, frais divers). Enregistrez votre
                        première dépense pour commencer à les suivre.
                      </p>
                    </td>
                  </tr>
                )}
                {expenses?.map((expense) => (
                  <tr key={expense.id}>
                    <td className="px-4 py-2">
                      {expense.billable && expense.status === "recorded" && (
                        <input
                          type="checkbox"
                          aria-label={`Sélectionner ${expense.number}`}
                          checked={selectedIds.includes(expense.id)}
                          onChange={() => toggleSelected(expense.id)}
                        />
                      )}
                    </td>
                    <td className="px-4 py-2 font-medium">{expense.number}</td>
                    <td className="px-4 py-2 text-text-muted">{expense.category}</td>
                    <td className="px-4 py-2 text-text-muted">{expense.description}</td>
                    <td className="px-4 py-2 text-text-muted">
                      {expense.amount} {expense.currency}
                    </td>
                    <td className="px-4 py-2 text-text-muted">
                      {new Date(expense.date).toLocaleDateString("fr-FR")}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant={STATUS_VARIANT[expense.status]}>
                        {STATUS_LABELS[expense.status]}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-text-muted">
                      {contactName(expense.contactId)}
                    </td>
                    <td className="px-4 py-2 text-text-muted">{expense.vendor ?? "—"}</td>
                    <td className="px-4 py-2 space-x-2">
                      {expense.status === "recorded" &&
                        (voidingId === expense.id ? (
                          <>
                            <button
                              onClick={() => voidMutation.mutate(expense.id)}
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
                            onClick={() => setVoidingId(expense.id)}
                            className="text-xs text-text-muted hover:underline"
                          >
                            Annuler
                          </button>
                        ))}
                      <button
                        onClick={() => setDeletingExpense(expense)}
                        className="text-xs text-destructive hover:underline"
                      >
                        Supprimer
                      </button>
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
        totalPages={expensesPage?.pagination.totalPages ?? 1}
        onPageChange={setPage}
        disabled={isLoading}
      />

      {deleteMutation.isError && (
        <p className="text-sm text-destructive">
          {errorMessage(deleteMutation.error, "Impossible de supprimer la dépense.")}
        </p>
      )}

      <Dialog
        open={deletingExpense !== null}
        onClose={() => setDeletingExpense(null)}
        title="Supprimer la dépense ?"
      >
        <p className="text-sm text-text-muted">
          Cette action est définitive. Voulez-vous vraiment supprimer la dépense «{" "}
          {deletingExpense?.number} » ?
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={deleteMutation.isPending}
            onClick={() => setDeletingExpense(null)}
          >
            Annuler
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={deleteMutation.isPending}
            onClick={() => deletingExpense && deleteMutation.mutate(deletingExpense.id)}
          >
            {deleteMutation.isPending ? "Suppression..." : "Confirmer ?"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
