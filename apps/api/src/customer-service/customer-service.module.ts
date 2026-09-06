import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Ticket, TicketSchema } from './tickets/schemas/ticket.schema';

import { TicketsRepository } from './tickets/tickets.repository';
import { TicketsService } from './tickets/tickets.service';
import { TicketsController } from './tickets/tickets.controller';

import { CrmModule } from '../crm/crm.module';
import { CommunicationModule } from '../communication/communication.module';
import { IdentityModule } from '../identity/identity.module';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { AuditModule } from '../audit/audit.module';

/**
 * Verified no reverse edge before importing CrmModule/CommunicationModule/IdentityModule (this
 * module is brand new, so nothing could import it back) — same discipline as every other
 * cross-module edge in this codebase. Exports TicketsService so CustomerAuthModule (the
 * customer-portal ticket routes) can inject it without duplicating any business logic.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Ticket.name, schema: TicketSchema }]),
    CrmModule,
    CommunicationModule,
    IdentityModule,
    CustomFieldsModule,
    AuditModule,
  ],
  controllers: [TicketsController],
  providers: [TicketsRepository, TicketsService],
  exports: [TicketsService],
})
export class CustomerServiceModule {}
