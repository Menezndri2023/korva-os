import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Resource, ResourceSchema } from './resources/schemas/resource.schema';
import { Booking, BookingSchema } from './bookings/schemas/booking.schema';

import { ResourcesRepository } from './resources/resources.repository';
import { ResourcesService } from './resources/resources.service';
import { ResourcesController } from './resources/resources.controller';

import { BookingsRepository } from './bookings/bookings.repository';
import { BookingsService } from './bookings/bookings.service';
import { BookingsController } from './bookings/bookings.controller';

import { AvailabilityService } from './availability/availability.service';
import { AvailabilityController } from './availability/availability.controller';

import { CrmModule } from '../crm/crm.module';
import { CatalogModule } from '../catalog/catalog.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Resource.name, schema: ResourceSchema },
      { name: Booking.name, schema: BookingSchema },
    ]),
    CrmModule,
    CatalogModule,
    AuditModule,
  ],
  controllers: [
    ResourcesController,
    AvailabilityController,
    BookingsController,
  ],
  providers: [
    ResourcesRepository,
    BookingsRepository,
    AvailabilityService,
    ResourcesService,
    BookingsService,
  ],
})
export class BookingModule {}
