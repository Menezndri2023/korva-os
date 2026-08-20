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
import { apiClient, ApiError } from "@/lib/api-client";

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

  const { data: workflows, isLoading } = useQuery({
    queryKey: ["workflows"],
    queryFn: () => apiClient.get<Workflow[]>("/workflows"),
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
        <p className="mt-1 text-sm text-zinc-500">
          Automatisez des actions (créer une tâche, envoyer un e-mail, appeler un webhook) en réaction aux
          événements de KORVA.
        </p>
      </div>

      <div className="flex justify-end">
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          {showForm ? "Annuler" : "Nouveau workflow"}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <input
              placeholder="Nom du workflow"
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
              {...register("name", { required: true })}
            />
            <select
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
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
            <p className="text-sm font-medium text-zinc-700">Conditions (toutes doivent être vraies)</p>
            {conditionFields.fields.map((field, index) => (
              <div key={field.id} className="grid grid-cols-12 gap-2">
                <input
                  placeholder="Champ (ex: estimatedValue)"
                  className="col-span-4 rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
                  {...register(`conditions.${index}.field`, { required: true })}
                />
                <select
                  className="col-span-3 rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
                  {...register(`conditions.${index}.operator`)}
                >
                  {WORKFLOW_CONDITION_OPERATORS.map((operator) => (
                    <option key={operator} value={operator}>
                      {OPERATOR_LABELS[operator]}
                    </option>
                  ))}
                </select>
                <select
                  className="col-span-2 rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
                  {...register(`conditions.${index}.valueType`)}
                >
                  <option value="string">Texte</option>
                  <option value="number">Nombre</option>
                  <option value="boolean">Booléen</option>
                </select>
                <input
                  placeholder="Valeur"
                  className="col-span-2 rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
                  {...register(`conditions.${index}.value`, { required: true })}
                />
                <button
                  type="button"
                  onClick={() => conditionFields.remove(index)}
                  className="col-span-1 text-sm text-red-600 hover:underline"
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
              className="text-sm text-zinc-600 hover:underline"
            >
              + Ajouter une condition
            </button>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-zinc-700">Actions (au moins une)</p>
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
              className="text-sm text-zinc-600 hover:underline"
            >
              + Ajouter une action
            </button>
          </div>

          {formError && <p className="text-sm text-red-600">{formError}</p>}
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
          >
            {createMutation.isPending ? "Création..." : "Créer le workflow"}
          </button>
        </form>
      )}

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-2">Nom</th>
              <th className="px-4 py-2">Déclencheur</th>
              <th className="px-4 py-2">Statut</th>
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
            {!isLoading && workflows?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-zinc-500">
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
              />
            ))}
          </tbody>
        </table>
      </div>
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
    <div className="space-y-2 rounded-md border border-zinc-200 p-3">
      <div className="flex items-center gap-2">
        <select
          className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
          {...register(`actions.${index}.type`)}
        >
          {WORKFLOW_ACTION_TYPES.map((actionType) => (
            <option key={actionType} value={actionType}>
              {ACTION_TYPE_LABELS[actionType]}
            </option>
          ))}
        </select>
        {onRemove && (
          <button type="button" onClick={onRemove} className="text-sm text-red-600 hover:underline">
            Retirer cette action
          </button>
        )}
      </div>

      {type === "create_task" && (
        <div className="grid grid-cols-2 gap-2">
          <input
            placeholder="Titre (ex: Suivre {{leadId}})"
            className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
            {...register(`actions.${index}.title`, { required: true })}
          />
          <input
            placeholder="Description (optionnel)"
            className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
            {...register(`actions.${index}.description`)}
          />
        </div>
      )}
      {type === "send_email" && (
        <div className="grid grid-cols-3 gap-2">
          <input
            placeholder="Destinataire ({{contact.email}})"
            className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
            {...register(`actions.${index}.to`, { required: true })}
          />
          <input
            placeholder="Sujet"
            className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
            {...register(`actions.${index}.subject`, { required: true })}
          />
          <input
            placeholder="Corps du message"
            className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
            {...register(`actions.${index}.body`, { required: true })}
          />
        </div>
      )}
      {type === "webhook" && (
        <input
          placeholder="URL du webhook"
          className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
          {...register(`actions.${index}.url`, { required: true })}
        />
      )}
      {type === "internal_notification" && (
        <div className="grid grid-cols-2 gap-2">
          <input
            placeholder="Titre (ex: Nouveau lead {{leadId}})"
            className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
            {...register(`actions.${index}.title`, { required: true })}
          />
          <input
            placeholder="Message (optionnel)"
            className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
            {...register(`actions.${index}.body`)}
          />
        </div>
      )}
    </div>
  );
}

