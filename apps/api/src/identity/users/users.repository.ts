import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../schemas/user.schema';

@Injectable()
export class UsersRepository {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  create(data: Partial<User>): Promise<UserDocument> {
    return this.userModel.create(data);
  }

  /**
   * `withPasswordHash` also pulls in the (also `select: false`) TOTP secret field — every
   * caller that legitimately needs the password hash (i.e. the login path) is exactly the same
   * caller that needs to know whether a TOTP code must be checked, so a single flag covers both
   * rather than adding a second one every login-adjacent call site would have to remember to set.
   */
  findByEmail(
    email: string,
    withPasswordHash = false,
  ): Promise<UserDocument | null> {
    const query = this.userModel.findOne({ email: email.toLowerCase() });
    if (withPasswordHash) query.select('+passwordHash +totpSecretEncrypted');
    return query.exec();
  }

  findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  findByIdWithTotpSecret(id: string): Promise<UserDocument | null> {
    return this.userModel
      .findById(id)
      .select('+totpSecretEncrypted +totpPendingSecretEncrypted')
      .exec();
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.userModel.updateOne({ _id: id }, { passwordHash }).exec();
  }

  async markEmailVerified(id: string): Promise<void> {
    await this.userModel
      .updateOne({ _id: id }, { emailVerifiedAt: new Date() })
      .exec();
  }

  /** Stores the not-yet-confirmed enrollment secret — never arms 2FA by itself. */
  async setPendingTotpSecret(
    id: string,
    encryptedSecret: string,
  ): Promise<void> {
    await this.userModel
      .updateOne({ _id: id }, { totpPendingSecretEncrypted: encryptedSecret })
      .exec();
  }

  /** Confirms enrollment: promotes the pending secret to the active one and arms 2FA. */
  async confirmTotpEnrollment(
    id: string,
    encryptedSecret: string,
  ): Promise<void> {
    await this.userModel
      .updateOne(
        { _id: id },
        {
          totpSecretEncrypted: encryptedSecret,
          totpPendingSecretEncrypted: null,
          totpEnabled: true,
        },
      )
      .exec();
  }

  async disableTotp(id: string): Promise<void> {
    await this.userModel
      .updateOne(
        { _id: id },
        {
          totpEnabled: false,
          totpSecretEncrypted: null,
          totpPendingSecretEncrypted: null,
        },
      )
      .exec();
  }

  /** Atomic increment so two concurrent failed logins for the same account can never lose an
   *  attempt count — returns the post-increment count for the caller to compare to the lockout
   *  threshold. */
  async incrementFailedAttempts(id: string): Promise<number> {
    const user = await this.userModel
      .findByIdAndUpdate(
        id,
        { $inc: { failedLoginAttempts: 1 } },
        { new: true },
      )
      .exec();
    return user?.failedLoginAttempts ?? 0;
  }

  async lockAccount(id: string, lockedUntil: Date): Promise<void> {
    await this.userModel
      .updateOne({ _id: id }, { lockedUntil, failedLoginAttempts: 0 })
      .exec();
  }

  async resetFailedAttempts(id: string): Promise<void> {
    await this.userModel
      .updateOne({ _id: id }, { failedLoginAttempts: 0, lockedUntil: null })
      .exec();
  }
}
