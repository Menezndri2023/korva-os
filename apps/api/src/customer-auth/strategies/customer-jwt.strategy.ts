import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface AuthenticatedCustomer {
  customerAccountId: string;
  contactId: string;
  organizationId: string;
}

interface CustomerJwtPayload {
  sub: string;
  contactId: string;
  organizationId: string;
  typ: 'customer';
}

/**
 * Deliberately its own Passport strategy name ('customer-jwt', registered below), never the
 * default 'jwt' the staff JwtStrategy uses — signed with CUSTOMER_JWT_SECRET, a distinct env
 * var from JWT_SECRET. This is the load-bearing security boundary: a customer token can never
 * verify against the staff strategy's key (wrong secret), and even in the hypothetical case of
 * a shared secret, the explicit `typ !== 'customer'` check below rejects it as defense in depth.
 * Conversely a staff-issued token (payload `{sub, email}`, no `typ`) fails here for the same
 * two independent reasons.
 */
@Injectable()
export class CustomerJwtStrategy extends PassportStrategy(
  Strategy,
  'customer-jwt',
) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('CUSTOMER_JWT_SECRET'),
    });
  }

  validate(payload: CustomerJwtPayload): AuthenticatedCustomer {
    if (payload.typ !== 'customer') {
      throw new UnauthorizedException({
        code: 'INVALID_CUSTOMER_TOKEN',
        message: 'Invalid customer session',
      });
    }
    return {
      customerAccountId: payload.sub,
      contactId: payload.contactId,
      organizationId: payload.organizationId,
    };
  }
}
