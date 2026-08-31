import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  createTaskSchema,
  updateTaskSchema,
  type CreateTaskInput,
  type UpdateTaskInput,
} from '@korva/validation';
import type { TenantContext, TaskEntity } from '@korva/types';
import { TasksService } from './tasks.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';

@ApiTags('tasks')
@RequireModule('crm')
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @RequirePermissions('contacts.read')
  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query('status') status?: string,
    @Query('assigneeId') assigneeId?: string,
    @Query('entity') entity?: TaskEntity,
    @Query('entityId') entityId?: string,
  ) {
    return this.tasksService.list(tenant.organizationId, {
      status,
      assigneeId,
      entity,
      entityId,
    });
  }

  @RequirePermissions('contacts.update')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createTaskSchema)) body: CreateTaskInput,
  ) {
    return this.tasksService.create(tenant.organizationId, body);
  }

  @RequirePermissions('contacts.update')
  @Patch(':id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTaskSchema)) body: UpdateTaskInput,
  ) {
    return this.tasksService.update(tenant.organizationId, id, body);
  }
}
