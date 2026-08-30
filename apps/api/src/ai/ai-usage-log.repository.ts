import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AiAgent, AiUsageSummary } from '@korva/types';
import { AiUsageLog, AiUsageLogDocument } from './schemas/ai-usage-log.schema';

interface RecordUsageInput {
  organizationId: string;
  conversationId: string;
  agent: AiAgent;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

function periodRange(period: string): { start: Date; end: Date } {
  const start = new Date(`${period}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
}

@Injectable()
export class AiUsageLogRepository {
  constructor(
    @InjectModel(AiUsageLog.name)
    private readonly aiUsageLogModel: Model<AiUsageLogDocument>,
  ) {}

  async record(input: RecordUsageInput): Promise<void> {
    await this.aiUsageLogModel.create({
      organizationId: new Types.ObjectId(input.organizationId),
      conversationId: new Types.ObjectId(input.conversationId),
      agent: input.agent,
      model: input.model,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      costUsd: input.costUsd,
    });
  }

  async getMonthlySummary(
    organizationId: string,
    period: string,
  ): Promise<AiUsageSummary> {
    const { start, end } = periodRange(period);
    const rows = await this.aiUsageLogModel
      .aggregate<{
        inputTokens: number;
        outputTokens: number;
        costUsd: number;
        unpricedCalls: number;
      }>([
        {
          $match: {
            organizationId: new Types.ObjectId(organizationId),
            createdAt: { $gte: start, $lt: end },
          },
        },
        {
          $group: {
            _id: null,
            inputTokens: { $sum: '$inputTokens' },
            outputTokens: { $sum: '$outputTokens' },
            costUsd: { $sum: { $ifNull: ['$costUsd', 0] } },
            unpricedCalls: {
              $sum: { $cond: [{ $eq: ['$costUsd', null] }, 1, 0] },
            },
          },
        },
      ])
      .exec();

    const totals = rows[0];
    return {
      period,
      inputTokens: totals?.inputTokens ?? 0,
      outputTokens: totals?.outputTokens ?? 0,
      costUsd: totals?.costUsd ?? 0,
      unpricedCalls: totals?.unpricedCalls ?? 0,
    };
  }
}
