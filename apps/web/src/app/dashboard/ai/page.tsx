"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AI_AGENTS,
  type AiAgent,
  type AiChatResponse,
  type AiConversation,
  type AiMessage,
  type AiPendingAction,
  type KorvaAiStatus,
} from "@korva/types";
import { Button, Card, Notice } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { AI_TOOL_LABELS, AI_TOOL_LABELS_EN, AiMessageText } from "@/components/ai-message-text";
import { useDashboardLocale, useT } from "@/lib/dashboard-locale";

const AGENT_LABELS: Record<AiAgent, [string, string]> = {
  general_assistant: ["Assistant KORVA", "KORVA assistant"],
  sales_agent: ["Agent commercial", "Sales agent"],
  booking_agent: ["Agent réservations", "Bookings agent"],
  analytics_agent: ["Agent analytique", "Analytics agent"],
};

export default function AiPage() {
  const queryClient = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [agent, setAgent] = useState<AiAgent>("general_assistant");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const authReady = useAuthReady();
  const t = useT();

  const { data: status } = useQuery({
    queryKey: ["ai-status"],
    queryFn: () => apiClient.get<KorvaAiStatus>("/ai/status"),
    enabled: authReady,
  });
  const canChat = status ? status.available && !status.paused : true;
  const assistant = status?.assistant;
  const agentLabel = (a: AiAgent) =>
    a === "general_assistant" && assistant ? assistant.name : t(...AGENT_LABELS[a]);

  const { data: conversations } = useQuery({
    queryKey: ["ai-conversations"],
    queryFn: () => apiClient.get<AiConversation[]>("/ai/conversations"),
    enabled: authReady,
  });
  const { data: messages, isLoading: messagesLoading } = useQuery({
    queryKey: ["ai-messages", conversationId],
    queryFn: () => apiClient.get<AiMessage[]>(`/ai/conversations/${conversationId}/messages`),
    enabled: authReady && !!conversationId,
  });
  const { data: pendingActions } = useQuery({
    queryKey: ["ai-pending-actions", conversationId],
    queryFn: () =>
      apiClient.get<AiPendingAction[]>(`/ai/conversations/${conversationId}/pending-actions`),
    enabled: authReady && !!conversationId,
  });

  function invalidateConversation(id: string) {
    void queryClient.invalidateQueries({ queryKey: ["ai-conversations"] });
    void queryClient.invalidateQueries({ queryKey: ["ai-messages", id] });
    void queryClient.invalidateQueries({ queryKey: ["ai-pending-actions", id] });
  }

  const chatMutation = useMutation({
    mutationFn: (input: { message: string }) =>
      apiClient.post<AiChatResponse>("/ai/chat", {
        conversationId: conversationId ?? undefined,
        agent: conversationId ? undefined : agent,
        message: input.message,
      }),
    onSuccess: (data) => {
      setConversationId(data.conversationId);
      setMessage("");
      setError(null);
      invalidateConversation(data.conversationId);
      void queryClient.invalidateQueries({ queryKey: ["ai-status"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : t("Erreur", "Error")),
  });

  const confirmMutation = useMutation({
    mutationFn: (actionId: string) => apiClient.post(`/ai/actions/${actionId}/confirm`),
    onSuccess: () => conversationId && invalidateConversation(conversationId),
  });
  const rejectMutation = useMutation({
    mutationFn: (actionId: string) => apiClient.post(`/ai/actions/${actionId}/reject`),
    onSuccess: () => conversationId && invalidateConversation(conversationId),
  });

  function send(text = message) {
    if (!text.trim() || chatMutation.isPending || !canChat) return;
    setMessage(text);
    chatMutation.mutate({ message: text.trim() });
  }

  const pendingOnly = pendingActions?.filter((a) => a.status === "pending") ?? [];

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4 md:flex-row">
      <aside
        // Not migrated to <Card>: Card always renders a <div>, and this element must stay a
        // real <aside> for document semantics — same exclusion as the raw <form> wrappers
        // elsewhere (dashboard/crm, dashboard/bookings).
        // Stacked above the chat and height-capped below md (a fixed w-64 sidebar next to the
        // chat would leave almost no room for it on a phone-width viewport); reverts to the
        // original side-by-side, full-height layout at md: and up.
        className="max-h-48 shrink-0 space-y-3 overflow-y-auto rounded-lg border border-border bg-surface p-3 md:h-auto md:max-h-none md:w-64"
      >
        <Button className="w-full" onClick={() => setConversationId(null)}>
          {t("Nouvelle conversation", "New conversation")}
        </Button>
        {!conversationId && (
          <select
            value={agent}
            onChange={(e) => setAgent(e.target.value as AiAgent)}
            className="w-full rounded-md border border-border-input px-2 py-1.5 text-sm focus:border-focus focus:outline-none"
          >
            {AI_AGENTS.map((a) => (
              <option key={a} value={a}>
                {agentLabel(a)}
              </option>
            ))}
          </select>
        )}
        <ul className="space-y-1">
          {conversations?.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => setConversationId(c.id)}
                className={`w-full truncate rounded-md px-2 py-1.5 text-left text-sm ${
                  conversationId === c.id
                    ? "bg-sidebar text-text-primary"
                    : "text-text hover:bg-surface-muted"
                }`}
              >
                {agentLabel(c.agent)}
              </button>
            </li>
          ))}
          {conversations?.length === 0 && (
            <li className="px-2 py-1.5 text-xs text-text-muted">{t("Aucune conversation.", "No conversations.")}</li>
          )}
        </ul>
      </aside>

      <Card className="flex flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary font-bold text-on-primary"
          >
            K
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-text">{assistant?.name ?? t("KORVA IA", "KORVA AI")}</p>
            <p className="truncate text-xs text-text-muted">
              {t("KORVA IA · adapté à votre métier", "KORVA AI · made for your trade")}
              {status && status.quota.limit > 0
                ? status.quota.limit - status.quota.used > 1
                  ? t(
                      ` · ${Math.max(0, status.quota.limit - status.quota.used)} messages restants ce mois-ci`,
                      ` · ${Math.max(0, status.quota.limit - status.quota.used)} messages left this month`,
                    )
                  : t(
                      ` · ${Math.max(0, status.quota.limit - status.quota.used)} message restant ce mois-ci`,
                      ` · ${Math.max(0, status.quota.limit - status.quota.used)} message left this month`,
                    )
                : ""}
            </p>
          </div>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {status && !status.available && (
            <Notice tone="warning">
              {t(
                "KORVA IA n'est pas encore activée sur la plateforme. Elle arrive très bientôt ; rien n'est décompté de votre quota en attendant.",
                "KORVA AI is not switched on yet. It is coming very soon; nothing counts against your quota until then.",
              )}
            </Notice>
          )}
          {status?.paused && (
            <Notice tone="warning">
              {t(
                "KORVA IA fait une pause jusqu'au début du mois prochain. Vos messages ne sont pas décomptés pendant ce temps.",
                "KORVA AI is paused until the start of next month. Your messages do not count in the meantime.",
              )}
            </Notice>
          )}
          {!conversationId && assistant && (
            <div className="space-y-3">
              <p className="text-sm text-text">{assistant.intro}</p>
              <p className="text-xs text-text-muted">{t("Pour commencer, par exemple :", "To start, for example:")}</p>
              <div className="flex flex-wrap gap-2">
                {assistant.suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    disabled={!canChat || chatMutation.isPending}
                    onClick={() => send(suggestion)}
                    className="rounded-full border border-border-input bg-surface px-3 py-1.5 text-left text-sm text-text hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}
          {conversationId && messagesLoading && (
            <p className="text-sm text-text-muted">{t("Chargement...", "Loading...")}</p>
          )}
          {messages?.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          {pendingOnly.map((action) => {
            // Per-action, not global: several pending actions can be on screen at once, and
            // `variables` scopes the mutation's last error to the specific action id it was
            // called with — the same pattern already used for per-row errors elsewhere (e.g.
            // crm/page.tsx's delete-confirm). Without this, a rejected WhatsApp-consent confirm
            // or a lost-claim race (AI_ACTION_ALREADY_RESOLVED) failed silently: the button just
            // stopped loading with no visible reason.
            const actionError =
              confirmMutation.isError && confirmMutation.variables === action.id
                ? confirmMutation.error
                : rejectMutation.isError && rejectMutation.variables === action.id
                  ? rejectMutation.error
                  : null;
            return (
              <div key={action.id} className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
                <p className="font-medium text-amber-900">
                  {t("Confirmation requise :", "Confirmation needed:")} {action.toolName}
                </p>
                <p className="mt-1 text-xs text-warning">{JSON.stringify(action.input)}</p>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => confirmMutation.mutate(action.id)}
                    disabled={confirmMutation.isPending}
                    className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-60"
                  >
                    {t("Confirmer", "Confirm")}
                  </button>
                  <button
                    onClick={() => rejectMutation.mutate(action.id)}
                    disabled={rejectMutation.isPending}
                    className="rounded-md border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
                  >
                    {t("Rejeter", "Reject")}
                  </button>
                </div>
                {actionError && (
                  <p className="mt-2 text-xs text-destructive">
                    {actionError instanceof ApiError
                      ? actionError.message
                      : t("Une erreur est survenue. Réessayez.", "Something went wrong. Try again.")}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <div className="border-t border-border p-3">
          {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={2}
              disabled={!canChat}
              aria-label={t("Votre message", "Your message")}
              placeholder={
                canChat
                  ? t("Posez votre question…", "Ask your question…")
                  : t("KORVA IA n'est pas disponible pour le moment", "KORVA AI is not available right now")
              }
              className="flex-1 rounded-md border border-border-input bg-surface px-3 py-2 text-sm focus:border-focus focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            />
            <Button onClick={() => send()} loading={chatMutation.isPending} disabled={!canChat}>
              {chatMutation.isPending ? "..." : t("Envoyer", "Send")}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function MessageBubble({ message }: { message: AiMessage }) {
  const locale = useDashboardLocale();
  // The data a tool returned is for the model, not for the merchant.
  if (message.role === "tool") return null;
  if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
    const labels = locale === "en" ? AI_TOOL_LABELS_EN : AI_TOOL_LABELS;
    const working = locale === "en" ? "is working" : "travaille";
    const steps = [...new Set(message.toolCalls.map((c) => labels[c.name] ?? working))];
    return (
      <p className="text-xs italic text-text-muted">
        {locale === "en" ? "KORVA AI" : "KORVA IA"} {steps.join(", ")}…
      </p>
    );
  }
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
          isUser ? "bg-sidebar text-text-primary" : "bg-surface-muted text-text"
        }`}
      >
        {isUser ? message.content : <AiMessageText text={message.content ?? ""} />}
      </div>
    </div>
  );
}
