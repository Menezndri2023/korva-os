"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_CHECK_IN_TIME, DEFAULT_CHECK_OUT_TIME, type Organization } from "@korva/types";
import { Button, Input } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";

/**
 * Arrival and departure times of a stay (offers sold by the night). A customer only picks dates;
 * the API turns them into these hours, in the organization's timezone.
 */
export function StaySettings({ organization }: { organization: Organization }) {
  const queryClient = useQueryClient();
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
      <h2 className="text-sm font-semibold text-text">Séjours</h2>
      <p className="mt-1 text-sm text-text-muted">
        Pour les offres vendues à la nuit : vos clients choisissent leurs dates, ces heures
        s&apos;appliquent.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="text-xs font-medium text-text">
          Arrivée à partir de
          <Input
            type="time"
            aria-label="Heure d'arrivée"
            className="mt-1 block"
            value={checkIn}
            onChange={(e) => setCheckIn(e.target.value)}
          />
        </label>
        <label className="text-xs font-medium text-text">
          Départ avant
          <Input
            type="time"
            aria-label="Heure de départ"
            className="mt-1 block"
            value={checkOut}
            onChange={(e) => setCheckOut(e.target.value)}
          />
        </label>
        <Button type="button" size="sm" loading={mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? "Enregistrement..." : "Enregistrer"}
        </Button>
        {mutation.isSuccess && <p className="text-xs text-success">Enregistré.</p>}
        {mutation.isError && (
          <p className="text-xs text-destructive">
            {mutation.error instanceof ApiError ? mutation.error.message : "Erreur"}
          </p>
        )}
      </div>
    </section>
  );
}
