import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthenticatedUser } from '../../core/tenant/request-context.types';

interface JwtPayload {
  sub: string;
  email: string;
  /** Present on an administration view token only — see AuthenticatedUser.viewOnly. */
  view?: { by: string; org: string };
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  validate(payload: JwtPayload): AuthenticatedUser {
    return {
      userId: payload.sub,
      email: payload.email,
      ...(payload.view
        ? {
            viewOnly: {
              adminUserId: payload.view.by,
              organizationId: payload.view.org,
            },
          }
        : {}),
    };
  }
}