function WorkflowRow({
  workflow,
  onToggleActive,
  onDelete,
}: {
  workflow: Workflow;
  onToggleActive: (active: boolean) => void;
  onDelete: () => void;
}) {
  const [showTest, setShowTest] = useState(false);
  const [showExecutions, setShowExecutions] = useState(false);
  const [payload, setPayload] = useState("{}");
  const [testResult, setTestResult] = useState<{ matched: boolean } | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const executionsQuery = useQuery({
    queryKey: ["workflow-executions", workflow.id],
    queryFn: () => apiClient.get<WorkflowExecution[]>(`/workflows/${workflow.id}/executions`),
    enabled: showExecutions,
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
        <td className="px-4 py-2 text-zinc-600">{workflow.trigger}</td>
        <td className="px-4 py-2">
          <button
            onClick={() => onToggleActive(!workflow.active)}
            className={`rounded-full px-2 py-0.5 text-xs ${
              workflow.active ? "bg-green-100 text-green-700" : "bg-zinc-100 text-zinc-600"
            }`}
          >
            {workflow.active ? "Actif" : "Inactif"}
          </button>
        </td>
        <td className="space-x-2 px-4 py-2">
          <button
            onClick={() => setShowTest((v) => !v)}
            className="text-xs text-zinc-600 hover:underline"
          >
            Tester
          </button>
          <button
            onClick={() => setShowExecutions((v) => !v)}
            className="text-xs text-zinc-600 hover:underline"
          >
            Exécutions
          </button>
          <button onClick={onDelete} className="text-xs text-red-600 hover:underline">
            Supprimer
          </button>
        </td>
      </tr>
      {showTest && (
        <tr>
          <td colSpan={4} className="bg-zinc-50 px-4 py-3">
            <div className="space-y-2">
              <p className="text-xs text-zinc-500">
                Test à blanc : évalue les conditions sur ce payload JSON sans exécuter les actions.
              </p>
              <textarea
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-zinc-300 px-2 py-1.5 font-mono text-xs"
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={runTest}
                  disabled={testMutation.isPending}
                  className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
                >
                  {testMutation.isPending ? "Test..." : "Lancer le test"}
                </button>
                {testResult && (
                  <span className={testResult.matched ? "text-xs text-green-700" : "text-xs text-zinc-500"}>
                    {testResult.matched ? "✓ Conditions satisfaites" : "✕ Conditions non satisfaites"}
                  </span>
                )}
                {testError && <span className="text-xs text-red-600">{testError}</span>}
              </div>
            </div>
          </td>
        </tr>
      )}
      {showExecutions && (
        <tr>
          <td colSpan={4} className="bg-zinc-50 px-4 py-3">
            {executionsQuery.isLoading && (
              <p className="text-xs text-zinc-500">Chargement...</p>
            )}
            {executionsQuery.data?.length === 0 && (
              <p className="text-xs text-zinc-500">Aucune exécution pour l&apos;instant.</p>
            )}
            <ul className="space-y-1">
              {executionsQuery.data?.map((execution) => (
                <li key={execution.id} className="text-xs text-zinc-600">
                  <span
                    className={execution.status === "success" ? "text-green-700" : "text-red-600"}
                  >
                    {execution.status}
                  </span>{" "}
                  — {execution.eventName} — {new Date(execution.createdAt).toLocaleString("fr-FR")}
                  {execution.error && <span className="text-red-600"> ({execution.error})</span>}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}
