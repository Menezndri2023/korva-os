import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import type { RequestWithContext } from '../tenant/request-context.types';

/** What an administration view token may do: read. */
const VIEW_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const authenticated = (await super.canActivate(context)) as boolean;
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    // An administration view token reads, and nothing else — whatever route it reaches.
    if (
      request.user?.viewOnly &&
      !VIEW_ONLY_METHODS.has(request.method.toUpperCase())
    ) {
      throw new ForbiddenException({
        code: 'VIEW_ONLY',
        message: 'This is a read-only view opened by KORVA administration',
      });
    }
    return authenticated;
  }
}
