import { BadRequestException } from '@nestjs/common';
import {
  listNotificationsQuerySchema,
  type ListNotificationsQuery,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import { NotificationsController } from './notifications.controller';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { NotificationsService } from './notifications.service';
import type { AuthenticatedUser } from '../../core/tenant/request-context.types';

const TENANT = { organizationId: 'org-1' } as unknown as TenantContext;
const USER = { userId: 'user-1' } as unknown as AuthenticatedUser;

/** Mirrors exactly what Nest's `@Query(new ZodValidationPipe(...))` does to the raw query object. */
function parseQuery(raw: Record<string, string | undefined>): unknown {
  return new ZodValidationPipe(listNotificationsQuerySchema).transform(raw);
}

function buildController() {
  const list = jest.fn().mockResolvedValue({ data: [], pagination: {} });
  const service = { list } as unknown as NotificationsService;
  return { controller: new NotificationsController(service), list };
}

describe('listNotificationsQuerySchema (via ZodValidationPipe)', () => {
  it('accepts a valid page and defaults limit/read', () => {
    expect(parseQuery({ page: '2' })).toEqual({
      page: 2,
      limit: 20,
      read: undefined,
    });
  });

  it('accepts a valid limit', () => {
    expect(parseQuery({ limit: '50' })).toEqual({
      page: 1,
      limit: 50,
      read: undefined,
    });
  });

  it('accepts read=true and read=false', () => {
    expect(parseQuery({ read: 'true' })).toEqual({
      page: 1,
      limit: 20,
      read: true,
    });
    expect(parseQuery({ read: 'false' })).toEqual({
      page: 1,
      limit: 20,
      read: false,
    });
  });

  it('defaults page/limit/read exactly like the previous hardcoded behavior when omitted', () => {
    expect(parseQuery({})).toEqual({ page: 1, limit: 20, read: undefined });
  });

  it('rejects a non-numeric page with a 400', () => {
    expect(() => parseQuery({ page: 'abc' })).toThrow(BadRequestException);
  });

  it('rejects a non-numeric limit with a 400', () => {
    expect(() => parseQuery({ limit: 'abc' })).toThrow(BadRequestException);
  });

  it('rejects an invalid read value with a 400', () => {
    expect(() => parseQuery({ read: 'maybe' })).toThrow(BadRequestException);
  });

  it('rejects out-of-range page and limit with a 400', () => {
    expect(() => parseQuery({ page: '0' })).toThrow(BadRequestException);
    expect(() => parseQuery({ page: '-1' })).toThrow(BadRequestException);
    expect(() => parseQuery({ limit: '0' })).toThrow(BadRequestException);
    expect(() => parseQuery({ limit: '101' })).toThrow(BadRequestException);
  });
});

describe('NotificationsController.list', () => {
  it('never passes NaN through — a validated query reaches the service with real numbers', async () => {
    const { controller, list } = buildController();
    const query = parseQuery({
      page: '3',
      limit: '10',
      read: 'true',
    }) as ListNotificationsQuery;

    await controller.list(TENANT, USER, query);

    expect(list).toHaveBeenCalledWith('org-1', 'user-1', {
      page: 3,
      limit: 10,
      read: true,
    });
  });
});
