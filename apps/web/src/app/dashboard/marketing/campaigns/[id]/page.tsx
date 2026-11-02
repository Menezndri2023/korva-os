"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { Campaign, CampaignRecipient, CampaignRecipientStatus } from "@korva/types";
import { Badge, Card, Pagination } from "@korva/ui";
import { apiClient } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { useT } from "@/lib/dashboard-locale";

const RECIPIENT_STATUS_LABELS: Record<CampaignRecipientStatus, [string, string]> = {
  pending: ["En attente", "Pending"],
  sent: ["Envoyé", "Sent"],
  failed: ["Échec", "Failed"],
  skipped: ["Ignoré", "Skipped"],
};

const RECIPIENT_STATUS_VARIANTS: Record<
  CampaignRecipientStatus,
  "default" | "success" | "warning" | "destructive"
> = {
  pending: "default",
  sent: "success",
  failed: "destructive",
  skipped: "warning",
};

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs text-text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

export default function CampaignDetailPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const [page, setPage] = useState(1);
  const authReady = useAuthReady();

  const { data: campaign, isLoading } = useQuery({
    queryKey: ["campaigns", id],
    queryFn: () => apiClient.get<Campaign>(`/campaigns/${id}`),
    enabled: authReady && !!id,
    refetchInterval: (query) => (query.state.data?.status === "sending" ? 2000 : false),
  });

  const { data: recipientsPage } = useQuery({
    queryKey: ["campaigns", id, "recipients", page],
    queryFn: () => apiClient.getList<CampaignRecipient>(`/campaigns/${id}/recipients?page=${page}`),
    enabled: authReady && !!id,
  });
  const recipients = recipientsPage?.data;

  if (isLoading || !campaign) {
    return <p className="text-sm text-text-muted">{t("Chargement...", "Loading...")}</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{campaign.name}</h1>
        {campaign.subject && <p className="text-sm text-text-muted">{campaign.subject}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatTile label={t("Total", "Total")} value={campaign.stats.totalRecipients} />
        <StatTile label={t("Traités", "Processed")} value={campaign.stats.processedCount} />
        <StatTile label={t("Envoyés", "Sent")} value={campaign.stats.sentCount} />
        <StatTile label={t("Échecs", "Failed")} value={campaign.stats.failedCount} />
        <StatTile label={t("Ignorés", "Skipped")} value={campaign.stats.skippedCount} />
      </div>

      <Card className="p-4">
        <p className="text-sm font-medium text-text">{t("Message", "Message")}</p>
        <p className="mt-1 whitespace-pre-wrap text-sm text-text-muted">{campaign.body}</p>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium text-text-muted">
              <tr>
                <th className="px-4 py-2">{t("Contact", "Contact")}</th>
                <th className="px-4 py-2">{t("Statut", "Status")}</th>
                <th className="px-4 py-2">{t("Canal", "Channel")}</th>
                <th className="px-4 py-2">{t("Erreur", "Error")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {recipients?.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-text-muted">
                    {t("Aucun destinataire.", "No recipients.")}
                  </td>
                </tr>
              )}
              {recipients?.map((recipient) => (
                <tr key={recipient.id}>
                  <td className="px-4 py-2 font-mono text-xs text-text-muted">
                    {recipient.contactId}
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant={RECIPIENT_STATUS_VARIANTS[recipient.status]}>
                      {t(...RECIPIENT_STATUS_LABELS[recipient.status])}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-text-muted">{recipient.channelUsed ?? "—"}</td>
                  <td className="px-4 py-2 text-text-muted">{recipient.error ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Pagination
        page={page}
        totalPages={recipientsPage?.pagination.totalPages ?? 1}
        onPageChange={setPage}
      />
    </div>
  );
}
