import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
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
}

@ApiTags('organizations')
@Controller('invitations')
export class InvitationsAcceptController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Public()
  @Post(':token/accept')
  accept(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(acceptInvitationSchema))
    body: AcceptInvitationInput,
  ) {
    return this.invitationsService.accept(token, body);
  }
}
