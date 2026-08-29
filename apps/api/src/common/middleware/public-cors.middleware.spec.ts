import type { Request, Response } from 'express';
import { publicCorsMiddleware } from './public-cors.middleware';

function makeResponse() {
  const headers: Record<string, string> = {};
  return {
    header: jest.fn((key: string, value: string) => {
      headers[key] = value;
    }),
    sendStatus: jest.fn(),
    headers,
  };
}

describe('publicCorsMiddleware', () => {
  it('sets a permissive Access-Control-Allow-Origin for a /api/v1/public/* request', () => {
    const req = {
      path: '/api/v1/public/my-org/leads',
      method: 'POST',
    } as Request;
    const res = makeResponse();
    const next = jest.fn();

    publicCorsMiddleware(req, res as unknown as Response, next);

    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.sendStatus).not.toHaveBeenCalled();
  });

  it('short-circuits an OPTIONS preflight for /public/* with a 204, never calling next()', () => {
    const req = {
      path: '/api/v1/public/my-org/leads',
      method: 'OPTIONS',
    } as Request;
    const res = makeResponse();
    const next = jest.fn();

    publicCorsMiddleware(req, res as unknown as Response, next);

    expect(res.sendStatus).toHaveBeenCalledWith(204);
    expect(next).not.toHaveBeenCalled();
  });

  it('does nothing for a non-/public/* path — no header set, next() called immediately', () => {
    const req = { path: '/api/v1/organizations/me', method: 'GET' } as Request;
    const res = makeResponse();
    const next = jest.fn();

    publicCorsMiddleware(req, res as unknown as Response, next);

    expect(res.header).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('never applies to a path that merely contains "public" outside the dedicated prefix', () => {
    const req = { path: '/api/v1/not-public/leads', method: 'POST' } as Request;
    const res = makeResponse();
    const next = jest.fn();

    publicCorsMiddleware(req, res as unknown as Response, next);

    expect(res.header).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
