"use client";

import { Fragment, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createMessageTemplateSchema,
  type CreateMessageTemplateInput,
  type UpdateMessageTemplateInput,
} from "@korva/validation";
import {
  COMMUNICATION_CHANNELS,
  type CommunicationChannel,
  type MessageTemplate,
} from "@korva/types";
import { Button, Card, Input } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { useT } from "@/lib/dashboard-locale";

const CHANNEL_LABELS: Record<CommunicationChannel, [string, string]> = {
  email: ["E-mail", "E-mail"],
  whatsapp: ["WhatsApp", "WhatsApp"],
  sms: ["SMS", "SMS"],
  internal: ["Note interne", "Internal note"],
};

export default function MessageTemplatesPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const authReady = useAuthReady();

  const { data: templates, isLoading } = useQuery({
    queryKey: ["message-templates"],
    queryFn: () => apiClient.get<MessageTemplate[]>("/message-templates"),
    enabled: authReady,
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
    onError: (error) => setFormError(error instanceof ApiError ? error.message : t("Erreur", "Error")),
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const {
    register: registerEdit,
    control: editControl,
    handleSubmit: handleEditSubmit,
    reset: resetEditForm,
  } = useForm<UpdateMessageTemplateInput>();
  const editChannel = useWatch({ control: editControl, name: "channel" });

  function startEdit(template: MessageTemplate) {
    setEditingId(template.id);
    resetEditForm({
      name: template.name,
      channel: template.channel,
      subject: template.subject,
      body: template.body,
    });
  }
  function cancelEdit() {
    setEditingId(null);
    resetEditForm();
  }

  const updateMutation = useMutation({
    mutationFn: ({ id, ...input }: { id: string } & UpdateMessageTemplateInput) =>
      apiClient.patch<MessageTemplate>(`/message-templates/${id}`, input),
    onSuccess: () => {
      invalidate();
      setEditingId(null);
      resetEditForm();
    },
  });

  const [deletingConfirmId, setDeletingConfirmId] = useState<string | null>(null);
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/message-templates/${id}`),
    onSuccess: () => {
      setDeletingConfirmId(null);
      invalidate();
    },
    onError: () => setDeletingConfirmId(null),
  });

  function onSubmit(values: CreateMessageTemplateInput) {
    setFormError(null);
    const result = createMessageTemplateSchema.safeParse(values);
    if (!result.success) {
      setFormError(result.error.issues[0]?.message ?? t("Formulaire invalide", "The form is not valid"));
      return;
    }
    createMutation.mutate(result.data);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setShowForm((v) => !v)}>{showForm ? t("Annuler", "Cancel") : t("Nouveau modèle", "New template")}</Button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit(onSubmit)}
          // Not migrated to <Card>: this wrapper is the <form> element itself (it carries
          // onSubmit), and Card renders a <div> — same exclusion documented on the other
          // migrated create-forms (dashboard/crm, dashboard/bookings).
          className="space-y-3 rounded-lg border border-border bg-surface p-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <Input placeholder={t("Nom du modèle", "Template name")} {...register("name", { required: true })} />
            <select
              className="rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
              {...register("channel", { required: true })}
            >
              {COMMUNICATION_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {t(...CHANNEL_LABELS[c])}
                </option>
              ))}
            </select>
          </div>
          {channel !== "internal" && (
            <Input placeholder={t(
              "Objet (ex: Bienvenue {{contact.firstName}})",
              "Subject (e.g. Welcome {{contact.firstName}})",
            )} className="w-full" {...register("subject")} />
          )}
          <textarea
            placeholder={t(
              "Corps du message — variables: {{contact.firstName}}, {{contact.lastName}}, {{contact.email}}, {{contact.phone}}",
              "Message body — variables: {{contact.firstName}}, {{contact.lastName}}, {{contact.email}}, {{contact.phone}}",
            )}
            rows={4}
            className="w-full rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            {...register("body", { required: true })}
          />

          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <Button type="submit" loading={createMutation.isPending}>
            {createMutation.isPending ? t("Création...", "Creating...") : t("Créer le modèle", "Create the template")}
          </Button>
        </form>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium text-text-muted">
              <tr>
                <th className="px-4 py-2">{t("Nom", "Name")}</th>
                <th className="px-4 py-2">{t("Canal", "Channel")}</th>
                <th className="px-4 py-2">{t("Corps", "Body")}</th>
                <th className="px-4 py-2">{t("Actions", "Actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-text-muted">
                    {t("Chargement...", "Loading...")}
                  </td>
                </tr>
              )}
              {!isLoading && templates?.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-text-muted">
                    {t("Aucun modèle.", "No templates.")}
                  </td>
                </tr>
              )}
              {templates?.map((template) => {
                const isEditing = editingId === template.id;
                const isDeleteConfirming = deletingConfirmId === template.id;
                const isDeletePending =
                  deleteMutation.isPending && deleteMutation.variables === template.id;
                const deleteError =
                  deleteMutation.isError && deleteMutation.variables === template.id
                    ? deleteMutation.error
                    : null;
                return (
                  <Fragment key={template.id}>
                    <tr>
                      <td className="px-4 py-2 font-medium">{template.name}</td>
                      <td className="px-4 py-2 text-text-muted">
                        {t(...CHANNEL_LABELS[template.channel])}
                      </td>
                      <td className="max-w-xs truncate px-4 py-2 text-text-muted">
                        {template.body}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={isDeleteConfirming}
                            onClick={() => (isEditing ? cancelEdit() : startEdit(template))}
                          >
                            {isEditing ? t("Annuler", "Cancel") : t("Modifier", "Edit")}
                          </Button>
                          {isDeleteConfirming ? (
                            <>
                              <Button
                                variant="secondary"
                                size="sm"
                                loading={isDeletePending}
                                onClick={() => deleteMutation.mutate(template.id)}
                              >
                                {isDeletePending ? t("Suppression...", "Deleting...") : t("Confirmer ?", "Confirm?")}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={isDeletePending}
                                onClick={() => setDeletingConfirmId(null)}
                              >
                                {t("Annuler", "Cancel")}
                              </Button>
                            </>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={isEditing}
                              onClick={() => setDeletingConfirmId(template.id)}
                            >
                              {t("Supprimer", "Delete")}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {deleteError && (
                      <tr>
                        <td colSpan={4} className="px-4 pb-2 text-xs text-destructive">
                          {deleteError instanceof ApiError
                            ? deleteError.message
                            : t("Impossible de supprimer le modèle.", "The template could not be deleted.")}
                        </td>
                      </tr>
                    )}
                    {isEditing && (
                      <tr>
                        <td colSpan={4} className="px-4 pb-4">
                          <form
                            onSubmit={handleEditSubmit((values) =>
                              updateMutation.mutate({ id: template.id, ...values }),
                            )}
                            className="space-y-3 rounded-lg border border-border bg-surface p-4"
                          >
                            <div className="grid grid-cols-2 gap-3">
                              <Input
                                placeholder={t("Nom du modèle", "Template name")}
                                {...registerEdit("name", { required: true })}
                              />
                              <select
                                className="rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
                                {...registerEdit("channel", { required: true })}
                              >
                                {COMMUNICATION_CHANNELS.map((c) => (
                                  <option key={c} value={c}>
                                    {t(...CHANNEL_LABELS[c])}
                                  </option>
                                ))}
                              </select>
                            </div>
                            {editChannel !== "internal" && (
                              <Input
                                placeholder={t(
                                  "Objet (ex: Bienvenue {{contact.firstName}})",
                                  "Subject (e.g. Welcome {{contact.firstName}})",
                                )}
                                className="w-full"
                                {...registerEdit("subject")}
                              />
                            )}
                            <textarea
                              placeholder={t("Corps du message", "Message body")}
                              rows={4}
                              className="w-full rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
                              {...registerEdit("body", { required: true })}
                            />

                            {updateMutation.isError && (
                              <p className="text-sm text-destructive">
                                {updateMutation.error instanceof ApiError
                                  ? updateMutation.error.message
                                  : t(
                                    "Impossible d'enregistrer le modèle.",
                                    "The template could not be saved.",
                                  )}
                              </p>
                            )}
                            <div className="flex gap-2">
                              <Button type="submit" loading={updateMutation.isPending}>
                                {updateMutation.isPending ? t("Enregistrement...", "Saving...") : t("Enregistrer", "Save")}
                              </Button>
                              <Button type="button" variant="ghost" onClick={cancelEdit}>
                                {t("Annuler", "Cancel")}
                              </Button>
                            </div>
                          </form>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
