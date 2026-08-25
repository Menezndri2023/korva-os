import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ApiKey, ApiKeyDocument } from '../schemas/api-key.schema';

@Injectable()
export class ApiKeysRepository {
  constructor(
    @InjectModel(ApiKey.name)
    private readonly apiKeyModel: Model<ApiKeyDocument>,
  ) {}

  create(data: Partial<ApiKey>): Promise<ApiKeyDocument> {
    return this.apiKeyModel.create(data);
  }

  findByOrganization(organizationId: string): Promise<ApiKeyDocument[]> {
    return this.apiKeyModel
      .find({ organizationId: new Types.ObjectId(organizationId) })
      .sort({ createdAt: -1 })
      .exec();
  }

  findByIdForOrganization(
    id: string,
    organizationId: string,
  ): Promise<ApiKeyDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.apiKeyModel
      .findOne({ _id: id, organizationId: new Types.ObjectId(organizationId) })
      .exec();
  }

  /** `keyHash` is `select: false` — callers authenticating a presented key already know the
   *  hash they are looking for and never need it echoed back on the returned document. */
  findByHash(keyHash: string): Promise<ApiKeyDocument | null> {
    return this.apiKeyModel.findOne({ keyHash }).exec();
  }

  async revoke(id: string): Promise<void> {
    await this.apiKeyModel
      .updateOne({ _id: id }, { revokedAt: new Date() })
      .exec();
  }

  /** Best-effort usage tracking — never allowed to turn a valid authentication into a failed
   *  request (see ApiKeyGuard, which fires this without awaiting it). */
  async touchLastUsed(id: string): Promise<void> {
    await this.apiKeyModel
      .updateOne({ _id: id }, { lastUsedAt: new Date() })
      .exec();
  }
}
