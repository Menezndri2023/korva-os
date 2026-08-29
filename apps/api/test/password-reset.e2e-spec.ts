import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import {
  EMAIL_PROVIDER,
  type EmailProvider,
  type EmailSendResult,
} from '../src/communication/providers/email-provider.interface';

interface ApiSuccess<T> {
  success: true;
  data: T;
}
interface ApiError {
  success: false;
  error: { code: string; message: string };
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

interface AuthResponseBody {
  user: { id: string; email: string };
  accessToken: string;
}

/**
 * Captures every email "sent" during the test so the reset link (and therefore the raw,
 * plaintext token) can be recovered without any production-only backdoor — the same technique
 * ai.e2e-spec.ts already uses via `.overrideProvider(AI_PROVIDER)` for ScriptedAIProvider.
 * PasswordResetService only ever receives this via the EMAIL_PROVIDER DI token, exactly as it
 * would receive LogEmailProvider/ResendEmailProvider in a real environment.
 */
class CapturingEmailProvider implements EmailProvider {
  readonly name = 'capturing';
  readonly sent: { to: string; subject: string; body: string }[] = [];

  send(input: {
    to: string;
    subject: string;
    body: string;
  }): Promise<EmailSendResult> {
    this.sent.push(input);
    return Promise.resolve({ providerReference: 'captured', status: 'sent' });
  }

  lastToken(): string {
    const last = this.sent[this.sent.length - 1];
    if (!last) throw new Error('No email captured');
    const match = /token=([0-9a-f]+)/.exec(last.body);
    if (!match)
      throw new Error(`No token found in captured email body: ${last.body}`);
    return match[1]!;
  }
}

describe('Password reset (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;
  let emailProvider: CapturingEmailProvider;

  beforeAll(async () => {
    emailProvider = new CapturingEmailProvider();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EMAIL_PROVIDER)
      .useValue(emailProvider)
      .compile();

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
      .send({ email, password: 'oldpassword123' })
      .expect(201);
    return asSuccess<AuthResponseBody>(res.body);
  }

  async function countActiveSessions(userId: string): Promise<number> {
    return connection
      .collection('sessions')
      .countDocuments({ userId: new Types.ObjectId(userId), revokedAt: null });
  }

  async function forgotPassword(email: string) {
    const res = await request(server)
      .post('/api/v1/auth/forgot-password')
      .send({ email })
      .expect(201);
    return asSuccess<{ message: string }>(res.body);
  }

  it('full flow: register -> forgot-password -> reset-password -> old password rejected, new password works, sessions revoked, token single-use', async () => {
    const email = 'reset-flow@korva.test';
    const { user } = await register(email);

    expect(await countActiveSessions(user.id)).toBe(1);

    const forgotResult = await forgotPassword(email);
    expect(forgotResult.message).toMatch(/reset link has been sent/i);

    const token = emailProvider.lastToken();

    // Reset with the captured token.
    const resetRes = await request(server)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'newpassword456' })
      .expect(201);
    expect(asSuccess<{ success: boolean }>(resetRes.body)).toEqual({
      success: true,
    });

    // All sessions predating the reset must be revoked.
    expect(await countActiveSessions(user.id)).toBe(0);

    // Old password no longer works.
    const oldLoginRes = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: 'oldpassword123' })
      .expect(401);
    expect(asError(oldLoginRes.body).code).toBe('INVALID_CREDENTIALS');

    // New password works, and establishes a fresh session.
    const newLoginRes = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: 'newpassword456' })
      .expect(201);
    expect(asSuccess<AuthResponseBody>(newLoginRes.body).user.id).toBe(user.id);
    expect(await countActiveSessions(user.id)).toBe(1);

    // The same token cannot be used again (single-use).
    const reuseRes = await request(server)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'yetanotherpassword789' })
      .expect(401);
    expect(asError(reuseRes.body).code).toBe('INVALID_RESET_TOKEN');
  });

  it('rejects an expired token with the same generic error as an invalid one', async () => {
    const email = 'reset-expired@korva.test';
    await register(email);
    await forgotPassword(email);
    const token = emailProvider.lastToken();

    // Force the just-issued token into the past — the only way to exercise real expiration
    // deterministically in a single test run, without waiting out the real 30-minute TTL.
    // Targeted by tokenHash (computed the same way PasswordResetService does) rather than by
    // an unqualified filter, since the collection may hold rows for other users from earlier
    // tests in this file (each user has at most one row, per the unique index on userId).
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await connection
      .collection('password_reset_tokens')
      .updateOne(
        { tokenHash },
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      );

    const res = await request(server)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'irrelevant123' })
      .expect(401);
    expect(asError(res.body).code).toBe('INVALID_RESET_TOKEN');
  });

  it('rejects an unknown token with the same generic error, and never reveals the token in the response', async () => {
    const res = await request(server)
      .post('/api/v1/auth/reset-password')
      .send({ token: 'a'.repeat(64), password: 'irrelevant123' })
      .expect(401);
    const error = asError(res.body);
    expect(error.code).toBe('INVALID_RESET_TOKEN');
    expect(JSON.stringify(res.body)).not.toContain('a'.repeat(64));
  });

  it('anti-enumeration: an existing and a non-existent email produce the identical response shape/status', async () => {
    const email = 'reset-enum@korva.test';
    await register(email);

    const existingRes = await request(server)
      .post('/api/v1/auth/forgot-password')
      .send({ email })
      .expect(201);
    const missingRes = await request(server)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'definitely-not-registered@korva.test' })
      .expect(201);

    expect(existingRes.status).toBe(missingRes.status);
    expect(existingRes.body).toEqual(missingRes.body);
  });

  it('a new forgot-password request invalidates the previously issued token for the same user', async () => {
    const email = 'reset-superseded@korva.test';
    await register(email);

    await forgotPassword(email);
    const firstToken = emailProvider.lastToken();

    await forgotPassword(email);
    const secondToken = emailProvider.lastToken();
    expect(secondToken).not.toBe(firstToken);

    const staleRes = await request(server)
      .post('/api/v1/auth/reset-password')
      .send({ token: firstToken, password: 'irrelevant123' })
      .expect(401);
    expect(asError(staleRes.body).code).toBe('INVALID_RESET_TOKEN');

    await request(server)
      .post('/api/v1/auth/reset-password')
      .send({ token: secondToken, password: 'freshpassword123' })
      .expect(201);
  });
});
