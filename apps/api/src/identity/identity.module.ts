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

import { UsersRepository } from './users/users.repository';
import { UsersService } from './users/users.service';
import { RolesRepository } from './roles/roles.repository';
import { RolesService } from './roles/roles.service';
import { MembershipsRepository } from './memberships/memberships.repository';
import { MembershipsService } from './memberships/memberships.service';
import { SessionsRepository } from './auth/sessions.repository';
import { SessionsService } from './auth/sessions.service';
import { AuthService } from './auth/auth.service';
import { AuthController } from './auth/auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Role.name, schema: RoleSchema },
      { name: Membership.name, schema: MembershipSchema },
      { name: Session.name, schema: SessionSchema },
    ]),
    PassportModule,
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
  controllers: [AuthController],
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
    JwtStrategy,
  ],
  exports: [UsersService, RolesService, MembershipsService],
})
export class IdentityModule {}
