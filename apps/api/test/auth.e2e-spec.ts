import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import * as OTPAuth from 'otpauth';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

interface ApiSuccess<T> {
  success: true;
  data: T;
}
interface ApiError {
  success: false;
  error: { code: string; message: string };
}

interface AuthResponseBody {
  user: { id: string; email: string; totpEnabled?: boolean };
  accessToken: string;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

const REFRESH_COOKIE_NAME = 'korva_refresh_token';

/** Extracts the `name=value` pair for REFRESH_COOKIE_NAME from a response's Set-Cookie
 *  header(s), for forwarding on a subsequent request — never logs/returns the full raw header
 *  (which also carries Path/HttpOnly/etc., not just the token). */
function extractRefreshCookiePair(res: request.Response): string {
  const raw =
    (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  const line = raw.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
  if (!line) {
    throw new Error(
      `${REFRESH_COOKIE_NAME} cookie not found in Set-Cookie header`,
    );
  }
  return line.split(';')[0]!;
}

function findRefreshCookieHeader(res: request.Response): string | undefined {
  const raw =
    (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  return raw.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
}

/**
 * Real HTTP, real MongoDB, real cookies — end-to-end coverage of the refresh-token flow that
 * apps/web actually depends on (see the auth pre-D3 audit report for the full architecture).
 * apps/api/src/identity/auth/auth.controller.spec.ts and auth.service.spec.ts already cover
 * the sequential/logic-level scenarios in isolation; this file exists specifically for what
 * those can't prove — a real cookie round-tripping through real HTTP responses/requests, and
 * genuine MongoDB write concurrency (TEST — concurrent refresh) that no mock can demonstrate.
 */
describe('Auth — refresh-token cookie flow (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    server = app.getHttpServer();
    connection = app.get(getConnectionToken());
    await connection.dropDatabase();
    await Promise.all(
      connection
        .modelNames()
        .map((name) => connection.model(name).syncIndexes()),
    );
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await app.close();
  });

  // Returns the raw response (not just the parsed body) — register() already goes through
  // the exact same issueTokens()/cookie flow as login(), so tests that just need ONE
  // established session use this alone instead of an extra, session-doubling login() call.
  async function register(email: string): Promise<request.Response> {
    return request(server)
      .post('/api/v1/auth/register')
      .send({ email, password: 'password123' })
      .expect(201);
  }

  async function countActiveSessions(userId: string): Promise<number> {
    return connection
      .collection('sessions')
      .countDocuments({ userId: new Types.ObjectId(userId), revokedAt: null });
  }

  it('A — login: access token in the body, refresh token ONLY as an HttpOnly cookie scoped to /api/v1/auth', async () => {
    await register('login-flow@korva.test'); // account setup only — this test is about login()

    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'login-flow@korva.test', password: 'password123' })
      .expect(201);

    const body = asSuccess<AuthResponseBody>(res.body);
    expect(typeof body.accessToken).toBe('string');
    expect(body.accessToken.length).toBeGreaterThan(0);
    expect(body).not.toHaveProperty('refreshToken');

    const cookieHeader = findRefreshCookieHeader(res);
    expect(cookieHeader).toBeDefined();
    expect(cookieHeader).toContain('HttpOnly');
    expect(cookieHeader).toContain('Path=/api/v1/auth');
    // Test env runs over plain HTTP (NODE_ENV=test, not production) — Secure must be absent,
    // matching AuthController.cookieOptions()'s isProduction() branch.
    expect(cookieHeader).not.toContain('Secure');
    expect(cookieHeader?.toLowerCase()).toContain('samesite=lax');
  });

  it('B — refresh: rotates using the real cookie, issues a new access token and a new cookie, and permanently invalidates the old one', async () => {
    const registerRes = await register('refresh-flow@korva.test');
    const originalCookie = extractRefreshCookiePair(registerRes);

    const refreshRes = await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', originalCookie)
      .expect(201);

    // Not asserted against the original: the access token is a JWT signed with second-
    // granularity `iat` — reissued an instant later it can be byte-identical, which is not a
    // meaningful signal either way. The refresh TOKEN (the cookie) is what must always differ,
    // asserted below — it's cryptographically random per issuance regardless of timing.
    const refreshed = asSuccess<{ accessToken: string }>(refreshRes.body);
    expect(refreshed).not.toHaveProperty('refreshToken');
    expect(typeof refreshed.accessToken).toBe('string');

    const newCookie = extractRefreshCookiePair(refreshRes);
    expect(newCookie).not.toBe(originalCookie);

    // The old (now-rotated-away) cookie must never work again.
    const replayRes = await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', originalCookie)
      .expect(401);
    expect(asError(replayRes.body).code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('C — reuse of an already-rotated token is rejected generically and revokes every active session for that user', async () => {
    const registerRes = await register('reuse-flow@korva.test');
    const rotatedAwayCookie = extractRefreshCookiePair(registerRes);
    const userId = asSuccess<AuthResponseBody>(registerRes.body).user.id;

    // Rotate it once (legitimate) — rotatedAwayCookie is now stale, and a second, independent
    // active session exists for the same user (the one this rotation just created).
    const rotateRes = await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', rotatedAwayCookie)
      .expect(201);
    const currentCookie = extractRefreshCookiePair(rotateRes);
    expect(await countActiveSessions(userId)).toBe(1);

    // Present the stale, already-rotated cookie again — the reuse signal.
    const reuseRes = await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', rotatedAwayCookie)
      .expect(401);
    expect(asError(reuseRes.body).code).toBe('INVALID_REFRESH_TOKEN');

    // The currently-valid session (from the legitimate rotation above) must ALSO have been
    // revoked by the global response to the reuse signal.
    expect(await countActiveSessions(userId)).toBe(0);
    await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', currentCookie)
      .expect(401);
  });

  it('D — logout revokes the session server-side and clears the cookie; a subsequent refresh fails', async () => {
    const registerRes = await register('logout-flow@korva.test');
    const cookie = extractRefreshCookiePair(registerRes);
    const accessToken = asSuccess<AuthResponseBody>(
      registerRes.body,
    ).accessToken;

    // logout is authenticated (no @Public()) — unlike register/login/refresh, it requires the
    // real Bearer access token, not just the refresh cookie.
    const logoutRes = await request(server)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);
    expect(asSuccess<{ loggedOut: boolean }>(logoutRes.body)).toEqual({
      loggedOut: true,
    });
    const clearedCookieHeader = findRefreshCookieHeader(logoutRes);
    expect(clearedCookieHeader).toContain('Path=/api/v1/auth');

    await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie)
      .expect(401);
  });

  it('E — two concurrent refreshes of the SAME active token: exactly one is accepted, the other is rejected, and never two independently-valid sessions coexist', async () => {
    const registerRes = await register('concurrent-flow@korva.test');
    const cookie = extractRefreshCookiePair(registerRes);
    const userId = asSuccess<AuthResponseBody>(registerRes.body).user.id;
    expect(await countActiveSessions(userId)).toBe(1);

    // Dispatched together — a genuine race against real MongoDB, not two sequential calls.
    // SessionsRepository.revokeActiveByTokenHash's atomic findOneAndUpdate (filtered on
    // revokedAt: null) is what MongoDB itself arbitrates this on: only one request's write can
    // match the still-active document — the invariant this test exists to prove.
    const [a, b] = await Promise.all([
      request(server).post('/api/v1/auth/refresh').set('Cookie', cookie),
      request(server).post('/api/v1/auth/refresh').set('Cookie', cookie),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 401]);

    const winner = a.status === 201 ? a : b;
    const loser = a.status === 201 ? b : a;
    expect(asSuccess<{ accessToken: string }>(winner.body).accessToken).toEqual(
      expect.any(String),
    );
    expect(asError(loser.body).code).toBe('INVALID_REFRESH_TOKEN');

    // The decisive assertion — NOT "exactly 1 remains": the loser's failed atomic consume falls
    // into the exact same detectRefreshTokenReuse path as a genuinely stolen token would (it
    // has no way to distinguish "lost a legitimate race" from "replayed"), which can legitimately
    // also revoke the winner's brand-new session as a side effect — whether that happens before
    // or after the winner's session is created is itself a second, undetermined race, so either
    // 0 or 1 remaining active sessions is a correct outcome. What must NEVER happen is 2: that
    // would mean the same original token produced two independently-valid sessions.
    expect(await countActiveSessions(userId)).toBeLessThanOrEqual(1);
  });
});

