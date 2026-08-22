import 'reflect-metadata';
import { UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthController } from './auth.controller';
import type { AuthService } from './auth.service';
import type { ConfigService } from '@nestjs/config';

const THROTTLER_LIMIT_DEFAULT = 'THROTTLER:LIMITdefault';
const THROTTLER_TTL_DEFAULT = 'THROTTLER:TTLdefault';

const prototype = AuthController.prototype as unknown as Record<
  string,
  unknown
>;

function getThrottleMetadata(
  key: string,
  methodName: string,
): number | undefined {
  return Reflect.getMetadata(key, prototype[methodName] as object) as
    number | undefined;
}

describe('AuthController — /auth/refresh throttling', () => {
  it('applies the same AUTH_THROTTLE limit/ttl to refresh as to login and register', () => {
    const loginLimit = getThrottleMetadata(THROTTLER_LIMIT_DEFAULT, 'login');
    const loginTtl = getThrottleMetadata(THROTTLER_TTL_DEFAULT, 'login');
    const registerLimit = getThrottleMetadata(
      THROTTLER_LIMIT_DEFAULT,
      'register',
    );
    const registerTtl = getThrottleMetadata(THROTTLER_TTL_DEFAULT, 'register');
    const refreshLimit = getThrottleMetadata(
      THROTTLER_LIMIT_DEFAULT,
      'refresh',
    );
    const refreshTtl = getThrottleMetadata(THROTTLER_TTL_DEFAULT, 'refresh');

    // Sanity: login/register are the known-good baseline (already correctly throttled).
    expect(loginLimit).toBe(30);
    expect(loginTtl).toBe(60_000);
    expect(registerLimit).toBe(30);
    expect(registerTtl).toBe(60_000);

    // The actual fix: refresh now carries the exact same throttle metadata.
    expect(refreshLimit).toBe(loginLimit);
    expect(refreshTtl).toBe(loginTtl);
    expect(refreshLimit).toBe(30);
    expect(refreshTtl).toBe(60_000);
  });

  it('does not apply throttle metadata to logout (unchanged behavior)', () => {
    const logoutLimit = getThrottleMetadata(THROTTLER_LIMIT_DEFAULT, 'logout');
    expect(logoutLimit).toBeUndefined();
  });
});

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type CookieCall = [string, string, Record<string, unknown>];

function buildRes() {
  const cookie = jest.fn<void, CookieCall>();
  const clearCookie = jest.fn();
  const res = { cookie, clearCookie } as unknown as Response;
  return { res, cookie, clearCookie };
}

function buildReq(cookieHeader?: string): Request {
  return { headers: { cookie: cookieHeader } } as unknown as Request;
}

function buildConfigService(nodeEnv: string): ConfigService {
  return {
    get: (key: string) => (key === 'NODE_ENV' ? nodeEnv : undefined),
  } as unknown as ConfigService;
}

function buildAuthService() {
  const register = jest.fn().mockResolvedValue({
    user: { id: 'user-1', email: 'ada@example.com' },
    accessToken: 'access-token-1',
    refreshToken: 'refresh-token-1',
  });
  const login = jest.fn().mockResolvedValue({
    user: { id: 'user-1', email: 'ada@example.com' },
    accessToken: 'access-token-1',
    refreshToken: 'refresh-token-1',
  });
  const refresh = jest.fn().mockResolvedValue({
    accessToken: 'access-token-2',
    refreshToken: 'refresh-token-2',
  });
  const logout = jest.fn().mockResolvedValue(undefined);
  const getRefreshTtlMs = jest.fn().mockReturnValue(REFRESH_TTL_MS);
  const authService = {
    register,
    login,
    refresh,
    logout,
    getRefreshTtlMs,
  } as unknown as AuthService;
  return { authService, register, login, refresh, logout, getRefreshTtlMs };
}

