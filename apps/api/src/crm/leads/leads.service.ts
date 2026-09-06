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
import { ActivitiesService } from '../activities/activities.service';
import { CustomFieldsService } from '../../custom-fields/custom-fields.service';
import { AuditService } from '../../audit/audit.service';
import { EventBusService } from '../../core/events/event-bus.service';
import { MembershipsService } from '../../identity/memberships/memberships.service';
import { RoleDocument } from '../../identity/schemas/role.schema';

@Injectable()
export class LeadsService {
  constructor(
    private readonly leadsRepository: LeadsRepository,
    private readonly contactsService: ContactsService,
    private readonly dealsService: DealsService,
    private readonly activitiesService: ActivitiesService,
    private readonly customFieldsService: CustomFieldsService,
    private readonly auditService: AuditService,
    private readonly eventBus: EventBusService,
    private readonly membershipsService: MembershipsService,
  ) {}

  /**
   * Lead auto-routing (Phase D4, docs/KORVA_OS_V2_AUDIT.md §2.5): a lead created without an
   * explicit owner is assigned to whichever active SALES-role member currently holds the fewest
   * active (not-yet-converted) leads — a deterministic load-balancing rule, not an LLM guess,
   * consistent with the Decision Engine's own "never an LLM standing in for a business decision"
   * philosophy. Returns undefined (no auto-assignment) if the org has no SALES-role member yet —
   * callers must not fall back to guessing an owner.
   */
  private async resolveAutoRoutedOwner(
    organizationId: string,
  ): Promise<Types.ObjectId | undefined> {
    const members =
      await this.membershipsService.listMembersForOrganization(organizationId);
    const salesMembers = members.filter((member) => {
      if (member.status !== 'active') return false;
      const role = member.roleId as unknown as RoleDocument;
      return role.systemKey === 'SALES';
    });
    if (salesMembers.length === 0) return undefined;

    const activeCounts =
      await this.leadsRepository.countActiveByOwner(organizationId);
    let chosen = salesMembers[0]!;
    let chosenCount =
      activeCounts.get((chosen.userId as unknown as { id: string }).id) ?? 0;
    for (const member of salesMembers.slice(1)) {
      const count =
        activeCounts.get((member.userId as unknown as { id: string }).id) ?? 0;
      if (count < chosenCount) {
        chosen = member;
        chosenCount = count;
      }
    }
    return new Types.ObjectId((chosen.userId as unknown as { id: string }).id);
  }

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

    const ownerId = input.ownerId
      ? new Types.ObjectId(input.ownerId)
      : await this.resolveAutoRoutedOwner(organizationId);

    const lead = await this.leadsRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      contactId: new Types.ObjectId(input.contactId),
      source: input.source,
      ownerId,
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

  /**
   * Lead scoring v1 (Phase D4, docs/KORVA_OS_V2_AUDIT.md §2.5): a deterministic 0-100 score from
   * signals already available on this lead's own data — never an ML/LLM guess, same philosophy
   * as the Decision Engine's rules. Computed on read rather than stored/cached, so it's never
   * stale: contact completeness (up to 30), logged engagement/activity (up to 40, 10 per
   * activity), and recency (up to 30, decaying after a week and gone after a month). This is a
   * deliberately simple starting model, not a finished scoring system — an organization with
   * real sales data should eventually be able to tune or replace these weights.
   */
  async getScore(
    organizationId: string,
    id: string,
  ): Promise<{ score: number; factors: Record<string, number> }> {
    const lead = await this.getById(organizationId, id);
    const contact = await this.contactsService.getById(
      organizationId,
      lead.contactId.toString(),
    );
    const activities = await this.activitiesService.listForEntity(
      organizationId,
      'lead',
      id,
    );

    const contactCompleteness =
      (contact.email ? 15 : 0) + (contact.phone ? 15 : 0);
    const engagement = Math.min(40, activities.length * 10);
    const ageDays =
      (Date.now() -
        (lead as unknown as { createdAt: Date }).createdAt.getTime()) /
      (1000 * 60 * 60 * 24);
    const recency = ageDays <= 7 ? 30 : ageDays <= 30 ? 15 : 0;

    const factors = { contactCompleteness, engagement, recency };
    const score = Math.min(100, contactCompleteness + engagement + recency);
    return { score, factors };
  }
}
