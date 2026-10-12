import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CredentialEncryptionService } from '../shared/crypto/credential-encryption.service';
import {
  PaymentMandate,
  PaymentMandateDocument,
} from './schemas/payment-mandate.schema';

export interface ActiveMandate {
  id: string;
  provider: string;
  /** Decrypted — only ever returned by `findActiveDecrypted`, never by a plain read. */
  reference: string;
  payerEmail: string;
}

/**
 * The only place a payment mandate is encrypted or decrypted. Callers deal in plaintext
 * authorizations exactly twice — capturing one and charging with one — and never see the stored
 * form; nothing else in the codebase can read `referenceEncrypted`, which is `select: false`.
 */
@Injectable()
export class PaymentMandatesRepository {
  constructor(
    @InjectModel(PaymentMandate.name)
    private readonly model: Model<PaymentMandateDocument>,
    private readonly encryption: CredentialEncryptionService,
  ) {}

  /**
   * Stores (or replaces) the authorization for one (organization, provider). Upsert rather than
   * insert: a payer who completes a second checkout produces a fresh authorization, and the
   * newest is the one worth keeping — the unique index would reject a second row anyway.
   *
   * Re-activates a previously revoked mandate, since a successful new checkout is exactly the
   * evidence that the payer can be charged again.
   */
  async capture(input: {
    organizationId: string;
    provider: string;
    reference: string;
    payerEmail: string;
  }): Promise<void> {
    await this.model
      .findOneAndUpdate(
        {
          organizationId: new Types.ObjectId(input.organizationId),
          provider: input.provider,
        },
        {
          referenceEncrypted: this.encryption.encrypt(input.reference),
          payerEmail: input.payerEmail,
          active: true,
          revokedReason: null,
        },
        { upsert: true, new: true },
      )
      .exec();
  }

  /**
   * The active mandate for a provider, decrypted. `+referenceEncrypted` is required because the
   * field is `select: false`; a mandate row whose ciphertext cannot be decrypted (a rotated
   * INTEGRATION_CREDENTIALS_KEY) is reported as absent rather than throwing, so a renewal falls
   * back to issuing an invoice instead of failing the whole sweep.
   */
  async findActiveDecrypted(
    organizationId: string,
    provider: string,
  ): Promise<ActiveMandate | null> {
    const doc = await this.model
      .findOne({
        organizationId: new Types.ObjectId(organizationId),
        provider,
        active: true,
      })
      .select('+referenceEncrypted')
      .exec();
    if (!doc) return null;
    try {
      return {
        id: doc.id as string,
        provider: doc.provider,
        reference: this.encryption.decrypt(doc.referenceEncrypted),
        payerEmail: doc.payerEmail,
      };
    } catch {
      return null;
    }
  }

  markUsed(id: string): Promise<PaymentMandateDocument | null> {
    return this.model
      .findByIdAndUpdate(id, { lastUsedAt: new Date() }, { new: true })
      .exec();
  }

  /**
   * Deactivates a mandate the provider has definitively rejected. Guarded on `active: true` so
   * a second failure in the same sweep does not overwrite the first recorded reason.
   */
  revoke(id: string, reason: string): Promise<PaymentMandateDocument | null> {
    return this.model
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), active: true },
        { active: false, revokedReason: reason },
        { new: true },
      )
      .exec();
  }
}
