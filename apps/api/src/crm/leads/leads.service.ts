import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type {
  ConvertLeadInput,
  CreateLeadInput,
  ListLeadsQuery,
  UpdateLeadInput,
} from '@korva/validation';
import type { Pagination } from '@korva/types';
import { LeadsRepository } from './leads.repository';
import { LeadDocument } from './schemas/lead.schema';
import { ContactsService } from '../contacts/contacts.service';
import { DealsService } from '../deals/deals.service';
import { DealDocument } from '../deals/schemas/deal.schema';
import { CustomFieldsService } from '../../custom-fields/custom-fields.service';
import { AuditService } from '../../audit/audit.service';
import { EventBusService } from '../../core/events/event-bus.service';

@Injectable()
export class LeadsService {
  constructor(
    private readonly leadsRepository: LeadsRepository,
    private readonly contactsService: ContactsService,
    private readonly dealsService: DealsService,
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
    const customFields = await this.customFieldsService.validateValues(
      organizationId,
      'leads',
      input.customFields,
    );

    const lead = await this.leadsRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      contactId: new Types.ObjectId(input.contactId),
      source: input.source,
      ownerId: input.ownerId ? new Types.ObjectId(input.ownerId) : undefined,
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
    await this.getById(organizationId, id);

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
      ownerId: input.ownerId ? new Types.ObjectId(input.ownerId) : undefined,
      status: input.status,
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

  /**
   * Creates the real Deal for a qualified lead. Guarded beyond the lead's own `status` flag —
   * also checks no Deal already references this lead — so a crash between the two writes below,
   * followed by a naive retry, cannot silently create a second orphan Deal.
   */
  async convertToDeal(
    organizationId: string,
    userId: string | undefined,
    id: string,
    input: ConvertLeadInput,
  ): Promise<{ lead: LeadDocument; deal: DealDocument }> {
    const lead = await this.getById(organizationId, id);
    if (lead.status === 'converted') {
      throw new BadRequestException({
        code: 'LEAD_ALREADY_CONVERTED',
        message: 'This lead has already been converted to a deal',
      });
    }
    const existingDealCount = await this.dealsService.countByLead(
      organizationId,
      id,
    );
    if (existingDealCount > 0) {
      throw new BadRequestException({
        code: 'LEAD_ALREADY_CONVERTED',
        message: 'This lead has already been converted to a deal',
      });
    }

    const deal = await this.dealsService.create(organizationId, userId, {
      contactId: lead.contactId.toString(),
      leadId: id,
      pipelineId: input.pipelineId,
      stageId: input.stageId,
      ownerId: lead.ownerId?.toString(),
      estimatedValue: input.estimatedValue,
      probability: input.probability,
    });

    const updated = await this.leadsRepository.update(organizationId, id, {
      status: 'converted',
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
      metadata: { status: 'converted', dealId: deal.id },
    });
    await this.eventBus.publish(organizationId, 'lead.converted', {
      leadId: id,
      dealId: deal.id as string,
    });

    return { lead: updated, deal };
  }
}
