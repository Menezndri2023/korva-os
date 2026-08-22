import { Logger, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import type { UsersService } from '../users/users.service';
import type { SessionsService } from './sessions.service';
import type { UserDocument } from '../schemas/user.schema';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function future(): Date {
  return new Date(Date.now() + 60_000);
}

function past(): Date {
  return new Date(Date.now() - 60_000);
}

function fakeUser(id: string) {
  return {
    id,
    email: 'ada@example.com',
    firstName: 'Ada',
    lastName: undefined,
    emailVerifiedAt: null,
  } as unknown as UserDocument;
}

function fakeConfigService(): ConfigService {
  return { get: () => '30d' } as unknown as ConfigService;
}

function fakeJwtService(): JwtService {
  return {
    signAsync: jest.fn().mockResolvedValue('access-token'),
  } as unknown as JwtService;
}

interface FakeSession {
  id: string;
  userId: string;
  refreshTokenHash: string;
  revokedAt: Date | null;
  expiresAt: Date;
}

/**
 * A small in-memory stand-in for SessionsService, backed by real state rather than
 * canned mockResolvedValueOnce sequences — reuse detection is inherently about behavior
 * across a create → rotate → re-present sequence, which is far more faithfully exercised
 * against real (fake) state than against a scripted list of return values.
 */
function buildFakeSessionsService() {
  const sessions: FakeSession[] = [];
  let nextId = 1;

  const create = jest.fn(
    (input: { userId: string; refreshTokenHash: string; expiresAt: Date }) => {
      const session: FakeSession = {
        id: `session-${nextId++}`,
        userId: input.userId,
        refreshTokenHash: input.refreshTokenHash,
        revokedAt: null,
        expiresAt: input.expiresAt,
      };
      sessions.push(session);
      return Promise.resolve(session);
    },
  );

  // Mirrors SessionsRepository.revokeActiveByTokenHash's atomic find-and-update semantics: the
  // match check and the write happen as a single synchronous step (no `await` in between), so
  // this fake — unlike a naive find-then-revoke pair — can't itself introduce the TOCTOU race
  // the real MongoDB findOneAndUpdate closes. It's still not a substitute for proving MongoDB
  // actually enforces this under real concurrency (see auth.e2e-spec.ts for that).
  const revokeActiveByTokenHash = jest.fn((hash: string) => {
    const session = sessions.find(
      (s) =>
        s.refreshTokenHash === hash &&
        s.revokedAt === null &&
        s.expiresAt.getTime() > Date.now(),
    );
    if (!session) return Promise.resolve(null);
    session.revokedAt = new Date();
    return Promise.resolve(session);
  });

  const findByTokenHash = jest.fn((hash: string) => {
    return Promise.resolve(
      sessions.find((s) => s.refreshTokenHash === hash) ?? null,
    );
  });

  const revokeByTokenHash = jest.fn((hash: string) => {
    const session = sessions.find((s) => s.refreshTokenHash === hash);
    if (session) session.revokedAt = new Date();
    return Promise.resolve();
  });

  const revokeAllForUser = jest.fn((userId: string) => {
    for (const s of sessions) {
      if (s.userId === userId && s.revokedAt === null) {
        s.revokedAt = new Date();
      }
    }
    return Promise.resolve();
  });

  const sessionsService = {
    create,
    revokeActiveByTokenHash,
    findByTokenHash,
    revokeByTokenHash,
    revokeAllForUser,
  } as unknown as SessionsService;

  return {
    sessionsService,
    sessions,
    create,
    revokeActiveByTokenHash,
    findByTokenHash,
    revokeByTokenHash,
    revokeAllForUser,
  };
}

async function catchUnauthorized(
  promise: Promise<unknown>,
): Promise<UnauthorizedException> {
  try {
    await promise;
  } catch (error) {
    return error as UnauthorizedException;
  }
  throw new Error('Expected promise to reject');
}

describe('AuthService.refresh — reuse detection', () => {
  it('TEST 1 — normal rotation: revokes only the presented session, issues a new one, no mass revocation', async () => {
    const {
      sessionsService,
      sessions,
      revokeActiveByTokenHash,
      revokeAllForUser,
      create,
    } = buildFakeSessionsService();
    const usersService = {
      findById: jest.fn().mockResolvedValue(fakeUser('user-1')),
    } as unknown as UsersService;
    const authService = new AuthService(
      usersService,
      sessionsService,
      fakeJwtService(),
      fakeConfigService(),
    );

    const rawToken = 'raw-token-1';
    await sessionsService.create({
      userId: 'user-1',
      refreshTokenHash: hashToken(rawToken),
      expiresAt: future(),
    });
    create.mockClear();

    const result = await authService.refresh(rawToken);

    expect(result.accessToken).toBe('access-token');
    expect(typeof result.refreshToken).toBe('string');
    expect(result.refreshToken).not.toBe(rawToken);
    expect(revokeActiveByTokenHash).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1); // exactly the rotation's new session
    expect(revokeAllForUser).not.toHaveBeenCalled();

    const active = sessions.filter(
      (s) => s.userId === 'user-1' && s.revokedAt === null,
    );
    expect(active).toHaveLength(1); // only the newly-rotated session remains active
  });

  it('TEST 2 — reuse of an already-rotated token revokes ALL active sessions for that user, creates nothing, and fails with the same generic error', async () => {
    const { sessionsService, sessions, revokeAllForUser, create } =
      buildFakeSessionsService();
    const usersService = {
      findById: jest.fn().mockResolvedValue(fakeUser('user-1')),
    } as unknown as UsersService;
    const authService = new AuthService(
      usersService,
      sessionsService,
      fakeJwtService(),
      fakeConfigService(),
    );

    const tokenA = 'raw-token-A'; // will be rotated, then reused
    const tokenB = 'raw-token-B'; // a second, independent active session for the same user
    await sessionsService.create({
      userId: 'user-1',
      refreshTokenHash: hashToken(tokenA),
      expiresAt: future(),
    });
    await sessionsService.create({
      userId: 'user-1',
      refreshTokenHash: hashToken(tokenB),
      expiresAt: future(),
    });

    // Normal rotation of tokenA — legitimate, must keep working.
    await authService.refresh(tokenA);
    expect(
      sessions.filter((s) => s.userId === 'user-1' && s.revokedAt === null),
    ).toHaveLength(2); // tokenB's session + the newly rotated-in one

    create.mockClear();
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    // tokenA is presented again — it was already rotated away.
    const caught = await catchUnauthorized(authService.refresh(tokenA));

    expect(caught).toBeInstanceOf(UnauthorizedException);
    expect(caught.getResponse()).toEqual({
      code: 'INVALID_REFRESH_TOKEN',
      message: 'Refresh token is invalid or expired',
    });

    expect(revokeAllForUser).toHaveBeenCalledWith('user-1');
    expect(create).not.toHaveBeenCalled(); // no new session/token issued from a reused token
    const stillActive = sessions.filter(
      (s) => s.userId === 'user-1' && s.revokedAt === null,
    );
    expect(stillActive).toHaveLength(0); // tokenB's session AND the rotated-in one are both gone

    // The detection detail is server-side only — never in the raw/hashed token in a log line.
    expect(warnSpy).toHaveBeenCalled();
    const loggedMessage = warnSpy.mock.calls[0]?.[0] as string;
    expect(loggedMessage).not.toContain(tokenA);
    expect(loggedMessage).not.toContain(hashToken(tokenA));
    warnSpy.mockRestore();
  });

  it('TEST 3 — a totally unknown token fails the same generic way, without correlating or revoking any user', async () => {
    const { sessionsService, revokeAllForUser, findByTokenHash } =
      buildFakeSessionsService();
    const usersService = {
      findById: jest.fn(),
    } as unknown as UsersService;
    const authService = new AuthService(
      usersService,
      sessionsService,
      fakeJwtService(),
      fakeConfigService(),
    );

    const caught = await catchUnauthorized(
      authService.refresh('totally-unknown-token'),
    );

    expect(caught).toBeInstanceOf(UnauthorizedException);
    expect(caught.getResponse()).toEqual({
      code: 'INVALID_REFRESH_TOKEN',
      message: 'Refresh token is invalid or expired',
    });
    expect(findByTokenHash).toHaveBeenCalledTimes(1); // looked up, but found nothing
    expect(revokeAllForUser).not.toHaveBeenCalled();
  });

  it('an expired-but-never-reused token does not trigger mass revocation (Case D, distinct from reuse)', async () => {
    const { sessionsService, revokeAllForUser } = buildFakeSessionsService();
    const usersService = { findById: jest.fn() } as unknown as UsersService;
    const authService = new AuthService(
      usersService,
      sessionsService,
      fakeJwtService(),
      fakeConfigService(),
    );

    const rawToken = 'raw-token-expired';
    await sessionsService.create({
      userId: 'user-1',
      refreshTokenHash: hashToken(rawToken),
      expiresAt: past(),
    });

    const caught = await catchUnauthorized(authService.refresh(rawToken));

    expect(caught).toBeInstanceOf(UnauthorizedException);
    expect(caught.getResponse()).toEqual({
      code: 'INVALID_REFRESH_TOKEN',
      message: 'Refresh token is invalid or expired',
    });
    expect(revokeAllForUser).not.toHaveBeenCalled();
  });
});
