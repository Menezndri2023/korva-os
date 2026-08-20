import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import type { CreateActivityInput } from '@korva/validation';
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
}
