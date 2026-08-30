import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { TimeEntriesService } from './time-entries.service';
import type { TimeEntriesRepository } from './time-entries.repository';
import type { TimeEntryDocument } from './schemas/time-entry.schema';
import type { ContactsService } from '../../crm/contacts/contacts.service';
import type { AuditService } from '../../audit/audit.service';
import type { InvoicesService } from '../invoices/invoices.service';
import type { MembershipsService } from '../../identity/memberships/memberships.service';

type TimeEntriesRepositoryMock = jest.Mocked<
  Pick<TimeEntriesRepository, 'create' | 'findByIds' | 'markInvoiced'>
>;
type InvoicesServiceMock = jest.Mocked<
  Pick<InvoicesService, 'createFromTimeEntries'>
>;

function buildTimeEntriesRepositoryMock(): TimeEntriesRepositoryMock {
  return {
    create: jest.fn().mockResolvedValue({ id: 'entry-1' }),
    findByIds: jest.fn(),
    markInvoiced: jest.fn(),
  };
}
function buildInvoicesServiceMock(): InvoicesServiceMock {
  return { createFromTimeEntries: jest.fn() };
}

/** Narrow casts so assertions on jest.fn() spies don't trip @typescript-eslint/unbound-method —
 *  same pattern as settlement.service.spec.ts. */
function asRepository(mock: TimeEntriesRepositoryMock): TimeEntriesRepository {
  return mock as unknown as TimeEntriesRepository;
}
function asInvoicesService(mock: InvoicesServiceMock): InvoicesService {
  return mock as unknown as InvoicesService;
}

/** Fake session whose withTransaction just awaits the callback directly — no real MongoDB
 *  involved, since these tests only cover TimeEntriesService's own branching logic. */
function buildConnectionMock() {
  const session = {
    withTransaction: (fn: () => Promise<unknown>) => fn(),
    endSession: jest.fn().mockResolvedValue(undefined),
  };
  return {
    startSession: jest.fn().mockResolvedValue(session),
  } as unknown as import('mongoose').Connection;
}

function makeEntry(
  overrides: Partial<{
    id: string;
    status: string;
    billable: boolean;
    contactId: string;
    currency: string;
    durationMinutes: number;
    hourlyRate: number;
    description: string;
    date: Date;
  }> = {},
): TimeEntryDocument {
  const id = overrides.id ?? new Types.ObjectId().toString();
  return {
    id,
    status: overrides.status ?? 'approved',
    billable: overrides.billable ?? true,
    contactId: new Types.ObjectId(
      overrides.contactId ?? '507f1f77bcf86cd799439011',
    ),
    currency: overrides.currency ?? 'EUR',
    durationMinutes: overrides.durationMinutes ?? 90,
    hourlyRate: overrides.hourlyRate ?? 100,
    description: overrides.description ?? 'Work',
    date: overrides.date ?? new Date('2026-08-01T00:00:00.000Z'),
  } as unknown as TimeEntryDocument;
}

function buildService(overrides?: {
  timeEntries?: TimeEntriesRepositoryMock;
  invoices?: InvoicesServiceMock;
  contacts?: { existsById: jest.Mock; getById: jest.Mock };
  memberships?: { findByUserAndOrganization: jest.Mock };
}) {
  const timeEntriesRepository =
    overrides?.timeEntries ?? buildTimeEntriesRepositoryMock();
  const invoicesService = overrides?.invoices ?? buildInvoicesServiceMock();
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const contactsService = overrides?.contacts ?? {
    existsById: jest.fn(),
    getById: jest.fn(),
  };
  const membershipsService = overrides?.memberships ?? {
    findByUserAndOrganization: jest.fn(),
  };
  const connection = buildConnectionMock();

  const service = new TimeEntriesService(
    asRepository(timeEntriesRepository),
    contactsService as unknown as ContactsService,
    auditService as unknown as AuditService,
    asInvoicesService(invoicesService),
    membershipsService as unknown as MembershipsService,
    connection,
  );
  return {
    service,
    timeEntriesRepository,
    invoicesService,
    auditService,
    contactsService,
    membershipsService,
  };
}

