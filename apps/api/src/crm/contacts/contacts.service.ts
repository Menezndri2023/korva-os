import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import type {
  CreateContactInput,
  ListContactsQuery,
  UpdateContactInput,
} from '@korva/validation';
import type { Pagination } from '@korva/types';
import { ContactsRepository } from './contacts.repository';
import { ContactReferencesRepository } from './contact-references.repository';
import { ContactMergeRepository } from './contact-merge.repository';
import { Contact, ContactDocument } from './schemas/contact.schema';
import { CustomFieldsService } from '../../custom-fields/custom-fields.service';
import { AuditService } from '../../audit/audit.service';
import { EventBusService } from '../../core/events/event-bus.service';

@Injectable()
export class ContactsService {
  constructor(
    private readonly contactsRepository: ContactsRepository,
    private readonly contactReferencesRepository: ContactReferencesRepository,
    private readonly contactMergeRepository: ContactMergeRepository,
    private readonly customFieldsService: CustomFieldsService,
    private readonly auditService: AuditService,
    private readonly eventBus: EventBusService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async create(
    organizationId: string,
    userId: string | undefined,
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
      defaultHourlyRate: input.defaultHourlyRate,
    });

    await this.auditService.record({
      organizationId,
      userId,
      action: 'CREATE',
      entity: 'contact',
      entityId: contact.id as string,
    });

    await this.eventBus.publish(organizationId, 'customer.created', {
      contactId: contact.id as string,
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

  /** Used by the public storefront API: matches an existing contact by email within the organization, or creates one. */
  async findOrCreateByEmail(
    organizationId: string,
    input: {
      email: string;
      firstName?: string;
      lastName?: string;
      phone?: string;
    },
  ): Promise<ContactDocument> {
    const existing = await this.contactsRepository.findByEmail(
      organizationId,
      input.email,
    );
    if (existing) return existing;

    return this.create(organizationId, undefined, {
      type: 'person',
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone,
      tags: [],
    });
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

  findDuplicates(organizationId: string) {
    return this.contactsRepository.findDuplicateGroups(organizationId);
  }

  async update(
    organizationId: string,
    // Optional so a customer-initiated self-service profile edit (no staff actor — see
    // CustomerAuthService.updateProfile) can call this too, same precedent as create()'s own
    // `userId: string | undefined` above; AuditService.record already tolerates undefined.
    userId: string | undefined,
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
    // Checked before the delete itself: contactId is a required field on every entity that
    // carries one (leads, orders, carts, bookings, invoices, quotes, conversations), and none
    // of them support a soft-delete/archival state — a hard delete here would leave those
    // records pointing at nothing. Status is deliberately not considered: even a cancelled
    // order or a lost lead is a real historical record.
    const hasReferences =
      await this.contactReferencesRepository.hasAnyReference(
        organizationId,
        id,
      );
    if (hasReferences) {
      throw new ConflictException({
        code: 'CONTACT_IN_USE',
        message:
          'This contact is still referenced by other records and cannot be deleted',
      });
    }

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

  /**
   * Merges `duplicateId` into `primaryId`: every business record referencing the duplicate
   * (leads, orders, bookings, invoices, tasks, notes, activities, cohort enrollment, ... — see
   * ContactMergeRepository for the full list) is re-pointed at the primary, the primary's own
   * fields are backfilled from whatever the duplicate had that the primary lacked, and the
   * duplicate is deleted. All in one transaction: a partial merge (some references re-pointed,
   * others not, or the duplicate deleted before every reference moved) would be worse than the
   * duplicate contact it's trying to fix.
   */
  async merge(
    organizationId: string,
    userId: string,
    primaryId: string,
    duplicateId: string,
  ): Promise<ContactDocument> {
    if (primaryId === duplicateId) {
      throw new BadRequestException({
        code: 'CONTACT_MERGE_SAME_CONTACT',
        message: 'Cannot merge a contact with itself',
      });
    }

    const [primary, duplicate] = await Promise.all([
      this.contactsRepository.findById(organizationId, primaryId),
      this.contactsRepository.findById(organizationId, duplicateId),
    ]);
    if (!primary || !duplicate) {
      throw new NotFoundException({
        code: 'CONTACT_NOT_FOUND',
        message: 'Contact not found',
      });
    }

    const mergedFields = mergeContactFields(primary, duplicate);

    const session = await this.connection.startSession();
    let updatedPrimary: ContactDocument | null;
    try {
      updatedPrimary = await session.withTransaction(async () => {
        await this.contactMergeRepository.repointAll(
          organizationId,
          primaryId,
          duplicateId,
          session,
        );

        const updated = await this.contactsRepository.update(
          organizationId,
          primaryId,
          mergedFields,
          session,
        );
        if (!updated) {
          throw new NotFoundException({
            code: 'CONTACT_NOT_FOUND',
            message: 'Contact not found',
          });
        }

        const deleted = await this.contactsRepository.delete(
          organizationId,
          duplicateId,
          session,
        );
        if (!deleted) {
          throw new NotFoundException({
            code: 'CONTACT_NOT_FOUND',
            message: 'Contact not found',
          });
        }

        return updated;
      });
    } finally {
      await session.endSession();
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'contact',
      entityId: primaryId,
      metadata: { mergedContactId: duplicateId },
    });

    // updatedPrimary is only ever null if withTransaction's callback threw (which itself always
    // throws instead of returning), so this narrows the type without changing behavior.
    return updatedPrimary;
  }
}

/**
 * Primary's own values win wherever it actually has one; a field the primary never filled in
 * gets backfilled from the duplicate instead of being lost. tags are unioned (deduplicated),
 * customFields merged with the primary's keys taking precedence over the duplicate's, and
 * consents concatenated — a consent record is historical, so both contacts' real ones matter,
 * not just the resulting single contact's most recent state.
 */
function mergeContactFields(
  primary: ContactDocument,
  duplicate: ContactDocument,
): Partial<Contact> {
  return {
    firstName: primary.firstName ?? duplicate.firstName,
    lastName: primary.lastName ?? duplicate.lastName,
    company: primary.company ?? duplicate.company,
    email: primary.email ?? duplicate.email,
    phone: primary.phone ?? duplicate.phone,
    defaultHourlyRate: primary.defaultHourlyRate ?? duplicate.defaultHourlyRate,
    tags: Array.from(new Set([...primary.tags, ...duplicate.tags])),
    customFields: { ...duplicate.customFields, ...primary.customFields },
    consents: [...primary.consents, ...duplicate.consents],
  };
}
