import { Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { Pagination } from '@korva/types';
import { NotificationsRepository } from './notifications.repository';
import { NotificationDocument } from './schemas/notification.schema';
import { MembershipsService } from '../../identity/memberships/memberships.service';

export interface CreateNotificationInput {
  organizationId: string;
  userId: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly notificationsRepository: NotificationsRepository,
    private readonly membershipsService: MembershipsService,
  ) {}

  create(input: CreateNotificationInput): Promise<NotificationDocument> {
    return this.notificationsRepository.create({
      organizationId: new Types.ObjectId(input.organizationId),
      userId: new Types.ObjectId(input.userId),
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link,
    });
  }

  /** Broadcasts one Notification to every active member of the organization — used by the Workflow Engine's `internal_notification` action. */
  async notifyOrganization(
    organizationId: string,
    input: { type: string; title: string; body?: string; link?: string },
  ): Promise<void> {
    const userIds =
      await this.membershipsService.listActiveUserIdsForOrganization(
        organizationId,
      );
    await Promise.all(
      userIds.map((userId) =>
        this.create({
          organizationId,
          userId,
          type: input.type,
          title: input.title,
          body: input.body,
          link: input.link,
        }),
      ),
    );
  }

  async list(
    organizationId: string,
    userId: string,
    query: { page: number; limit: number; read?: boolean },
  ): Promise<{ data: NotificationDocument[]; pagination: Pagination }> {
    const { data, total } = await this.notificationsRepository.findAllForUser(
      organizationId,
      userId,
      query,
    );
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

  async markRead(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<NotificationDocument> {
    const updated = await this.notificationsRepository.markRead(
      organizationId,
      userId,
      id,
    );
    if (!updated) {
      throw new NotFoundException({
        code: 'NOTIFICATION_NOT_FOUND',
        message: 'Notification not found',
      });
    }
    return updated;
  }

  markAllRead(organizationId: string, userId: string): Promise<number> {
    return this.notificationsRepository.markAllRead(organizationId, userId);
  }
}
