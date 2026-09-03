import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';

import type { TtlString } from '../core/config/ttl';

import { User, UserSchema } from './schemas/user.schema';
import { Role, RoleSchema } from './schemas/role.schema';
import { Membership, MembershipSchema } from './schemas/membership.schema';
import { Session, SessionSchema } from './schemas/session.schema';
import {
  PasswordResetToken,
  PasswordResetTokenSchema,
} from './schemas/password-reset-token.schema';
import {
  EmailVerificationToken,
  EmailVerificationTokenSchema,
} from './schemas/email-verification-token.schema';
import {
  Organization,
  OrganizationSchema,
} from '../organizations/schemas/organization.schema';

import { UsersRepository } from './users/users.repository';
import { UsersService } from './users/users.service';
import { RolesRepository } from './roles/roles.repository';
import { RolesService } from './roles/roles.service';
import { RolesController } from './roles/roles.controller';
import { MembershipsRepository } from './memberships/memberships.repository';
import { MembershipsService } from './memberships/memberships.service';
import { SessionsRepository } from './auth/sessions.repository';
import { SessionsService } from './auth/sessions.service';
import { AuthService } from './auth/auth.service';
import { AuthController } from './auth/auth.controller';
import { PasswordResetRepository } from './auth/password-reset.repository';
import { PasswordResetService } from './auth/password-reset.service';
import { EmailVerificationRepository } from './auth/email-verification.repository';
import { EmailVerificationService } from './auth/email-verification.service';
import { TwoFactorService } from './auth/two-factor.service';
import { TwoFactorController } from './auth/two-factor.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { EmailModule } from '../shared/email/email.module';
import {
  InvitationsController,
  InvitationsAcceptController,
} from './invitations/invitations.controller';
import { InvitationsService } from './invitations/invitations.service';
import { InvitationsRepository } from './invitations/invitations.repository';
import { Invitation, InvitationSchema } from './schemas/invitation.schema';
import { AuditModule } from '../audit/audit.module';
import { ApiKey, ApiKeySchema } from './schemas/api-key.schema';
import { ApiKeysRepository } from './api-keys/api-keys.repository';
import { ApiKeysService } from './api-keys/api-keys.service';
import { ApiKeysController } from './api-keys/api-keys.controller';
import { ApiKeyGuard } from '../core/guards/api-key.guard';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Role.name, schema: RoleSchema },
      { name: Membership.name, schema: MembershipSchema },
      { name: Session.name, schema: SessionSchema },
      { name: PasswordResetToken.name, schema: PasswordResetTokenSchema },
      {
        name: EmailVerificationToken.name,
        schema: EmailVerificationTokenSchema,
      },
      { name: Invitation.name, schema: InvitationSchema },
      { name: ApiKey.name, schema: ApiKeySchema },
      // Registered here (not via OrganizationsModule) so MembershipsService can read
      // enabledModules while resolving TenantContext — OrganizationsModule already imports
      // IdentityModule, so depending on OrganizationsModule/OrganizationsRepository here would
      // be circular.
      { name: Organization.name, schema: OrganizationSchema },
    ]),
    PassportModule,
    EmailModule,
    AuditModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: (configService.get<string>('JWT_ACCESS_TTL') ??
            '15m') as TtlString,
        },
      }),
    }),
  ],
  controllers: [
    AuthController,
    TwoFactorController,
    InvitationsController,
    InvitationsAcceptController,
    ApiKeysController,
    RolesController,
  ],
  providers: [
    UsersRepository,
    UsersService,
    RolesRepository,
    RolesService,
    MembershipsRepository,
    MembershipsService,
    SessionsRepository,
    SessionsService,
    AuthService,
    PasswordResetRepository,
    PasswordResetService,
    EmailVerificationRepository,
    EmailVerificationService,
    TwoFactorService,
    InvitationsRepository,
    InvitationsService,
    JwtStrategy,
    ApiKeysRepository,
    ApiKeysService,
    ApiKeyGuard,
  ],
  exports: [UsersService, RolesService, MembershipsService],
})
export class IdentityModule {}
