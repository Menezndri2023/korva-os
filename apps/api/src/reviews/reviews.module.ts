import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Review, ReviewSchema } from './schemas/review.schema';
import { ReviewsRepository } from './reviews.repository';
import { ReviewsService } from './reviews.service';
import { ReviewsController } from './reviews.controller';
import { ReviewRequestsService } from './review-requests.service';
import { Offer, OfferSchema } from '../catalog/offers/schemas/offer.schema';
import {
  Organization,
  OrganizationSchema,
} from '../organizations/schemas/organization.schema';
// CommunicationModule (WhatsApp/email to the customer) and CrmModule (their first name). Neither
// imports ReviewsModule, BookingModule or CommerceModule — the modules that import this one —
// so no cycle. Offer and Organization are read through their schemas only, like ActivationModule.
import { CommunicationModule } from '../communication/communication.module';
import { CrmModule } from '../crm/crm.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Review.name, schema: ReviewSchema },
      { name: Offer.name, schema: OfferSchema },
      { name: Organization.name, schema: OrganizationSchema },
    ]),
    CommunicationModule,
    CrmModule,
  ],
  controllers: [ReviewsController],
  providers: [ReviewsRepository, ReviewsService, ReviewRequestsService],
  exports: [ReviewsService, ReviewRequestsService],
})
export class ReviewsModule {}
