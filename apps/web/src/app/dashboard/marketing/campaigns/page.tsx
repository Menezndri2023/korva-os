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
import { useT } from "@/lib/dashboard-locale";

const STATUS_LABELS: Record<CampaignStatus, [string, string]> = {
  draft: ["Brouillon", "Draft"],
  sending: ["Envoi en cours", "Sending"],
  sent: ["Envoyée", "Sent"],
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
  const t = useT();
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
          {t(
            "Envoyez un message (WhatsApp puis email en secours) à tous les contacts d'un segment.",
            "Send a message (WhatsApp, with e-mail as a fallback) to every contact in a segment.",
          )}
        </p>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? t("Annuler", "Cancel") : t("Nouvelle campagne", "New campaign")}
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit((values) => createMutation.mutate(values))}
          className="space-y-3 rounded-lg border border-border bg-surface p-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <Input placeholder={t("Nom de la campagne", "Campaign name")} {...register("name")} />
            <Select {...register("segmentId")}>
              <option value="">{t("Sélectionner un segment", "Select a segment")}</option>
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

          <Input placeholder={t(
            "Objet (pour l'email, optionnel)",
            "Subject (for e-mail, optional)",
          )} {...register("subject")} />
          <textarea
            placeholder={t(
              "Message — utilisez {{contact.firstName}} pour personnaliser",
              "Message — use {{contact.firstName}} to personalise",
            )}
            className="w-full rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            rows={4}
            {...register("body")}
          />
          {errors.body && <p className="text-xs text-destructive">{errors.body.message}</p>}

          {createMutation.isError && (
            <p className="text-sm text-destructive">
              {errorMessage(createMutation.error, t(
                "Impossible de créer cette campagne.",
                "This campaign could not be created.",
              ))}
            </p>
          )}
          <Button type="submit" loading={createMutation.isPending}>
            {createMutation.isPending ? t("Création...", "Creating...") : t("Créer en brouillon", "Create as a draft")}
          </Button>
        </form>
      )}

      {isError && (
        <Card className="p-6">
          <p className="text-sm text-destructive">{t(
            "Impossible de charger les campagnes.",
            "Campaigns could not be loaded.",
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
                  <th className="px-4 py-2">{t("Nom", "Name")}</th>
                  <th className="px-4 py-2">{t("Statut", "Status")}</th>
                  <th className="px-4 py-2">{t("Destinataires", "Recipients")}</th>
                  <th className="px-4 py-2">{t("Actions", "Actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-text-muted">
                      {t("Chargement...", "Loading...")}
                    </td>
                  </tr>
                )}
                {!isLoading && campaigns?.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-text-muted">
                      {t("Aucune campagne.", "No campaigns.")}
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
                        {t(...STATUS_LABELS[campaign.status])}
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
                          {t("Envoyer", "Send")}
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
        title={t("Envoyer cette campagne ?", "Send this campaign?")}
      >
        <p className="text-sm text-text-muted">
          {t(
            "Le message sera envoyé à tous les contacts du segment sélectionné. Cette action est irréversible.",
            "The message will be sent to every contact in the selected segment. This cannot be undone.",
          )}
        </p>
        {sendMutation.isError && (
          <p className="mt-2 text-sm text-destructive">
            {errorMessage(sendMutation.error, t(
              "Impossible d'envoyer cette campagne.",
              "This campaign could not be sent.",
            ))}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmSendId(null)}>
            {t("Annuler", "Cancel")}
          </Button>
          <Button
            loading={sendMutation.isPending}
            onClick={() => confirmSendId && sendMutation.mutate(confirmSendId)}
          >
            {t("Envoyer", "Send")}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
