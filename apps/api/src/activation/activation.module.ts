import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { EmailModule } from '../shared/email/email.module';
import {
  Organization,
  OrganizationSchema,
} from '../organizations/schemas/organization.schema';
import { Offer, OfferSchema } from '../catalog/offers/schemas/offer.schema';
import {
  Membership,
  MembershipSchema,
} from '../identity/schemas/membership.schema';
import { User, UserSchema } from '../identity/schemas/user.schema';
import { Session, SessionSchema } from '../identity/schemas/session.schema';
import { ActivationReportService } from './activation-report.service';
import { ActivationController } from './activation.controller';
import { ActivationNudgeService } from './activation-nudge.service';
import { ActivationNudgeSchedulerService } from './activation-nudge-scheduler.service';

/** Helping a new organization reach a working site — see ActivationNudgeService. */
@Module({
  imports: [
    ConfigModule,
    EmailModule,
    MongooseModule.forFeature([
      { name: Organization.name, schema: OrganizationSchema },
      { name: Offer.name, schema: OfferSchema },
      { name: Membership.name, schema: MembershipSchema },
      { name: User.name, schema: UserSchema },
      { name: Session.name, schema: SessionSchema },
    ]),
  ],
  controllers: [ActivationController],
  providers: [
    ActivationNudgeService,
    ActivationNudgeSchedulerService,
    ActivationReportService,
  ],
  exports: [ActivationNudgeService],
})
export class ActivationModule {}