/**
 * TOTP-based 2FA — a real, un-mocked TOTP implementation on both sides: the API generates and
 * verifies with `otpauth` (see TwoFactorService), and this test independently computes codes
 * against the SAME secret with the same library, exactly the way a real authenticator app would.
 */
describe('Auth — two-factor authentication (TOTP) (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    server = app.getHttpServer();
    connection = app.get(getConnectionToken());
    await connection.dropDatabase();
    await Promise.all(
      connection
        .modelNames()
        .map((name) => connection.model(name).syncIndexes()),
    );
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await app.close();
  });

  async function registerAndLogin(email: string): Promise<AuthResponseBody> {
    const res = await request(server)
      .post('/api/v1/auth/register')
      .send({ email, password: 'password123' })
      .expect(201);
    return asSuccess<AuthResponseBody>(res.body);
  }

  function codeFor(secret: string): string {
    const totp = new OTPAuth.TOTP({
      issuer: 'KORVA OS',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });
    return totp.generate();
  }

  /** Deterministically wrong: never equal to the real code, unlike a fixed guess such as
   *  '000000' which has a (tiny but real) chance of colliding with it. */
  function wrongCodeFor(secret: string): string {
    const real = codeFor(secret);
    const firstDigit = real[0] as string;
    const flipped = firstDigit === '0' ? '1' : '0';
    return flipped + real.slice(1);
  }

  it('full flow: setup -> confirm -> login without code fails/prompts -> wrong code fails -> correct code succeeds', async () => {
    const email = 'totp-flow@korva.test';
    const { accessToken } = await registerAndLogin(email);

    const setupRes = await request(server)
      .post('/api/v1/auth/2fa/setup')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);
    const { secret, otpauthUrl } = asSuccess<{
      secret: string;
      otpauthUrl: string;
    }>(setupRes.body);
    expect(typeof secret).toBe('string');
    expect(otpauthUrl).toContain('otpauth://totp/');

    // Wrong code is rejected and must NOT arm 2FA.
    await request(server)
      .post('/api/v1/auth/2fa/confirm')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: wrongCodeFor(secret) })
      .expect(401);

    const confirmRes = await request(server)
      .post('/api/v1/auth/2fa/confirm')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: codeFor(secret) })
      .expect(201);
    expect(asSuccess<{ enabled: boolean }>(confirmRes.body)).toEqual({
      enabled: true,
    });

    // The secret is never re-exposed anywhere from this point on.
    expect(JSON.stringify(confirmRes.body)).not.toContain(secret);

    // Login without a code: rejected with a distinguishable "prompt for code" error, not a
    // silent success and not a generic INVALID_CREDENTIALS.
    const noCodeRes = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: 'password123' })
      .expect(401);
    expect(asError(noCodeRes.body).code).toBe('TOTP_REQUIRED');

    // Login with a wrong code fails.
    const wrongCodeRes = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: 'password123', totpCode: wrongCodeFor(secret) })
      .expect(401);
    expect(asError(wrongCodeRes.body).code).toBe('INVALID_TOTP_CODE');

    // Login with the correct code succeeds.
    const okRes = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: 'password123', totpCode: codeFor(secret) })
      .expect(201);
    const okBody = asSuccess<AuthResponseBody>(okRes.body);
    expect(okBody.user.email).toBe(email);
    expect(typeof okBody.accessToken).toBe('string');
    expect(JSON.stringify(okRes.body)).not.toContain(secret);
  });

  it('disable requires a valid code, and login no longer requires one afterwards', async () => {
    const email = 'totp-disable@korva.test';
    const { accessToken } = await registerAndLogin(email);

    const setupRes = await request(server)
      .post('/api/v1/auth/2fa/setup')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);
    const { secret } = asSuccess<{ secret: string }>(setupRes.body);
    await request(server)
      .post('/api/v1/auth/2fa/confirm')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: codeFor(secret) })
      .expect(201);

    // Wrong code cannot disable it.
    await request(server)
      .post('/api/v1/auth/2fa/disable')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: wrongCodeFor(secret) })
      .expect(401);

    await request(server)
      .post('/api/v1/auth/2fa/disable')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: codeFor(secret) })
      .expect(201);

    // Login no longer requires a code.
    const loginRes = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: 'password123' })
      .expect(201);
    expect(asSuccess<AuthResponseBody>(loginRes.body).user.email).toBe(email);
  });
});