describe('AuthController — refresh-token cookie flow', () => {
  it('login returns a working access token and no refresh token in the JSON body', async () => {
    const { authService } = buildAuthService();
    const controller = new AuthController(
      authService,
      buildConfigService('development'),
    );
    const { res } = buildRes();

    const result = await controller.login(
      { email: 'ada@example.com', password: 'password123' },
      res,
    );

    expect(result).toEqual({
      user: { id: 'user-1', email: 'ada@example.com' },
      accessToken: 'access-token-1',
    });
    expect(result).not.toHaveProperty('refreshToken');
  });

  it('register returns a working access token and no refresh token in the JSON body', async () => {
    const { authService } = buildAuthService();
    const controller = new AuthController(
      authService,
      buildConfigService('development'),
    );
    const { res } = buildRes();

    const result = await controller.register(
      { email: 'ada@example.com', password: 'password123' },
      res,
    );

    expect(result).not.toHaveProperty('refreshToken');
    expect(result).toEqual({
      user: { id: 'user-1', email: 'ada@example.com' },
      accessToken: 'access-token-1',
    });
  });

  it('login sets the refresh token as an HttpOnly cookie, scoped to /api/v1/auth, with the real TTL as maxAge', async () => {
    const { authService } = buildAuthService();
    const controller = new AuthController(
      authService,
      buildConfigService('development'),
    );
    const { res, cookie } = buildRes();

    await controller.login(
      { email: 'ada@example.com', password: 'password123' },
      res,
    );

    expect(cookie).toHaveBeenCalledWith(
      'korva_refresh_token',
      'refresh-token-1',
      expect.objectContaining({
        httpOnly: true,
        path: '/api/v1/auth',
        maxAge: REFRESH_TTL_MS,
      }),
    );
  });

  it('marks the cookie Secure + SameSite=None in production', async () => {
    const { authService } = buildAuthService();
    const controller = new AuthController(
      authService,
      buildConfigService('production'),
    );
    const { res, cookie } = buildRes();

    await controller.login(
      { email: 'ada@example.com', password: 'password123' },
      res,
    );

    const options = cookie.mock.calls[0]![2];
    expect(options.secure).toBe(true);
    expect(options.sameSite).toBe('none');
  });

  it('marks the cookie non-Secure + SameSite=Lax outside production (so it still works over local http)', async () => {
    const { authService } = buildAuthService();
    const controller = new AuthController(
      authService,
      buildConfigService('development'),
    );
    const { res, cookie } = buildRes();

    await controller.login(
      { email: 'ada@example.com', password: 'password123' },
      res,
    );

    const options = cookie.mock.calls[0]![2];
    expect(options.secure).toBe(false);
    expect(options.sameSite).toBe('lax');
  });

  it('refresh reads the refresh token from the cookie (not the body), rotates it, and returns only accessToken', async () => {
    const { authService, refresh } = buildAuthService();
    const controller = new AuthController(
      authService,
      buildConfigService('development'),
    );
    const { res, cookie } = buildRes();
    const req = buildReq(
      'korva_refresh_token=refresh-token-1; other=irrelevant',
    );

    const result = await controller.refresh(req, res);

    expect(refresh).toHaveBeenCalledWith('refresh-token-1');
    expect(result).toEqual({ accessToken: 'access-token-2' });
    expect(result).not.toHaveProperty('refreshToken');
    expect(cookie).toHaveBeenCalledWith(
      'korva_refresh_token',
      'refresh-token-2',
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it('refresh rejects with 401 when no refresh cookie is present, without calling the service', async () => {
    const { authService, refresh } = buildAuthService();
    const controller = new AuthController(
      authService,
      buildConfigService('development'),
    );
    const { res, cookie } = buildRes();
    const req = buildReq(undefined);

    await expect(controller.refresh(req, res)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(refresh).not.toHaveBeenCalled();
    expect(cookie).not.toHaveBeenCalled();
  });

  it('logout revokes the session (by the cookie token) and clears the cookie', async () => {
    const { authService, logout } = buildAuthService();
    const controller = new AuthController(
      authService,
      buildConfigService('development'),
    );
    const { res, clearCookie } = buildRes();
    const req = buildReq('korva_refresh_token=refresh-token-1');

    const result = await controller.logout(req, res);

    expect(logout).toHaveBeenCalledWith('refresh-token-1');
    expect(clearCookie).toHaveBeenCalledWith(
      'korva_refresh_token',
      expect.objectContaining({ httpOnly: true, path: '/api/v1/auth' }),
    );
    expect(result).toEqual({ loggedOut: true });
  });

  it('logout still clears the cookie even with no cookie present, without calling the service', async () => {
    const { authService, logout } = buildAuthService();
    const controller = new AuthController(
      authService,
      buildConfigService('development'),
    );
    const { res, clearCookie } = buildRes();
    const req = buildReq(undefined);

    await controller.logout(req, res);

    expect(logout).not.toHaveBeenCalled();
    expect(clearCookie).toHaveBeenCalled();
  });
});
