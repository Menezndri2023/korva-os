import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import {
  EMAIL_PROVIDER,
  type EmailProvider,
} from '../../communication/providers/email-provider.interface';
import { LogEmailProvider } from '../../communication/providers/log-email.provider';
import { ResendEmailProvider } from '../../communication/providers/resend-email.provider';

/**
 * Neutral home for the EMAIL_PROVIDER binding, imported by both CommunicationModule (its
 * original owner) and IdentityModule (which needs it for password-reset emails). Neither of
 * those two modules can import the other directly — CommunicationModule already imports
 * IdentityModule for user/membership data, so IdentityModule importing CommunicationModule back
 * would be a circular module dependency (this repository has zero existing forwardRef() usage;
 * introducing one here would be a first, avoidable by having both depend on this third, leaf
 * module instead). ResendEmailProvider/LogEmailProvider are plain classes with no dependency on
 * anything under communication/ beyond the EmailProvider interface itself, so they are reused
 * from their existing location as-is — moving them would be a needless relocation.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: EMAIL_PROVIDER,
      useFactory: (configService: ConfigService): EmailProvider => {
        const apiKey = configService.get<string>('RESEND_API_KEY');
        if (
          configService.get<string>('EMAIL_PROVIDER') === 'resend' &&
          apiKey
        ) {
          return new ResendEmailProvider(
            apiKey,
            configService.get<string>('EMAIL_FROM') ?? 'no-reply@korva.app',
          );
        }
        return new LogEmailProvider();
      },
      inject: [ConfigService],
    },
  ],
  exports: [EMAIL_PROVIDER],
})
export class EmailModule {}
