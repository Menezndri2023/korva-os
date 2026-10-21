"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createRecurringBillingSchema,
  type CreateRecurringBillingInput,
} from "@korva/validation";
import {
  RECURRING_BILLING_INTERVALS,
  type Contact,
  type Offer,
  type RecurringBilling,
  type RecurringBillingInterval,
} from "@korva/types";
import { Badge, Button, Card, Pagination } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";

const INTERVAL_LABELS: Record<RecurringBillingInterval, string> = {
  monthly: "Mensuel",
  yearly: "Annuel",
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("fr-FR");
}

export default function RecurringBillingPage() {
  const [showForm, setShowForm] = useState(false);
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const authReady = useAuthReady();

  const {
    data: plansPage,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["recurring-billing", page],
    queryFn: () =>
      apiClient.getList<RecurringBilling>(`/recurring-billing?page=${page}`),
    enabled: authReady,
  });
  const plans = plansPage?.data;

  const { data: contacts } = useQuery({
    queryKey: ["contacts", ""],
    queryFn: () => apiClient.get<Contact[]>("/contacts"),
    enabled: authReady,
  });

  const { data: offers } = useQuery({
    queryKey: ["offers", ""],
    queryFn: () => apiClient.get<Offer[]>("/offers"),
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

  function offerName(offerId: string): string {
    return offers?.find((o) => o.id === offerId)?.name ?? "—";
  }

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateRecurringBillingInput>({
    resolver: zodResolver(createRecurringBillingSchema),
    defaultValues: { interval: "monthly" },
  });

  const createMutation = useMutation({
    mutationFn: (input: CreateRecurringBillingInput) =>
      apiClient.post<RecurringBilling>("/recurring-billing", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["recurring-billing"] });
      reset({ interval: "monthly" });
      setShowForm(false);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.post<RecurringBilling>(`/recurring-billing/${id}/cancel`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["recurring-billing"] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-text-muted">
          Abonnements clients — factures générées automatiquement à chaque échéance.
        </p>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Annuler" : "Nouvel abonnement"}
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit((values) => createMutation.mutate(values))}
          className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface p-4"
        >
          <select
            className="rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            {...register("contactId")}
            defaultValue=""
          >
            <option value="" disabled>
              Client...
            </option>
            {contacts?.map((c) => (
              <option key={c.id} value={c.id}>
                {[c.firstName, c.lastName].filter(Boolean).join(" ") || c.company || c.email}
              </option>
            ))}
          </select>
          {errors.contactId && (
            <p className="col-span-2 text-xs text-destructive">{errors.contactId.message}</p>
          )}

          <select
            className="rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            {...register("offerId")}
            defaultValue=""
          >
            <option value="" disabled>
              Offre...
            </option>
            {offers?.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.pricing.amount} {o.pricing.currency})
              </option>
            ))}
          </select>
          {errors.offerId && (
            <p className="col-span-2 text-xs text-destructive">{errors.offerId.message}</p>
          )}

          <select
            className="col-span-2 rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            {...register("interval")}
          >
            {RECURRING_BILLING_INTERVALS.map((i) => (
              <option key={i} value={i}>
                {INTERVAL_LABELS[i]}
              </option>
            ))}
          </select>

          {createMutation.isError && (
            <p className="col-span-2 text-sm text-destructive">
              {errorMessage(createMutation.error, "Impossible de créer cet abonnement.")}
            </p>
          )}
          <Button type="submit" loading={createMutation.isPending} className="col-span-2">
            {createMutation.isPending ? "Création..." : "Créer l'abonnement"}
          </Button>
        </form>
      )}

      {isError && (
        <Card className="p-6">
          <p className="text-sm text-destructive">Impossible de charger les abonnements.</p>
          <button onClick={() => refetch()} className="mt-2 text-sm font-medium text-text underline">
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
                  <th className="px-4 py-2">Offre</th>
                  <th className="px-4 py-2">Fréquence</th>
                  <th className="px-4 py-2">Montant</th>
                  <th className="px-4 py-2">Prochaine échéance</th>
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
                {!isLoading && plans?.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-text-muted">
                      Aucun abonnement.
                    </td>
                  </tr>
                )}
                {plans?.map((plan) => (
                  <tr key={plan.id}>
                    <td className="px-4 py-2 font-medium">{contactName(plan.contactId)}</td>
                    <td className="px-4 py-2 text-text-muted">{offerName(plan.offerId)}</td>
                    <td className="px-4 py-2 text-text-muted">
                      {INTERVAL_LABELS[plan.interval]}
                    </td>
                    <td className="px-4 py-2 text-text-muted">
                      {plan.amount} {plan.currency}
                    </td>
                    <td className="px-4 py-2 text-text-muted">
                      {formatDate(plan.nextBillingDate)}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant={plan.status === "active" ? "success" : "default"}>
                        {plan.status === "active" ? "Actif" : "Annulé"}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">
                      {plan.status === "active" && (
                        <button
                          onClick={() => cancelMutation.mutate(plan.id)}
                          disabled={
                            cancelMutation.isPending && cancelMutation.variables === plan.id
                          }
                          className="text-xs text-destructive hover:underline"
                        >
                          Annuler
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
        totalPages={plansPage?.pagination.totalPages ?? 1}
        onPageChange={setPage}
        disabled={isLoading}
      />
    </div>
  );
}
