import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type {
  AssignTicketInput,
  CreateTicketInput,
  UpdateTicketInput,
} from '@korva/validation';
import type { Pagination } from '@korva/types';
import { FindTicketsOptions, TicketsRepository } from './tickets.repository';
import { TicketDocument } from './schemas/ticket.schema';
import { ContactsService } from '../../crm/contacts/contacts.service';
import { ConversationsService } from '../../communication/conversations/conversations.service';
import { MembershipsService } from '../../identity/memberships/memberships.service';
import { CustomFieldsService } from '../../custom-fields/custom-fields.service';
import { AuditService } from '../../audit/audit.service';
import { EventBusService } from '../../core/events/event-bus.service';

@Injectable()
export class TicketsService {
  constructor(
    private readonly ticketsRepository: TicketsRepository,
    private readonly contactsService: ContactsService,
    private readonly conversationsService: ConversationsService,
    private readonly membershipsService: MembershipsService,
    private readonly customFieldsService: CustomFieldsService,
    private readonly auditService: AuditService,
    private readonly eventBus: EventBusService,
  ) {}

  async create(
    organizationId: string,
    userId: string | undefined,
    input: CreateTicketInput,
  ): Promise<TicketDocument> {
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
    if (input.conversationId) {
      // Throws CONVERSATION_NOT_FOUND naturally if missing/wrong org.
      await this.conversationsService.getById(
        organizationId,
        input.conversationId,
      );
    }
    const customFields = await this.customFieldsService.validateValues(
      organizationId,
      'tickets',
      input.customFields,
    );

    const ticket = await this.ticketsRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      subject: input.subject,
      description: input.description,
      priority: input.priority,
      status: 'open',
      contactId: new Types.ObjectId(input.contactId),
      conversationId: input.conversationId
        ? new Types.ObjectId(input.conversationId)
        : undefined,
      customFields,
    });

    await this.auditService.record({
      organizationId,
      userId,
      action: 'CREATE',
      entity: 'ticket',
      entityId: ticket.id as string,
      metadata: { subject: input.subject },
    });

    await this.eventBus.publish(organizationId, 'ticket.created', {
      ticketId: ticket.id as string,
      contactId: input.contactId,
    });

    return ticket;
  }

  async getById(organizationId: string, id: string): Promise<TicketDocument> {
    const ticket = await this.ticketsRepository.findById(organizationId, id);
    if (!ticket) {
      throw new NotFoundException({
        code: 'TICKET_NOT_FOUND',
        message: 'Ticket not found',
      });
    }
    return ticket;
  }

  async list(
    organizationId: string,
    query: FindTicketsOptions,
  ): Promise<{ data: TicketDocument[]; pagination: Pagination }> {
    const { data, total } = await this.ticketsRepository.findAll(
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
    input: UpdateTicketInput,
  ): Promise<TicketDocument> {
    let customFields;
    if (input.customFields) {
      customFields = await this.customFieldsService.validateValues(
        organizationId,
        'tickets',
        input.customFields,
      );
    }
    const updated = await this.ticketsRepository.update(organizationId, id, {
      subject: input.subject,
      description: input.description,
      priority: input.priority,
      customFields,
    });
    if (!updated) {
      throw new NotFoundException({
        code: 'TICKET_NOT_FOUND',
        message: 'Ticket not found',
      });
    }
    return updated;
  }

  async assign(
    organizationId: string,
    userId: string,
    id: string,
    input: AssignTicketInput,
  ): Promise<TicketDocument> {
    const membership = await this.membershipsService.findByIdForOrganization(
      input.assigneeMembershipId,
      organizationId,
    );
    if (!membership) {
      throw new NotFoundException({
        code: 'MEMBERSHIP_NOT_FOUND',
        message: 'Member not found',
      });
    }

    const updated = await this.ticketsRepository.update(organizationId, id, {
      assigneeMembershipId: new Types.ObjectId(input.assigneeMembershipId),
    });
    if (!updated) {
      throw new NotFoundException({
        code: 'TICKET_NOT_FOUND',
        message: 'Ticket not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'ticket',
      entityId: id,
      metadata: { assigneeMembershipId: input.assigneeMembershipId },
    });

    await this.eventBus.publish(organizationId, 'ticket.assigned', {
      ticketId: id,
      assigneeMembershipId: input.assigneeMembershipId,
    });

    return updated;
  }

  async resolve(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<TicketDocument> {
    const ticket = await this.getById(organizationId, id);
    if (ticket.status === 'resolved') {
      throw new BadRequestException({
        code: 'TICKET_ALREADY_RESOLVED',
        message: 'This ticket is already resolved',
      });
    }
    if (ticket.status === 'closed') {
      throw new BadRequestException({
        code: 'TICKET_NOT_RESOLVABLE',
        message: 'A closed ticket must be reopened before it can be resolved',
      });
    }

    const updated = await this.ticketsRepository.update(organizationId, id, {
      status: 'resolved',
      resolvedAt: new Date(),
    });
    if (!updated) {
      throw new NotFoundException({
        code: 'TICKET_NOT_FOUND',
        message: 'Ticket not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'ticket',
      entityId: id,
      metadata: { status: 'resolved' },
    });
    await this.eventBus.publish(organizationId, 'ticket.resolved', {
      ticketId: id,
    });

    return updated;
  }

  async close(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<TicketDocument> {
    const ticket = await this.getById(organizationId, id);
    if (ticket.status === 'closed') {
      throw new BadRequestException({
        code: 'TICKET_ALREADY_CLOSED',
        message: 'This ticket is already closed',
      });
    }

    const updated = await this.ticketsRepository.update(organizationId, id, {
      status: 'closed',
      closedAt: new Date(),
    });
    if (!updated) {
      throw new NotFoundException({
        code: 'TICKET_NOT_FOUND',
        message: 'Ticket not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'ticket',
      entityId: id,
      metadata: { status: 'closed' },
    });
    await this.eventBus.publish(organizationId, 'ticket.closed', {
      ticketId: id,
    });

    return updated;
  }

  async reopen(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<TicketDocument> {
    const ticket = await this.getById(organizationId, id);
    if (ticket.status !== 'closed') {
      throw new BadRequestException({
        code: 'TICKET_NOT_CLOSED',
        message: 'Only a closed ticket can be reopened',
      });
    }

    const updated = await this.ticketsRepository.reopen(organizationId, id);
    if (!updated) {
      throw new NotFoundException({
        code: 'TICKET_NOT_FOUND',
        message: 'Ticket not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'ticket',
      entityId: id,
      metadata: { status: 'open' },
    });
    await this.eventBus.publish(organizationId, 'ticket.reopened', {
      ticketId: id,
    });

    return updated;
  }
}
