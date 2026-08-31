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

  /** Most recent activity across every contact/lead in the organization — unlike
   *  findForEntity, not scoped to one entity. Backs the CRM "Activités" feed. */
  async findRecentForOrganization(
    organizationId: string,
    page: number,
    limit: number,
  ): Promise<{ data: ActivityDocument[]; total: number }> {
    const filter = { organizationId: new Types.ObjectId(organizationId) };
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.activityModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.activityModel.countDocuments(filter).exec(),
    ]);
    return { data, total };
  }
}
