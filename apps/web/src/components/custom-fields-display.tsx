"use client";

import type { CustomFieldEntity, CustomFieldValues } from "@korva/types";
import { useCustomFieldDefinitions } from "@/lib/use-custom-field-definitions";

function formatCustomFieldValue(value: unknown): string {
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "—";
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  return String(value);
}

// Read-only counterpart to CustomFieldsFieldset — meant to be dropped inside an existing
// `<dl className="grid grid-cols-2 ...">` block. Only renders fields that actually have a value,
// so an org with definitions configured but this particular record left blank stays uncluttered.
export function CustomFieldsDisplay({
  entity,
  values,
}: {
  entity: CustomFieldEntity;
  values: CustomFieldValues;
}) {
  const { data: definitions } = useCustomFieldDefinitions(entity);
  const populated = (definitions ?? []).filter((field) => {
    const value = values[field.key];
    return value !== undefined && value !== null && value !== "";
  });

  if (populated.length === 0) return null;

  return (
    <>
      {populated.map((field) => (
        <div key={field.id}>
          <dt className="text-text-muted">{field.label}</dt>
          <dd className="mt-0.5">{formatCustomFieldValue(values[field.key])}</dd>
        </div>
      ))}
    </>
  );
}
