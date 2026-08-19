export const SYSTEM_ROLES = [
  "OWNER",
  "ADMIN",
  "MANAGER",
  "SALES",
  "FINANCE",
  "STAFF",
] as const;

export type SystemRole = (typeof SYSTEM_ROLES)[number];

/** Permissions are always "resource.action", e.g. "contacts.read". */
export type Permission = `${string}.${string}`;

export const CORE_PERMISSIONS = [
  "contacts.read",
  "contacts.create",
  "contacts.update",
  "contacts.delete",
  "leads.read",
  "leads.create",
  "leads.update",
  "quotes.create",
  "quotes.approve",
  "invoices.read",
  "invoices.create",
  "payments.read",
  "payments.refund",
  "bookings.read",
  "bookings.create",
  "bookings.cancel",
  "settings.manage",
  "ai.use",
  "ai.execute_sensitive_actions",
] as const satisfies readonly Permission[];

export type CorePermission = (typeof CORE_PERMISSIONS)[number];

/** Default permission set granted to each system role. Organizations may layer custom roles on top. */
export const SYSTEM_ROLE_PERMISSIONS: Record<SystemRole, readonly Permission[]> = {
  OWNER: CORE_PERMISSIONS,
  ADMIN: CORE_PERMISSIONS,
  MANAGER: [
    "contacts.read",
    "contacts.create",
    "contacts.update",
    "leads.read",
    "leads.create",
    "leads.update",
    "quotes.create",
    "quotes.approve",
    "invoices.read",
    "bookings.read",
    "bookings.create",
    "bookings.cancel",
    "ai.use",
  ],
  SALES: [
    "contacts.read",
    "contacts.create",
    "contacts.update",
    "leads.read",
    "leads.create",
    "leads.update",
    "quotes.create",
    "bookings.read",
    "bookings.create",
    "ai.use",
  ],
  FINANCE: [
    "invoices.read",
    "invoices.create",
    "payments.read",
    "payments.refund",
    "quotes.approve",
  ],
  STAFF: ["contacts.read", "leads.read", "bookings.read"],
};
