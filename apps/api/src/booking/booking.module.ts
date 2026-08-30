import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Resource, ResourceSchema } from './resources/schemas/resource.schema';
import { Booking, BookingSchema } from './bookings/schemas/booking.schema';
import {
  WaitlistEntry,
  WaitlistEntrySchema,
} from './waitlist/schemas/waitlist-entry.schema';
import {
  CreditBalance,
  CreditBalanceSchema,
} from './credit-balances/schemas/credit-balance.schema';

import { ResourcesRepository } from './resources/resources.repository';
import { ResourcesService } from './resources/resources.service';
import { ResourcesController } from './resources/resources.controller';

import { BookingsRepository } from './bookings/bookings.repository';
import { BookingsService } from './bookings/bookings.service';
import { BookingsController } from './bookings/bookings.controller';
import { BookingReminderSchedulerService } from './bookings/booking-reminder-scheduler.service';

import { AvailabilityService } from './availability/availability.service';
import { AvailabilityController } from './availability/availability.controller';
import { CalendarSyncSchedulerService } from './resources/calendar-sync-scheduler.service';

import { WaitlistRepository } from './waitlist/waitlist.repository';
import { WaitlistService } from './waitlist/waitlist.service';
import { WaitlistController } from './waitlist/waitlist.controller';

import { CreditBalancesRepository } from './credit-balances/credit-balances.repository';
import { CreditBalancesService } from './credit-balances/credit-balances.service';
import { CreditBalancesController } from './credit-balances/credit-balances.controller';

import { CrmModule } from '../crm/crm.module';
import { CatalogModule } from '../catalog/catalog.module';
import { AuditModule } from '../audit/audit.module';
// For ConversationsService (BookingReminderSchedulerService's outbound send). Safe: neither
// CommunicationModule nor anything it imports (CrmModule, IdentityModule, AuditModule,
// EmailModule, MessagingProviderModule) imports BookingModule — verified by grepping every
// `import { BookingModule }` site first, per this codebase's own "check the reverse edge first"
// convention.
import { CommunicationModule } from '../communication/communication.module';
// For MembershipsService (staff↔Resource link validation, staffMembershipId snapshot on
// Booking.create). Safe: IdentityModule only imports EmailModule/AuditModule, neither of which
// imports BookingModule — verified per this codebase's "check the reverse edge first" convention.
import { IdentityModule } from '../identity/identity.module';
// For OrganizationsService (booking certificate PDF header) — same reverse-edge check already
// documented above for IdentityModule; OrganizationsModule has no path back to BookingModule.
import { OrganizationsModule } from '../organizations/organizations.module';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Resource.name, schema: ResourceSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: WaitlistEntry.name, schema: WaitlistEntrySchema },
      { name: CreditBalance.name, schema: CreditBalanceSchema },
    ]),
    CrmModule,
    CatalogModule,
    AuditModule,
    CommunicationModule,
    IdentityModule,
    OrganizationsModule,
    DocumentsModule,
  ],
  controllers: [
    ResourcesController,
    AvailabilityController,
    BookingsController,
    WaitlistController,
    CreditBalancesController,
  ],
  providers: [
    ResourcesRepository,
    BookingsRepository,
    AvailabilityService,
    ResourcesService,
    BookingsService,
    CalendarSyncSchedulerService,
    BookingReminderSchedulerService,
    WaitlistRepository,
    WaitlistService,
    CreditBalancesRepository,
    CreditBalancesService,
  ],
  exports: [
    BookingsService,
    AvailabilityService,
    ResourcesService,
    WaitlistService,
    CreditBalancesService,
  ],
})
export class BookingModule {}
