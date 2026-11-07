import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { Public } from '../common/decorators/public.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { captureClientError } from '../core/observability/sentry';

export const clientErrorSchema = z.object({
  app: z.enum(['web', 'storefront']),
  message: z.string().trim().min(1).max(500),
  stack: z.string().max(4000).optional(),
  /** Path only — the reporter drops the query string before sending. */
  path: z
    .string()
    .max(300)
    .transform((path) => path.split('?')[0]!.split('#')[0]!),
  release: z.string().max(60).optional(),
});
type ClientErrorInput = z.infer<typeof clientErrorSchema>;

/**
 * POST /client-errors — the browser side of error tracking (lib/error-reporter in both Next
 * apps): a crash on a customer's phone reaches Sentry like an API error does. Public, as the
 * storefront's visitors are anonymous, and throttled per address so it cannot flood Sentry.
 */
@ApiTags('health')
@Public()
@Controller('client-errors')
export class ClientErrorsController {
  @Post()
  @HttpCode(204)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  report(
    @Body(new ZodValidationPipe(clientErrorSchema)) body: ClientErrorInput,
  ): void {
    captureClientError(body);
  }
}
