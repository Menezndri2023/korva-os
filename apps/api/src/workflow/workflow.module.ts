import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Workflow, WorkflowSchema } from './schemas/workflow.schema';
import {
  WorkflowExecution,
  WorkflowExecutionSchema,
} from './schemas/workflow-execution.schema';

import { WorkflowsRepository } from './workflows.repository';
import { WorkflowsService } from './workflows.service';
import { WorkflowsController } from './workflows.controller';
import { WorkflowActionsService } from './workflow-actions.service';
import { WorkflowEngineService } from './workflow-engine.service';
import { EventsProcessor } from './events.processor';

import { CrmModule } from '../crm/crm.module';
import { CommunicationModule } from '../communication/communication.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Workflow.name, schema: WorkflowSchema },
      { name: WorkflowExecution.name, schema: WorkflowExecutionSchema },
    ]),
    CrmModule,
    CommunicationModule,
  ],
  controllers: [WorkflowsController],
  providers: [
    WorkflowsRepository,
    WorkflowsService,
    WorkflowActionsService,
    WorkflowEngineService,
    EventsProcessor,
  ],
})
export class WorkflowModule {}
