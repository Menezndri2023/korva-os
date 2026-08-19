import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { RequestWithContext } from '../../core/tenant/request-context.types';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<RequestWithContext>();
    return request.user;
  },
);
