import { Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type {
  CreateLeadInput,
  ListLeadsQuery,
  UpdateLeadInput,
} from '@korva/validation';
import type { Pagination } from '@korva/types';
import { LeadsRepository } from './leads.repository';
import { LeadDocument } from './schemas/lead.schema';
import { ContactsService } from '../contacts/contacts.service';
import { PipelinesService } from '../pipelines/pipelines.service';
import { CustomFieldsService } from '../../custom-fields/custom-fields.service';
import { AuditService } from '../../audit/audit.service';
import { EventBusService } from '../../core/events/event-bus.service';

@Injectable()
export class LeadsService {
  constructor(
    private readonly leadsRepository: LeadsRepository,
    private readonly contactsService: ContactsService,
    private readonly pipelinesService: PipelinesService,
    private readonly customFieldsService: CustomFieldsService,
    private readonly auditService: AuditService,
    private readonly eventBus: EventBusService,
  ) {}

  async create(
    organizationId: string,
    userId: string | undefined,
    input: CreateLeadInput,
  ): Promise<LeadDocument> {
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
    await this.pipelinesService.assertStageExists(
      organizationId,
      input.pipelineId,
      input.stageId,
    );
    const customFields = await this.customFieldsService.validateValues(
      organizationId,
      'leads',
      input.customFields,
    );

    const lead = await this.leadsRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      contactId: new Types.ObjectId(input.contactId),
      source: input.source,
      pipelineId: new Types.ObjectId(input.pipelineId),
      stageId: new Types.ObjectId(input.stageId),
      ownerId: input.ownerId ? new Types.ObjectId(input.ownerId) : undefined,
      estimatedValue: input.estimatedValue,
      probability: input.probability,
      customFields,
    });

    await this.auditService.record({
      organizationId,
      userId,
      action: 'CREATE',
      entity: 'lead',
      entityId: lead.id as string,
    });

    await this.eventBus.publish(organizationId, 'lead.created', {
      leadId: lead.id as string,
      contactId: input.contactId,
      estimatedValue: input.estimatedValue,
    });

    return lead;
  }

  async getById(organizationId: string, id: string): Promise<LeadDocument> {
    const lead = await this.leadsRepository.findById(organizationId, id);
    if (!lead) {
      throw new NotFoundException({
        code: 'LEAD_NOT_FOUND',
        message: 'Lead not found',
      });
    }
    return lead;
  }

  async list(
    organizationId: string,
    query: ListLeadsQuery,
  ): Promise<{ data: LeadDocument[]; pagination: Pagination }> {
    const { data, total } = await this.leadsRepository.findAll(
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
    userId: string,
    id: string,
    input: UpdateLeadInput,
  ): Promise<LeadDocument> {
    const lead = await this.getById(organizationId, id);

    if (input.stageId) {
      await this.pipelinesService.assertStageExists(
        organizationId,
        lead.pipelineId.toString(),
        input.stageId,
      );
    }

    const customFields =
      input.customFields !== undefined
        ? await this.customFieldsService.validateValues(
            organizationId,
            'leads',
            input.customFields,
          )
        : undefined;

    const updated = await this.leadsRepository.update(organizationId, id, {
      source: input.source,
      stageId: input.stageId ? new Types.ObjectId(input.stageId) : undefined,
      ownerId: input.ownerId ? new Types.ObjectId(input.ownerId) : undefined,
      status: input.status,
      estimatedValue: input.estimatedValue,
      probability: input.probability,
      ...(customFields !== undefined ? { customFields } : {}),
    });
    if (!updated) {
      throw new NotFoundException({
        code: 'LEAD_NOT_FOUND',
        message: 'Lead not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'lead',
      entityId: id,
      metadata: input.status ? { status: input.status } : undefined,
    });

    return updated;
  }
}