describe('TimeEntriesService.generateInvoice', () => {
  it('throws NotFoundException naming missing ids when some requested entries do not exist', async () => {
    const { service, timeEntriesRepository } = buildService();
    const entryA = makeEntry();
    timeEntriesRepository.findByIds.mockResolvedValue([entryA]);

    await expect(
      service.generateInvoice('org-1', 'user-1', {
        timeEntryIds: [entryA.id as string, 'missing-id'],
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects a batch containing a non-approved entry (TIME_ENTRY_NOT_APPROVED)', async () => {
    const { service, timeEntriesRepository } = buildService();
    const entries = [
      makeEntry({ status: 'approved' }),
      makeEntry({ status: 'unbilled' }),
    ];
    timeEntriesRepository.findByIds.mockResolvedValue(entries);

    await expect(
      service.generateInvoice('org-1', 'user-1', {
        timeEntryIds: entries.map((e) => e.id as string),
      }),
    ).rejects.toMatchObject({
      response: { code: 'TIME_ENTRY_NOT_APPROVED' },
    });
  });

  it('rejects a batch containing a non-billable entry (TIME_ENTRY_NOT_BILLABLE)', async () => {
    const { service, timeEntriesRepository } = buildService();
    const entries = [
      makeEntry({ billable: true }),
      makeEntry({ billable: false }),
    ];
    timeEntriesRepository.findByIds.mockResolvedValue(entries);

    await expect(
      service.generateInvoice('org-1', 'user-1', {
        timeEntryIds: entries.map((e) => e.id as string),
      }),
    ).rejects.toMatchObject({
      response: { code: 'TIME_ENTRY_NOT_BILLABLE' },
    });
  });

  it('rejects a batch spanning more than one contact (TIME_ENTRIES_MIXED_CONTACT)', async () => {
    const { service, timeEntriesRepository } = buildService();
    const entries = [
      makeEntry({ contactId: '507f1f77bcf86cd799439011' }),
      makeEntry({ contactId: '507f1f77bcf86cd799439022' }),
    ];
    timeEntriesRepository.findByIds.mockResolvedValue(entries);

    await expect(
      service.generateInvoice('org-1', 'user-1', {
        timeEntryIds: entries.map((e) => e.id as string),
      }),
    ).rejects.toMatchObject({
      response: { code: 'TIME_ENTRIES_MIXED_CONTACT' },
    });
  });

  it('rejects a batch spanning more than one currency (TIME_ENTRIES_MIXED_CURRENCY)', async () => {
    const { service, timeEntriesRepository } = buildService();
    const entries = [
      makeEntry({ currency: 'EUR' }),
      makeEntry({ currency: 'USD' }),
    ];
    timeEntriesRepository.findByIds.mockResolvedValue(entries);

    await expect(
      service.generateInvoice('org-1', 'user-1', {
        timeEntryIds: entries.map((e) => e.id as string),
      }),
    ).rejects.toMatchObject({
      response: { code: 'TIME_ENTRIES_MIXED_CURRENCY' },
    });
  });

  it('rounds minutes to 2-decimal hours and builds one line item per entry, on the happy path', async () => {
    const { service, timeEntriesRepository, invoicesService } = buildService();
    const entryA = makeEntry({ durationMinutes: 100, hourlyRate: 90 }); // 1.67h
    const entryB = makeEntry({ durationMinutes: 30, hourlyRate: 90 }); // 0.5h
    timeEntriesRepository.findByIds.mockResolvedValue([entryA, entryB]);
    timeEntriesRepository.markInvoiced.mockResolvedValue({ matchedCount: 2 });
    invoicesService.createFromTimeEntries.mockResolvedValue({
      id: 'invoice-1',
    } as never);

    await service.generateInvoice('org-1', 'user-1', {
      timeEntryIds: [entryA.id as string, entryB.id as string],
    });

    expect(invoicesService.createFromTimeEntries).toHaveBeenCalledTimes(1);
    const [, input] = invoicesService.createFromTimeEntries.mock.calls[0]!;
    expect(input.items).toHaveLength(2);
    expect(input.items[0]!.quantity).toBeCloseTo(1.67);
    expect(input.items[1]!.quantity).toBe(0.5);
  });

  it('throws TIME_ENTRIES_NOT_INVOICEABLE when markInvoiced matches fewer entries than requested', async () => {
    const { service, timeEntriesRepository, invoicesService } = buildService();
    const entryA = makeEntry();
    const entryB = makeEntry();
    timeEntriesRepository.findByIds.mockResolvedValue([entryA, entryB]);
    // Simulates a concurrent winner having already claimed one of the two entries.
    timeEntriesRepository.markInvoiced.mockResolvedValue({ matchedCount: 1 });
    invoicesService.createFromTimeEntries.mockResolvedValue({
      id: 'invoice-1',
    } as never);

    await expect(
      service.generateInvoice('org-1', 'user-1', {
        timeEntryIds: [entryA.id as string, entryB.id as string],
      }),
    ).rejects.toMatchObject({
      response: { code: 'TIME_ENTRIES_NOT_INVOICEABLE' },
    });
  });
});

describe('TimeEntriesService.create — default hourly rate resolution', () => {
  const ORG_ID = '507f1f77bcf86cd799439011';
  const USER_ID = '507f1f77bcf86cd799439012';
  const baseInput = {
    contactId: '507f1f77bcf86cd799439013',
    date: '2026-08-01T00:00:00.000Z',
    durationMinutes: 60,
    description: 'Work',
    billable: true,
    currency: 'EUR',
  };

  it('uses the explicitly-provided hourlyRate over any default', async () => {
    const contactsService = {
      existsById: jest.fn(),
      getById: jest.fn().mockResolvedValue({ defaultHourlyRate: 50 }),
    };
    const membershipsService = {
      findByUserAndOrganization: jest
        .fn()
        .mockResolvedValue({ defaultHourlyRate: 75 }),
    };
    const { service, timeEntriesRepository } = buildService({
      contacts: contactsService,
      memberships: membershipsService,
    });

    await service.create(ORG_ID, USER_ID, { ...baseInput, hourlyRate: 120 });

    expect(timeEntriesRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ hourlyRate: 120 }),
    );
    expect(membershipsService.findByUserAndOrganization).not.toHaveBeenCalled();
  });

  it("falls back to the client's default rate when none is provided", async () => {
    const contactsService = {
      existsById: jest.fn(),
      getById: jest.fn().mockResolvedValue({ defaultHourlyRate: 90 }),
    };
    const membershipsService = {
      findByUserAndOrganization: jest
        .fn()
        .mockResolvedValue({ defaultHourlyRate: 75 }),
    };
    const { service, timeEntriesRepository } = buildService({
      contacts: contactsService,
      memberships: membershipsService,
    });

    await service.create(ORG_ID, USER_ID, { ...baseInput });

    expect(timeEntriesRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ hourlyRate: 90 }),
    );
  });

  it("falls back to the staff member's default rate when the client has none", async () => {
    const contactsService = {
      existsById: jest.fn(),
      getById: jest.fn().mockResolvedValue({ defaultHourlyRate: undefined }),
    };
    const membershipsService = {
      findByUserAndOrganization: jest
        .fn()
        .mockResolvedValue({ defaultHourlyRate: 65 }),
    };
    const { service, timeEntriesRepository } = buildService({
      contacts: contactsService,
      memberships: membershipsService,
    });

    await service.create(ORG_ID, USER_ID, { ...baseInput });

    expect(timeEntriesRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ hourlyRate: 65 }),
    );
  });

  it('rejects a billable entry when no rate can be resolved from any source', async () => {
    const contactsService = {
      existsById: jest.fn(),
      getById: jest.fn().mockResolvedValue({ defaultHourlyRate: undefined }),
    };
    const membershipsService = {
      findByUserAndOrganization: jest.fn().mockResolvedValue(null),
    };
    const { service } = buildService({
      contacts: contactsService,
      memberships: membershipsService,
    });

    await expect(
      service.create(ORG_ID, USER_ID, { ...baseInput }),
    ).rejects.toMatchObject({
      response: { code: 'TIME_ENTRY_RATE_REQUIRED' },
    });
  });

  it('allows a non-billable entry with no resolvable rate at all', async () => {
    const contactsService = {
      existsById: jest.fn(),
      getById: jest.fn().mockResolvedValue({ defaultHourlyRate: undefined }),
    };
    const membershipsService = {
      findByUserAndOrganization: jest.fn().mockResolvedValue(null),
    };
    const { service, timeEntriesRepository } = buildService({
      contacts: contactsService,
      memberships: membershipsService,
    });

    await service.create(ORG_ID, USER_ID, {
      ...baseInput,
      billable: false,
    });

    expect(timeEntriesRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ hourlyRate: undefined }),
    );
  });
});
