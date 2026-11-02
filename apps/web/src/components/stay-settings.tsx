"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_CHECK_IN_TIME, DEFAULT_CHECK_OUT_TIME, type Organization } from "@korva/types";
import { Button, Input } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useT } from "@/lib/dashboard-locale";

/**
 * Arrival and departure times of a stay (offers sold by the night). A customer only picks dates;
 * the API turns them into these hours, in the organization's timezone.
 */
export function StaySettings({ organization }: { organization: Organization }) {
  const queryClient = useQueryClient();
  const t = useT();
  const [checkIn, setCheckIn] = useState(organization.checkInTime ?? DEFAULT_CHECK_IN_TIME);
  const [checkOut, setCheckOut] = useState(organization.checkOutTime ?? DEFAULT_CHECK_OUT_TIME);
  const mutation = useMutation({
    mutationFn: () =>
      apiClient.patch<Organization>("/organizations/me", {
        checkInTime: checkIn,
        checkOutTime: checkOut,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["organizations", "me"] }),
  });

  return (
    <section className="rounded-lg border border-border bg-surface p-6">
      <h2 className="text-sm font-semibold text-text">{t("Séjours", "Stays")}</h2>
      <p className="mt-1 text-sm text-text-muted">
        {t(
          "Pour les offres vendues à la nuit : vos clients choisissent leurs dates, ces heures s'appliquent.",
          "For offers sold by the night: your customers choose their dates, and these times apply.",
        )}
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="text-xs font-medium text-text">
          {t("Arrivée à partir de", "Check-in from")}
          <Input
            type="time"
            aria-label={t("Heure d'arrivée", "Check-in time")}
            className="mt-1 block"
            value={checkIn}
            onChange={(e) => setCheckIn(e.target.value)}
          />
        </label>
        <label className="text-xs font-medium text-text">
          {t("Départ avant", "Check-out by")}
          <Input
            type="time"
            aria-label={t("Heure de départ", "Check-out time")}
            className="mt-1 block"
            value={checkOut}
            onChange={(e) => setCheckOut(e.target.value)}
          />
        </label>
        <Button type="button" size="sm" loading={mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? t("Enregistrement...", "Saving...") : t("Enregistrer", "Save")}
        </Button>
        {mutation.isSuccess && <p className="text-xs text-success">{t("Enregistré.", "Saved.")}</p>}
        {mutation.isError && (
          <p className="text-xs text-destructive">
            {mutation.error instanceof ApiError ? mutation.error.message : t("Erreur", "Error")}
          </p>
        )}
      </div>
    </section>
  );
}
