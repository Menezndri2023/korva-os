"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createMessageTemplateSchema,
  type CreateMessageTemplateInput,
} from "@korva/validation";
import {
  COMMUNICATION_CHANNELS,
  type CommunicationChannel,
  type MessageTemplate,
} from "@korva/types";
import { apiClient, ApiError } from "@/lib/api-client";

const CHANNEL_LABELS: Record<CommunicationChannel, string> = {
  email: "E-mail",
  whatsapp: "WhatsApp",
  sms: "SMS",
  internal: "Note interne",
};

export default function MessageTemplatesPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const { data: templates, isLoading } = useQuery({
    queryKey: ["message-templates"],
    queryFn: () => apiClient.get<MessageTemplate[]>("/message-templates"),
  });

  const { register, control, handleSubmit, reset } = useForm<CreateMessageTemplateInput>({
    defaultValues: { name: "", channel: "email", subject: "", body: "" },
  });
  const channel = useWatch({ control, name: "channel" });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["message-templates"] });

  const createMutation = useMutation({
    mutationFn: (input: CreateMessageTemplateInput) =>
      apiClient.post<MessageTemplate>("/message-templates", input),
    onSuccess: () => {
      invalidate();
      reset();
      setShowForm(false);
      setFormError(null);
    },
    onError: (error) => setFormError(error instanceof ApiError ? error.message : "Erreur"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/message-templates/${id}`),
    onSuccess: invalidate,
  });

  function onSubmit(values: CreateMessageTemplateInput) {
    setFormError(null);
    const result = createMessageTemplateSchema.safeParse(values);
    if (!result.success) {
      setFormError(result.error.issues[0]?.message ?? "Formulaire invalide");
      return;
    }
    createMutation.mutate(result.data);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          {showForm ? "Annuler" : "Nouveau modèle"}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <input
              placeholder="Nom du modèle"
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
              {...register("name", { required: true })}
            />
            <select
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
              {...register("channel", { required: true })}
            >
              {COMMUNICATION_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          {channel !== "internal" && (
            <input
              placeholder="Objet (ex: Bienvenue {{contact.firstName}})"
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
              {...register("subject")}
            />
          )}
          <textarea
            placeholder="Corps du message — variables: {{contact.firstName}}, {{contact.lastName}}, {{contact.email}}, {{contact.phone}}"
            rows={4}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            {...register("body", { required: true })}
          />

          {formError && <p className="text-sm text-red-600">{formError}</p>}
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
          >
            {createMutation.isPending ? "Création..." : "Créer le modèle"}
          </button>
        </form>
      )}

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-2">Nom</th>
              <th className="px-4 py-2">Canal</th>
              <th className="px-4 py-2">Corps</th>
              <th className="px-4 py-2">Actions</th>
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
            {!isLoading && templates?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-zinc-500">
                  Aucun modèle.
                </td>
              </tr>
            )}
            {templates?.map((template) => (
              <tr key={template.id}>
                <td className="px-4 py-2 font-medium">{template.name}</td>
                <td className="px-4 py-2 text-zinc-600">{CHANNEL_LABELS[template.channel]}</td>
                <td className="max-w-xs truncate px-4 py-2 text-zinc-600">{template.body}</td>
                <td className="px-4 py-2">
                  <button
                    onClick={() => deleteMutation.mutate(template.id)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Supprimer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
