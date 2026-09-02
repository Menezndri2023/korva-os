import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import type { Pagination } from '@korva/types';
import type { ListAuditLogsQuery } from '@korva/validation';
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

  /** Paginated, filterable audit trail for a "who did what" read UI — see AuditController. */
  async list(
    organizationId: string,
    query: ListAuditLogsQuery,
  ): Promise<{ data: AuditLogDocument[]; pagination: Pagination }> {
    const filter: FilterQuery<AuditLog> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (query.action) filter.action = query.action;
    if (query.entity) filter.entity = query.entity;

    const [data, total] = await Promise.all([
      this.auditLogModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .exec(),
      this.auditLogModel.countDocuments(filter).exec(),
    ]);

    return {
      data,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }
}
