import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import type { TaskEntity } from '@korva/types';
import { Task, TaskDocument } from './schemas/task.schema';

export interface FindTasksOptions {
  status?: string;
  assigneeId?: string;
  entity?: TaskEntity;
  entityId?: string;
}

@Injectable()
export class TasksRepository {
  constructor(
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
  ) {}

  create(data: Partial<Task>): Promise<TaskDocument> {
    return this.taskModel.create(data);
  }

  findById(organizationId: string, id: string): Promise<TaskDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.taskModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  findAll(
    organizationId: string,
    options: FindTasksOptions,
  ): Promise<TaskDocument[]> {
    const filter: FilterQuery<Task> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (options.status) filter.status = options.status;
    if (options.assigneeId)
      filter.assigneeId = new Types.ObjectId(options.assigneeId);
    if (options.entity) filter.entity = options.entity;
    if (options.entityId)
      filter.entityId = new Types.ObjectId(options.entityId);
    return this.taskModel.find(filter).sort({ dueAt: 1, createdAt: -1 }).exec();
  }

  async update(
    organizationId: string,
    id: string,
    data: Partial<Task>,
  ): Promise<TaskDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.taskModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
        },
        data,
        { new: true },
      )
      .exec();
  }
}
