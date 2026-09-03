import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { randomBytes } from 'node:crypto';
import type { AddMemberInput } from '@korva/validation';
import {
  EMAIL_PROVIDER,
  type EmailProvider,
} from '../../communication/providers/email-provider.interface';
import { interpolate } from '../../shared/template';
import { requireSystemRoleRank } from '../../organizations/organizations.service';
import {
  Organization,
  OrganizationDocument,
} from '../../organizations/schemas/organization.schema';
import { InvitationsRepository } from './invitations.repository';
import { InvitationDocument } from '../schemas/invitation.schema';
import { RolesService } from '../roles/roles.service';
import { UsersService } from '../users/users.service';
import { MembershipsService } from '../memberships/memberships.service';
import { MembershipDocument } from '../schemas/membership.schema';
import { hashToken } from '../auth/token-hash.util';
import { AuditService } from '../../audit/audit.service';

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const INVITATION_EMAIL_SUBJECT_TEMPLATE =
  "You've been invited to join {{orgName}} on KORVA OS";

/** `{{orgName}}`/`{{acceptUrl}}` only — both are server-known (organization.name, a
 *  server-generated hex token), never user-supplied free text, but escapeHtml stays on for
 *  defense in depth, same posture as PasswordResetService/EmailVerificationService. */
const INVITATION_EMAIL_BODY_TEMPLATE =
  '<p>You have been invited to join <strong>{{orgName}}</strong> on KORVA OS.</p>' +
  '<p><a href="{{acceptUrl}}">Click here to accept the invitation</a>. This link expires in 7 days.</p>' +
  '<p>If you were not expecting this invitation, you can safely ignore this email.</p>';

export interface AcceptInvitationResult {
  organizationId: string;
  membershipId: string;
  roleId: string;
  userId: string;
  email: string;
  createdNewUser: boolean;
}

/**
 * The invite-by-email alternative to OrganizationsService.addMember, which requires the invited
 * address to already have a KORVA account (throws USER_NOT_FOUND otherwise — see that method).
 * This service never requires that: `accept` creates the account on the spot if none exists.
 *
 * Deliberately its own module/service under identity/invitations/ rather than
 * organizations/invitations/ — this wave's file ownership grants this agent all of
 * apps/api/src/identity/** but only organizations.service.ts (not organizations.module.ts or
 * organizations.controller.ts) under organizations/, and wiring a new controller into the app
 * requires editing whichever module registers it. Living under identity/ lets it be wired via
 * identity.module.ts (fully owned) with zero changes to any organizations/* or app.module.ts
 * file. Nest resolves controllers from every transitively-imported module regardless of where
 * they physically live, so the routes are unaffected: POST /organizations/me/invitations and
 * POST /invitations/:token/accept behave identically to if this lived under organizations/.
 */
