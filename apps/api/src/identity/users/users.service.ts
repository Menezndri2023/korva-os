import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { UsersRepository } from './users.repository';
import { UserDocument } from '../schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async create(
    email: string,
    password: string,
    firstName?: string,
    lastName?: string,
  ): Promise<UserDocument> {
    const passwordHash = await argon2.hash(password);
    return this.usersRepository.create({
      email,
      passwordHash,
      firstName,
      lastName,
    });
  }

  findByEmail(
    email: string,
    withPasswordHash = false,
  ): Promise<UserDocument | null> {
    return this.usersRepository.findByEmail(email, withPasswordHash);
  }

  findById(id: string): Promise<UserDocument | null> {
    return this.usersRepository.findById(id);
  }

  verifyPassword(passwordHash: string, plain: string): Promise<boolean> {
    return argon2.verify(passwordHash, plain);
  }

  /**
   * Same call as `create()`'s own hashing step (argon2, default params), exposed separately so
   * a caller can compute the hash — the only step that can meaningfully fail before anything is
   * persisted — ahead of a later, unrelated write (see PasswordResetService.resetPassword,
   * which must know the new hash is ready *before* irreversibly consuming the reset token).
   */
  hashPassword(password: string): Promise<string> {
    return argon2.hash(password);
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.usersRepository.updatePasswordHash(id, passwordHash);
  }

  findByIdWithTotpSecret(id: string): Promise<UserDocument | null> {
    return this.usersRepository.findByIdWithTotpSecret(id);
  }

  setPendingTotpSecret(id: string, encryptedSecret: string): Promise<void> {
    return this.usersRepository.setPendingTotpSecret(id, encryptedSecret);
  }

  confirmTotpEnrollment(id: string, encryptedSecret: string): Promise<void> {
    return this.usersRepository.confirmTotpEnrollment(id, encryptedSecret);
  }

  disableTotp(id: string): Promise<void> {
    return this.usersRepository.disableTotp(id);
  }

  incrementFailedAttempts(id: string): Promise<number> {
    return this.usersRepository.incrementFailedAttempts(id);
  }

  lockAccount(id: string, lockedUntil: Date): Promise<void> {
    return this.usersRepository.lockAccount(id, lockedUntil);
  }

  resetFailedAttempts(id: string): Promise<void> {
    return this.usersRepository.resetFailedAttempts(id);
  }
}
