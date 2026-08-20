import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Activity, ActivityDocument } from './schemas/activity.schema';

@Injectable()
export class ActivitiesRepository {
  constructor(
    @InjectModel(Activity.name)
    private readonly activityModel: Model<ActivityDocument>,
  ) {}

  create(data: Partial<Activity>): Promise<ActivityDocument> {
    return this.activityModel.create(data);
  }

  findForEntity(
    organizationId: string,
    entity: 'contact' | 'lead',
    entityId: string,
  ): Promise<ActivityDocument[]> {
    return this.activityModel
      .find({
        organizationId: new Types.ObjectId(organizationId),
        entity,
        entityId: new Types.ObjectId(entityId),
      })
      .sort({ createdAt: -1 })
      .exec();
  }
}
