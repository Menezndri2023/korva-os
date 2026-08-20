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
import { apiClient, ApiError } from "@/lib/api-client";

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

  const { data: conversations, isLoading } = useQuery({
    queryKey: ["conversations"],
    queryFn: () => apiClient.get<Conversation[]>("/conversations"),
  });
  const { data: contacts } = useQuery({
    queryKey: ["contacts", ""],
    queryFn: () => apiClient.get<Contact[]>("/contacts"),
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
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          {showForm ? "Annuler" : "Nouvelle conversation"}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="grid grid-cols-3 gap-3 rounded-lg border border-zinc-200 bg-white p-4"
        >
          <select
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
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
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
            {...register("channel", { required: true })}
          >
            {COMMUNICATION_CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {CHANNEL_LABELS[channel]}
              </option>
            ))}
          </select>
          <input
            placeholder="Sujet (optionnel)"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
            {...register("subject")}
          />

          {formError && <p className="col-span-3 text-sm text-red-600">{formError}</p>}
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="col-span-3 rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
          >
            {createMutation.isPending ? "Création..." : "Créer la conversation"}
          </button>
        </form>
      )}

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-2">Contact</th>
              <th className="px-4 py-2">Canal</th>
              <th className="px-4 py-2">Sujet</th>
              <th className="px-4 py-2">Statut</th>
              <th className="px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-zinc-500">
                  Chargement...
                </td>
              </tr>
            )}
            {!isLoading && conversations?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-zinc-500">
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

  const messagesQuery = useQuery({
    queryKey: ["messages", conversation.id],
    queryFn: () => apiClient.get<Message[]>(`/conversations/${conversation.id}/messages`),
    enabled: expanded,
  });
  const { data: templates } = useQuery({
    queryKey: ["message-templates"],
    queryFn: () => apiClient.get<MessageTemplate[]>("/message-templates"),
    enabled: expanded,
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
        <td className="px-4 py-2 text-zinc-600">{CHANNEL_LABELS[conversation.channel]}</td>
        <td className="px-4 py-2 text-zinc-600">{conversation.subject ?? "—"}</td>
        <td className="px-4 py-2">
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${
              conversation.status === "open" ? "bg-green-100 text-green-700" : "bg-zinc-100 text-zinc-600"
            }`}
          >
            {conversation.status === "open" ? "Ouverte" : "Fermée"}
          </span>
        </td>
        <td className="space-x-2 px-4 py-2">
          <button onClick={() => setExpanded((v) => !v)} className="text-xs text-zinc-600 hover:underline">
            {expanded ? "Fermer" : "Voir le fil"}
          </button>
          <button onClick={() => toggleStatusMutation.mutate()} className="text-xs text-zinc-600 hover:underline">
            {conversation.status === "open" ? "Clore" : "Rouvrir"}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={5} className="bg-zinc-50 px-4 py-3">
            <div className="space-y-3">
              <ul className="space-y-2">
                {messagesQuery.data?.length === 0 && (
                  <li className="text-xs text-zinc-500">Aucun message pour l&apos;instant.</li>
                )}
                {messagesQuery.data?.map((message) => (
                  <li key={message.id} className="rounded-md border border-zinc-200 bg-white p-2 text-xs">
                    <div className="mb-1 flex justify-between text-zinc-400">
                      <span>{message.direction === "outbound" ? "Envoyé" : "Reçu"}</span>
                      <span>{new Date(message.createdAt).toLocaleString("fr-FR")}</span>
                    </div>
                    <p className="text-zinc-700">{message.body}</p>
                    <p className="mt-1 text-zinc-400">
                      statut: {message.status}
                      {message.to ? ` — à ${message.to}` : ""}
                    </p>
                  </li>
                ))}
              </ul>

              {conversation.status === "open" && (
                <div className="space-y-2 border-t border-zinc-200 pt-3">
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Écrire un message..."
                    rows={2}
                    className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
                  />
                  <div className="flex items-center gap-2">
                    <select
                      value={templateId}
                      onChange={(e) => setTemplateId(e.target.value)}
                      className="rounded-md border border-zinc-300 px-2 py-1.5 text-xs"
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
                    <button
                      onClick={send}
                      disabled={sendMutation.isPending}
                      className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
                    >
                      {sendMutation.isPending ? "Envoi..." : "Envoyer"}
                    </button>
                    {sendError && <span className="text-xs text-red-600">{sendError}</span>}
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
