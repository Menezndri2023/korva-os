import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AuditAction,
  AuditLog,
  AuditLogDocument,
} from './schemas/audit-log.schema';

interface RecordAuditInput {
  organizationId: string;
  userId?: string;
  action: AuditAction;
  entity: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLogDocument>,
  ) {}

  async record(input: RecordAuditInput): Promise<void> {
    await this.auditLogModel.create({
      organizationId: new Types.ObjectId(input.organizationId),
      userId: input.userId ? new Types.ObjectId(input.userId) : undefined,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      metadata: input.metadata ?? {},
    });
  }

  listRecent(
    organizationId: string,
    limit: number,
  ): Promise<AuditLogDocument[]> {
    return this.auditLogModel
      .find({ organizationId: new Types.ObjectId(organizationId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }
}
