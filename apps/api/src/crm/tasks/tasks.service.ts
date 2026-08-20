import { Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { CreateTaskInput, UpdateTaskInput } from '@korva/validation';
import { TasksRepository, FindTasksOptions } from './tasks.repository';
import { TaskDocument } from './schemas/task.schema';

@Injectable()
export class TasksService {
  constructor(private readonly tasksRepository: TasksRepository) {}

  create(
    organizationId: string,
    input: CreateTaskInput,
  ): Promise<TaskDocument> {
    return this.tasksRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      title: input.title,
      description: input.description,
      entity: input.entity,
      entityId: input.entityId ? new Types.ObjectId(input.entityId) : undefined,
      assigneeId: input.assigneeId
        ? new Types.ObjectId(input.assigneeId)
        : undefined,
      dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
    });
  }

  list(
    organizationId: string,
    options: FindTasksOptions,
  ): Promise<TaskDocument[]> {
    return this.tasksRepository.findAll(organizationId, options);
  }

  async update(
    organizationId: string,
    id: string,
    input: UpdateTaskInput,
  ): Promise<TaskDocument> {
    const updated = await this.tasksRepository.update(organizationId, id, {
      title: input.title,
      description: input.description,
      assigneeId: input.assigneeId
        ? new Types.ObjectId(input.assigneeId)
        : undefined,
      dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
      status: input.status,
    });
    if (!updated) {
      throw new NotFoundException({
        code: 'TASK_NOT_FOUND',
        message: 'Task not found',
      });
    }
    return updated;
  }
}
