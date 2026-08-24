import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { TenantContext } from '@korva/types';
import { ModuleGuard } from './module.guard';
import type { RequestWithContext } from '../tenant/request-context.types';

function makeContext(tenant?: Partial<TenantContext>): ExecutionContext {
  const request = { tenant } as RequestWithContext;
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}) as never,
    getClass: () => ({}) as never,
  } as unknown as ExecutionContext;
}

function buildGuard(requiredModule: string | undefined) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(requiredModule),
  } as unknown as Reflector;
  return new ModuleGuard(reflector);
}

describe('ModuleGuard', () => {
  it('allows the request through when the endpoint has no @RequireModule at all', () => {
    const guard = buildGuard(undefined);
    const context = makeContext({ enabledModules: [] });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows the request through when the required module is enabled', () => {
    const guard = buildGuard('analytics');
    const context = makeContext({ enabledModules: ['crm', 'analytics'] });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects with 403 MODULE_NOT_ENABLED when the required module is not enabled', () => {
    const guard = buildGuard('analytics');
    const context = makeContext({ enabledModules: ['crm'] });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    try {
      guard.canActivate(context);
      fail('expected canActivate to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      const response = (error as ForbiddenException).getResponse() as {
        code: string;
        details: { module: string };
      };
      expect(response.code).toBe('MODULE_NOT_ENABLED');
      expect(response.details.module).toBe('analytics');
    }
  });

  it('rejects when request.tenant is missing entirely (no membership resolved) rather than throwing a TypeError', () => {
    const guard = buildGuard('analytics');
    const context = makeContext(undefined);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejects when enabledModules is an empty array', () => {
    const guard = buildGuard('crm');
    const context = makeContext({ enabledModules: [] });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('checks each required module independently — enabling one module never grants another', () => {
    const crmGuard = buildGuard('crm');
    const analyticsGuard = buildGuard('analytics');
    const context = makeContext({ enabledModules: ['crm'] });

    expect(crmGuard.canActivate(context)).toBe(true);
    expect(() => analyticsGuard.canActivate(context)).toThrow(
      ForbiddenException,
    );
  });
});
