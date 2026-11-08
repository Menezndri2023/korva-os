import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AddMemberInput,
  CreateOrganizationInput,
  UpdateOrganizationInput,
} from '@korva/validation';
import {
  BUSINESS_MODEL_DEFINITIONS,
  ONLINE_PAYMENT_TERMS_VERSION,
  onlinePaymentTermsAccepted,
  SYSTEM_ROLE_RANK,
  planHasFeature,
  verticalForOrganizationType,
  type BusinessModel,
  type KorvaModule,
} from '@korva/types';
import { Types } from 'mongoose';
import { OrganizationsRepository } from './organizations.repository';
import { OrganizationDocument } from './schemas/organization.schema';
import {
  extractBusinessInfoFromHtml,
  type ExtractedBusinessInfo,
} from './business-import.util';
import { safeFetch, UnsafeWebhookUrlError } from '../shared/safe-fetch';
import { RolesService } from '../identity/roles/roles.service';
import { RoleDocument } from '../identity/schemas/role.schema';
import { MembershipsService } from '../identity/memberships/memberships.service';
import { UsersService } from '../identity/users/users.service';
import { AuditService } from '../audit/audit.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { EntitlementsService } from '../subscriptions/entitlements.service';
import { randomBytes } from 'crypto';
import type { ReferralSummary } from '@korva/types';

const REFERRAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Rank of a role for role-assignment hierarchy purposes only (see addMember). Custom roles
 * (no systemKey, or an unrecognized one) have no known rank and must never be assumed to
 * outrank anything — callers must fail closed rather than fall back to a permissive default.
 *
 * `allowCustomAsMostSenior` is the one deliberate escape hatch, and must ONLY ever be passed
 * when checking a TARGET role being granted/removed/kept — never for the actor's own role,
 * which must always fail closed regardless. A custom role's real seniority is business-defined
 * and unknowable here; ties it with OWNER (rank 0) purely so the `actorRank > targetRank`
 * comparison at the call site evaluates false — safe only because every call site only ever
 * sets this to `true` after independently confirming the actor's OWN role is OWNER, who may
 * already grant/edit/remove anything by definition.
 */
export function requireSystemRoleRank(
  role: RoleDocument,
  options?: { allowCustomAsMostSenior?: boolean },
): number {
  const rank = role.systemKey ? SYSTEM_ROLE_RANK[role.systemKey] : undefined;
  if (rank === undefined) {
    if (options?.allowCustomAsMostSenior) {
      return 0;
    }
    throw new ForbiddenException({
      code: 'ROLE_HIERARCHY_UNKNOWN',
      message: 'You cannot assign a role with higher privileges than your own.',
    });
  }
  return rank;
}

/** Phase E2 — derives a short storefront-hero tagline from the owner's own entered business
 *  description: the first sentence if it's reasonably short, otherwise a hard character-limit
 *  truncation. Deliberately never rewrites/embellishes the owner's wording, just excerpts it —
 *  see createOrganizationSchema's own doc comment on `businessDescription` for why. Matches
 *  Organization.tagline's own 200-char cap (see updateOrganizationSchema). */
const TAGLINE_MAX_LENGTH = 200;

export function deriveTaglineFromDescription(description: string): string {
  const trimmed = description.trim();
  const firstSentenceMatch = /^[^.!?\n]+[.!?]/.exec(trimmed);
  const firstSentence = firstSentenceMatch?.[0].trim();
  if (firstSentence && firstSentence.length <= TAGLINE_MAX_LENGTH) {
    return firstSentence;
  }
  if (trimmed.length <= TAGLINE_MAX_LENGTH) {
    return trimmed;
  }
  return `${trimmed.slice(0, TAGLINE_MAX_LENGTH - 1).trimEnd()}…`;
}

