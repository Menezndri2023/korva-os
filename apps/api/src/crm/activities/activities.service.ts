import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import type { CreateActivityInput } from '@korva/validation';
import type { Pagination } from '@korva/types';
import { ActivitiesRepository } from './activities.repository';
import { ActivityDocument } from './schemas/activity.schema';

@Injectable()
export class ActivitiesService {
  constructor(private readonly activitiesRepository: ActivitiesRepository) {}

  create(
    organizationId: string,
    userId: string,
    input: CreateActivityInput,
  ): Promise<ActivityDocument> {
    return this.activitiesRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      entity: input.entity,
      entityId: new Types.ObjectId(input.entityId),
      type: input.type,
      content: input.content,
      authorId: new Types.ObjectId(userId),
    });
  }

  listForEntity(
    organizationId: string,
    entity: 'contact' | 'lead',
    entityId: string,
  ): Promise<ActivityDocument[]> {
    return this.activitiesRepository.findForEntity(
      organizationId,
      entity,
      entityId,
    );
  }

  async listRecent(
    organizationId: string,
    page: number,
    limit: number,
  ): Promise<{ data: ActivityDocument[]; pagination: Pagination }> {
    const { data, total } =
      await this.activitiesRepository.findRecentForOrganization(
        organizationId,
        page,
        limit,
      );
    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }
}
