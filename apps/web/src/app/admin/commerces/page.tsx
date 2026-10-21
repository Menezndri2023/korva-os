"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BUSINESS_MODEL_DEFINITIONS, type BusinessModel } from "@korva/types";
import { Badge, Card, PageHeader } from "@korva/ui";
import { apiClient } from "@/lib/api-client";
import { STOREFRONT_URL } from "@/lib/storefront-url";

type Issue = "site_vide" | "sans_logo" | "sans_whatsapp" | "inactif";

interface ActivationRow {
  id: string;
  name: string;
  slug: string;
  businessModel?: BusinessModel;
  createdAt: string;
  ownerEmail: string | null;
  activeOffers: number;
  hasLogo: boolean;
  hasWhatsapp: boolean;
  websiteEnabled: boolean;
  lastActivityAt: string | null;
  nudgedAt: string | null;
  issues: Issue[];
}

const ISSUE_LABELS: Record<Issue, string> = {
  site_vide: "Site vide",
  sans_logo: "Sans logo",
  sans_whatsapp: "Sans WhatsApp",
  inactif: "Inactif 7 j",
};

const ISSUE_ORDER: Issue[] = ["site_vide", "inactif", "sans_whatsapp", "sans_logo"];

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "—";
}

/**
 * Every customer of the platform with what it needs — empty site, no logo, no WhatsApp, nobody
 * logged in for a week — the list to call or message. Access is checked by the admin layout and
 * the API (PlatformAdminGuard).
 */
export default function AdminShopsPage() {
  const [filter, setFilter] = useState<Issue | "all">("all");

  const query = useQuery({
    queryKey: ["platform", "activation"],
    queryFn: () => apiClient.get<ActivationRow[]>("/platform/activation", { withOrganization: false }),
  });

  const rows = useMemo(() => query.data ?? [], [query.data]);
  const counts = useMemo(() => {
    const result = Object.fromEntries(ISSUE_ORDER.map((issue) => [issue, 0])) as Record<Issue, number>;
    for (const row of rows) for (const issue of row.issues) result[issue] += 1;
    return result;
  }, [rows]);
  const visible = filter === "all" ? rows : rows.filter((row) => row.issues.includes(filter));

  if (query.isError) {
    return <p className="text-sm text-destructive">Impossible de charger les commerces.</p>;
  }

  return (
    <Shell>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrer les commerces">
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
          Tous ({rows.length})
        </FilterChip>
        {ISSUE_ORDER.map((issue) => (
          <FilterChip key={issue} active={filter === issue} onClick={() => setFilter(issue)}>
            {ISSUE_LABELS[issue]} ({counts[issue]})
          </FilterChip>
        ))}
      </div>

      <Card className="mt-4 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium text-text-muted">
              <tr>
                <th className="px-4 py-2.5">Commerce</th>
                <th className="px-4 py-2.5">Propriétaire</th>
                <th className="px-4 py-2.5">Offres en ligne</th>
                <th className="px-4 py-2.5">Inscrit</th>
                <th className="px-4 py-2.5">Dernière activité</th>
                <th className="px-4 py-2.5">À faire</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {query.isLoading && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-text-muted">Chargement…</td>
                </tr>
              )}
              {visible.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3">
                    <Link href={`/admin/commerces/${row.id}`} className="font-medium hover:underline">
                      {row.name}
                    </Link>
                    <a
                      href={`${STOREFRONT_URL}/${row.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-2 text-xs text-text-muted hover:underline"
                    >
                      voir le site
                    </a>
                    <p className="text-xs text-text-muted">
                      {row.businessModel ? BUSINESS_MODEL_DEFINITIONS[row.businessModel].label : "—"}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    {row.ownerEmail ? (
                      <a href={`mailto:${row.ownerEmail}`} className="hover:underline">{row.ownerEmail}</a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{row.activeOffers}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatDate(row.createdAt)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatDate(row.lastActivityAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {row.issues.map((issue) => (
                        <Badge key={issue} variant={issue === "site_vide" || issue === "inactif" ? "warning" : "default"}>
                          {ISSUE_LABELS[issue]}
                        </Badge>
                      ))}
                      {row.nudgedAt && <Badge variant="accent">Relancé le {formatDate(row.nudgedAt)}</Badge>}
                    </div>
                  </td>
                </tr>
              ))}
              {!query.isLoading && visible.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-text-muted">Aucun commerce dans cette catégorie.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <PageHeader
        title="Commerces"
        description="Les commerces à accompagner : site vide, pas de WhatsApp, personne connecté depuis 7 jours."
      />
      <div className="mt-6">{children}</div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
        active
          ? "border-primary bg-primary font-semibold text-on-primary"
          : "border-border-input bg-surface hover:bg-surface-muted"
      }`}
    >
      {children}
    </button>
  );
}
