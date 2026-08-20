"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Notification } from "@korva/types";
import { apiClient } from "@/lib/api-client";

export default function NotificationsPage() {
  const queryClient = useQueryClient();

  const { data: notifications, isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiClient.get<Notification[]>("/notifications"),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["notifications"] });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => apiClient.patch<Notification>(`/notifications/${id}/read`),
    onSuccess: invalidate,
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => apiClient.post<{ updated: number }>("/notifications/read-all"),
    onSuccess: invalidate,
  });

  const unreadCount = notifications?.filter((n) => !n.read).length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">
          {unreadCount > 0 ? `${unreadCount} notification(s) non lue(s)` : "Tout est à jour."}
        </p>
        {unreadCount > 0 && (
          <button
            onClick={() => markAllReadMutation.mutate()}
            disabled={markAllReadMutation.isPending}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
          >
            Tout marquer comme lu
          </button>
        )}
      </div>

      <div className="divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 bg-white">
        {isLoading && <p className="px-4 py-6 text-center text-sm text-zinc-500">Chargement...</p>}
        {!isLoading && notifications?.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-zinc-500">Aucune notification.</p>
        )}
        {notifications?.map((notification) => (
          <div
            key={notification.id}
            className={`flex items-start justify-between gap-3 px-4 py-3 ${
              notification.read ? "" : "bg-zinc-50"
            }`}
          >
            <div>
              <p className="text-sm font-medium text-zinc-900">{notification.title}</p>
              {notification.body && <p className="mt-0.5 text-sm text-zinc-600">{notification.body}</p>}
              <p className="mt-1 text-xs text-zinc-400">
                {new Date(notification.createdAt).toLocaleString("fr-FR")}
              </p>
            </div>
            {!notification.read && (
              <button
                onClick={() => markReadMutation.mutate(notification.id)}
                className="shrink-0 text-xs text-zinc-600 hover:underline"
              >
                Marquer comme lu
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
