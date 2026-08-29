import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  addMemberSchema,
  acceptInvitationSchema,
  type AddMemberInput,
  type AcceptInvitationInput,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import { InvitationsService } from './invitations.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';

/** Same rationale and value as AuthController's AUTH_THROTTLE. The invitation token itself is a
 *  32-byte random hex value (see InvitationsService.invite), so brute-forcing it directly is
 *  infeasible regardless of rate limit — but this is still a @Public(), unauthenticated,
 *  account-adjacent endpoint (a successful call creates a session-worthy membership, and for an
 *  unknown email, a brand-new user account), so it should not be left on only the generic global
 *  120-req/min guard either. */
const INVITATION_ACCEPT_THROTTLE = { default: { limit: 30, ttl: 60_000 } };

/**
 * Two independent route prefixes on purpose, mirroring OrganizationsController's own
 * `me/members` shape for the invite side, and AuthController's password-reset/email-
 * verification routes for the public accept side (@Public() — no auth, the token itself is the
 * credential). See InvitationsService's class doc for why this lives under identity/ rather than
 * organizations/invitations/ as originally sketched.
 */
@ApiTags('organizations')
@Controller('organizations/me/invitations')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @RequirePermissions('settings.manage')
  @Post()
  invite(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(addMemberSchema)) body: AddMemberInput,
  ) {
    return this.invitationsService.invite(
      tenant.organizationId,
      tenant.userId,
      tenant.roleId,
      body,
    );
  }

  /** Lists still-pending (not yet accepted/expired-filtered-by-status) invitations for the
   *  current org, so the Settings UI can show "invited, awaiting acceptance" alongside active
   *  members instead of the invite silently disappearing after submit. `tokenHash` is
   *  `select:false` on the schema, so it is never present on these documents to begin with. */
  @RequirePermissions('settings.manage')
  @Get()
  listPending(@CurrentTenant() tenant: TenantContext) {
    return this.invitationsService.listPending(tenant.organizationId);
  }
}

@ApiTags('organizations')
@Controller('invitations')
export class InvitationsAcceptController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Public()
  @Throttle(INVITATION_ACCEPT_THROTTLE)
  @Post(':token/accept')
  accept(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(acceptInvitationSchema))
    body: AcceptInvitationInput,
  ) {
    return this.invitationsService.accept(token, body);
  }
}
