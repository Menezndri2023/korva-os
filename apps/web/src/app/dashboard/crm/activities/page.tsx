"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Activity, Contact, Deal, Lead } from "@korva/types";
import { Badge, Card, Pagination } from "@korva/ui";
import { apiClient } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";

const ENTITY_LABELS: Record<Activity["entity"], string> = {
  contact: "Client",
  lead: "Prospect",
  deal: "Affaire",
};

export default function ActivitiesPage() {
  const [page, setPage] = useState(1);
  const authReady = useAuthReady();

  const { data: activitiesPage, isLoading, isError, refetch } = useQuery({
    queryKey: ["activities", "recent", page],
    queryFn: () => apiClient.getList<Activity>(`/activities/recent?page=${page}`),
    enabled: authReady,
  });
  const activities = activitiesPage?.data;

  const { data: contacts } = useQuery({
    queryKey: ["contacts", ""],
    queryFn: () => apiClient.get<Contact[]>("/contacts"),
    enabled: authReady,
  });
  const { data: leads } = useQuery({
    queryKey: ["leads", ""],
    queryFn: () => apiClient.get<Lead[]>("/leads"),
    enabled: authReady,
  });
  const { data: deals } = useQuery({
    queryKey: ["deals", ""],
    queryFn: () => apiClient.get<Deal[]>("/deals"),
    enabled: authReady,
  });

  function contactName(contactId: string): string {
    const contact = contacts?.find((c) => c.id === contactId);
    if (!contact) return "—";
    return (
      [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
      contact.company ||
      contact.email ||
      "—"
    );
  }

  // A lead or deal has no name of its own — resolve it back to the contact it's attached to.
  function entityLink(activity: Activity): { href: string; label: string } {
    if (activity.entity === "contact") {
      return {
        href: `/dashboard/crm/${activity.entityId}`,
        label: contactName(activity.entityId),
      };
    }
    if (activity.entity === "deal") {
      const deal = deals?.find((d) => d.id === activity.entityId);
      return {
        href: deal ? `/dashboard/crm/${deal.contactId}` : "#",
        label: deal ? contactName(deal.contactId) : "—",
      };
    }
    const lead = leads?.find((l) => l.id === activity.entityId);
    return {
      href: lead ? `/dashboard/crm/${lead.contactId}` : "#",
      label: lead ? contactName(lead.contactId) : "—",
    };
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Activités</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Appels, e-mails, rendez-vous et notes enregistrés sur vos clients et prospects.
        </p>
      </div>

      {isError && (
        <Card className="p-6">
          <p className="text-sm text-destructive">Impossible de charger les activités.</p>
          <button onClick={() => refetch()} className="mt-2 text-sm font-medium text-text underline">
            Réessayer
          </button>
        </Card>
      )}

      {!isError && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500">
                <tr>
                  <th className="px-4 py-2">Type</th>
                  <th className="px-4 py-2">Contact</th>
                  <th className="px-4 py-2">Détails</th>
                  <th className="px-4 py-2">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {isLoading && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-zinc-500">
                      Chargement...
                    </td>
                  </tr>
                )}
                {!isLoading && activities?.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-zinc-500">
                      Aucune activité enregistrée pour le moment.
                    </td>
                  </tr>
                )}
                {activities?.map((activity) => {
                  const entity = entityLink(activity);
                  return (
                    <tr key={activity.id}>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <Badge>{activity.type}</Badge>
                          <span className="text-xs text-zinc-500">
                            {ENTITY_LABELS[activity.entity]}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2 font-medium">
                        <Link
                          href={entity.href}
                          className="text-zinc-900 underline-offset-2 hover:underline"
                        >
                          {entity.label}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-zinc-600">{activity.content ?? "—"}</td>
                      <td className="px-4 py-2 text-zinc-600">
                        {new Date(activity.createdAt).toLocaleString("fr-FR")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Pagination
        page={page}
        totalPages={activitiesPage?.pagination.totalPages ?? 1}
        onPageChange={setPage}
        disabled={isLoading}
      />
    </div>
  );
}
