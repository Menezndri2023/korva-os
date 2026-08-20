import type { Permission } from '@korva/types';
import type { AiToolDefinition } from '../providers/ai-provider.interface';

/**
 * Every AI tool is a thin wrapper around an existing business service method — it never
 * touches MongoDB directly and never bypasses the permission a human would need for the
 * same action (see docs/ai.md). `sensitive` tools are never executed inline: the
 * orchestrator persists an AiPendingAction instead and waits for POST /ai/actions/:id/confirm.
 */
export interface AiTool<TInput = unknown> {
  definition: AiToolDefinition;
  requiredPermission: Permission;
  sensitive?: boolean;
  auditEntity: string;
  parseInput(raw: unknown): TInput;
  execute(
    organizationId: string,
    userId: string,
    input: TInput,
  ): Promise<unknown>;
}
