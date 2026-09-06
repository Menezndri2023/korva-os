"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createCampaignSchema, type CreateCampaignInput } from "@korva/validation";
import type { Campaign, CampaignStatus, Segment } from "@korva/types";
import { Badge, Button, Card, Dialog, Input, Select } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";

const STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: "Brouillon",
  sending: "Envoi en cours",
  sent: "Envoyée",
};

const STATUS_VARIANTS: Record<CampaignStatus, "default" | "success" | "warning"> = {
  draft: "default",
  sending: "warning",
  sent: "success",
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export default function MarketingCampaignsPage() {
  const [showForm, setShowForm] = useState(false);
  const [confirmSendId, setConfirmSendId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const authReady = useAuthReady();

  const { data: campaigns, isLoading, isError, refetch } = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => apiClient.get<Campaign[]>("/campaigns"),
    enabled: authReady,
    // A campaign "sending" moves toward "sent" in the background — poll while any campaign in
    // the current list is still in flight so the status/stats update without a manual refresh.
    refetchInterval: (query) =>
      query.state.data?.some((c) => c.status === "sending") ? 2000 : false,
  });

  const { data: segments } = useQuery({
    queryKey: ["segments"],
    queryFn: () => apiClient.get<Segment[]>("/segments"),
    enabled: authReady,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateCampaignInput>({
    resolver: zodResolver(createCampaignSchema),
  });

  const createMutation = useMutation({
    mutationFn: (input: CreateCampaignInput) => apiClient.post<Campaign>("/campaigns", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      reset();
      setShowForm(false);
    },
  });

  const sendMutation = useMutation({
    mutationFn: (id: string) => apiClient.post<Campaign>(`/campaigns/${id}/send`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      setConfirmSendId(null);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-text-muted">
          Envoyez un message (WhatsApp puis email en secours) à tous les contacts d&apos;un segment.
        </p>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Annuler" : "Nouvelle campagne"}
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit((values) => createMutation.mutate(values))}
          className="space-y-3 rounded-lg border border-border bg-surface p-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <Input placeholder="Nom de la campagne" {...register("name")} />
            <Select {...register("segmentId")}>
              <option value="">Sélectionner un segment</option>
              {segments?.map((segment) => (
                <option key={segment.id} value={segment.id}>
                  {segment.name}
                </option>
              ))}
            </Select>
          </div>
          {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          {errors.segmentId && (
            <p className="text-xs text-destructive">{errors.segmentId.message}</p>
          )}

          <Input placeholder="Objet (pour l'email, optionnel)" {...register("subject")} />
          <textarea
            placeholder="Message — utilisez {{contact.firstName}} pour personnaliser"
            className="w-full rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            rows={4}
            {...register("body")}
          />
          {errors.body && <p className="text-xs text-destructive">{errors.body.message}</p>}

          {createMutation.isError && (
            <p className="text-sm text-destructive">
              {errorMessage(createMutation.error, "Impossible de créer cette campagne.")}
            </p>
          )}
          <Button type="submit" loading={createMutation.isPending}>
            {createMutation.isPending ? "Création..." : "Créer en brouillon"}
          </Button>
        </form>
      )}

      {isError && (
        <Card className="p-6">
          <p className="text-sm text-destructive">Impossible de charger les campagnes.</p>
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
                  <th className="px-4 py-2">Nom</th>
                  <th className="px-4 py-2">Statut</th>
                  <th className="px-4 py-2">Destinataires</th>
                  <th className="px-4 py-2">Actions</th>
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
                {!isLoading && campaigns?.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-text-muted">
                      Aucune campagne.
                    </td>
                  </tr>
                )}
                {campaigns?.map((campaign) => (
                  <tr key={campaign.id}>
                    <td className="px-4 py-2 font-medium">
                      <Link href={`/dashboard/marketing/campaigns/${campaign.id}`} className="hover:underline">
                        {campaign.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant={STATUS_VARIANTS[campaign.status]}>
                        {STATUS_LABELS[campaign.status]}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-text-muted">
                      {campaign.stats.processedCount} / {campaign.stats.totalRecipients}
                    </td>
                    <td className="px-4 py-2">
                      {campaign.status === "draft" && (
                        <button
                          onClick={() => setConfirmSendId(campaign.id)}
                          className="text-xs font-medium text-text underline"
                        >
                          Envoyer
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

      <Dialog
        open={confirmSendId !== null}
        onClose={() => setConfirmSendId(null)}
        title="Envoyer cette campagne ?"
      >
        <p className="text-sm text-text-muted">
          Le message sera envoyé à tous les contacts du segment sélectionné. Cette action est
          irréversible.
        </p>
        {sendMutation.isError && (
          <p className="mt-2 text-sm text-destructive">
            {errorMessage(sendMutation.error, "Impossible d'envoyer cette campagne.")}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmSendId(null)}>
            Annuler
          </Button>
          <Button
            loading={sendMutation.isPending}
            onClick={() => confirmSendId && sendMutation.mutate(confirmSendId)}
          >
            Envoyer
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
