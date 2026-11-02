"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { KitchenTicketStatus, KitchenTicketWithOrder } from "@korva/types";
import { Button, Card } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { useKitchenSocket } from "@/lib/use-kitchen-socket";
import { useT } from "@/lib/dashboard-locale";

const COLUMNS: { status: KitchenTicketStatus; label: [string, string] }[] = [
  { status: "new", label: ["Nouveau", "New"] },
  { status: "preparing", label: ["En préparation", "Preparing"] },
  { status: "ready", label: ["Prêt", "Ready"] },
];

const ADVANCE_LABEL: Record<string, [string, string]> = {
  new: ["Commencer", "Start"],
  preparing: ["Marquer prêt", "Mark ready"],
  ready: ["Marquer servi", "Mark served"],
};

function elapsedMinutes(createdAt: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000));
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export default function KitchenDisplayPage() {
  const authReady = useAuthReady();
  const queryClient = useQueryClient();
  const t = useT();

  const ticketsQuery = useQuery({
    queryKey: ["kitchen-tickets"],
    queryFn: () => apiClient.get<KitchenTicketWithOrder[]>("/kitchen-tickets"),
    enabled: authReady,
    // A fallback in case the socket connection drops — the real-time push is the primary path,
    // this is just a safety net so the board never goes fully stale.
    refetchInterval: 15000,
  });

  useKitchenSocket(() => {
    void queryClient.invalidateQueries({ queryKey: ["kitchen-tickets"] });
  });

  const advanceMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/kitchen-tickets/${id}/advance`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["kitchen-tickets"] }),
  });

  const tickets = ticketsQuery.data ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t("Cuisine", "Kitchen")}</h1>
        <p className="mt-1 text-sm text-text-muted">
          {t(
            "Vue en temps réel des additions ouvertes — se met à jour automatiquement.",
            "A live view of open tabs — it updates by itself.",
          )}
        </p>
      </div>

      {ticketsQuery.isError && (
        <Card className="p-6">
          <p className="text-sm text-destructive">
            {errorMessage(ticketsQuery.error, t("Impossible de charger les tickets.", "The tickets could not be loaded."))}
          </p>
        </Card>
      )}

      {!ticketsQuery.isError && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {COLUMNS.map((column) => {
            const columnTickets = tickets.filter((entry) => entry.ticket.status === column.status);
            return (
              <div key={column.status} className="space-y-2">
                <h2 className="text-sm font-semibold text-text-muted">
                  {t(...column.label)} ({columnTickets.length})
                </h2>
                <div className="space-y-2">
                  {columnTickets.length === 0 && (
                    <Card className="p-4 text-center text-xs text-text-muted">{t("Vide", "Empty")}</Card>
                  )}
                  {columnTickets.map(({ ticket, order }) => (
                    <Card key={ticket.id} className="p-4">
                      <div className="flex items-center justify-between">
                        <p className="font-medium text-text">{t("Commande", "Order")} {order.number}</p>
                        <p className="text-xs text-text-muted">
                          {elapsedMinutes(order.createdAt)} min
                        </p>
                      </div>
                      <ul className="mt-2 space-y-0.5 text-sm text-text-muted">
                        {order.items.length === 0 && <li>{t("Aucun article", "No items")}</li>}
                        {order.items.map((item, index) => (
                          <li key={index}>
                            {item.quantity}× {item.description}
                          </li>
                        ))}
                      </ul>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="mt-3 w-full"
                        loading={
                          advanceMutation.isPending &&
                          advanceMutation.variables === ticket.id
                        }
                        onClick={() => advanceMutation.mutate(ticket.id)}
                      >
                        {ADVANCE_LABEL[ticket.status] ? t(...ADVANCE_LABEL[ticket.status]!) : ticket.status}
                      </Button>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
