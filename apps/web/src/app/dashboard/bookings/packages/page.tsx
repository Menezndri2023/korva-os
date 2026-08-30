"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  topUpCreditBalanceSchema,
  type TopUpCreditBalanceInput,
} from "@korva/validation";
import type { Contact, CreditBalance, Offer } from "@korva/types";
import { Button, Card, Input, Pagination } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";

export default function PackagesPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [page, setPage] = useState(1);
  const authReady = useAuthReady();

  const { data: balancesPage, isLoading } = useQuery({
    queryKey: ["credit-balances", page],
    queryFn: () =>
      apiClient.getList<CreditBalance>(`/credit-balances?page=${page}`),
    enabled: authReady,
  });
  const balances = balancesPage?.data;

  const { data: contacts } = useQuery({
    queryKey: ["contacts", ""],
    queryFn: () => apiClient.get<Contact[]>("/contacts"),
    enabled: authReady,
  });
  const { data: packageOffers } = useQuery({
    queryKey: ["offers", "package"],
    queryFn: () => apiClient.get<Offer[]>("/offers?type=package"),
    enabled: authReady,
  });

  function contactName(id: string): string {
    const contact = contacts?.find((c) => c.id === id);
    if (!contact) return "—";
    return (
      [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
      contact.company ||
      "—"
    );
  }
  function offerName(id: string): string {
    return packageOffers?.find((o) => o.id === id)?.name ?? "—";
  }

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<TopUpCreditBalanceInput>({
    resolver: zodResolver(topUpCreditBalanceSchema),
  });

  const topUpMutation = useMutation({
    mutationFn: (input: TopUpCreditBalanceInput) =>
      apiClient.post<CreditBalance>("/credit-balances/top-up", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["credit-balances"] });
      reset();
      setShowForm(false);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-zinc-500">
          Forfaits de séances prépayées — le solde se décrémente automatiquement quand une
          réservation pour ce forfait est marquée terminée avec présence.
        </p>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Annuler" : "Vendre un forfait"}
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit((values) => topUpMutation.mutate(values))}
          className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4"
        >
          <div className="grid grid-cols-3 gap-2">
            <select
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
              defaultValue=""
              {...register("contactId", { required: true })}
            >
              <option value="" disabled>
                Client
              </option>
              {contacts?.map((c) => (
                <option key={c.id} value={c.id}>
                  {[c.firstName, c.lastName].filter(Boolean).join(" ") || c.company || c.email}
                </option>
              ))}
            </select>
            <select
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
              defaultValue=""
              {...register("offerId", { required: true })}
            >
              <option value="" disabled>
                Forfait
              </option>
              {packageOffers?.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <Input
              type="number"
              placeholder="Nombre de séances"
              {...register("credits", { valueAsNumber: true })}
            />
          </div>
          {errors.credits && (
            <p className="text-xs text-red-600">{errors.credits.message}</p>
          )}
          {!packageOffers?.length && (
            <p className="text-xs text-zinc-500">
              Aucune offre de type &laquo; forfait &raquo; — créez-en une dans le catalogue avant
              de vendre un forfait.
            </p>
          )}

          {topUpMutation.isError && (
            <p className="text-sm text-red-600">
              {topUpMutation.error instanceof ApiError
                ? topUpMutation.error.message
                : "Erreur"}
            </p>
          )}
          <Button type="submit" loading={topUpMutation.isPending}>
            {topUpMutation.isPending ? "Enregistrement..." : "Créditer le forfait"}
          </Button>
        </form>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-2">Client</th>
                <th className="px-4 py-2">Forfait</th>
                <th className="px-4 py-2">Solde restant</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {isLoading && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-zinc-500">
                    Chargement...
                  </td>
                </tr>
              )}
              {!isLoading && balances?.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-zinc-500">
                    Aucun forfait vendu.
                  </td>
                </tr>
              )}
              {balances?.map((balance) => (
                <tr key={balance.id}>
                  <td className="px-4 py-2 font-medium">{contactName(balance.contactId)}</td>
                  <td className="px-4 py-2 text-zinc-600">{offerName(balance.offerId)}</td>
                  <td className="px-4 py-2 text-zinc-600">
                    {balance.remainingCredits} / {balance.totalCredits}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Pagination
        page={page}
        totalPages={balancesPage?.pagination.totalPages ?? 1}
        onPageChange={setPage}
        disabled={isLoading}
      />
    </div>
  );
}
