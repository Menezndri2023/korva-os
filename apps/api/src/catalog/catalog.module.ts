import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Offer, OfferSchema } from './offers/schemas/offer.schema';
import { OffersRepository } from './offers/offers.repository';
import { OffersService } from './offers/offers.service';
import { OffersController } from './offers/offers.controller';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Offer.name, schema: OfferSchema }]),
    CustomFieldsModule,
    AuditModule,
  ],
  controllers: [OffersController],
  providers: [OffersRepository, OffersService],
  exports: [OffersService],
})
export class CatalogModule {}
