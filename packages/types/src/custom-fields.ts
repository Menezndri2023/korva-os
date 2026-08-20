export const CUSTOM_FIELD_TYPES = [
  "text",
  "number",
  "boolean",
  "date",
  "datetime",
  "select",
  "multiselect",
  "email",
  "phone",
  "url",
] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

/** "offers" covers the whole Catalog entity (product/service/booking/digital_product/subscription/package — see Offer in catalog.ts), superseding the separate "products"/"services" entities named in the original spec. */
export const CUSTOM_FIELD_ENTITIES = ["contacts", "leads", "offers", "bookings", "orders"] as const;
export type CustomFieldEntity = (typeof CUSTOM_FIELD_ENTITIES)[number];

export interface CustomField {
  id: string;
  organizationId: string;
  entity: CustomFieldEntity;
  key: string;
  label: string;
  type: CustomFieldType;
  options?: string[];
  required: boolean;
}

export type CustomFieldValues = Record<string, unknown>;
