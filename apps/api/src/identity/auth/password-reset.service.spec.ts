import { Logger, UnauthorizedException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { ConfigService } from '@nestjs/config';
import { PasswordResetService } from './password-reset.service';
import type { UsersService } from '../users/users.service';
import type { SessionsService } from './sessions.service';
import type { PasswordResetRepository } from './password-reset.repository';
import type {
  EmailProvider,
  EmailSendResult,
} from '../../communication/providers/email-provider.interface';
import type { UserDocument } from '../schemas/user.schema';
import type { PasswordResetTokenDocument } from '../schemas/password-reset-token.schema';

const RESET_TOKEN_HEX_LENGTH = 64; // randomBytes(32).toString('hex')

type SendInput = { to: string; subject: string; body: string };

function fakeUser(id: string, email = 'ada@example.com') {
  return { _id: new Types.ObjectId(id), email } as unknown as UserDocument;
}

function fakeClaim(userId: string) {
  return {
    userId: new Types.ObjectId(userId),
  } as unknown as PasswordResetTokenDocument;
}

function buildConfigService(): ConfigService {
  return {
    get: (key: string) => (key === 'APP_URL' ? 'https://app.korva.test' : undefined),
  } as unknown as ConfigService;
}

interface Deps {
  usersService: jest.Mocked<
    Pick<UsersService, 'findByEmail' | 'hashPassword' | 'updatePasswordHash'>
  >;
  sessionsService: jest.Mocked<Pick<SessionsService, 'revokeAllForUser'>>;
  passwordResetRepository: jest.Mocked<
    Pick<PasswordResetRepository, 'issue' | 'consume'>
  >;
  emailProvider: jest.Mocked<EmailProvider>;
}

function buildService(): {
  service: PasswordResetService;
  send: jest.Mock<Promise<EmailSendResult>, [SendInput]>;
} & Deps {
  const usersService = {
    findByEmail: jest.fn(),
    hashPassword: jest.fn(),
    updatePasswordHash: jest.fn(),
  } as unknown as Deps['usersService'];
  const sessionsService = {
    revokeAllForUser: jest.fn().mockResolvedValue(undefined),
  } as unknown as Deps['sessionsService'];
  const passwordResetRepository = {
    issue: jest.fn().mockResolvedValue(undefined),
    consume: jest.fn(),
  } as unknown as Deps['passwordResetRepository'];
  // Kept as a standalone `const` (rather than asserted on via `emailProvider.send` later) —
  // same pattern already used by workflow-actions.service.spec.ts for the same interface, which
  // avoids a false-positive @typescript-eslint/unbound-method on a method pulled off an
  // interface-typed mock.
  const send = jest
    .fn<Promise<EmailSendResult>, [SendInput]>()
    .mockResolvedValue({ providerReference: 'x', status: 'sent' });
  const emailProvider = { name: 'fake', send } as unknown as Deps['emailProvider'];

  const service = new PasswordResetService(
    usersService as unknown as UsersService,
    sessionsService as unknown as SessionsService,
    passwordResetRepository as unknown as PasswordResetRepository,
    buildConfigService(),
    emailProvider,
  );

  return { service, usersService, sessionsService, passwordResetRepository, emailProvider, send };
}

describe('PasswordResetService.forgotPassword', () => {
  it('returns the generic response and does nothing else when the email has no account', async () => {
    const { service, usersService, passwordResetRepository, send } = buildService();
    usersService.findByEmail.mockResolvedValue(null);

    const result = await service.forgotPassword('nobody@example.com');

    expect(result).toEqual({
      message: 'If an account exists for this email, a reset link has been sent.',
    });
    expect(passwordResetRepository.issue).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('issues a hashed token and emails a reset link for an existing account, returning the same generic response', async () => {
    const userId = new Types.ObjectId().toHexString();
    const { service, usersService, passwordResetRepository, send } = buildService();
    usersService.findByEmail.mockResolvedValue(fakeUser(userId, 'ada@example.com'));

    const result = await service.forgotPassword('ADA@example.com');

    expect(result).toEqual({
      message: 'If an account exists for this email, a reset link has been sent.',
    });

    expect(passwordResetRepository.issue).toHaveBeenCalledTimes(1);
    const [issuedUserId, issuedTokenHash, expiresAt] =
      passwordResetRepository.issue.mock.calls[0]!;
    expect(issuedUserId.toString()).toBe(userId);
    expect(issuedTokenHash).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex digest
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 30 * 60 * 1000);

    expect(send).toHaveBeenCalledTimes(1);
    const sendArgs = send.mock.calls[0]![0];
    expect(sendArgs.to).toBe('ada@example.com');
    expect(sendArgs.subject).not.toMatch(/[0-9a-f]{40,}/); // token never in subject
    expect(sendArgs.body).toContain('https://app.korva.test/reset-password?token=');
  });

  it('never stores or emails the raw token — only its SHA-256 hash reaches the repository, and the link carries a different, unhashed value', async () => {
    const userId = new Types.ObjectId().toHexString();
    const { service, usersService, passwordResetRepository, send } = buildService();
    usersService.findByEmail.mockResolvedValue(fakeUser(userId));

    await service.forgotPassword('ada@example.com');

    const storedHash = passwordResetRepository.issue.mock.calls[0]![1];
    const emailBody = send.mock.calls[0]![0].body;
    const linkTokenMatch = /token=([0-9a-f]+)/.exec(emailBody);
    expect(linkTokenMatch).not.toBeNull();
    const linkToken = linkTokenMatch![1]!;
    expect(linkToken).toHaveLength(RESET_TOKEN_HEX_LENGTH);
    expect(linkToken).not.toBe(storedHash); // the hash in Mongo must differ from the plaintext link token
  });

  it('still returns the generic response and never throws when the email provider fails', async () => {
    const userId = new Types.ObjectId().toHexString();
    const { service, usersService, send } = buildService();
    usersService.findByEmail.mockResolvedValue(fakeUser(userId));
    send.mockRejectedValue(new Error('provider outage'));

    const result = await service.forgotPassword('ada@example.com');

    expect(result).toEqual({
      message: 'If an account exists for this email, a reset link has been sent.',
    });
  });

  it('never logs the raw reset token, on the success path or the email-failure path', async () => {
    const userId = new Types.ObjectId().toHexString();
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    const { service, usersService, send, passwordResetRepository } = buildService();
    usersService.findByEmail.mockResolvedValue(fakeUser(userId));
    send.mockRejectedValue(new Error('provider outage'));

    await service.forgotPassword('ada@example.com');

    const issuedTokenHash = passwordResetRepository.issue.mock.calls[0]![1];
    const sendBody = send.mock.calls[0]![0].body;
    const linkToken = /token=([0-9a-f]+)/.exec(sendBody)![1]!;

    const allLoggedText = [...logSpy.mock.calls, ...errorSpy.mock.calls, ...warnSpy.mock.calls]
      .flat()
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join('\n');
    expect(allLoggedText).not.toContain(linkToken);
    expect(allLoggedText).not.toContain(issuedTokenHash);

    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

describe('PasswordResetService.resetPassword', () => {
  it('rejects an invalid/expired/already-used token with a generic error, without touching the user or sessions', async () => {
    const { service, passwordResetRepository, usersService, sessionsService } =
      buildService();
    passwordResetRepository.consume.mockResolvedValue(null);

    await expect(
      service.resetPassword('bad-token', 'newpassword123'),
    ).rejects.toMatchObject(new UnauthorizedException({
      code: 'INVALID_RESET_TOKEN',
      message: 'This reset link is invalid or has expired',
    }));

    expect(usersService.updatePasswordHash).not.toHaveBeenCalled();
    expect(sessionsService.revokeAllForUser).not.toHaveBeenCalled();
  });

  it('hashes the new password BEFORE consuming the token, then persists the hash and revokes all sessions on success', async () => {
    const userId = new Types.ObjectId().toHexString();
    const { service, passwordResetRepository, usersService, sessionsService } =
      buildService();

    const order: string[] = [];
    usersService.hashPassword.mockImplementation(() => {
      order.push('hash');
      return Promise.resolve('argon2-hash-of-new-password');
    });
    passwordResetRepository.consume.mockImplementation(() => {
      order.push('consume');
      return Promise.resolve(fakeClaim(userId));
    });
    usersService.updatePasswordHash.mockImplementation(() => {
      order.push('persist');
      return Promise.resolve();
    });
    sessionsService.revokeAllForUser.mockImplementation(() => {
      order.push('revoke');
      return Promise.resolve();
    });

    await service.resetPassword('good-token', 'newpassword123');

    expect(order).toEqual(['hash', 'consume', 'persist', 'revoke']);
    expect(usersService.updatePasswordHash).toHaveBeenCalledWith(
      userId,
      'argon2-hash-of-new-password',
    );
    expect(sessionsService.revokeAllForUser).toHaveBeenCalledWith(userId);
  });
});
