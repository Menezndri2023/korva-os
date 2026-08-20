import { Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type {
  CreateContactInput,
  ListContactsQuery,
  UpdateContactInput,
} from '@korva/validation';
import type { Pagination } from '@korva/types';
import { ContactsRepository } from './contacts.repository';
import { ContactDocument } from './schemas/contact.schema';
import { CustomFieldsService } from '../../custom-fields/custom-fields.service';
import { AuditService } from '../../audit/audit.service';

@Injectable()
export class ContactsService {
  constructor(
    private readonly contactsRepository: ContactsRepository,
    private readonly customFieldsService: CustomFieldsService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    organizationId: string,
    userId: string,
    input: CreateContactInput,
  ): Promise<ContactDocument> {
    const customFields = await this.customFieldsService.validateValues(
      organizationId,
      'contacts',
      input.customFields,
    );

    const contact = await this.contactsRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      type: input.type,
      firstName: input.firstName,
      lastName: input.lastName,
      company: input.company,
      email: input.email,
      phone: input.phone,
      tags: input.tags,
      customFields,
    });

    await this.auditService.record({
      organizationId,
      userId,
      action: 'CREATE',
      entity: 'contact',
      entityId: contact.id as string,
    });

    return contact;
  }

  async getById(organizationId: string, id: string): Promise<ContactDocument> {
    const contact = await this.contactsRepository.findById(organizationId, id);
    if (!contact) {
      throw new NotFoundException({
        code: 'CONTACT_NOT_FOUND',
        message: 'Contact not found',
      });
    }
    return contact;
  }

  existsById(organizationId: string, id: string): Promise<boolean> {
    return this.contactsRepository.existsById(organizationId, id);
  }

  async list(
    organizationId: string,
    query: ListContactsQuery,
  ): Promise<{ data: ContactDocument[]; pagination: Pagination }> {
    const { data, total } = await this.contactsRepository.findAll(
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
    input: UpdateContactInput,
  ): Promise<ContactDocument> {
    const customFields =
      input.customFields !== undefined
        ? await this.customFieldsService.validateValues(
            organizationId,
            'contacts',
            input.customFields,
          )
        : undefined;

    const updated = await this.contactsRepository.update(organizationId, id, {
      ...input,
      ...(customFields !== undefined ? { customFields } : {}),
    });
    if (!updated) {
      throw new NotFoundException({
        code: 'CONTACT_NOT_FOUND',
        message: 'Contact not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'contact',
      entityId: id,
    });

    return updated;
  }

  async delete(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<void> {
    const deleted = await this.contactsRepository.delete(organizationId, id);
    if (!deleted) {
      throw new NotFoundException({
        code: 'CONTACT_NOT_FOUND',
        message: 'Contact not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'DELETE',
      entity: 'contact',
      entityId: id,
    });
  }
}
