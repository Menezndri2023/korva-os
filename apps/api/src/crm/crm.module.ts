import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Contact, ContactSchema } from './contacts/schemas/contact.schema';
import { Lead, LeadSchema } from './leads/schemas/lead.schema';
import { Pipeline, PipelineSchema } from './pipelines/schemas/pipeline.schema';
import { Activity, ActivitySchema } from './activities/schemas/activity.schema';
import { Task, TaskSchema } from './tasks/schemas/task.schema';
import { Note, NoteSchema } from './notes/schemas/note.schema';
import { Tag, TagSchema } from './tags/schemas/tag.schema';

import { ContactsRepository } from './contacts/contacts.repository';
import { ContactsService } from './contacts/contacts.service';
import { ContactsController } from './contacts/contacts.controller';

import { LeadsRepository } from './leads/leads.repository';
import { LeadsService } from './leads/leads.service';
import { LeadsController } from './leads/leads.controller';

import { PipelinesRepository } from './pipelines/pipelines.repository';
import { PipelinesService } from './pipelines/pipelines.service';
import { PipelinesController } from './pipelines/pipelines.controller';

import { ActivitiesRepository } from './activities/activities.repository';
import { ActivitiesService } from './activities/activities.service';
import { ActivitiesController } from './activities/activities.controller';

import { TasksRepository } from './tasks/tasks.repository';
import { TasksService } from './tasks/tasks.service';
import { TasksController } from './tasks/tasks.controller';

import { NotesRepository } from './notes/notes.repository';
import { NotesService } from './notes/notes.service';
import { NotesController } from './notes/notes.controller';

import { TagsRepository } from './tags/tags.repository';
import { TagsService } from './tags/tags.service';
import { TagsController } from './tags/tags.controller';

import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Contact.name, schema: ContactSchema },
      { name: Lead.name, schema: LeadSchema },
      { name: Pipeline.name, schema: PipelineSchema },
      { name: Activity.name, schema: ActivitySchema },
      { name: Task.name, schema: TaskSchema },
      { name: Note.name, schema: NoteSchema },
      { name: Tag.name, schema: TagSchema },
    ]),
    CustomFieldsModule,
    AuditModule,
  ],
  controllers: [
    ContactsController,
    LeadsController,
    PipelinesController,
    ActivitiesController,
    TasksController,
    NotesController,
    TagsController,
  ],
  providers: [
    ContactsRepository,
    ContactsService,
    LeadsRepository,
    LeadsService,
    PipelinesRepository,
    PipelinesService,
    ActivitiesRepository,
    ActivitiesService,
    TasksRepository,
    TasksService,
    NotesRepository,
    NotesService,
    TagsRepository,
    TagsService,
  ],
})
export class CrmModule {}