/**
 * Per-account lockout, distinct from and layered on top of the global per-IP ThrottlerGuard —
 * see AuthService.login's MAX_FAILED_ATTEMPTS/LOCKOUT_DURATION_MS.
 */
describe('Auth — per-account lockout (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    server = app.getHttpServer();
    connection = app.get(getConnectionToken());
    await connection.dropDatabase();
    await Promise.all(
      connection
        .modelNames()
        .map((name) => connection.model(name).syncIndexes()),
    );
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await app.close();
  });

  async function register(email: string): Promise<AuthResponseBody> {
    const res = await request(server)
      .post('/api/v1/auth/register')
      .send({ email, password: 'password123' })
      .expect(201);
    return asSuccess<AuthResponseBody>(res.body);
  }

  async function failedLogin(email: string) {
    return request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: 'wrong-password' });
  }

  it('locks the account after 5 consecutive failed attempts, and rejects the 6th attempt even with the correct password', async () => {
    const email = 'lockout-flow@korva.test';
    await register(email);

    for (let i = 0; i < 5; i++) {
      const res = await failedLogin(email);
      expect(res.status).toBe(401);
      expect(asError(res.body).code).toBe('INVALID_CREDENTIALS');
    }

    // The account is now locked — even the CORRECT password is rejected.
    const lockedRes = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: 'password123' })
      .expect(401);
    expect(asError(lockedRes.body).code).toBe('ACCOUNT_LOCKED');
  });

  it('a successful login before the threshold resets the failed-attempt counter', async () => {
    const email = 'lockout-reset@korva.test';
    await register(email);

    // 3 failures (below the threshold of 5) ...
    for (let i = 0; i < 3; i++) {
      await failedLogin(email);
    }

    // ... then a successful login must reset the counter back to 0.
    await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: 'password123' })
      .expect(201);

    // 4 more failures afterwards must NOT lock the account (3 + 4 = 7 total failures across the
    // whole test, but only 4 consecutive since the reset — below the threshold of 5).
    for (let i = 0; i < 4; i++) {
      const res = await failedLogin(email);
      expect(res.status).toBe(401);
      expect(asError(res.body).code).toBe('INVALID_CREDENTIALS');
    }

    // Correct password still works — the account was never locked.
    await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: 'password123' })
      .expect(201);
  });

  it('automatically unlocks once the cooldown window elapses', async () => {
    const email = 'lockout-cooldown@korva.test';
    const { user } = await register(email);

    for (let i = 0; i < 5; i++) {
      await failedLogin(email);
    }
    await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: 'password123' })
      .expect(401); // still locked

    // Force lockedUntil into the past — the only way to exercise real cooldown expiry
    // deterministically without waiting out the real window, same technique as
    // password-reset.e2e-spec.ts's expired-token test.
    await connection
      .collection('users')
      .updateOne(
        { _id: new Types.ObjectId(user.id) },
        { $set: { lockedUntil: new Date(Date.now() - 1000) } },
      );

    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: 'password123' })
      .expect(201);
    expect(asSuccess<AuthResponseBody>(res.body).user.email).toBe(email);
  });
});
