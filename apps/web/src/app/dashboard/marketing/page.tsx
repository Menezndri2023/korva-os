"use client";

import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createSegmentSchema, type CreateSegmentInput } from "@korva/validation";
import {
  SEGMENT_MATCH_MODES,
  SEGMENT_RULE_OPERATORS,
  type CustomField,
  type Segment,
  type SegmentRuleOperator,
} from "@korva/types";
import { Badge, Button, Card, Input, Select } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";

const OPERATOR_LABELS: Record<SegmentRuleOperator, string> = {
  has_tag: "a le tag",
  not_has_tag: "n'a pas le tag",
  equals: "est égal à",
  not_equals: "est différent de",
  contains: "contient",
  is_set: "est renseigné",
  is_not_set: "n'est pas renseigné",
};

const OPERATORS_NEEDING_VALUE = new Set<SegmentRuleOperator>([
  "has_tag",
  "not_has_tag",
  "equals",
  "not_equals",
  "contains",
]);

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export default function MarketingSegmentsPage() {
  const [showForm, setShowForm] = useState(false);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const authReady = useAuthReady();

  const { data: segments, isLoading, isError, refetch } = useQuery({
    queryKey: ["segments"],
    queryFn: () => apiClient.get<Segment[]>("/segments"),
    enabled: authReady,
  });

  const { data: customFields } = useQuery({
    queryKey: ["custom-fields", "contacts"],
    queryFn: () => apiClient.get<CustomField[]>("/custom-fields?entity=contacts"),
    enabled: authReady,
  });

  const {
    register,
    control,
    handleSubmit,
    reset,
    getValues,
    formState: { errors },
  } = useForm<CreateSegmentInput>({
    resolver: zodResolver(createSegmentSchema),
    defaultValues: {
      name: "",
      criteria: { version: 1, match: "all", rules: [] },
    },
  });
  const ruleFields = useFieldArray({ control, name: "criteria.rules" });

  const createMutation = useMutation({
    mutationFn: (input: CreateSegmentInput) => apiClient.post<Segment>("/segments", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["segments"] });
      reset({ name: "", criteria: { version: 1, match: "all", rules: [] } });
      setPreviewCount(null);
      setShowForm(false);
    },
  });

  const previewMutation = useMutation({
    mutationFn: (criteria: CreateSegmentInput["criteria"]) =>
      apiClient.post<{ count: number }>("/segments/preview", { criteria }),
    onSuccess: (result) => setPreviewCount(result.count),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/segments/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["segments"] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-text-muted">
          Segments de contacts réutilisables pour vos campagnes marketing.
        </p>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Annuler" : "Nouveau segment"}
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit((values) => createMutation.mutate(values))}
          className="space-y-3 rounded-lg border border-border bg-surface p-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <Input placeholder="Nom du segment" {...register("name")} />
            <Select {...register("criteria.match")}>
              {SEGMENT_MATCH_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode === "all" ? "Toutes les règles" : "Au moins une règle"}
                </option>
              ))}
            </Select>
          </div>
          {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          <Input placeholder="Description (optionnel)" {...register("description")} />

          <div className="space-y-2">
            <p className="text-sm font-medium text-text">Règles</p>
            {ruleFields.fields.map((field, index) => (
              <div key={field.id} className="grid grid-cols-12 gap-2">
                <Select
                  className="col-span-4"
                  {...register(`criteria.rules.${index}.field`)}
                >
                  <option value="tag">Tag</option>
                  {customFields?.map((cf) => (
                    <option key={cf.id} value={`customField:${cf.key}`}>
                      {cf.label}
                    </option>
                  ))}
                </Select>
                <Select
                  className="col-span-4"
                  {...register(`criteria.rules.${index}.operator`)}
                >
                  {SEGMENT_RULE_OPERATORS.map((operator) => (
                    <option key={operator} value={operator}>
                      {OPERATOR_LABELS[operator]}
                    </option>
                  ))}
                </Select>
                <Input
                  className="col-span-3"
                  placeholder="Valeur"
                  disabled={
                    !OPERATORS_NEEDING_VALUE.has(
                      getValues(`criteria.rules.${index}.operator`),
                    )
                  }
                  {...register(`criteria.rules.${index}.value`)}
                />
                <button
                  type="button"
                  onClick={() => ruleFields.remove(index)}
                  className="col-span-1 text-sm text-destructive hover:underline"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                ruleFields.append({ field: "tag", operator: "has_tag", value: "" })
              }
              className="text-sm text-text-muted hover:underline"
            >
              + Ajouter une règle
            </button>
          </div>

          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              loading={previewMutation.isPending}
              onClick={() => previewMutation.mutate(getValues("criteria"))}
            >
              Aperçu
            </Button>
            {previewCount !== null && (
              <span className="text-sm text-text-muted">
                {previewCount} contact{previewCount > 1 ? "s" : ""} correspondant
                {previewCount > 1 ? "s" : ""}
              </span>
            )}
          </div>

          {createMutation.isError && (
            <p className="text-sm text-destructive">
              {errorMessage(createMutation.error, "Impossible de créer ce segment.")}
            </p>
          )}
          <Button type="submit" loading={createMutation.isPending}>
            {createMutation.isPending ? "Création..." : "Créer le segment"}
          </Button>
        </form>
      )}

      {isError && (
        <Card className="p-6">
          <p className="text-sm text-destructive">Impossible de charger les segments.</p>
          <button onClick={() => refetch()} className="mt-2 text-sm font-medium text-text underline">
            Réessayer
          </button>
        </Card>
      )}

      {!isError && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium text-text-muted">
                <tr>
                  <th className="px-4 py-2">Nom</th>
                  <th className="px-4 py-2">Règles</th>
                  <th className="px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-text-muted">
                      Chargement...
                    </td>
                  </tr>
                )}
                {!isLoading && segments?.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-text-muted">
                      Aucun segment.
                    </td>
                  </tr>
                )}
                {segments?.map((segment) => (
                  <tr key={segment.id}>
                    <td className="px-4 py-2 font-medium">
                      {segment.name}
                      {segment.description && (
                        <p className="text-xs font-normal text-text-muted">
                          {segment.description}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-2 text-text-muted">
                      <Badge>
                        {segment.criteria.rules.length} règle
                        {segment.criteria.rules.length > 1 ? "s" : ""} (
                        {segment.criteria.match === "all" ? "toutes" : "au moins une"})
                      </Badge>
                    </td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => deleteMutation.mutate(segment.id)}
                        disabled={deleteMutation.isPending && deleteMutation.variables === segment.id}
                        className="text-xs text-destructive hover:underline"
                      >
                        Supprimer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
