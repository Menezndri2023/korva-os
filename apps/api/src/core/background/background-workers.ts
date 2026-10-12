import type { ConfigService } from '@nestjs/config';

/**
 * One switch that stops every BullMQ worker and scheduler in the process from starting.
 *
 * Exists for the CLI scripts in `apps/api/scripts/`. Each builds a real application context
 * (`NestFactory.createApplicationContext(AppModule)`) because that is how it resolves services
 * and models — but that also runs every scheduler's `onModuleInit`. Before this flag, running
 * `manage-plans.ts` to print a dry-run started ten workers, registered their repeatable job
 * definitions in Redis, and left them live for the few seconds the script took. A CLI tool
 * printing a plan could therefore execute a payment-reconciliation sweep as a side effect.
 *
 * That is a correctness problem first and a cost problem second. The Redis traffic of a script
 * run is small; a script quietly performing financial work nobody asked for is not.
 *
 * Deliberately a single global flag rather than the ten per-scheduler `*_ENABLED` variables a
 * caller could set individually: a scheduler added later is covered automatically, whereas a
 * hand-maintained list of ten flags in every script would fall behind exactly the way the queue
 * lists in `core/queues/queue-registry.ts` already did once.
 *
 * Only `'true'` disables. Anything else, including unset, leaves background work running — the
 * running application must never be one typo away from silently processing nothing.
 */
export const DISABLE_BACKGROUND_WORKERS_ENV = 'DISABLE_BACKGROUND_WORKERS';

export function backgroundWorkersDisabled(
  configService: Pick<ConfigService, 'get'>,
): boolean {
  return configService.get<string>(DISABLE_BACKGROUND_WORKERS_ENV) === 'true';
}