@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly invitationsRepository: InvitationsRepository,
    private readonly rolesService: RolesService,
    private readonly usersService: UsersService,
    private readonly membershipsService: MembershipsService,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<OrganizationDocument>,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {}

  /**
   * Same role-hierarchy enforcement as OrganizationsService.addMember (reuses its exported
   * requireSystemRoleRank), applied at invite time rather than accept time — an inviter must
   * never be able to grant a role above their own rank, whether the invited email already has
   * an account or not.
   */
  async invite(
    organizationId: string,
    actorUserId: string,
    actorRoleId: string,
    input: AddMemberInput,
  ): Promise<InvitationDocument> {
    const role = await this.rolesService.getRoleById(input.roleId);
    if (!role || role.organizationId.toString() !== organizationId) {
      throw new NotFoundException({
        code: 'ROLE_NOT_FOUND',
        message: 'Role not found in this organization',
      });
    }

    const actorRole = await this.rolesService.getRoleById(actorRoleId);
    if (!actorRole) {
      throw new ForbiddenException({
        code: 'ROLE_HIERARCHY_UNKNOWN',
        message:
          'You cannot assign a role with higher privileges than your own.',
      });
    }
    if (
      requireSystemRoleRank(actorRole) >
      requireSystemRoleRank(role, {
        allowCustomAsMostSenior: actorRole.systemKey === 'OWNER',
      })
    ) {
      throw new ForbiddenException({
        code: 'ROLE_HIERARCHY_VIOLATION',
        message:
          'You cannot assign a role with higher privileges than your own.',
      });
    }

    const organization = await this.organizationModel
      .findById(organizationId)
      .exec();
    if (!organization) {
      throw new NotFoundException({
        code: 'ORGANIZATION_NOT_FOUND',
        message: 'Organization not found',
      });
    }

    const token = randomBytes(32).toString('hex');
    const invitation = await this.invitationsRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      email: input.email.toLowerCase(),
      roleId: new Types.ObjectId(input.roleId),
      invitedByUserId: new Types.ObjectId(actorUserId),
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    });

    await this.auditService.record({
      organizationId,
      userId: actorUserId,
      action: 'CREATE',
      entity: 'invitation',
      entityId: invitation.id as string,
      metadata: { invitedEmail: invitation.email, roleId: input.roleId },
    });

    const acceptUrl = this.buildAcceptUrl(token);
    const subject = interpolate(
      INVITATION_EMAIL_SUBJECT_TEMPLATE,
      { orgName: organization.name },
      { escapeHtml: false },
    );
    const body = interpolate(
      INVITATION_EMAIL_BODY_TEMPLATE,
      { orgName: organization.name, acceptUrl },
      { escapeHtml: true },
    );

    try {
      await this.emailProvider.send({ to: invitation.email, subject, body });
    } catch (error) {
      // Additive, never allowed to turn a successfully-created invitation into a failed
      // request — same posture as PasswordResetService.forgotPassword's email send.
      this.logger.error('Failed to send invitation email', error);
    }

    return invitation;
  }

  /**
   * Accepts an invitation: finds-or-creates the invited user, then atomically consumes the
   * token (the single-use gate — see InvitationsRepository.consume) before creating the
   * membership. A membership-creation race between two different pending invitations for the
   * same email+organization is closed by Membership's own unique (userId, organizationId)
   * index — see the catch below, mirroring PasswordResetRepository's isDuplicateUserIdError
   * pattern.
   */
  async accept(
    token: string,
    newAccountInput: {
      password?: string;
      firstName?: string;
      lastName?: string;
    },
  ): Promise<AcceptInvitationResult> {
    const tokenHash = hashToken(token);
    const pending =
      await this.invitationsRepository.findValidByTokenHash(tokenHash);
    if (!pending) {
      throw new UnauthorizedException({
        code: 'INVALID_INVITATION_TOKEN',
        message: 'This invitation is invalid, expired, or already used',
      });
    }

    let user = await this.usersService.findByEmail(pending.email);
    let createdNewUser = false;
    if (!user) {
      if (!newAccountInput.password) {
        throw new UnauthorizedException({
          code: 'PASSWORD_REQUIRED',
          message: 'A password is required to create your account',
        });
      }
      user = await this.usersService.create(
        pending.email,
        newAccountInput.password,
        newAccountInput.firstName,
        newAccountInput.lastName,
      );
      createdNewUser = true;
    }

    const consumed = await this.invitationsRepository.consume(
      tokenHash,
      new Types.ObjectId(user.id as string),
    );
    if (!consumed) {
      throw new UnauthorizedException({
        code: 'INVALID_INVITATION_TOKEN',
        message: 'This invitation is invalid, expired, or already used',
      });
    }

    let membership: MembershipDocument;
    try {
      membership = await this.membershipsService.create(
        user.id as string,
        consumed.organizationId.toString(),
        consumed.roleId.toString(),
      );
    } catch (error) {
      if (!isDuplicateMembershipError(error)) throw error;
      const existing = await this.membershipsService.findByUserAndOrganization(
        user.id as string,
        consumed.organizationId.toString(),
      );
      if (!existing) throw error;
      membership = existing;
    }

    await this.auditService.record({
      organizationId: consumed.organizationId.toString(),
      userId: user.id as string,
      action: 'CREATE',
      entity: 'membership',
      entityId: membership.id as string,
      metadata: { viaInvitation: true, roleId: consumed.roleId.toString() },
    });

    return {
      organizationId: consumed.organizationId.toString(),
      membershipId: membership.id as string,
      roleId: consumed.roleId.toString(),
      userId: user.id as string,
      email: user.email,
      createdNewUser,
    };
  }

  listPending(organizationId: string): Promise<InvitationDocument[]> {
    return this.invitationsRepository.listPendingForOrganization(
      organizationId,
    );
  }

  private buildAcceptUrl(token: string): string {
    const appUrl =
      this.configService.get<string>('APP_URL') ?? 'http://localhost:3000';
    return `${appUrl}/invitations/accept?token=${token}`;
  }
}

/** True for the MongoDB duplicate-key error raised by Membership's unique (userId,
 *  organizationId) index — mirrors PasswordResetRepository's isDuplicateUserIdError. */
function isDuplicateMembershipError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code } = error as Record<string, unknown>;
  return code === 11000;
}
