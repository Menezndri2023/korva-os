"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Notification } from "@korva/types";
import { Button, Card, Pagination } from "@korva/ui";
import { apiClient } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { intlLocale, useDashboardLocale, useT } from "@/lib/dashboard-locale";

export default function NotificationsPage() {
  const locale = useDashboardLocale();
  const t = useT();
  const queryClient = useQueryClient();
  const authReady = useAuthReady();
  const [page, setPage] = useState(1);

  const { data: notificationsPage, isLoading, isError, refetch } = useQuery({
    queryKey: ["notifications", page],
    queryFn: () => apiClient.getList<Notification>(`/notifications?page=${page}`),
    enabled: authReady,
  });
  const notifications = notificationsPage?.data;

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
        <p className="text-sm text-text-muted">
          {unreadCount > 0 ? `${unreadCount} notification(s) non lue(s)` : t("Tout est à jour.", "You are all caught up.")}
        </p>
        {unreadCount > 0 && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => markAllReadMutation.mutate()}
            loading={markAllReadMutation.isPending}
          >
            {t("Tout marquer comme lu", "Mark all as read")}
          </Button>
        )}
      </div>

      {isError && (
        <Card className="p-6">
          <p className="text-sm text-destructive">{t(
            "Impossible de charger vos notifications.",
            "Your notifications could not be loaded.",
          )}</p>
          <button
            onClick={() => void refetch()}
            className="mt-2 text-sm font-medium text-text underline"
          >
            {t("Réessayer", "Try again")}
          </button>
        </Card>
      )}

      {!isError && (
        <Card className="divide-y divide-border overflow-hidden">
          {isLoading && <p className="px-4 py-6 text-center text-sm text-text-muted">{t("Chargement...", "Loading...")}</p>}
          {!isLoading && notifications?.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-text-muted">{t("Aucune notification.", "No notifications.")}</p>
          )}
          {notifications?.map((notification) => (
            <div
              key={notification.id}
              className={`flex items-start justify-between gap-3 px-4 py-3 ${
                notification.read ? "" : "bg-surface-muted"
              }`}
            >
              <div>
                <p className="text-sm font-medium text-text">{notification.title}</p>
                {notification.body && <p className="mt-0.5 text-sm text-text-muted">{notification.body}</p>}
                <p className="mt-1 text-xs text-text-muted">
                  {new Date(notification.createdAt).toLocaleString(intlLocale(locale))}
                </p>
              </div>
              {!notification.read && (
                <button
                  onClick={() => markReadMutation.mutate(notification.id)}
                  className="shrink-0 text-xs text-text-muted hover:underline"
                >
                  {t("Marquer comme lu", "Mark as read")}
                </button>
              )}
            </div>
          ))}
        </Card>
      )}

      {!isError && (
        <Pagination
          page={page}
          totalPages={notificationsPage?.pagination.totalPages ?? 1}
          onPageChange={setPage}
          disabled={isLoading}
        />
      )}
    </div>
  );
}