const DIACRITICS_PATTERN = new RegExp('[\\u0300-\\u036f]', 'g');

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICS_PATTERN, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * The modules a new organization starts with: everything its plan grants, except that a plan
 * without `both_channels` (Free) gets ONE sales channel — the one its type of activity sells
 * through. Without this, every new free organization would start with bookings AND orders, and
 * assertModulesAllowed's "keep what you already have" rule would let it keep both for good.
 *
 * Orders for shops, restaurants and associations; bookings for everyone else, including
 * services on quote (appointments) and real estate (visits), and an organization whose type of
 * activity is unknown.
 */
function defaultModulesFor(
  planModules: KorvaModule[],
  planKey: string,
  businessModel: BusinessModel | undefined,
): KorvaModule[] {
  if (planHasFeature(planKey, 'both_channels')) return planModules;
  const sellsOrders =
    businessModel !== undefined &&
    BUSINESS_MODEL_DEFINITIONS[businessModel].primaryChannel === 'orders';
  const dropped: KorvaModule = sellsOrders ? 'booking' : 'commerce';
  return planModules.filter((module) => module !== dropped);
}

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly organizationsRepository: OrganizationsRepository,
    private readonly rolesService: RolesService,
    private readonly membershipsService: MembershipsService,
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly entitlementsService: EntitlementsService,
  ) {}

  async createForOwner(
    ownerUserId: string,
    input: CreateOrganizationInput,
  ): Promise<OrganizationDocument> {
    const baseSlug = slugify(input.name) || 'organization';
    const existingCount =
      await this.organizationsRepository.countBySlugPrefix(baseSlug);
    const slug =
      existingCount === 0 ? baseSlug : `${baseSlug}-${existingCount + 1}`;

    // Phase E2 — real auto-generation of the storefront's tagline/aboutText from the owner's
    // own entered business description, instead of the org starting with no content at all
    // (the only way to get any was previously the separate "import from an existing external
    // site" scrape flow). Never invented: absent input.businessDescription, both stay unset,
    // exactly like before this phase.
    const generatedContent = input.businessDescription
      ? {
          tagline: deriveTaglineFromDescription(input.businessDescription),
          aboutText: input.businessDescription.trim(),
        }
      : {};

    const businessModel =
      input.businessModel ??
      verticalForOrganizationType(input.type)?.businessModel;
    // A parrainage link: an unknown code is simply ignored, it never blocks the signup.
    const referrer = input.referralCode
      ? await this.organizationsRepository.findByReferralCode(
          input.referralCode.toUpperCase(),
        )
      : null;
    const organization = await this.organizationsRepository.create({
      name: input.name,
      slug,
      type: input.type,
      businessModel,
      country: input.country,
      currency: input.currency,
      timezone: input.timezone,
      language: input.language,
      acquisitionSource:
        input.acquisitionSource ?? (referrer ? 'referral' : undefined),
      ...(referrer ? { referredByOrganizationId: referrer._id } : {}),
      settings: { onboardingCompleted: false },
      enabledModules: [],
      ...generatedContent,
    });

    await this.rolesService.seedSystemRoles(organization.id as string);
    const ownerRole = await this.rolesService.getOwnerRole(
      organization.id as string,
    );
    if (!ownerRole) {
      throw new Error('Failed to seed OWNER role for new organization');
    }

    await this.membershipsService.create(
      ownerUserId,
      organization.id as string,
      ownerRole.id as string,
    );

    await this.subscriptionsService.createDefaultSubscription(
      organization.id as string,
    );

    // A freshly created organization must default to every module its assigned plan
    // actually allows, not an empty set — otherwise every module (CRM, Catalog, Booking,
    // Commerce, Finance, Analytics, Workflow, Communication, AI) stays undiscoverable until
    // someone opts each one in manually via Settings. The plan can only be resolved once the
    // default subscription above exists, and enabledModules must always stay a subset of the
    // plan's own module list (never a hardcoded literal — see EntitlementsService.assertModulesAllowed).
    const plan = await this.subscriptionsService.getActivePlan(
      organization.id as string,
    );
    const withDefaultModules = await this.organizationsRepository.update(
      organization.id as string,
      {
        enabledModules: defaultModulesFor(
          plan.modules,
          plan.key,
          businessModel,
        ),
      },
    );
    if (!withDefaultModules) {
      throw new Error('Failed to enable default modules for new organization');
    }

    await this.auditService.record({
      organizationId: organization.id as string,
      userId: ownerUserId,
      action: 'CREATE',
      entity: 'organization',
      entityId: organization.id as string,
      metadata: { name: organization.name },
    });

    return withDefaultModules;
  }

  /**
   * The business's parrainage code (created on first use) and what it has brought so far. The
   * code is short and unambiguous to read aloud or type from a WhatsApp message: no 0/O, 1/I.
   */
  async referralSummary(organizationId: string): Promise<ReferralSummary> {
    const organization = await this.getById(organizationId);
    let code = organization.referralCode;
    for (let attempt = 0; !code && attempt < 5; attempt++) {
      const candidate = Array.from(
        randomBytes(6),
        (byte) => REFERRAL_ALPHABET[byte % REFERRAL_ALPHABET.length],
      ).join('');
      // The unique index decides between two businesses drawing the same code.
      code =
        (await this.organizationsRepository.setReferralCodeIfMissing(
          organizationId,
          candidate,
        )) ?? undefined;
    }
    if (!code) {
      throw new Error('Could not create a referral code');
    }
    const { signedUp, rewarded } =
      await this.organizationsRepository.countReferrals(organizationId);
    return { code, signedUp, rewarded };
  }

  async getBySlug(slug: string): Promise<OrganizationDocument> {
    const organization = await this.organizationsRepository.findBySlug(slug);
    if (!organization) {
      throw new NotFoundException({
        code: 'ORGANIZATION_NOT_FOUND',
        message: 'Organization not found',
      });
    }
    return organization;
  }

  async getById(id: string): Promise<OrganizationDocument> {
    const organization = await this.organizationsRepository.findById(id);
    if (!organization) {
      throw new NotFoundException({
        code: 'ORGANIZATION_NOT_FOUND',
        message: 'Organization not found',
      });
    }
    return organization;
  }

  /** Phase E4 — powers apps/storefront's sitemap.ts. Deliberately not org-scoped (the storefront
   *  needs every tenant, not one) and deliberately thin (slug + updatedAt only). */
  listWebsiteSitemapEntries() {
    return this.organizationsRepository.findWebsiteEnabledSlugs();
  }

  /** Phase E3 — powers PublicSitesController#resolveDomain (apps/storefront's custom-domain
   *  middleware calls it on every request to an unrecognized host). */
  getByCustomDomain(
    customDomain: string,
  ): Promise<OrganizationDocument | null> {
    return this.organizationsRepository.findByCustomDomain(customDomain);
  }

  async listForUser(userId: string): Promise<OrganizationDocument[]> {
    const memberships =
      await this.membershipsService.listOrganizationIdsForUser(userId);
    if (memberships.length === 0) return [];
    return this.organizationsRepository.findByIds(
      memberships.map((m) => m.organizationId.toString()),
    );
  }

  async update(
    id: string,
    input: UpdateOrganizationInput,
    actorUserId?: string,
  ): Promise<OrganizationDocument> {
    const { acceptOnlinePaymentTerms, ...changes } = input;
    // Accepting the online payment terms is recorded with whoever saved it — only the current
    // version counts (ONLINE_PAYMENT_TERMS_VERSION).
    const acceptingTerms =
      acceptOnlinePaymentTerms === ONLINE_PAYMENT_TERMS_VERSION && actorUserId;
    const termsUpdate = acceptingTerms
      ? {
          onlinePaymentTerms: {
            version: ONLINE_PAYMENT_TERMS_VERSION,
            acceptedAt: new Date(),
            acceptedByUserId: new Types.ObjectId(actorUserId),
          },
        }
      : {};
    if (input.enabledModules) {
      await this.entitlementsService.assertModulesAllowed(
        id,
        input.enabledModules,
      );
    }
    // Offering online payment is a paid feature; checked only when it is being turned ON, so a
    // downgraded organization can still save its settings with it already listed (the
    // storefront stops offering it on its own — PublicService#isOnlinePaymentAvailable).
    if (input.acceptedPaymentMethods?.includes('online')) {
      const current = await this.organizationsRepository.findById(id);
      if (!current?.acceptedPaymentMethods?.includes('online')) {
        await this.entitlementsService.assertFeature(id, 'online_payment');
      }
      // Online payment is the business's choice, made knowingly: it cannot be on without the
      // current terms accepted — now, or before.
      if (
        !acceptingTerms &&
        !onlinePaymentTermsAccepted(current?.onlinePaymentTerms)
      ) {
        throw new BadRequestException({
          code: 'ONLINE_PAYMENT_TERMS_REQUIRED',
          message:
            'Accept the online payment terms to offer online payment to your customers',
          version: ONLINE_PAYMENT_TERMS_VERSION,
        });
      }
    }
    if (
      input.storefrontTemplate ||
      input.storefrontPalette ||
      input.storefrontFontPairing
    ) {
      const current = await this.organizationsRepository.findById(id);
      await this.entitlementsService.assertStorefrontThemeAllowed(id, {
        template: input.storefrontTemplate ?? current?.storefrontTemplate,
        palette: input.storefrontPalette,
        fontPairing: input.storefrontFontPairing,
      });
    }
    // The site grows with the plan: story and FAQ on Starter, people and pictures on Pro.
    // Clearing is always allowed (an empty value or list), so a downgraded business can tidy up.
    if (input.aboutText || (input.faqItems && input.faqItems.length > 0)) {
      await this.entitlementsService.assertFeature(id, 'site_about_faq');
    }
    if (input.announcement) {
      await this.entitlementsService.assertFeature(id, 'site_announcement');
    }
    if (
      (input.testimonials && input.testimonials.length > 0) ||
      (input.teamMembers && input.teamMembers.length > 0) ||
      (input.galleryImages && input.galleryImages.length > 0)
    ) {
      await this.entitlementsService.assertFeature(id, 'site_showcase');
    }
    if (input.name) {
      const existing = await this.organizationsRepository.findBySlug(
        slugify(input.name),
      );
      if (existing && existing.id !== id) {
        throw new ConflictException({
          code: 'SLUG_TAKEN',
          message: 'Organization name already in use',
        });
      }
    }
    if (input.customDomain) {
      // Plan check before the uniqueness check: a free organization must be told its plan does
      // not include a custom domain, not that the domain it wants is taken.
      await this.entitlementsService.assertCustomDomainAllowed(id);
      const existing = await this.organizationsRepository.findByCustomDomain(
        input.customDomain,
      );
      if (existing && existing.id !== id) {
        throw new ConflictException({
          code: 'CUSTOM_DOMAIN_TAKEN',
          message: 'This domain is already connected to another organization',
        });
      }
    }
    const organization = await this.organizationsRepository.update(id, {
      ...changes,
      ...termsUpdate,
    });
    if (!organization) {
      throw new NotFoundException({
        code: 'ORGANIZATION_NOT_FOUND',
        message: 'Organization not found',
      });
    }
    return organization;
  }

  /** Whole-list replace, not a merge — see AiOrchestratorService.updateAutoApprovedTools, which
   *  validates every name against the currently-sensitive tool list before calling this. */
  async updateAiAutoApprovedTools(
    id: string,
    toolNames: string[],
  ): Promise<OrganizationDocument> {
    const organization = await this.organizationsRepository.update(id, {
      aiAutoApprovedTools: toolNames,
    });
    if (!organization) {
      throw new NotFoundException({
        code: 'ORGANIZATION_NOT_FOUND',
        message: 'Organization not found',
      });
    }
    return organization;
  }

  listMembers(organizationId: string) {
    return this.membershipsService.listMembersForOrganization(organizationId);
  }

  listRoles(organizationId: string) {
    return this.rolesService.listForOrganization(organizationId);
  }

  async addMember(
    organizationId: string,
    actorUserId: string,
    actorRoleId: string,
    input: AddMemberInput,
  ) {
    await this.entitlementsService.assertSeatAvailable(organizationId);

    const user = await this.usersService.findByEmail(input.email);
    if (!user) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'No user found with this email',
      });
    }

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
    const actorIsOwner = actorRole.systemKey === 'OWNER';
    if (
      requireSystemRoleRank(actorRole) >
      requireSystemRoleRank(role, { allowCustomAsMostSenior: actorIsOwner })
    ) {
      throw new ForbiddenException({
        code: 'ROLE_HIERARCHY_VIOLATION',
        message:
          'You cannot assign a role with higher privileges than your own.',
      });
    }

    // Placed AFTER the hierarchy checks on purpose: reactivating somebody is granting them a
    // role, so it has to pass exactly the same rank rules as granting it for the first time.
    //
    // Without this branch, re-hiring a removed member returned a 500 — `create` always inserts
    // and the unique index on (userId, organizationId) rejected it as a duplicate key, which
    // nothing in the stack maps to an HTTP status. Adding somebody who is already an active
    // member had the same ending, for the same reason.
    const existing = await this.membershipsService.findByUserAndOrganization(
      user.id as string,
      organizationId,
    );
    if (existing) {
      if (existing.status !== 'suspended') {
        throw new ConflictException({
          code: 'ALREADY_A_MEMBER',
          message: 'This user already belongs to the organization',
        });
      }
      const reactivated = await this.membershipsService.reactivate(
        existing.id as string,
        input.roleId,
      );
      await this.auditService.record({
        organizationId,
        userId: actorUserId,
        action: 'UPDATE',
        entity: 'membership',
        entityId: existing.id as string,
        metadata: {
          reactivatedUserId: user.id,
          roleId: input.roleId,
        },
      });
      return reactivated;
    }

    const membership = await this.membershipsService.create(
      user.id as string,
      organizationId,
      input.roleId,
    );

    await this.auditService.record({
      organizationId,
      userId: actorUserId,
      action: 'CREATE',
      entity: 'membership',
      entityId: membership.id as string,
      metadata: { invitedUserId: user.id, roleId: input.roleId },
    });

    return membership;
  }

  /**
   * Changes an existing member's role. Same hierarchy invariant as addMember (an actor can never
   * assign a role that outranks their own), extended with a second check addMember doesn't need:
   * the membership's CURRENT role must also not outrank the actor — otherwise an ADMIN could
   * demote an OWNER despite never being allowed to grant OWNER-rank access in the first place.
   * Also guards against demoting an organization's last active OWNER, which would otherwise leave
   * the org with no one able to manage it.
   */
  async updateMemberRole(
    organizationId: string,
    actorUserId: string,
    actorRoleId: string,
    membershipId: string,
    newRoleId: string,
  ) {
    const membership = await this.membershipsService.findByIdForOrganization(
      membershipId,
      organizationId,
    );
    if (!membership) {
      throw new NotFoundException({
        code: 'MEMBERSHIP_NOT_FOUND',
        message: 'Membership not found',
      });
    }

    const newRole = await this.rolesService.getRoleById(newRoleId);
    if (!newRole || newRole.organizationId.toString() !== organizationId) {
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
    const currentRole = membership.roleId as unknown as RoleDocument;
    const actorIsOwner = actorRole.systemKey === 'OWNER';
    if (
      requireSystemRoleRank(actorRole) >
        requireSystemRoleRank(newRole, {
          allowCustomAsMostSenior: actorIsOwner,
        }) ||
      requireSystemRoleRank(actorRole) >
        requireSystemRoleRank(currentRole, {
          allowCustomAsMostSenior: actorIsOwner,
        })
    ) {
      throw new ForbiddenException({
        code: 'ROLE_HIERARCHY_VIOLATION',
        message:
          'You cannot assign a role with higher privileges than your own.',
      });
    }

    if (
      currentRole.systemKey === 'OWNER' &&
      newRole.systemKey !== 'OWNER' &&
      (await this.membershipsService.countActiveByRole(
        organizationId,
        currentRole.id as string,
      )) <= 1
    ) {
      throw new ForbiddenException({
        code: 'CANNOT_DEMOTE_LAST_OWNER',
        message: 'An organization must always have at least one owner.',
      });
    }

    const updated = await this.membershipsService.updateRole(
      membershipId,
      newRoleId,
    );

    await this.auditService.record({
      organizationId,
      userId: actorUserId,
      action: 'ROLE_CHANGE',
      entity: 'membership',
      entityId: membershipId,
      metadata: { previousRoleId: currentRole.id as string, roleId: newRoleId },
    });

    return updated;
  }

  /**
   * Sets a member's default hourly rate — pre-fills TimeEntry.hourlyRate for that staff member
   * when a time entry omits one (see TimeEntriesService.create). Unlike updateMemberRole, this
   * carries no privilege-hierarchy concern (a rate is a billing detail, not an access level), so
   * the only guard needed is that the membership actually belongs to this organization.
   */
  async updateMemberRate(
    organizationId: string,
    actorUserId: string,
    membershipId: string,
    defaultHourlyRate: number,
  ) {
    const membership = await this.membershipsService.findByIdForOrganization(
      membershipId,
      organizationId,
    );
    if (!membership) {
      throw new NotFoundException({
        code: 'MEMBERSHIP_NOT_FOUND',
        message: 'Membership not found',
      });
    }

    const updated = await this.membershipsService.updateDefaultHourlyRate(
      membershipId,
      defaultHourlyRate,
    );

    await this.auditService.record({
      organizationId,
      userId: actorUserId,
      action: 'UPDATE',
      entity: 'membership',
      entityId: membershipId,
      metadata: { defaultHourlyRate },
    });

    return updated;
  }

  /** Same shape/guards as updateMemberRate above. */
  async updateMemberCommissionRate(
    organizationId: string,
    actorUserId: string,
    membershipId: string,
    commissionRateBasisPoints: number,
  ) {
    const membership = await this.membershipsService.findByIdForOrganization(
      membershipId,
      organizationId,
    );
    if (!membership) {
      throw new NotFoundException({
        code: 'MEMBERSHIP_NOT_FOUND',
        message: 'Membership not found',
      });
    }

    const updated = await this.membershipsService.updateCommissionRate(
      membershipId,
      commissionRateBasisPoints,
    );

    await this.auditService.record({
      organizationId,
      userId: actorUserId,
      action: 'UPDATE',
      entity: 'membership',
      entityId: membershipId,
      metadata: { commissionRateBasisPoints },
    });

    return updated;
  }

  /**
   * Removes a member — a status change to 'suspended', never a delete (same revoke-not-delete
   * convention as invitations/integration accounts). Guards: an actor can never remove someone
   * who outranks them, can never remove themselves via this route (self-removal from the org
   * they're managing is not this action's job), and can never remove an organization's last
   * active OWNER.
   */
  async removeMember(
    organizationId: string,
    actorUserId: string,
    actorRoleId: string,
    membershipId: string,
  ) {
    const membership = await this.membershipsService.findByIdForOrganization(
      membershipId,
      organizationId,
    );
    if (!membership) {
      throw new NotFoundException({
        code: 'MEMBERSHIP_NOT_FOUND',
        message: 'Membership not found',
      });
    }

    // membership.userId is POPULATED here (findByIdForOrganization populates it) — it is a full
    // User sub-document at runtime despite the schema's static ObjectId type, so `.toString()`
    // would stringify the object itself, not its id. `.id` is Mongoose's own virtual getter
    // (present on every hydrated document by default), the same accessor already relied on for
    // `currentRole.id` below.
    const memberUserId = (membership.userId as unknown as { id: string }).id;
    if (memberUserId === actorUserId) {
      throw new ForbiddenException({
        code: 'CANNOT_REMOVE_SELF',
        message: 'You cannot remove your own membership.',
      });
    }

    const actorRole = await this.rolesService.getRoleById(actorRoleId);
    const currentRole = membership.roleId as unknown as RoleDocument;
    if (
      !actorRole ||
      requireSystemRoleRank(actorRole) >
        requireSystemRoleRank(currentRole, {
          allowCustomAsMostSenior: actorRole.systemKey === 'OWNER',
        })
    ) {
      throw new ForbiddenException({
        code: 'ROLE_HIERARCHY_VIOLATION',
        message:
          'You cannot remove a member with higher privileges than your own.',
      });
    }

    // No separate "last owner" count guard here (unlike updateMemberRole, which does need one):
    // the hierarchy check above only lets an OWNER-ranked actor remove an OWNER-ranked target
    // (nothing outranks OWNER, so no lower-ranked actor can ever pass it), and CANNOT_REMOVE_SELF
    // above already rejects an owner removing their own membership. Combined, the only way to
    // reach "removing the organization's last active owner" would require the actor and target
    // to be the same single remaining owner — which CANNOT_REMOVE_SELF already blocks. A distinct
    // count-based check here would be unreachable dead code, not real defense-in-depth.

    const updated = await this.membershipsService.updateStatus(
      membershipId,
      'suspended',
    );

    await this.auditService.record({
      organizationId,
      userId: actorUserId,
      action: 'DELETE',
      entity: 'membership',
      entityId: membershipId,
      metadata: { removedUserId: memberUserId },
    });

    return updated;
  }

  /**
   * Onboarding's "importer mon entreprise" step — fetches the given URL server-side (SSRF-safe,
   * https-only, same `safeFetch`/`assertSafeWebhookUrl` posture as webhook/calendar URLs
   * elsewhere in this codebase) and extracts best-effort branding suggestions. Never throws for
   * "nothing extractable" — an empty result just means the caller's form stays blank, exactly
   * like a user who chose the manual "créer" path instead. Only a genuinely unreachable/unsafe
   * URL is a hard error, since that's the one case the caller can't silently fall back from
   * (they typed a URL and it didn't work — worth telling them, not worth guessing).
   */
  async importPreviewFromUrl(url: string): Promise<ExtractedBusinessInfo> {
    let response: Response;
    try {
      response = await safeFetch(url);
    } catch (error) {
      // safeFetch's own UnsafeWebhookUrlError messages are worded for its original webhook
      // caller ("Webhook URL must use https", ...) — rephrased here rather than passed through
      // verbatim, but still narrow enough to guide the user (https-only vs. genuinely
      // unreachable), not the fully generic message every OTHER failure mode below gets.
      const message =
        error instanceof UnsafeWebhookUrlError &&
        error.message.includes('https')
          ? 'This URL must use https'
          : 'Unable to reach this URL';
      throw new BadRequestException({
        code: 'IMPORT_URL_UNREACHABLE',
        message,
      });
    }
    if (!response.ok) {
      throw new BadRequestException({
        code: 'IMPORT_URL_UNREACHABLE',
        message: `The site responded with status ${response.status}`,
      });
    }

    const html = await response.text();
    return extractBusinessInfoFromHtml(html, url);
  }
}
