"use client";

import { useState } from "react";
import { useFieldArray, useForm, useWatch, type Control } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createWorkflowSchema,
  testWorkflowSchema,
  type TestWorkflowInput,
} from "@korva/validation";
import {
  SYSTEM_EVENTS,
  WORKFLOW_ACTION_TYPES,
  WORKFLOW_CONDITION_OPERATORS,
  type SystemEvent,
  type Workflow,
  type WorkflowActionType,
  type WorkflowConditionOperator,
  type WorkflowExecution,
} from "@korva/types";
import { Badge, Button, Card, Input } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";

const OPERATOR_LABELS: Record<WorkflowConditionOperator, string> = {
  equals: "égal à",
  not_equals: "différent de",
  greater_than: "supérieur à",
  less_than: "inférieur à",
  contains: "contient",
};

const ACTION_TYPE_LABELS: Record<WorkflowActionType, string> = {
  create_task: "Créer une tâche",
  send_email: "Envoyer un e-mail",
  webhook: "Appeler un webhook",
  internal_notification: "Notifier l'équipe",
};

interface ConditionFormValue {
  field: string;
  operator: WorkflowConditionOperator;
  valueType: "string" | "number" | "boolean";
  value: string;
}
interface ActionFormValue {
  type: WorkflowActionType;
  title: string;
  description: string;
  to: string;
  subject: string;
  body: string;
  url: string;
}
interface WorkflowFormValues {
  name: string;
  trigger: SystemEvent;
  conditions: ConditionFormValue[];
  actions: ActionFormValue[];
}

function buildConditionValue(condition: ConditionFormValue): string | number | boolean {
  if (condition.valueType === "number") return Number(condition.value);
  if (condition.valueType === "boolean") return condition.value === "true";
  return condition.value;
}

function buildActionPayload(action: ActionFormValue) {
  switch (action.type) {
    case "create_task":
      return {
        type: "create_task" as const,
        config: { title: action.title, description: action.description || undefined },
      };
    case "send_email":
      return {
        type: "send_email" as const,
        config: { to: action.to, subject: action.subject, body: action.body },
      };
    case "webhook":
      return { type: "webhook" as const, config: { url: action.url } };
    case "internal_notification":
      return {
        type: "internal_notification" as const,
        config: { title: action.title, body: action.body || undefined },
      };
  }
}

