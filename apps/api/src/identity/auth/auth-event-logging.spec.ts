import { Logger, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import type { UsersService } from '../users/users.service';
import type { SessionsService } from './sessions.service';
import type { TwoFactorService } from './two-factor.service';

/**
 * Authentication events are emitted to the structured log rather than AuditService — see
 * AuthService#logAuthEvent for why (AuditLog.organizationId is required and a login has no
 * organization). These tests exist for two reasons: to prove each event actually fires, and to
 * prove no secret ever reaches a log aggregator through one.
 */
const PASSWORD = 'correct-horse-battery';
const TOTP_SECRET = 'ENCRYPTED-TOTP-SECRET';

function fakeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'owner@korva.test',
    passwordHash: 'argon2-hash',
    failedLoginAttempts: 0,
    lockedUntil: null,
    totpEnabled: false,
    totpSecretEncrypted: null,
    ...overrides,
  };
}

function build(
  options: {
    user?: unknown;
    passwordValid?: boolean;
    totpValid?: boolean;
  } = {},
) {
  // Standalone consts rather than reading them back off `usersService`:
  // `expect(obj.method)` is itself what @typescript-eslint/unbound-method flags, and a cast at
  // the call site does not satisfy it.
  const verifyPassword = jest
    .fn()
    .mockResolvedValue(options.passwordValid ?? true);
  const incrementFailedAttempts = jest.fn().mockResolvedValue(1);
  const lockAccount = jest.fn().mockResolvedValue(undefined);

  const usersService = {
    findByEmail: jest
      .fn()
      .mockResolvedValue(
        options.user === undefined ? fakeUser() : options.user,
      ),
    verifyPassword,
    resetFailedAttempts: jest.fn().mockResolvedValue(undefined),
    incrementFailedAttempts,
    lockAccount,
  } as unknown as UsersService;

  const sessionsService = {
    create: jest.fn().mockResolvedValue(undefined),
    revokeByTokenHash: jest.fn().mockResolvedValue(undefined),
  } as unknown as SessionsService;

  const jwtService = {
    signAsync: jest.fn().mockResolvedValue('access-token'),
  } as unknown as JwtService;

  const configService = {
    get: jest.fn().mockReturnValue('30d'),
    getOrThrow: jest.fn().mockReturnValue('secret'),
  } as unknown as ConfigService;

  const twoFactorService = {
    verifyActiveCode: jest.fn().mockReturnValue(options.totpValid ?? true),
  } as unknown as TwoFactorService;

  const service = new AuthService(
    usersService,
    sessionsService,
    jwtService,
    configService,
    undefined,
    twoFactorService,
  );
  return { service, verifyPassword, incrementFailedAttempts, lockAccount };
}

/** Every string the logger was called with during a test. */
function loggedLines(spy: jest.SpyInstance): string {
  return (spy.mock.calls as unknown[][])
    .map((call) => String(call[0]))
    .join('\n');
}

describe('AuthService — authentication event logging', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs AUTH_LOGIN_SUCCEEDED with the userId and whether 2FA was used', async () => {
    const { service } = build({ user: fakeUser({ totpEnabled: false }) });

    await service.login({ email: 'owner@korva.test', password: PASSWORD });

    const lines = loggedLines(logSpy);
    expect(lines).toContain('AUTH_LOGIN_SUCCEEDED');
    expect(lines).toContain('"userId":"user-1"');
    expect(lines).toContain('"twoFactor":false');
  });

  it('logs the attempted email when no account matches — the one case with no userId to log instead', async () => {
    const { service } = build({ user: null });

    await expect(
      service.login({ email: 'ghost@korva.test', password: PASSWORD }),
    ).rejects.toThrow(UnauthorizedException);

    const lines = loggedLines(logSpy);
    expect(lines).toContain('AUTH_LOGIN_FAILED');
    expect(lines).toContain('"reason":"unknown_email"');
    expect(lines).toContain('ghost@korva.test');
  });

  it('logs a bad password by userId, never the password itself or the email', async () => {
    const { service } = build({ passwordValid: false });

    await expect(
      service.login({ email: 'owner@korva.test', password: PASSWORD }),
    ).rejects.toThrow(UnauthorizedException);

    const lines = loggedLines(logSpy);
    expect(lines).toContain('"reason":"bad_password"');
    expect(lines).toContain('"userId":"user-1"');
    expect(lines).not.toContain(PASSWORD);
    // A known account is identified by id, so there is no reason to put its address in the log.
    expect(lines).not.toContain('owner@korva.test');
  });

  it('logs a rejected TOTP code without logging the code or the stored secret', async () => {
    const { service } = build({
      user: fakeUser({ totpEnabled: true, totpSecretEncrypted: TOTP_SECRET }),
      totpValid: false,
    });

    await expect(
      service.login({
        email: 'owner@korva.test',
        password: PASSWORD,
        totpCode: '123456',
      }),
    ).rejects.toThrow(UnauthorizedException);

    const lines = loggedLines(logSpy);
    expect(lines).toContain('"reason":"bad_totp_code"');
    expect(lines).not.toContain('123456');
    expect(lines).not.toContain(TOTP_SECRET);
  });

  it('logs AUTH_LOGIN_BLOCKED for a locked account, before the password is even checked', async () => {
    const lockedUntil = new Date(Date.now() + 600_000);
    const { service, verifyPassword } = build({
      user: fakeUser({ lockedUntil }),
    });

    await expect(
      service.login({ email: 'owner@korva.test', password: PASSWORD }),
    ).rejects.toThrow(UnauthorizedException);

    const lines = loggedLines(logSpy);
    expect(lines).toContain('AUTH_LOGIN_BLOCKED');
    expect(lines).toContain('"reason":"account_locked"');
    expect(lines).toContain(lockedUntil.toISOString());
    // The lockout must short-circuit: a locked account never reaches password verification,
    // so it cannot leak whether the password was right while locked.
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it('logs AUTH_ACCOUNT_LOCKED when the failed-attempt threshold is crossed', async () => {
    const { service, incrementFailedAttempts, lockAccount } = build({
      passwordValid: false,
    });
    incrementFailedAttempts.mockResolvedValue(5);

    await expect(
      service.login({ email: 'owner@korva.test', password: PASSWORD }),
    ).rejects.toThrow(UnauthorizedException);

    const lines = loggedLines(logSpy);
    expect(lines).toContain('AUTH_ACCOUNT_LOCKED');
    expect(lines).toContain('"attempts":5');
    expect(lockAccount).toHaveBeenCalledTimes(1);
  });

  it('logs AUTH_LOGOUT without the refresh token or its hash', async () => {
    const { service } = build();

    await service.logout('raw-refresh-token-value');

    const lines = loggedLines(logSpy);
    expect(lines).toContain('AUTH_LOGOUT');
    expect(lines).not.toContain('raw-refresh-token-value');
  });
});
