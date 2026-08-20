import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Notification,
  NotificationDocument,
} from './schemas/notification.schema';

export interface FindNotificationsOptions {
  page: number;
  limit: number;
  read?: boolean;
}
export interface Paginated<T> {
  data: T[];
  total: number;
}

@Injectable()
export class NotificationsRepository {
  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
  ) {}

  create(data: Partial<Notification>): Promise<NotificationDocument> {
    return this.notificationModel.create(data);
  }

  async findAllForUser(
    organizationId: string,
    userId: string,
    options: FindNotificationsOptions,
  ): Promise<Paginated<NotificationDocument>> {
    const filter: Record<string, unknown> = {
      organizationId: new Types.ObjectId(organizationId),
      userId: new Types.ObjectId(userId),
    };
    if (options.read !== undefined) filter.read = options.read;

    const skip = (options.page - 1) * options.limit;
    const [data, total] = await Promise.all([
      this.notificationModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(options.limit)
        .exec(),
      this.notificationModel.countDocuments(filter).exec(),
    ]);

    return { data, total };
  }

  findById(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<NotificationDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.notificationModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
        userId: new Types.ObjectId(userId),
      })
      .exec();
  }

  markRead(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<NotificationDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.notificationModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
          userId: new Types.ObjectId(userId),
        },
        { read: true, readAt: new Date() },
        { new: true },
      )
      .exec();
  }

  async markAllRead(organizationId: string, userId: string): Promise<number> {
    const result = await this.notificationModel
      .updateMany(
        {
          organizationId: new Types.ObjectId(organizationId),
          userId: new Types.ObjectId(userId),
          read: false,
        },
        { read: true, readAt: new Date() },
      )
      .exec();
    return result.modifiedCount;
  }
}
