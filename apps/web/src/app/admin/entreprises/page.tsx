"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BUSINESS_MODELS,
  BUSINESS_MODEL_DEFINITIONS,
  PLAN_KEYS,
  PLAN_NAMES,
  type PlanKey,
} from "@korva/types";
import { Badge, Card, Input, PageHeader, Select } from "@korva/ui";
import { apiClient } from "@/lib/api-client";
import { STOREFRONT_URL } from "@/lib/storefront-url";
import {
  channelCount,
  formatDay,
  type BusinessIssue,
  type PlatformBusinessRow,
} from "@/lib/platform-admin";

const ISSUE_LABELS: Record<BusinessIssue, string> = {
  site_vide: "Site vide",
  sans_logo: "Sans logo",
  sans_whatsapp: "Sans WhatsApp",
  inactif: "Inactif 7 j",
};

const ISSUE_ORDER: BusinessIssue[] = ["site_vide", "inactif", "sans_whatsapp", "sans_logo"];

/**
 * Every business on the platform, whatever its trade — shops, restaurants, salons, lodging,
 * training, service companies, agencies, associations — with what each needs and its activity in
 * its OWN channel (bookings for a salon, quotes for a service company…). Access is checked by the
 * admin layout and the API (PlatformAdminGuard).
 */
export default function AdminBusinessesPage() {
  const [issue, setIssue] = useState<BusinessIssue | "all" | "suspended">("all");
  const [model, setModel] = useState("all");
  const [plan, setPlan] = useState("all");
  const [search, setSearch] = useState("");

  const query = useQuery({
    queryKey: ["platform", "businesses"],
    queryFn: () => apiClient.get<PlatformBusinessRow[]>("/platform/businesses", { withOrganization: false }),
  });

  const rows = useMemo(() => query.data ?? [], [query.data]);
  const counts = useMemo(() => {
    const result = Object.fromEntries(ISSUE_ORDER.map((key) => [key, 0])) as Record<BusinessIssue, number>;
    for (const row of rows) for (const key of row.issues) result[key] += 1;
    return result;
  }, [rows]);
  const suspendedCount = rows.filter((row) => row.suspendedAt).length;

  const needle = search.trim().toLowerCase();
  const visible = rows.filter(
    (row) =>
      (issue === "all" ||
        (issue === "suspended" ? Boolean(row.suspendedAt) : row.issues.includes(issue))) &&
      (model === "all" || (model === "none" ? !row.businessModel : row.businessModel === model)) &&
      (plan === "all" || row.planKey === plan) &&
      (!needle ||
        row.name.toLowerCase().includes(needle) ||
        (row.ownerEmail ?? "").toLowerCase().includes(needle) ||
        row.slug.includes(needle)),
  );

  return (
    <div>
      <PageHeader
        title="Entreprises"
        description="Tous les métiers de la plateforme, avec ce qu'il faut pour les accompagner."
      />

      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <Input
          type="search"
          aria-label="Rechercher une entreprise"
          placeholder="Nom, e-mail du propriétaire ou adresse du site…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select aria-label="Métier" value={model} onChange={(event) => setModel(event.target.value)}>
          <option value="all">Tous les métiers</option>
          {BUSINESS_MODELS.map((key) => (
            <option key={key} value={key}>
              {BUSINESS_MODEL_DEFINITIONS[key].label}
            </option>
          ))}
          <option value="none">Métier non renseigné</option>
        </Select>
        <Select aria-label="Formule" value={plan} onChange={(event) => setPlan(event.target.value)}>
          <option value="all">Toutes les formules</option>
          {PLAN_KEYS.map((key) => (
            <option key={key} value={key}>
              {PLAN_NAMES[key]}
            </option>
          ))}
        </Select>
      </div>

      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Filtrer les entreprises">
        <FilterChip active={issue === "all"} onClick={() => setIssue("all")}>
          Toutes ({rows.length})
        </FilterChip>
        {ISSUE_ORDER.map((key) => (
          <FilterChip key={key} active={issue === key} onClick={() => setIssue(key)}>
            {ISSUE_LABELS[key]} ({counts[key]})
          </FilterChip>
        ))}
        <FilterChip active={issue === "suspended"} onClick={() => setIssue("suspended")}>
          Suspendues ({suspendedCount})
        </FilterChip>
      </div>

      <Card className="mt-4 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium text-text-muted">
              <tr>
                <th className="px-4 py-2.5">Entreprise</th>
                <th className="px-4 py-2.5">Formule</th>
                <th className="px-4 py-2.5">Activité 30 j</th>
                <th className="px-4 py-2.5">Offres en ligne</th>
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
              {query.isError && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-destructive">Impossible de charger les entreprises.</td>
                </tr>
              )}
              {visible.map((row) => (
                <tr key={row.id} className={row.suspendedAt ? "bg-destructive-soft/40" : undefined}>
                  <td className="px-4 py-3">
                    <Link href={`/admin/entreprises/${row.id}`} className="font-medium hover:underline">
                      {row.name}
                    </Link>
                    <p className="text-xs text-text-muted">
                      {row.businessModel ? BUSINESS_MODEL_DEFINITIONS[row.businessModel].label : "Métier non renseigné"}
                      {" · "}
                      <a
                        href={`${STOREFRONT_URL}/${row.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                      >
                        voir le site
                      </a>
                    </p>
                    {row.ownerEmail && <p className="text-xs text-text-muted">{row.ownerEmail}</p>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {row.planKey ? (PLAN_NAMES[row.planKey as PlanKey] ?? row.planKey) : "—"}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap tabular-nums">{channelCount(row.activity30d, row.channel)}</td>
                  <td className="px-4 py-3 tabular-nums">{row.activeOffers}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatDay(row.lastActivityAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {row.suspendedAt && <Badge variant="destructive">Suspendue</Badge>}
                      {row.issues.map((key) => (
                        <Badge key={key} variant={key === "site_vide" || key === "inactif" ? "warning" : "default"}>
                          {ISSUE_LABELS[key]}
                        </Badge>
                      ))}
                      {row.nudgedAt && <Badge variant="accent">Relancée le {formatDay(row.nudgedAt)}</Badge>}
                    </div>
                  </td>
                </tr>
              ))}
              {!query.isLoading && visible.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-text-muted">Aucune entreprise ne correspond.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
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
