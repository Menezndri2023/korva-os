import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { RequestWithContext } from '../../core/tenant/request-context.types';

/** Resolves the current request's TenantContext (organizationId, membership, permissions). */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<RequestWithContext>();
    return request.tenant;
  },
);
