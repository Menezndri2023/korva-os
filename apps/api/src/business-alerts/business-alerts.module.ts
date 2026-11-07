import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { EmailModule } from '../shared/email/email.module';
import {
  Organization,
  OrganizationSchema,
} from '../organizations/schemas/organization.schema';
import {
  Membership,
  MembershipSchema,
} from '../identity/schemas/membership.schema';
import { User, UserSchema } from '../identity/schemas/user.schema';
import { BusinessAlertsService } from './business-alerts.service';

/** E-mails the business when its site brings an order, a booking, a request or a payment. */
@Module({
  imports: [
    ConfigModule,
    EmailModule,
    MongooseModule.forFeature([
      { name: Organization.name, schema: OrganizationSchema },
      { name: Membership.name, schema: MembershipSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  providers: [BusinessAlertsService],
  exports: [BusinessAlertsService],
})
export class BusinessAlertsModule {}