export default function WorkflowsPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const authReady = useAuthReady();

  const { data: workflows, isLoading } = useQuery({
    queryKey: ["workflows"],
    queryFn: () => apiClient.get<Workflow[]>("/workflows"),
    enabled: authReady,
  });

  const { register, control, handleSubmit, reset } = useForm<WorkflowFormValues>({
    defaultValues: {
      name: "",
      trigger: SYSTEM_EVENTS[0],
      conditions: [],
      actions: [{ type: "create_task", title: "", description: "", to: "", subject: "", body: "", url: "" }],
    },
  });
  const conditionFields = useFieldArray({ control, name: "conditions" });
  const actionFields = useFieldArray({ control, name: "actions" });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["workflows"] });

  const createMutation = useMutation({
    mutationFn: (input: ReturnType<typeof createWorkflowSchema.parse>) =>
      apiClient.post<Workflow>("/workflows", input),
    onSuccess: () => {
      invalidate();
      reset();
      setShowForm(false);
      setFormError(null);
    },
    onError: (error) => setFormError(error instanceof ApiError ? error.message : "Erreur"),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      apiClient.patch<Workflow>(`/workflows/${id}`, { active }),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/workflows/${id}`),
    onSuccess: invalidate,
  });

  function onSubmit(values: WorkflowFormValues) {
    setFormError(null);
    const result = createWorkflowSchema.safeParse({
      name: values.name,
      trigger: values.trigger,
      active: true,
      conditions: values.conditions.map((condition) => ({
        field: condition.field,
        operator: condition.operator,
        value: buildConditionValue(condition),
      })),
      actions: values.actions.map(buildActionPayload),
    });
    if (!result.success) {
      setFormError(result.error.issues[0]?.message ?? "Formulaire invalide");
      return;
    }
    createMutation.mutate(result.data);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Workflows</h1>
        <p className="mt-1 text-sm text-text-muted">
          Automatisez des actions (créer une tâche, envoyer un e-mail, appeler un webhook) en réaction aux
          événements de KORVA.
        </p>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => setShowForm((v) => !v)}>{showForm ? "Annuler" : "Nouveau workflow"}</Button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit(onSubmit)}
          // Not migrated to <Card>: this wrapper is the <form> element itself (it carries
          // onSubmit), and Card renders a <div> — same exclusion documented on the other
          // migrated create-forms (dashboard/crm, dashboard/bookings).
          className="space-y-4 rounded-lg border border-border bg-surface p-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <Input placeholder="Nom du workflow" {...register("name", { required: true })} />
            <select
              className="rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
              {...register("trigger", { required: true })}
            >
              {SYSTEM_EVENTS.map((event) => (
                <option key={event} value={event}>
                  {event}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-text">Conditions (toutes doivent être vraies)</p>
            {conditionFields.fields.map((field, index) => (
              <div key={field.id} className="grid grid-cols-12 gap-2">
                <Input
                  placeholder="Champ (ex: estimatedValue)"
                  className="col-span-4"
                  {...register(`conditions.${index}.field`, { required: true })}
                />
                <select
                  className="col-span-3 rounded-md border border-border-input px-2 py-1.5 text-sm focus:border-focus focus:outline-none"
                  {...register(`conditions.${index}.operator`)}
                >
                  {WORKFLOW_CONDITION_OPERATORS.map((operator) => (
                    <option key={operator} value={operator}>
                      {OPERATOR_LABELS[operator]}
                    </option>
                  ))}
                </select>
                <select
                  className="col-span-2 rounded-md border border-border-input px-2 py-1.5 text-sm focus:border-focus focus:outline-none"
                  {...register(`conditions.${index}.valueType`)}
                >
                  <option value="string">Texte</option>
                  <option value="number">Nombre</option>
                  <option value="boolean">Booléen</option>
                </select>
                <Input
                  placeholder="Valeur"
                  className="col-span-2"
                  {...register(`conditions.${index}.value`, { required: true })}
                />
                <button
                  type="button"
                  onClick={() => conditionFields.remove(index)}
                  className="col-span-1 text-sm text-destructive hover:underline"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                conditionFields.append({ field: "", operator: "equals", valueType: "string", value: "" })
              }
              className="text-sm text-text-muted hover:underline"
            >
              + Ajouter une condition
            </button>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-text">Actions (au moins une)</p>
            {actionFields.fields.map((field, index) => (
              <ActionRow
                key={field.id}
                index={index}
                control={control}
                register={register}
                onRemove={actionFields.fields.length > 1 ? () => actionFields.remove(index) : undefined}
              />
            ))}
            <button
              type="button"
              onClick={() =>
                actionFields.append({
                  type: "create_task",
                  title: "",
                  description: "",
                  to: "",
                  subject: "",
                  body: "",
                  url: "",
                })
              }
              className="text-sm text-text-muted hover:underline"
            >
              + Ajouter une action
            </button>
          </div>

          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <Button type="submit" loading={createMutation.isPending}>
            {createMutation.isPending ? "Création..." : "Créer le workflow"}
          </Button>
        </form>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium uppercase text-text-muted">
              <tr>
                <th className="px-4 py-2">Nom</th>
                <th className="px-4 py-2">Déclencheur</th>
                <th className="px-4 py-2">Statut</th>
                <th className="px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-text-muted">
                    Chargement...
                  </td>
                </tr>
              )}
              {!isLoading && workflows?.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-text-muted">
                    Aucun workflow.
                  </td>
                </tr>
              )}
              {workflows?.map((workflow) => (
                <WorkflowRow
                  key={workflow.id}
                  workflow={workflow}
                  onToggleActive={(active) => toggleActiveMutation.mutate({ id: workflow.id, active })}
                  onDelete={() => deleteMutation.mutate(workflow.id)}
                  isDeleting={deleteMutation.isPending && deleteMutation.variables === workflow.id}
                  deleteError={
                    deleteMutation.isError && deleteMutation.variables === workflow.id
                      ? deleteMutation.error
                      : null
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function ActionRow({
  index,
  control,
  register,
  onRemove,
}: {
  index: number;
  control: Control<WorkflowFormValues>;
  register: ReturnType<typeof useForm<WorkflowFormValues>>["register"];
  onRemove?: () => void;
}) {
  const type = useWatch({ control, name: `actions.${index}.type` });

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center gap-2">
        <select
          className="rounded-md border border-border-input px-2 py-1.5 text-sm focus:border-focus focus:outline-none"
          {...register(`actions.${index}.type`)}
        >
          {WORKFLOW_ACTION_TYPES.map((actionType) => (
            <option key={actionType} value={actionType}>
              {ACTION_TYPE_LABELS[actionType]}
            </option>
          ))}
        </select>
        {onRemove && (
          <button type="button" onClick={onRemove} className="text-sm text-destructive hover:underline">
            Retirer cette action
          </button>
        )}
      </div>

      {type === "create_task" && (
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="Titre (ex: Suivre {{leadId}})" {...register(`actions.${index}.title`, { required: true })} />
          <Input placeholder="Description (optionnel)" {...register(`actions.${index}.description`)} />
        </div>
      )}
      {type === "send_email" && (
        <div className="grid grid-cols-3 gap-2">
          <Input
            placeholder="Destinataire ({{contact.email}})"
            {...register(`actions.${index}.to`, { required: true })}
          />
          <Input placeholder="Sujet" {...register(`actions.${index}.subject`, { required: true })} />
          <Input placeholder="Corps du message" {...register(`actions.${index}.body`, { required: true })} />
        </div>
      )}
      {type === "webhook" && (
        <Input placeholder="URL du webhook" className="w-full" {...register(`actions.${index}.url`, { required: true })} />
      )}
      {type === "internal_notification" && (
        <div className="grid grid-cols-2 gap-2">
          <Input
            placeholder="Titre (ex: Nouveau lead {{leadId}})"
            {...register(`actions.${index}.title`, { required: true })}
          />
          <Input placeholder="Message (optionnel)" {...register(`actions.${index}.body`)} />
        </div>
      )}
    </div>
  );
}

function WorkflowRow({
  workflow,
  onToggleActive,
  onDelete,
  isDeleting,
  deleteError,
}: {
  workflow: Workflow;
  onToggleActive: (active: boolean) => void;
  onDelete: () => void;
  isDeleting: boolean;
  deleteError: unknown;
}) {
  const [showTest, setShowTest] = useState(false);
  const [showExecutions, setShowExecutions] = useState(false);
  const [payload, setPayload] = useState("{}");
  const [testResult, setTestResult] = useState<{ matched: boolean } | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const authReady = useAuthReady();
  const executionsQuery = useQuery({
    queryKey: ["workflow-executions", workflow.id],
    queryFn: () => apiClient.get<WorkflowExecution[]>(`/workflows/${workflow.id}/executions`),
    enabled: authReady && showExecutions,
  });

  const testMutation = useMutation({
    mutationFn: (input: TestWorkflowInput) =>
      apiClient.post<{ matched: boolean }>(`/workflows/${workflow.id}/test`, input),
    onSuccess: (data) => {
      setTestResult(data);
      setTestError(null);
    },
    onError: (error) => {
      setTestError(error instanceof ApiError ? error.message : "Erreur");
      setTestResult(null);
    },
  });

  function runTest() {
    let parsedPayload: Record<string, unknown>;
    try {
      parsedPayload = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      setTestError("JSON invalide");
      return;
    }
    const result = testWorkflowSchema.safeParse({ payload: parsedPayload });
    if (!result.success) {
      setTestError(result.error.issues[0]?.message ?? "Payload invalide");
      return;
    }
    testMutation.mutate(result.data);
  }

  return (
    <>
      <tr>
        <td className="px-4 py-2 font-medium">{workflow.name}</td>
        <td className="px-4 py-2 text-text-muted">{workflow.trigger}</td>
        <td className="px-4 py-2">
          <button type="button" onClick={() => onToggleActive(!workflow.active)} className="border-0 bg-transparent p-0">
            <Badge variant={workflow.active ? "success" : "default"}>
              {workflow.active ? "Actif" : "Inactif"}
            </Badge>
          </button>
        </td>
        <td className="space-x-2 px-4 py-2">
          <button onClick={() => setShowTest((v) => !v)} className="text-xs text-text-muted hover:underline">
            Tester
          </button>
          <button onClick={() => setShowExecutions((v) => !v)} className="text-xs text-text-muted hover:underline">
            Exécutions
          </button>
          {isConfirmingDelete ? (
            <>
              <button
                onClick={onDelete}
                disabled={isDeleting}
                className="text-xs text-destructive hover:underline disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isDeleting ? "Suppression..." : "Confirmer ?"}
              </button>
              <button
                onClick={() => setIsConfirmingDelete(false)}
                disabled={isDeleting}
                className="text-xs text-text-muted hover:underline disabled:cursor-not-allowed disabled:opacity-60"
              >
                Annuler
              </button>
            </>
          ) : (
            <button
              onClick={() => setIsConfirmingDelete(true)}
              className="text-xs text-destructive hover:underline"
            >
              Supprimer
            </button>
          )}
        </td>
      </tr>
      {deleteError != null && (
        <tr>
          <td colSpan={4} className="px-4 pb-2 text-xs text-destructive">
            {deleteError instanceof ApiError
              ? deleteError.message
              : "Impossible de supprimer le workflow."}
          </td>
        </tr>
      )}
      {showTest && (
        <tr>
          <td colSpan={4} className="bg-surface-muted px-4 py-3">
            <div className="space-y-2">
              <p className="text-xs text-text-muted">
                Test à blanc : évalue les conditions sur ce payload JSON sans exécuter les actions.
              </p>
              <textarea
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-border-input px-2 py-1.5 font-mono text-xs focus:border-focus focus:outline-none"
              />
              <div className="flex items-center gap-3">
                <Button size="sm" onClick={runTest} loading={testMutation.isPending}>
                  {testMutation.isPending ? "Test..." : "Lancer le test"}
                </Button>
                {testResult && (
                  <span className={testResult.matched ? "text-xs text-success" : "text-xs text-text-muted"}>
                    {testResult.matched ? "✓ Conditions satisfaites" : "✕ Conditions non satisfaites"}
                  </span>
                )}
                {testError && <span className="text-xs text-destructive">{testError}</span>}
              </div>
            </div>
          </td>
        </tr>
      )}
      {showExecutions && (
        <tr>
          <td colSpan={4} className="bg-surface-muted px-4 py-3">
            {executionsQuery.isLoading && (
              <p className="text-xs text-text-muted">Chargement...</p>
            )}
            {executionsQuery.data?.length === 0 && (
              <p className="text-xs text-text-muted">Aucune exécution pour l&apos;instant.</p>
            )}
            <ul className="space-y-1">
              {executionsQuery.data?.map((execution) => (
                <li key={execution.id} className="text-xs text-text-muted">
                  <span className={execution.status === "success" ? "text-success" : "text-destructive"}>
                    {execution.status}
                  </span>{" "}
                  — {execution.eventName} — {new Date(execution.createdAt).toLocaleString("fr-FR")}
                  {execution.error && <span className="text-destructive"> ({execution.error})</span>}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}
