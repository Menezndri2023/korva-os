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
import { useT } from "@/lib/dashboard-locale";

const OPERATOR_LABELS: Record<SegmentRuleOperator, [string, string]> = {
  has_tag: ["a le tag", "has the tag"],
  not_has_tag: ["n'a pas le tag", "does not have the tag"],
  equals: ["est égal à", "equals"],
  not_equals: ["est différent de", "is not"],
  contains: ["contient", "contains"],
  is_set: ["est renseigné", "is filled in"],
  is_not_set: ["n'est pas renseigné", "is empty"],
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
  const t = useT();
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
          {t(
            "Segments de contacts réutilisables pour vos campagnes marketing.",
            "Reusable contact segments for your marketing campaigns.",
          )}
        </p>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? t("Annuler", "Cancel") : t("Nouveau segment", "New segment")}
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit((values) => createMutation.mutate(values))}
          className="space-y-3 rounded-lg border border-border bg-surface p-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <Input placeholder={t("Nom du segment", "Segment name")} {...register("name")} />
            <Select {...register("criteria.match")}>
              {SEGMENT_MATCH_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode === "all" ? t("Toutes les règles", "All the rules") : t("Au moins une règle", "At least one rule")}
                </option>
              ))}
            </Select>
          </div>
          {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          <Input placeholder={t("Description (optionnel)", "Description (optional)")} {...register("description")} />

          <div className="space-y-2">
            <p className="text-sm font-medium text-text">{t("Règles", "Rules")}</p>
            {ruleFields.fields.map((field, index) => (
              <div key={field.id} className="grid grid-cols-12 gap-2">
                <Select
                  className="col-span-4"
                  {...register(`criteria.rules.${index}.field`)}
                >
                  <option value="tag">{t("Tag", "Tag")}</option>
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
                      {t(...OPERATOR_LABELS[operator])}
                    </option>
                  ))}
                </Select>
                <Input
                  className="col-span-3"
                  placeholder={t("Valeur", "Value")}
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
              {t("+ Ajouter une règle", "+ Add a rule")}
            </button>
          </div>

          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              loading={previewMutation.isPending}
              onClick={() => previewMutation.mutate(getValues("criteria"))}
            >
              {t("Aperçu", "Preview")}
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
              {errorMessage(createMutation.error, t(
                "Impossible de créer ce segment.",
                "This segment could not be created.",
              ))}
            </p>
          )}
          <Button type="submit" loading={createMutation.isPending}>
            {createMutation.isPending ? t("Création...", "Creating...") : t("Créer le segment", "Create the segment")}
          </Button>
        </form>
      )}

      {isError && (
        <Card className="p-6">
          <p className="text-sm text-destructive">{t(
            "Impossible de charger les segments.",
            "Segments could not be loaded.",
          )}</p>
          <button onClick={() => refetch()} className="mt-2 text-sm font-medium text-text underline">
            {t("Réessayer", "Try again")}
          </button>
        </Card>
      )}

      {!isError && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium text-text-muted">
                <tr>
                  <th className="px-4 py-2">{t("Nom", "Name")}</th>
                  <th className="px-4 py-2">{t("Règles", "Rules")}</th>
                  <th className="px-4 py-2">{t("Actions", "Actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-text-muted">
                      {t("Chargement...", "Loading...")}
                    </td>
                  </tr>
                )}
                {!isLoading && segments?.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-text-muted">
                      {t("Aucun segment.", "No segments.")}
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
                        {t(
                          `${segment.criteria.rules.length} règle${segment.criteria.rules.length > 1 ? "s" : ""} (${segment.criteria.match === "all" ? "toutes" : "au moins une"})`,
                          `${segment.criteria.rules.length} rule${segment.criteria.rules.length === 1 ? "" : "s"} (${segment.criteria.match === "all" ? "all" : "at least one"})`,
                        )}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => deleteMutation.mutate(segment.id)}
                        disabled={deleteMutation.isPending && deleteMutation.variables === segment.id}
                        className="text-xs text-destructive hover:underline"
                      >
                        {t("Supprimer", "Delete")}
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
