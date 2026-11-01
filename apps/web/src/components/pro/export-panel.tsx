"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { DataExport, DataExportKind } from "@korva/types";
import { Button, Card, Input } from "@korva/ui";
import { ApiError, apiClient } from "@/lib/api-client";
import { usePlanFeatures } from "@/lib/use-plan-features";
import { PlanLock } from "@/components/plan-lock";
import { UpgradeCard } from "./upgrade-card";

const KIND_LABELS: Record<DataExportKind, string> = {
  orders: "Commandes",
  bookings: "Réservations",
  contacts: "Clients",
  "sales-journal": "Journal des ventes (comptable)",
};

function isoDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Hands the file to the browser: the API returns its text, the browser saves it. */
function save(file: DataExport) {
  const url = URL.createObjectURL(new Blob([file.csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Excel exports (Pro), and the accountant's sales journal (Business). Only the kinds the trade
 * works with are offered: a salon is not offered an export of orders it does not take.
 */
export function ExportPanel({ kinds }: { kinds: DataExportKind[] }) {
  const planFeatures = usePlanFeatures();
  const [from, setFrom] = useState(() => isoDay(new Date(Date.now() - 29 * 86_400_000)));
  const [to, setTo] = useState(() => isoDay(new Date()));
  const [done, setDone] = useState<string | null>(null);
  const exportMutation = useMutation({
    mutationFn: (kind: DataExportKind) =>
      apiClient.get<DataExport>(`/exports/${kind}?from=${from}&to=${to}`),
    onSuccess: (file) => {
      save(file);
      setDone(
        file.truncated
          ? `${file.rows} lignes exportées : la période en contient davantage, choisissez des dates plus proches pour le reste.`
          : `${file.rows} ligne${file.rows > 1 ? "s" : ""} exportée${file.rows > 1 ? "s" : ""}.`,
      );
    },
  });

  if (!planFeatures.has("data_export")) {
    return (
      <UpgradeCard
        feature="data_export"
        description="Téléchargez vos ventes, réservations et clients en fichier Excel, pour vos comptes ou vos analyses."
      />
    );
  }

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-text">Exporter vers Excel</h2>
      <p className="mt-1 text-sm text-text-muted">
        Un fichier qui s&apos;ouvre directement dans Excel ou Google Sheets.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-text">Du</span>
          <Input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-text">Au</span>
          <Input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {kinds.map((kind) => {
          const locked = kind === "sales-journal" && !planFeatures.has("accounting_export");
          return (
            <span key={kind} className="inline-flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={locked || exportMutation.isPending || !from || !to}
                onClick={() => {
                  setDone(null);
                  exportMutation.mutate(kind);
                }}
              >
                {KIND_LABELS[kind]}
              </Button>
              {locked && <PlanLock feature="accounting_export" />}
            </span>
          );
        })}
      </div>
      <p aria-live="polite" className="mt-3 text-sm">
        {exportMutation.isPending && <span className="text-text-muted">Préparation du fichier…</span>}
        {exportMutation.isError && (
          <span className="text-destructive">
            {exportMutation.error instanceof ApiError
              ? exportMutation.error.message
              : "Impossible de préparer le fichier. Réessayez."}
          </span>
        )}
        {done && <span className="text-success">{done}</span>}
      </p>
    </Card>
  );
}
