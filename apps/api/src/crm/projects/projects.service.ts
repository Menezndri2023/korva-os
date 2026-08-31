import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { Pagination } from '@korva/types';
import type { CreateProjectInput, UpdateProjectInput } from '@korva/validation';
import { ProjectsRepository, FindProjectsOptions } from './projects.repository';
import { ProjectDocument } from './schemas/project.schema';
import { ContactsService } from '../contacts/contacts.service';
import {
  TimeEntry,
  TimeEntryDocument,
} from '../../finance/time-entries/schemas/time-entry.schema';
import { Task, TaskDocument } from '../tasks/schemas/task.schema';

export interface ProjectSummaryResult {
  project: ProjectDocument;
  totalHoursLogged: number;
  billableHoursLogged: number;
  totalBilled: number;
  openTaskCount: number;
  totalTaskCount: number;
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly projectsRepository: ProjectsRepository,
    private readonly contactsService: ContactsService,
    // Direct model injection, not TimeEntriesService/TasksService — CrmModule already registers
    // TimeEntry directly (see crm.module.ts's own comment on the Invoice/Order/Cart/Booking
    // registrations for the identical FinanceModule-already-imports-CrmModule circularity this
    // avoids). Task lives in CrmModule itself, so its model is available the same way.
    @InjectModel(TimeEntry.name)
    private readonly timeEntryModel: Model<TimeEntryDocument>,
    @InjectModel(Task.name)
    private readonly taskModel: Model<TaskDocument>,
  ) {}

  async create(
    organizationId: string,
    input: CreateProjectInput,
  ): Promise<ProjectDocument> {
    const contactExists = await this.contactsService.existsById(
      organizationId,
      input.contactId,
    );
    if (!contactExists) {
      throw new NotFoundException({
        code: 'CONTACT_NOT_FOUND',
        message: 'Contact not found',
      });
    }

    return this.projectsRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      contactId: new Types.ObjectId(input.contactId),
      name: input.name,
      description: input.description,
      status: 'active',
      budgetHours: input.budgetHours,
      budgetAmount: input.budgetAmount,
      currency: input.currency,
      startDate: input.startDate ? new Date(input.startDate) : undefined,
      endDate: input.endDate ? new Date(input.endDate) : undefined,
    });
  }

  async getById(organizationId: string, id: string): Promise<ProjectDocument> {
    const project = await this.projectsRepository.findById(organizationId, id);
    if (!project) {
      throw new NotFoundException({
        code: 'PROJECT_NOT_FOUND',
        message: 'Project not found',
      });
    }
    return project;
  }

  /** Read-only existence check, mirroring ContactsService.existsById — used by
   *  TimeEntriesService to validate a caller-supplied projectId without a full getById round
   *  trip or a NotFoundException it would have to translate. */
  async existsById(organizationId: string, id: string): Promise<boolean> {
    return this.projectsRepository.existsById(organizationId, id);
  }

  async list(
    organizationId: string,
    query: FindProjectsOptions,
  ): Promise<{ data: ProjectDocument[]; pagination: Pagination }> {
    const { data, total } = await this.projectsRepository.findAll(
      organizationId,
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

  async update(
    organizationId: string,
    id: string,
    input: UpdateProjectInput,
  ): Promise<ProjectDocument> {
    const updated = await this.projectsRepository.update(organizationId, id, {
      ...input,
      startDate: input.startDate ? new Date(input.startDate) : undefined,
      endDate: input.endDate ? new Date(input.endDate) : undefined,
    });
    if (!updated) {
      throw new NotFoundException({
        code: 'PROJECT_NOT_FOUND',
        message: 'Project not found',
      });
    }
    return updated;
  }

  /** "Billed so far" counts only entries already turned into an invoice (`status: 'invoiced'`)
   *  — it does NOT check whether that invoice has since been paid (the commission-report
   *  endpoint already covers that paid/unpaid distinction elsewhere for payroll purposes; this
   *  summary is an operational "where does this engagement stand" view, not a payroll figure). */
  async getSummary(
    organizationId: string,
    id: string,
  ): Promise<ProjectSummaryResult> {
    const project = await this.getById(organizationId, id);
    const orgObjectId = new Types.ObjectId(organizationId);
    const projectObjectId = new Types.ObjectId(id);

    const [timeEntries, totalTaskCount, openTaskCount] = await Promise.all([
      this.timeEntryModel
        .find({ organizationId: orgObjectId, projectId: projectObjectId })
        .exec(),
      this.taskModel
        .countDocuments({
          organizationId: orgObjectId,
          entity: 'project',
          entityId: projectObjectId,
        })
        .exec(),
      this.taskModel
        .countDocuments({
          organizationId: orgObjectId,
          entity: 'project',
          entityId: projectObjectId,
          status: 'pending',
        })
        .exec(),
    ]);

    let totalHoursLogged = 0;
    let billableHoursLogged = 0;
    let totalBilled = 0;
    for (const entry of timeEntries) {
      const hours = entry.durationMinutes / 60;
      totalHoursLogged += hours;
      if (entry.billable) billableHoursLogged += hours;
      if (entry.status === 'invoiced' && entry.hourlyRate) {
        totalBilled += hours * entry.hourlyRate;
      }
    }

    return {
      project,
      totalHoursLogged: Math.round(totalHoursLogged * 100) / 100,
      billableHoursLogged: Math.round(billableHoursLogged * 100) / 100,
      totalBilled: Math.round(totalBilled * 100) / 100,
      openTaskCount,
      totalTaskCount,
    };
  }
}
