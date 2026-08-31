import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import type {
  CreateTimeEntryInput,
  GenerateInvoiceFromTimeEntriesInput,
  UpdateTimeEntryInput,
} from '@korva/validation';
import type { Pagination } from '@korva/types';
import {
  TimeEntriesRepository,
  FindTimeEntriesOptions,
} from './time-entries.repository';
import { TimeEntryDocument } from './schemas/time-entry.schema';
import { ContactsService } from '../../crm/contacts/contacts.service';
import { AuditService } from '../../audit/audit.service';
import { InvoicesService } from '../invoices/invoices.service';
import { InvoiceDocument } from '../invoices/schemas/invoice.schema';
import { MembershipsService } from '../../identity/memberships/memberships.service';
import { ProjectsService } from '../../crm/projects/projects.service';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

@Injectable()
export class TimeEntriesService {
  constructor(
    private readonly timeEntriesRepository: TimeEntriesRepository,
    private readonly contactsService: ContactsService,
    private readonly auditService: AuditService,
    private readonly invoicesService: InvoicesService,
    private readonly membershipsService: MembershipsService,
    private readonly projectsService: ProjectsService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /**
   * Resolves the rate to bill when the caller didn't supply one explicitly: the client's own
   * negotiated rate takes priority (Contact.defaultHourlyRate — more specific to this billing
   * relationship than who happened to do the work), falling back to the staff member's own
   * default (Membership.defaultHourlyRate for the resolved userId). A non-billable entry never
   * needs a rate at all. Returns undefined when nothing resolves — the caller decides whether
   * that's an error (it is, for a billable entry with no input.hourlyRate).
   */
  private async resolveHourlyRate(
    organizationId: string,
    userId: string,
    contactDefaultRate: number | undefined,
    inputRate: number | undefined,
  ): Promise<number | undefined> {
    if (inputRate !== undefined) return inputRate;
    if (contactDefaultRate !== undefined) return contactDefaultRate;
    const membership = await this.membershipsService.findByUserAndOrganization(
      userId,
      organizationId,
    );
    return membership?.defaultHourlyRate;
  }

  async create(
    organizationId: string,
    callerUserId: string,
    input: CreateTimeEntryInput,
  ): Promise<TimeEntryDocument> {
    const contact = await this.contactsService.getById(
      organizationId,
      input.contactId,
    );

    if (input.projectId) {
      const projectExists = await this.projectsService.existsById(
        organizationId,
        input.projectId,
      );
      if (!projectExists) {
        throw new NotFoundException({
          code: 'PROJECT_NOT_FOUND',
          message: 'Project not found',
        });
      }
    }

    const userId = input.userId ?? callerUserId;
    const hourlyRate = await this.resolveHourlyRate(
      organizationId,
      userId,
      contact.defaultHourlyRate,
      input.hourlyRate,
    );
    if (input.billable && hourlyRate === undefined) {
      throw new BadRequestException({
        code: 'TIME_ENTRY_RATE_REQUIRED',
        message:
          'No hourlyRate was provided and none could be resolved from the client or staff member defaults',
      });
    }

    const entry = await this.timeEntriesRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      contactId: new Types.ObjectId(input.contactId),
      userId: new Types.ObjectId(userId),
      projectId: input.projectId
        ? new Types.ObjectId(input.projectId)
        : undefined,
      date: new Date(input.date),
      durationMinutes: input.durationMinutes,
      description: input.description,
      billable: input.billable,
      hourlyRate,
      currency: input.currency,
      notes: input.notes,
    });

    await this.auditService.record({
      organizationId,
      userId: callerUserId,
      action: 'CREATE',
      entity: 'time_entry',
      entityId: entry.id as string,
    });

