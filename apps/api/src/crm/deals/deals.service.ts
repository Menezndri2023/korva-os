import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type {
  CreateDealInput,
  ListDealsQuery,
  LoseDealInput,
  MoveDealStageInput,
  UpdateDealInput,
} from '@korva/validation';
import type { Pagination } from '@korva/types';
import { DealsRepository } from './deals.repository';
import { DealDocument } from './schemas/deal.schema';
import { ContactsService } from '../contacts/contacts.service';
import { PipelinesService } from '../pipelines/pipelines.service';
import { CustomFieldsService } from '../../custom-fields/custom-fields.service';
import { AuditService } from '../../audit/audit.service';
import { EventBusService } from '../../core/events/event-bus.service';

export interface CreateDealForLeadInput {
  contactId: string;
  leadId?: string;
  pipelineId: string;
  stageId: string;
  ownerId?: string;
  estimatedValue?: number;
  probability?: number;
  customFields?: Record<string, unknown>;
}

@Injectable()
export class DealsService {
  constructor(
    private readonly dealsRepository: DealsRepository,
    private readonly contactsService: ContactsService,
    private readonly pipelinesService: PipelinesService,
    private readonly customFieldsService: CustomFieldsService,
    private readonly auditService: AuditService,
    private readonly eventBus: EventBusService,
  ) {}

  async create(
    organizationId: string,
    userId: string | undefined,
    input: CreateDealInput | CreateDealForLeadInput,
  ): Promise<DealDocument> {
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
      'deals',
      input.customFields,
    );

    const leadId = 'leadId' in input ? input.leadId : undefined;

    const deal = await this.dealsRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      contactId: new Types.ObjectId(input.contactId),
      leadId: leadId ? new Types.ObjectId(leadId) : undefined,
      pipelineId: new Types.ObjectId(input.pipelineId),
      stageId: new Types.ObjectId(input.stageId),
      ownerId: input.ownerId ? new Types.ObjectId(input.ownerId) : undefined,
      status: 'open',
      estimatedValue: input.estimatedValue,
      probability: input.probability,
      customFields,
    });

    await this.auditService.record({
      organizationId,
      userId,
      action: 'CREATE',
      entity: 'deal',
      entityId: deal.id as string,
    });

    await this.eventBus.publish(organizationId, 'deal.created', {
      dealId: deal.id as string,
      contactId: input.contactId,
      estimatedValue: input.estimatedValue,
    });

    return deal;
  }

  async getById(organizationId: string, id: string): Promise<DealDocument> {
    const deal = await this.dealsRepository.findById(organizationId, id);
    if (!deal) {
      throw new NotFoundException({
        code: 'DEAL_NOT_FOUND',
        message: 'Deal not found',
      });
    }
    return deal;
  }

  async countByLead(organizationId: string, leadId: string): Promise<number> {
    const { total } = await this.dealsRepository.findAll(organizationId, {
      page: 1,
      limit: 1,
      leadId,
    });
    return total;
  }

  async list(
    organizationId: string,
    query: ListDealsQuery,
  ): Promise<{ data: DealDocument[]; pagination: Pagination }> {
    const { data, total } = await this.dealsRepository.findAll(
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
    input: UpdateDealInput,
  ): Promise<DealDocument> {
    await this.getById(organizationId, id);

    const customFields =
      input.customFields !== undefined
        ? await this.customFieldsService.validateValues(
            organizationId,
            'deals',
            input.customFields,
          )
        : undefined;

    const updated = await this.dealsRepository.update(organizationId, id, {
      ownerId: input.ownerId ? new Types.ObjectId(input.ownerId) : undefined,
      estimatedValue: input.estimatedValue,
      probability: input.probability,
      ...(customFields !== undefined ? { customFields } : {}),
    });
    if (!updated) {
      throw new NotFoundException({
        code: 'DEAL_NOT_FOUND',
        message: 'Deal not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'deal',
      entityId: id,
    });

    return updated;
  }

  async moveStage(
    organizationId: string,
    userId: string,
    id: string,
    input: MoveDealStageInput,
  ): Promise<DealDocument> {
    const deal = await this.getById(organizationId, id);
    if (deal.status !== 'open') {
      throw new BadRequestException({
        code: 'DEAL_NOT_OPEN',
        message: 'Only an open deal can move stage',
      });
    }
    await this.pipelinesService.assertStageExists(
      organizationId,
      deal.pipelineId.toString(),
      input.stageId,
    );

    const updated = await this.dealsRepository.update(organizationId, id, {
      stageId: new Types.ObjectId(input.stageId),
    });
    if (!updated) {
      throw new NotFoundException({
        code: 'DEAL_NOT_FOUND',
        message: 'Deal not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'deal',
      entityId: id,
      metadata: { stageId: input.stageId },
    });
    await this.eventBus.publish(organizationId, 'deal.stage_changed', {
      dealId: id,
      stageId: input.stageId,
    });

    return updated;
  }

  async win(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<DealDocument> {
    const deal = await this.getById(organizationId, id);
    if (deal.status === 'won') {
      throw new BadRequestException({
        code: 'DEAL_ALREADY_WON',
        message: 'This deal is already won',
      });
    }
    if (deal.status === 'lost') {
      throw new BadRequestException({
        code: 'DEAL_NOT_WINNABLE',
        message: 'A lost deal must be reopened before it can be won',
      });
    }

    const updated = await this.dealsRepository.update(organizationId, id, {
      status: 'won',
      closedAt: new Date(),
    });
    if (!updated) {
      throw new NotFoundException({
        code: 'DEAL_NOT_FOUND',
        message: 'Deal not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'deal',
      entityId: id,
      metadata: { status: 'won' },
    });
    await this.eventBus.publish(organizationId, 'deal.won', { dealId: id });

    return updated;
  }

  async lose(
    organizationId: string,
    userId: string,
    id: string,
    input: LoseDealInput,
  ): Promise<DealDocument> {
    const deal = await this.getById(organizationId, id);
    if (deal.status === 'lost') {
      throw new BadRequestException({
        code: 'DEAL_ALREADY_LOST',
        message: 'This deal is already lost',
      });
    }
    if (deal.status === 'won') {
      throw new BadRequestException({
        code: 'DEAL_NOT_LOSABLE',
        message: 'A won deal must be reopened before it can be lost',
      });
    }

    const updated = await this.dealsRepository.update(organizationId, id, {
      status: 'lost',
      closedAt: new Date(),
      lossReason: input.lossReason,
    });
    if (!updated) {
      throw new NotFoundException({
        code: 'DEAL_NOT_FOUND',
        message: 'Deal not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'deal',
      entityId: id,
      metadata: { status: 'lost', lossReason: input.lossReason },
    });
    await this.eventBus.publish(organizationId, 'deal.lost', { dealId: id });

    return updated;
  }

  async reopen(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<DealDocument> {
    const deal = await this.getById(organizationId, id);
    if (deal.status === 'open') {
      throw new BadRequestException({
        code: 'DEAL_NOT_CLOSED',
        message: 'Only a won or lost deal can be reopened',
      });
    }

    const updated = await this.dealsRepository.reopen(organizationId, id);
    if (!updated) {
      throw new NotFoundException({
        code: 'DEAL_NOT_FOUND',
        message: 'Deal not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'deal',
      entityId: id,
      metadata: { status: 'open' },
    });
    await this.eventBus.publish(organizationId, 'deal.reopened', {
      dealId: id,
    });

    return updated;
  }
}
