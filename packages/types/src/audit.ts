export const AUDIT_ACTIONS = [
  "CREATE",
  "UPDATE",
  "DELETE",
  "LOGIN",
  "LOGOUT",
  "PAYMENT",
  "REFUND",
  "BOOKING",
  "AI_ACTION",
  "ROLE_CHANGE",
  "SETTINGS_CHANGE",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Mirrors AuditLog (apps/api/src/audit/schemas/audit-log.schema.ts) exactly. */
export interface AuditLogEntry {
  id: string;
  organizationId: string;
  userId?: string;
  action: AuditAction;
  entity: string;
  entityId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}
