"use client";

import type { CustomFieldEntity, CustomFieldValues } from "@korva/types";
import { Input, Select } from "@korva/ui";
import { useCustomFieldDefinitions } from "@/lib/use-custom-field-definitions";

interface CustomFieldsFieldsetProps {
  entity: CustomFieldEntity;
  values: CustomFieldValues;
  onChange: (values: CustomFieldValues) => void;
  idPrefix?: string;
}

// Renders one labeled input per custom field DEFINED for this organization+entity — an org with
// none configured (the common case until Settings' "Champs personnalisés" section is used)
// renders nothing, so every existing create/edit form stays visually unchanged by default.
// Meant to be dropped inside an existing `grid grid-cols-2` form; each field takes one column
// except boolean/multiselect, which read better full-width.
export function CustomFieldsFieldset({
  entity,
  values,
  onChange,
  idPrefix = "custom-field",
}: CustomFieldsFieldsetProps) {
  const { data: definitions } = useCustomFieldDefinitions(entity);

  if (!definitions || definitions.length === 0) return null;

  function setField(key: string, value: unknown) {
    onChange({ ...values, [key]: value });
  }

  return (
    <>
      {definitions.map((field) => {
        const inputId = `${idPrefix}-${field.id}`;
        const label = field.required ? `${field.label} *` : field.label;
        const value = values[field.key];

        if (field.type === "boolean") {
          return (
            <label
              key={field.id}
              className="col-span-2 flex items-center gap-2 text-sm text-text"
            >
              <input
                type="checkbox"
                checked={Boolean(value)}
                onChange={(e) => setField(field.key, e.target.checked)}
              />
              {label}
            </label>
          );
        }

        if (field.type === "select") {
          return (
            <div key={field.id}>
              <label className="mb-1 block text-xs font-medium text-text" htmlFor={inputId}>
                {label}
              </label>
              <Select
                id={inputId}
                className="w-full"
                value={typeof value === "string" ? value : ""}
                onChange={(e) => setField(field.key, e.target.value || undefined)}
              >
                <option value="">—</option>
                {(field.options ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </div>
          );
        }

        if (field.type === "multiselect") {
          const selected = Array.isArray(value) ? (value as string[]) : [];
          return (
            <div key={field.id} className="col-span-2">
              <p className="mb-1 text-xs font-medium text-text">{label}</p>
              <div className="flex flex-wrap gap-3">
                {(field.options ?? []).map((option) => (
                  <label key={option} className="flex items-center gap-1.5 text-sm text-text">
                    <input
                      type="checkbox"
                      checked={selected.includes(option)}
                      onChange={(e) =>
                        setField(
                          field.key,
                          e.target.checked
                            ? [...selected, option]
                            : selected.filter((v) => v !== option),
                        )
                      }
                    />
                    {option}
                  </label>
                ))}
              </div>
            </div>
          );
        }

        if (field.type === "number") {
          return (
            <div key={field.id}>
              <label className="mb-1 block text-xs font-medium text-text" htmlFor={inputId}>
                {label}
              </label>
              <Input
                id={inputId}
                type="number"
                value={typeof value === "number" ? value : ""}
                onChange={(e) =>
                  setField(field.key, e.target.value === "" ? undefined : Number(e.target.value))
                }
              />
            </div>
          );
        }

        if (field.type === "date" || field.type === "datetime") {
          return (
            <div key={field.id}>
              <label className="mb-1 block text-xs font-medium text-text" htmlFor={inputId}>
                {label}
              </label>
              <Input
                id={inputId}
                type={field.type === "date" ? "date" : "datetime-local"}
                value={typeof value === "string" ? value : ""}
                onChange={(e) => setField(field.key, e.target.value || undefined)}
              />
            </div>
          );
        }

        return (
          <div key={field.id}>
            <label className="mb-1 block text-xs font-medium text-text" htmlFor={inputId}>
              {label}
            </label>
            <Input
              id={inputId}
              type={field.type === "email" ? "email" : field.type === "url" ? "url" : "text"}
              value={typeof value === "string" ? value : ""}
              onChange={(e) => setField(field.key, e.target.value || undefined)}
            />
          </div>
        );
      })}
    </>
  );
}
