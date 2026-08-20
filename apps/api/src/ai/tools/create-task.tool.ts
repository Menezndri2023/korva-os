import { createTaskSchema, type CreateTaskInput } from '@korva/validation';
import { Injectable } from '@nestjs/common';
import type { AiTool } from './tool.interface';
import { TasksService } from '../../crm/tasks/tasks.service';

@Injectable()
export class CreateTaskTool implements AiTool<CreateTaskInput> {
  readonly definition = {
    name: 'create_task',
    description:
      'Crée une tâche de suivi, éventuellement rattachée à un contact ou un prospect.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        entity: { type: 'string', enum: ['contact', 'lead'] },
        entityId: { type: 'string' },
      },
      required: ['title'],
    },
  };
  readonly requiredPermission = 'contacts.update' as const;
  readonly auditEntity = 'task';

  constructor(private readonly tasksService: TasksService) {}

  parseInput(raw: unknown) {
    return createTaskSchema.parse(raw);
  }

  async execute(
    organizationId: string,
    _userId: string,
    input: CreateTaskInput,
  ) {
    const task = await this.tasksService.create(organizationId, input);
    return { id: task.id as string, title: task.title };
  }
}
