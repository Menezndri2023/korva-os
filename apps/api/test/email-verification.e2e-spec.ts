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
  user: { id: string; email: string; emailVerifiedAt: string | null };
  accessToken: string;
}

/**
 * Captures every email "sent" during the test so the verification link (and therefore the raw,
 * plaintext token) can be recovered without any production-only backdoor — the same technique
 * password-reset.e2e-spec.ts already uses via `.overrideProvider(EMAIL_PROVIDER)`.
 * EmailVerificationService only ever receives this via the EMAIL_PROVIDER DI token, exactly as
 * it would receive LogEmailProvider/ResendEmailProvider in a real environment.
 */
class CapturingEmailProvider implements EmailProvider {
  readonly name = 'capturing';
  readonly sent: { to: string; subject: string; body: string }[] = [];

  send(input: { to: string; subject: string; body: string }): Promise<EmailSendResult> {
    this.sent.push(input);
    return Promise.resolve({ providerReference: 'captured', status: 'sent' });
  }

  lastToken(): string {
    const last = this.sent[this.sent.length - 1];
    if (!last) throw new Error('No email captured');
    const match = /token=([0-9a-f]+)/.exec(last.body);
    if (!match) throw new Error(`No token found in captured email body: ${last.body}`);
    return match[1]!;
  }
}

describe('Email verification (e2e)', () => {
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
      .send({ email, password: 'password123' })
      .expect(201);
    return asSuccess<AuthResponseBody>(res.body);
  }

  async function findUserEmailVerifiedAt(userId: string): Promise<Date | null> {
    const doc = await connection
      .collection('users')
      .findOne<{ emailVerifiedAt: Date | null }>({
        _id: new Types.ObjectId(userId),
      });
    return doc?.emailVerifiedAt ?? null;
  }

  it('TEST 1 — register() creates the user and triggers a verification email carrying an extractable token', async () => {
    const email = 'verify-flow-1@korva.test';
    const { user } = await register(email);

    expect(user.emailVerifiedAt).toBeNull();

    const sent = emailProvider.sent[emailProvider.sent.length - 1]!;
    expect(sent.to).toBe(email);
    expect(sent.body).toMatch(/verify-email\?token=/);

    // The raw token must never appear anywhere in a register HTTP response body.
    const token = emailProvider.lastToken();
    const secondRegisterRes = await register('verify-flow-1b@korva.test');
    expect(JSON.stringify(secondRegisterRes)).not.toContain(token);
  });

  it('TEST 2 — a valid token marks emailVerifiedAt and is consumed', async () => {
    const email = 'verify-flow-2@korva.test';
    const { user } = await register(email);
    const token = emailProvider.lastToken();

    const res = await request(server)
      .post('/api/v1/auth/verify-email')
      .send({ token })
      .expect(201);
    expect(asSuccess<{ success: boolean }>(res.body)).toEqual({ success: true });

    expect(await findUserEmailVerifiedAt(user.id)).not.toBeNull();
  });

  it('TEST 3 — an invalid/unknown token is rejected without touching any user', async () => {
    const res = await request(server)
      .post('/api/v1/auth/verify-email')
      .send({ token: 'not-a-real-token' })
      .expect(401);
    expect(asError(res.body).code).toBe('INVALID_VERIFICATION_TOKEN');
  });

  it('TEST 4 — an expired token is rejected with the same generic error', async () => {
    const email = 'verify-flow-4@korva.test';
    await register(email);
    const token = emailProvider.lastToken();
    const tokenHash = createHash('sha256').update(token).digest('hex');

    // Only this token's own row is force-expired — never a blanket update — so this test can
    // never affect another test's still-valid token in the same run.
    await connection
      .collection('email_verification_tokens')
      .updateOne(
        { tokenHash },
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      );

    const res = await request(server)
      .post('/api/v1/auth/verify-email')
      .send({ token })
      .expect(401);
    expect(asError(res.body).code).toBe('INVALID_VERIFICATION_TOKEN');
  });

  it('TEST 5 — a token already used once is rejected on the second attempt with the same generic error', async () => {
    const email = 'verify-flow-5@korva.test';
    await register(email);
    const token = emailProvider.lastToken();

    await request(server)
      .post('/api/v1/auth/verify-email')
      .send({ token })
      .expect(201);

    const secondRes = await request(server)
      .post('/api/v1/auth/verify-email')
      .send({ token })
      .expect(401);
    expect(asError(secondRes.body).code).toBe('INVALID_VERIFICATION_TOKEN');
  });

  it('TEST 6 — register() contract is unchanged: user + accessToken present, emailVerifiedAt initially null', async () => {
    const { user, accessToken } = await register('verify-flow-6@korva.test');
    expect(user.id).toBeDefined();
    expect(accessToken).toBeDefined();
    expect(user.emailVerifiedAt).toBeNull();
  });

  it('TEST 7 — a not-yet-verified user can still log in (verification is informative, not a login gate)', async () => {
    const email = 'verify-flow-7@korva.test';
    const password = 'password123';
    const { user } = await register(email);
    expect(user.emailVerifiedAt).toBeNull();

    const loginRes = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(201);
    const loginBody = asSuccess<AuthResponseBody>(loginRes.body);
    expect(loginBody.accessToken).toBeDefined();
  });
});
