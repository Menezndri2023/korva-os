"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createConversationSchema,
  type CreateConversationInput,
  type CreateMessageInput,
} from "@korva/validation";
import {
  COMMUNICATION_CHANNELS,
  type CommunicationChannel,
  type Contact,
  type Conversation,
  type Message,
  type MessageTemplate,
} from "@korva/types";
import { Badge, Button, Card, Input, Pagination } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";

const CHANNEL_LABELS: Record<CommunicationChannel, string> = {
  email: "E-mail",
  whatsapp: "WhatsApp",
  sms: "SMS",
  internal: "Note interne",
};

export default function ConversationsPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const authReady = useAuthReady();

  const { data: conversationsPage, isLoading } = useQuery({
    queryKey: ["conversations", page],
    queryFn: () => apiClient.getList<Conversation>(`/conversations?page=${page}`),
    enabled: authReady,
  });
  const conversations = conversationsPage?.data;
  const { data: contacts } = useQuery({
    queryKey: ["contacts", ""],
    queryFn: () => apiClient.get<Contact[]>("/contacts"),
    enabled: authReady,
  });

  const { register, handleSubmit, reset } = useForm<CreateConversationInput>({
    defaultValues: { contactId: "", channel: "email", subject: "" },
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["conversations"] });

  const createMutation = useMutation({
    mutationFn: (input: CreateConversationInput) =>
      apiClient.post<Conversation>("/conversations", input),
    onSuccess: () => {
      invalidate();
      reset();
      setShowForm(false);
      setFormError(null);
    },
    onError: (error) => setFormError(error instanceof ApiError ? error.message : "Erreur"),
  });

  function onSubmit(values: CreateConversationInput) {
    setFormError(null);
    const result = createConversationSchema.safeParse(values);
    if (!result.success) {
      setFormError(result.error.issues[0]?.message ?? "Formulaire invalide");
      return;
    }
    createMutation.mutate(result.data);
  }

  function contactName(contactId: string): string {
    const contact = contacts?.find((c) => c.id === contactId);
    if (!contact) return "—";
    return [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.company || contact.email || "—";
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setShowForm((v) => !v)}>{showForm ? "Annuler" : "Nouvelle conversation"}</Button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit(onSubmit)}
          // Not migrated to <Card>: this wrapper is the <form> element itself (it carries
          // onSubmit), and Card renders a <div> — same exclusion documented on the other
          // migrated create-forms (dashboard/crm, dashboard/bookings).
          className="grid grid-cols-3 gap-3 rounded-lg border border-border bg-surface p-4"
        >
          <select
            className="rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            defaultValue=""
            {...register("contactId", { required: true })}
          >
            <option value="" disabled>
              Choisir un contact
            </option>
            {contacts?.map((c) => (
              <option key={c.id} value={c.id}>
                {[c.firstName, c.lastName].filter(Boolean).join(" ") || c.company || c.email}
              </option>
            ))}
          </select>
          <select
            className="rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            {...register("channel", { required: true })}
          >
            {COMMUNICATION_CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {CHANNEL_LABELS[channel]}
              </option>
            ))}
          </select>
          <Input placeholder="Sujet (optionnel)" {...register("subject")} />

          {formError && <p className="col-span-3 text-sm text-destructive">{formError}</p>}
          <Button type="submit" loading={createMutation.isPending} className="col-span-3">
            {createMutation.isPending ? "Création..." : "Créer la conversation"}
          </Button>
        </form>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium uppercase text-text-muted">
              <tr>
                <th className="px-4 py-2">Contact</th>
                <th className="px-4 py-2">Canal</th>
                <th className="px-4 py-2">Sujet</th>
                <th className="px-4 py-2">Statut</th>
                <th className="px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-text-muted">
                    Chargement...
                  </td>
                </tr>
              )}
              {!isLoading && conversations?.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-text-muted">
                    Aucune conversation.
                  </td>
                </tr>
              )}
              {conversations?.map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  contactName={contactName(conversation.contactId)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Pagination
        page={page}
        totalPages={conversationsPage?.pagination.totalPages ?? 1}
        onPageChange={setPage}
        disabled={isLoading}
      />
    </div>
  );
}

