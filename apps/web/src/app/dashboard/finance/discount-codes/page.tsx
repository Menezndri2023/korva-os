"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createDiscountCodeSchema, type CreateDiscountCodeInput } from "@korva/validation";
import { DISCOUNT_CODE_TYPES, type DiscountCode, type DiscountCodeType } from "@korva/types";
import { Badge, Button, Card, Input, Pagination } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { useT } from "@/lib/dashboard-locale";

const TYPE_LABELS: Record<DiscountCodeType, [string, string]> = {
  percentage: ["Pourcentage", "Percentage"],
  fixed: ["Montant fixe", "Fixed amount"],
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export default function DiscountCodesPage() {
  const t = useT();
  const [showForm, setShowForm] = useState(false);
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const authReady = useAuthReady();

  const {
    data: codesPage,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["discount-codes", page],
    queryFn: () => apiClient.getList<DiscountCode>(`/discount-codes?page=${page}`),
    enabled: authReady,
  });
  const codes = codesPage?.data;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<CreateDiscountCodeInput>({
    resolver: zodResolver(createDiscountCodeSchema),
    defaultValues: { type: "percentage", scope: "all", offerIds: [], active: true },
  });
  const type = watch("type");

  const createMutation = useMutation({
    mutationFn: (input: CreateDiscountCodeInput) =>
      apiClient.post<DiscountCode>("/discount-codes", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["discount-codes"] });
      reset({ type: "percentage", scope: "all", offerIds: [], active: true });
      setShowForm(false);
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.patch<DiscountCode>(`/discount-codes/${id}`, { active: false }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["discount-codes"] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-text-muted">
          {t(
            "Codes de réduction applicables aux commandes, devis et factures.",
            "Discount codes for orders, quotes and invoices.",
          )}
        </p>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? t("Annuler", "Cancel") : t("Nouveau code", "New code")}
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit((values) => createMutation.mutate(values))}
          className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface p-4"
        >
          <Input placeholder={t("Code (ex: PROMO10)", "Code (e.g. PROMO10)")} {...register("code")} />
          {errors.code && <p className="text-xs text-destructive">{errors.code.message}</p>}

          <select
            className="rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            {...register("type")}
          >
            {DISCOUNT_CODE_TYPES.map((kind) => (
              <option key={kind} value={kind}>
                {t(...TYPE_LABELS[kind])}
              </option>
            ))}
          </select>

          <Input
            type="number"
            step="0.01"
            placeholder={type === "percentage" ? t("Valeur (%)", "Value (%)") : t("Montant", "Amount")}
            {...register("value", { valueAsNumber: true })}
          />
          {errors.value && <p className="text-xs text-destructive">{errors.value.message}</p>}

          {type === "fixed" && (
            <Input
              placeholder={t("Devise (EUR)", "Currency (EUR)")}
              {...register("currency", {
                setValueAs: (v: string) => (v === "" ? undefined : v),
              })}
            />
          )}
          {errors.currency && (
            <p className="text-xs text-destructive">{errors.currency.message}</p>
          )}

          <Input
            type="number"
            placeholder={t("Nombre d'utilisations max (optionnel)", "Maximum uses (optional)")}
            className="col-span-2"
            {...register("maxRedemptions", {
              setValueAs: (v: string) => (v === "" ? undefined : Number(v)),
            })}
          />

          {createMutation.isError && (
            <p className="col-span-2 text-sm text-destructive">
              {errorMessage(createMutation.error, t(
                "Impossible de créer ce code.",
                "This code could not be created.",
              ))}
            </p>
          )}
          <Button type="submit" loading={createMutation.isPending} className="col-span-2">
            {createMutation.isPending ? t("Création...", "Creating...") : t("Créer le code", "Create the code")}
          </Button>
        </form>
      )}

      {isError && (
        <Card className="p-6">
          <p className="text-sm text-destructive">{t(
            "Impossible de charger les codes promo.",
            "Discount codes could not be loaded.",
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
                  <th className="px-4 py-2">{t("Code", "Code")}</th>
                  <th className="px-4 py-2">{t("Type", "Type")}</th>
                  <th className="px-4 py-2">{t("Valeur", "Value")}</th>
                  <th className="px-4 py-2">{t("Utilisations", "Uses")}</th>
                  <th className="px-4 py-2">{t("Statut", "Status")}</th>
                  <th className="px-4 py-2">{t("Actions", "Actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-text-muted">
                      {t("Chargement...", "Loading...")}
                    </td>
                  </tr>
                )}
                {!isLoading && codes?.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-text-muted">
                      {t("Aucun code promo.", "No discount codes.")}
                    </td>
                  </tr>
                )}
                {codes?.map((code) => (
                  <tr key={code.id}>
                    <td className="px-4 py-2 font-medium">{code.code}</td>
                    <td className="px-4 py-2 text-text-muted">{t(...TYPE_LABELS[code.type])}</td>
                    <td className="px-4 py-2 text-text-muted">
                      {code.type === "percentage" ? `${code.value}%` : `${code.value} ${code.currency ?? ""}`}
                    </td>
                    <td className="px-4 py-2 text-text-muted">
                      {code.redemptionsCount}
                      {code.maxRedemptions ? ` / ${code.maxRedemptions}` : ""}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant={code.active ? "success" : "default"}>
                        {code.active ? t("Actif", "Active") : t("Inactif", "Inactive")}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">
                      {code.active && (
                        <button
                          onClick={() => deactivateMutation.mutate(code.id)}
                          disabled={
                            deactivateMutation.isPending &&
                            deactivateMutation.variables === code.id
                          }
                          className="text-xs text-destructive hover:underline"
                        >
                          {t("Désactiver", "Turn off")}
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
        totalPages={codesPage?.pagination.totalPages ?? 1}
        onPageChange={setPage}
        disabled={isLoading}
      />
    </div>
  );
}
