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
} from "@korva/types";
import { Button, Card } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";

const AGENT_LABELS: Record<AiAgent, string> = {
  general_assistant: "Assistant général",
  sales_agent: "Agent commercial",
  booking_agent: "Agent réservations",
  analytics_agent: "Agent analytique",
};

export default function AiPage() {
  const queryClient = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [agent, setAgent] = useState<AiAgent>("general_assistant");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const authReady = useAuthReady();

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
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Erreur"),
  });

  const confirmMutation = useMutation({
    mutationFn: (actionId: string) => apiClient.post(`/ai/actions/${actionId}/confirm`),
    onSuccess: () => conversationId && invalidateConversation(conversationId),
  });
  const rejectMutation = useMutation({
    mutationFn: (actionId: string) => apiClient.post(`/ai/actions/${actionId}/reject`),
    onSuccess: () => conversationId && invalidateConversation(conversationId),
  });

  function send() {
    if (!message.trim() || chatMutation.isPending) return;
    chatMutation.mutate({ message: message.trim() });
  }

  const pendingOnly = pendingActions?.filter((a) => a.status === "pending") ?? [];

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      <aside
        // Not migrated to <Card>: Card always renders a <div>, and this element must stay a
        // real <aside> for document semantics — same exclusion as the raw <form> wrappers
        // elsewhere (dashboard/crm, dashboard/bookings).
        className="w-64 shrink-0 space-y-3 overflow-y-auto rounded-lg border border-border bg-surface p-3"
      >
        <Button className="w-full" onClick={() => setConversationId(null)}>
          Nouvelle conversation
        </Button>
        {!conversationId && (
          <select
            value={agent}
            onChange={(e) => setAgent(e.target.value as AiAgent)}
            className="w-full rounded-md border border-border-input px-2 py-1.5 text-sm focus:border-focus focus:outline-none"
          >
            {AI_AGENTS.map((a) => (
              <option key={a} value={a}>
                {AGENT_LABELS[a]}
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
                    ? "bg-zinc-900 text-text-primary"
                    : "text-text hover:bg-surface-muted"
                }`}
              >
                {AGENT_LABELS[c.agent]}
              </button>
            </li>
          ))}
          {conversations?.length === 0 && (
            <li className="px-2 py-1.5 text-xs text-text-muted">Aucune conversation.</li>
          )}
        </ul>
      </aside>

      <Card className="flex flex-1 flex-col">
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {!conversationId && (
            <p className="text-sm text-text-muted">
              Choisissez un agent à gauche, puis écrivez votre premier message.
            </p>
          )}
          {conversationId && messagesLoading && (
            <p className="text-sm text-text-muted">Chargement...</p>
          )}
          {messages?.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          {pendingOnly.map((action) => (
            <div key={action.id} className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
              <p className="font-medium text-amber-900">
                Confirmation requise : {action.toolName}
              </p>
              <p className="mt-1 text-xs text-warning">{JSON.stringify(action.input)}</p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => confirmMutation.mutate(action.id)}
                  disabled={confirmMutation.isPending}
                  className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-60"
                >
                  Confirmer
                </button>
                <button
                  onClick={() => rejectMutation.mutate(action.id)}
                  disabled={rejectMutation.isPending}
                  className="rounded-md border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
                >
                  Rejeter
                </button>
              </div>
            </div>
          ))}
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
              placeholder="Écrivez votre message..."
              className="flex-1 rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            />
            <Button onClick={send} loading={chatMutation.isPending}>
              {chatMutation.isPending ? "..." : "Envoyer"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function MessageBubble({ message }: { message: AiMessage }) {
  if (message.role === "tool") {
    return (
      <div className="text-xs text-text-muted">
        🔧 {message.toolName} → {message.content}
      </div>
    );
  }
  if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
    return (
      <div className="text-xs text-text-muted">
        🔧 appel : {message.toolCalls.map((c) => c.name).join(", ")}
      </div>
    );
  }
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
          isUser ? "bg-zinc-900 text-text-primary" : "bg-surface-muted text-text"
        }`}
      >
        {message.content}
      </div>
    </div>
  );
}