function ConversationRow({
  conversation,
  contactName,
}: {
  conversation: Conversation;
  contactName: string;
}) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [body, setBody] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const authReady = useAuthReady();

  const messagesQuery = useQuery({
    queryKey: ["messages", conversation.id],
    queryFn: () => apiClient.get<Message[]>(`/conversations/${conversation.id}/messages`),
    enabled: authReady && expanded,
  });
  const { data: templates } = useQuery({
    queryKey: ["message-templates"],
    queryFn: () => apiClient.get<MessageTemplate[]>("/message-templates"),
    enabled: authReady && expanded,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["conversations"] });
    void queryClient.invalidateQueries({ queryKey: ["messages", conversation.id] });
  };

  const toggleStatusMutation = useMutation({
    mutationFn: () =>
      apiClient.patch<Conversation>(`/conversations/${conversation.id}`, {
        status: conversation.status === "open" ? "closed" : "open",
      }),
    onSuccess: invalidate,
  });

  const sendMutation = useMutation({
    mutationFn: (input: CreateMessageInput) =>
      apiClient.post<Message>(`/conversations/${conversation.id}/messages`, input),
    onSuccess: () => {
      invalidate();
      setBody("");
      setTemplateId("");
      setSendError(null);
    },
    onError: (error) => setSendError(error instanceof ApiError ? error.message : "Erreur"),
  });

  function send() {
    if (!body.trim() && !templateId) {
      setSendError("Écrivez un message ou choisissez un modèle.");
      return;
    }
    sendMutation.mutate({
      body: body.trim() || "(modèle)",
      templateId: templateId || undefined,
    });
  }

  return (
    <>
      <tr>
        <td className="px-4 py-2 font-medium">{contactName}</td>
        <td className="px-4 py-2 text-text-muted">{CHANNEL_LABELS[conversation.channel]}</td>
        <td className="px-4 py-2 text-text-muted">{conversation.subject ?? "—"}</td>
        <td className="px-4 py-2">
          <Badge variant={conversation.status === "open" ? "success" : "default"}>
            {conversation.status === "open" ? "Ouverte" : "Fermée"}
          </Badge>
        </td>
        <td className="space-x-2 px-4 py-2">
          <button onClick={() => setExpanded((v) => !v)} className="text-xs text-text-muted hover:underline">
            {expanded ? "Fermer" : "Voir le fil"}
          </button>
          <button onClick={() => toggleStatusMutation.mutate()} className="text-xs text-text-muted hover:underline">
            {conversation.status === "open" ? "Clore" : "Rouvrir"}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={5} className="bg-surface-muted px-4 py-3">
            <div className="space-y-3">
              <ul className="space-y-2">
                {messagesQuery.data?.length === 0 && (
                  <li className="text-xs text-text-muted">Aucun message pour l&apos;instant.</li>
                )}
                {messagesQuery.data?.map((message) => (
                  <li key={message.id} className="rounded-md border border-border bg-surface p-2 text-xs">
                    <div className="mb-1 flex justify-between text-text-muted">
                      <span>{message.direction === "outbound" ? "Envoyé" : "Reçu"}</span>
                      <span>{new Date(message.createdAt).toLocaleString("fr-FR")}</span>
                    </div>
                    <p className="text-text">{message.body}</p>
                    <p className="mt-1 text-text-muted">
                      statut: {message.status}
                      {message.to ? ` — à ${message.to}` : ""}
                    </p>
                  </li>
                ))}
              </ul>

              {conversation.status === "open" && (
                <div className="space-y-2 border-t border-border pt-3">
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Écrire un message..."
                    rows={2}
                    className="w-full rounded-md border border-border-input px-2 py-1.5 text-sm focus:border-focus focus:outline-none"
                  />
                  <div className="flex items-center gap-2">
                    <select
                      value={templateId}
                      onChange={(e) => setTemplateId(e.target.value)}
                      className="rounded-md border border-border-input px-2 py-1.5 text-xs focus:border-focus focus:outline-none"
                    >
                      <option value="">Sans modèle</option>
                      {templates
                        ?.filter((t) => t.channel === conversation.channel)
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                    </select>
                    <Button size="sm" onClick={send} loading={sendMutation.isPending}>
                      {sendMutation.isPending ? "Envoi..." : "Envoyer"}
                    </Button>
                    {sendError && <span className="text-xs text-destructive">{sendError}</span>}
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
