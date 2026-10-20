import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';

import type { TtlString } from '../core/config/ttl';

import {
  CustomerAccount,
  CustomerAccountSchema,
} from './schemas/customer-account.schema';
import {
  CustomerSession,
  CustomerSessionSchema,
} from './schemas/customer-session.schema';
import {
  CustomerPasswordResetToken,
  CustomerPasswordResetTokenSchema,
} from './schemas/customer-password-reset-token.schema';

import { CustomerAccountRepository } from './customer-account.repository';
import { CustomerSessionRepository } from './customer-session.repository';
import { CustomerPasswordResetRepository } from './customer-password-reset.repository';
import { CustomerAuthService } from './customer-auth.service';
import { CustomerAuthController } from './customer-auth.controller';
import { CustomerJwtStrategy } from './strategies/customer-jwt.strategy';
import { CustomerAuthGuard } from './guards/customer-auth.guard';

import { OrganizationsModule } from '../organizations/organizations.module';
import { CrmModule } from '../crm/crm.module';
import { CommerceModule } from '../commerce/commerce.module';
import { BookingModule } from '../booking/booking.module';
import { IdentityModule } from '../identity/identity.module';
import { EmailModule } from '../shared/email/email.module';
import { FinanceModule } from '../finance/finance.module';
import { CatalogModule } from '../catalog/catalog.module';
import { DocumentsModule } from '../documents/documents.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { CustomerServiceModule } from '../customer-service/customer-service.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

/**
 * Top-level module (not nested under PublicModule) so it's independently testable/importable —
 * see customer-auth.controller.ts's class doc for how it relates to (and stays independent of)
 * PublicController's existing guest-checkout/tracking endpoints. Registered a *second*,
 * separately-configured JwtModule instance here (own secret, own default expiresIn) — verified
 * no reverse edge exists before importing CrmModule/CommerceModule/BookingModule/IdentityModule/
 * FinanceModule/CatalogModule/DocumentsModule/ReviewsModule/CustomerServiceModule (this module is
 * brand new, so nothing could import it back — re-verified via grep before each addition).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CustomerAccount.name, schema: CustomerAccountSchema },
      { name: CustomerSession.name, schema: CustomerSessionSchema },
      {
        name: CustomerPasswordResetToken.name,
        schema: CustomerPasswordResetTokenSchema,
      },
    ]),
    PassportModule,
    EmailModule,
    OrganizationsModule,
    CrmModule,
    CommerceModule,
    BookingModule,
    IdentityModule,
    FinanceModule,
    CatalogModule,
    DocumentsModule,
    ReviewsModule,
    CustomerServiceModule,
    SubscriptionsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('CUSTOMER_JWT_SECRET'),
        signOptions: {
          expiresIn: (configService.get<string>('CUSTOMER_JWT_ACCESS_TTL') ??
            '15m') as TtlString,
        },
      }),
    }),
  ],
  controllers: [CustomerAuthController],
  providers: [
    CustomerAccountRepository,
    CustomerSessionRepository,
    CustomerPasswordResetRepository,
    CustomerAuthService,
    CustomerJwtStrategy,
    CustomerAuthGuard,
  ],
})
export class CustomerAuthModule {}
