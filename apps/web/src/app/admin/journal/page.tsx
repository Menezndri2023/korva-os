"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Badge, Card, PageHeader, Pagination } from "@korva/ui";
import { apiClient } from "@/lib/api-client";
import { ACTIVITY_ENTITY_LABELS, activityActionLabel } from "@/lib/analytics-format";
import { formatDay, type PlatformAuditRow } from "@/lib/platform-admin";

interface AuditPage {
  data: PlatformAuditRow[];
  pagination: { page: number; totalPages: number; total: number };
}

/** Who did what, across every business — and every action of the KORVA administration. */
export default function AdminJournalPage() {
  return (
    <Suspense fallback={<p className="text-sm text-text-muted">Chargement…</p>}>
      <Journal />
    </Suspense>
  );
}

function Journal() {
  const organizationId = useSearchParams().get("entreprise") ?? "";
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["platform", "audit", organizationId, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page) });
      if (organizationId) params.set("organizationId", organizationId);
      // A paginated answer: the rows and the pagination sit side by side.
      return apiClient.getList<PlatformAuditRow>(`/platform/audit?${params}`, { withOrganization: false }) as Promise<AuditPage>;
    },
  });

  return (
    <div>
      <PageHeader
        title="Journal"
        description={organizationId ? "Les actions d'une entreprise." : "Toutes les actions enregistrées sur la plateforme."}
        actions={organizationId ? <Link href="/admin/journal" className="text-sm underline">Tout le journal</Link> : undefined}
      />
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium text-text-muted">
              <tr>
                <th className="px-4 py-2.5">Date</th>
                <th className="px-4 py-2.5">Entreprise</th>
                <th className="px-4 py-2.5">Action</th>
                <th className="px-4 py-2.5">Par</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {query.isLoading && <tr><td colSpan={4} className="px-4 py-6 text-text-muted">Chargement…</td></tr>}
              {query.isError && <tr><td colSpan={4} className="px-4 py-6 text-destructive">Impossible de charger le journal.</td></tr>}
              {query.data?.data.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {formatDay(row.createdAt)}{" "}
                    <span className="text-text-muted">
                      {new Date(row.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/entreprises/${row.organizationId}`} className="hover:underline">
                      {row.organizationName}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {ACTIVITY_ENTITY_LABELS[row.entity] ?? row.entity}{" "}
                    <span className="text-text-muted">{activityActionLabel(row.entity, row.action)}</span>
                  </td>
                  <td className="px-4 py-3">
                    {row.metadata.by === "platform_admin" ? (
                      <Badge variant="accent">Administration KORVA</Badge>
                    ) : (
                      row.userEmail ?? <span className="text-text-muted">Système</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {query.data && query.data.pagination.totalPages > 1 && (
        <div className="mt-4">
          <Pagination
            page={query.data.pagination.page}
            totalPages={query.data.pagination.totalPages}
            onPageChange={setPage}
            disabled={query.isFetching}
          />
        </div>
      )}
    </div>
  );
}