    return entry;
  }

  async getById(
    organizationId: string,
    id: string,
  ): Promise<TimeEntryDocument> {
    const entry = await this.timeEntriesRepository.findById(organizationId, id);
    if (!entry) {
      throw new NotFoundException({
        code: 'TIME_ENTRY_NOT_FOUND',
        message: 'Time entry not found',
      });
    }
    return entry;
  }

  async list(
    organizationId: string,
    query: FindTimeEntriesOptions,
  ): Promise<{ data: TimeEntryDocument[]; pagination: Pagination }> {
    const { data, total } = await this.timeEntriesRepository.findAll(
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
    input: UpdateTimeEntryInput,
  ): Promise<TimeEntryDocument> {
    const entry = await this.getById(organizationId, id);
    if (entry.status !== 'unbilled') {
      throw new BadRequestException({
        code: 'TIME_ENTRY_NOT_EDITABLE',
        message: 'Only an unbilled time entry can be edited',
      });
    }

    if (input.projectId) {
      const projectExists = await this.projectsService.existsById(
        organizationId,
        input.projectId,
      );
      if (!projectExists) {
        throw new NotFoundException({
          code: 'PROJECT_NOT_FOUND',
          message: 'Project not found',
        });
      }
    }

    const updated = await this.timeEntriesRepository.update(
      organizationId,
      id,
      {
        projectId: input.projectId
          ? new Types.ObjectId(input.projectId)
          : undefined,
        date: input.date ? new Date(input.date) : undefined,
        durationMinutes: input.durationMinutes,
        description: input.description,
        billable: input.billable,
        hourlyRate: input.hourlyRate,
        currency: input.currency,
        notes: input.notes,
      },
    );
    if (!updated) {
      throw new NotFoundException({
        code: 'TIME_ENTRY_NOT_FOUND',
        message: 'Time entry not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'time_entry',
      entityId: id,
    });

    return updated;
  }

  async approve(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<TimeEntryDocument> {
    const entry = await this.getById(organizationId, id);
    if (entry.status !== 'unbilled') {
      throw new BadRequestException({
        code: 'TIME_ENTRY_INVALID_TRANSITION',
        message: `Cannot approve a time entry with status "${entry.status}"`,
      });
    }

    const updated = await this.timeEntriesRepository.update(
      organizationId,
      id,
      { status: 'approved' },
    );
    if (!updated) {
      throw new NotFoundException({
        code: 'TIME_ENTRY_NOT_FOUND',
        message: 'Time entry not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'time_entry',
      entityId: id,
      metadata: { status: 'approved' },
    });

    return updated;
  }

  async void(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<TimeEntryDocument> {
    const entry = await this.getById(organizationId, id);
    if (entry.status !== 'unbilled' && entry.status !== 'approved') {
      throw new BadRequestException({
        code: 'TIME_ENTRY_INVALID_TRANSITION',
        message: `Cannot void a time entry with status "${entry.status}"`,
      });
    }

    const updated = await this.timeEntriesRepository.update(
      organizationId,
      id,
      { status: 'voided' },
    );
    if (!updated) {
      throw new NotFoundException({
        code: 'TIME_ENTRY_NOT_FOUND',
        message: 'Time entry not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'time_entry',
      entityId: id,
      metadata: { status: 'voided' },
    });

    return updated;
  }

  async delete(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<void> {
    const entry = await this.getById(organizationId, id);
    if (entry.status === 'invoiced') {
      throw new BadRequestException({
        code: 'TIME_ENTRY_ALREADY_INVOICED',
        message:
          'A time entry already attached to an invoice cannot be deleted',
      });
    }

    const deleted = await this.timeEntriesRepository.delete(organizationId, id);
    if (!deleted) {
      throw new NotFoundException({
        code: 'TIME_ENTRY_NOT_FOUND',
        message: 'Time entry not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'DELETE',
      entity: 'time_entry',
      entityId: id,
    });
  }

  /**
   * Batches N approved, billable time entries (same contact, same currency) into one Invoice,
   * inside a single MongoDB transaction with TimeEntriesRepository.markInvoiced so either both
   * the Invoice insert and every entry's status flip commit, or neither does. Concurrency: two
   * overlapping generateInvoice calls race at the transaction level — MongoDB's write-conflict
   * detection aborts the loser, the driver retries it automatically, and on retry
   * markInvoiced's matchedCount comes back short (the winner already flipped those entries),
   * which is converted into TIME_ENTRIES_NOT_INVOICEABLE below rather than a silently
   * inconsistent partial invoice. See apps/api/src/commerce/orders/orders.service.ts's
   * generateInvoiceAtomically for the sibling pattern this mirrors (that one guards a 1:1
   * Order↔Invoice relationship via a partial unique index instead, since a single conditional
   * update is enough there — here the relationship is N:1, so an all-or-nothing updateMany
   * inside the transaction is the equivalent guarantee).
   */
  async generateInvoice(
    organizationId: string,
    callerUserId: string,
    input: GenerateInvoiceFromTimeEntriesInput,
  ): Promise<InvoiceDocument> {
    const entries = await this.timeEntriesRepository.findByIds(
      organizationId,
      input.timeEntryIds,
    );
    if (entries.length !== input.timeEntryIds.length) {
      const foundIds = new Set(entries.map((e) => e.id as string));
      const missing = input.timeEntryIds.filter((id) => !foundIds.has(id));
      throw new NotFoundException({
        code: 'TIME_ENTRY_NOT_FOUND',
        message: `Time entry not found: ${missing.join(', ')}`,
      });
    }

    if (entries.some((e) => e.status !== 'approved')) {
      throw new BadRequestException({
        code: 'TIME_ENTRY_NOT_APPROVED',
        message: 'Only approved time entries can be invoiced',
      });
    }
    if (entries.some((e) => !e.billable)) {
      throw new BadRequestException({
        code: 'TIME_ENTRY_NOT_BILLABLE',
        message: 'Non-billable time entries cannot be invoiced',
      });
    }

    const contactId = entries[0]!.contactId.toString();
    if (entries.some((e) => e.contactId.toString() !== contactId)) {
      throw new BadRequestException({
        code: 'TIME_ENTRIES_MIXED_CONTACT',
        message: 'All selected time entries must belong to the same client',
      });
    }

    const currency = entries[0]!.currency;
    if (entries.some((e) => e.currency !== currency)) {
      throw new BadRequestException({
        code: 'TIME_ENTRIES_MIXED_CURRENCY',
        message: 'All selected time entries must use the same currency',
      });
    }

    const items = entries.map((entry) => {
      const hours = round2(entry.durationMinutes / 60);
      const dateLabel = entry.date.toISOString().slice(0, 10);
      return {
        description: `${dateLabel} — ${entry.description} (${hours}h × ${entry.hourlyRate} ${currency}/h)`,
        quantity: hours,
        unitPrice: entry.hourlyRate!,
      };
    });

    const timeEntryIds = entries.map((e) => e.id as string);
    const session = await this.connection.startSession();
    let invoice: InvoiceDocument;
    try {
      invoice = await session.withTransaction(async () => {
        const created = await this.invoicesService.createFromTimeEntries(
          organizationId,
          {
            contactId,
            items,
            currency,
            dueDate: input.dueDate,
            notes: input.notes,
          },
          session,
        );

        const { matchedCount } = await this.timeEntriesRepository.markInvoiced(
          organizationId,
          timeEntryIds,
          created.id as string,
          session,
        );
        if (matchedCount !== timeEntryIds.length) {
          throw new BadRequestException({
            code: 'TIME_ENTRIES_NOT_INVOICEABLE',
            message:
              'One or more time entries were modified concurrently and are no longer invoiceable',
          });
        }

        return created;
      });
    } finally {
      await session.endSession();
    }

    await this.auditService.record({
      organizationId,
      userId: callerUserId,
      action: 'CREATE',
      entity: 'invoice',
      entityId: invoice.id as string,
      metadata: { timeEntryIds },
    });

    return invoice;
  }

  /**
   * Commission a staff member earned on their own billed-and-paid work within a date range —
   * Membership.commissionRateBasisPoints × the sum of (durationMinutes/60 × hourlyRate) for
   * every invoiced TimeEntry of theirs whose invoice has since been fully paid. Grouped by
   * currency rather than assuming one: an org billing in multiple currencies would otherwise
   * silently sum incompatible amounts together.
   */
  async getCommissionReport(
    organizationId: string,
    userId: string,
    from: string,
    to: string,
  ): Promise<{
    userId: string;
    commissionRateBasisPoints: number;
    timeEntryCount: number;
    periods: {
      currency: string;
      billableAmount: number;
      commissionAmount: number;
    }[];
  }> {
    const membership = await this.membershipsService.findByUserAndOrganization(
      userId,
      organizationId,
    );
    const commissionRateBasisPoints =
      membership?.commissionRateBasisPoints ?? 0;

    const entries = await this.timeEntriesRepository.findInvoicedByUserInRange(
      organizationId,
      userId,
      new Date(from),
      new Date(to),
    );

    const invoiceIds = [
      ...new Set(
        entries.filter((e) => e.invoiceId).map((e) => e.invoiceId!.toString()),
      ),
    ];
    const invoicesById = await this.invoicesService.getManyByIds(
      organizationId,
      invoiceIds,
    );

    const paidEntries = entries.filter(
      (entry) =>
        entry.invoiceId &&
        invoicesById.get(entry.invoiceId.toString())?.status === 'paid',
    );

    const billableByCurrency = new Map<string, number>();
    for (const entry of paidEntries) {
      const amount = round2(
        (entry.durationMinutes / 60) * (entry.hourlyRate ?? 0),
      );
      billableByCurrency.set(
        entry.currency,
        round2((billableByCurrency.get(entry.currency) ?? 0) + amount),
      );
    }

    const periods = [...billableByCurrency.entries()].map(
      ([currency, billableAmount]) => ({
        currency,
        billableAmount,
        commissionAmount: round2(
          (billableAmount * commissionRateBasisPoints) / 10000,
        ),
      }),
    );

    return {
      userId,
      commissionRateBasisPoints,
      timeEntryCount: paidEntries.length,
      periods,
    };
  }
}
