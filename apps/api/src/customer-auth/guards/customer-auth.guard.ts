import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Guards the authenticated customer-portal routes (GET/PATCH /me, /orders, /bookings). Never
 * touches the staff JwtAuthGuard/TenantGuard/PermissionsGuard chain — this controller is
 * `@Public()` at the class level (see customer-auth.controller.ts) specifically so those global
 * guards skip it entirely, and this guard is applied explicitly per-route instead.
 *
 * Authenticating the token only proves *a* customer identity; it does not by itself prove that
 * identity belongs to the organization named in the URL's :organizationSlug — every handler that
 * uses this guard must still re-check `request.customer.organizationId` against the slug's
 * resolved organization (see CustomerAuthService's own methods), the same "never trust a claim
 * without re-verifying it against the URL" discipline PublicService already applies throughout.
 */
@Injectable()
export class CustomerAuthGuard extends AuthGuard('customer-jwt') {}
