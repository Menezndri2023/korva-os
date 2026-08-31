import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import type {
  CustomerRegisterInput,
  CustomerLoginInput,
  CustomerUpdateProfileInput,
  ListCustomerHistoryQuery,
  CreateReviewInput,
} from '@korva/validation';
import {
  EMAIL_PROVIDER,
  type EmailProvider,
} from '../communication/providers/email-provider.interface';
import { interpolate } from '../shared/template';
import { OrganizationsService } from '../organizations/organizations.service';
import { OrganizationDocument } from '../organizations/schemas/organization.schema';
import { ContactsService } from '../crm/contacts/contacts.service';
import { OrdersService } from '../commerce/orders/orders.service';
import { OrderDocument } from '../commerce/orders/schemas/order.schema';
import { BookingsService } from '../booking/bookings/bookings.service';
import { BookingDocument } from '../booking/bookings/schemas/booking.schema';
import { UsersService } from '../identity/users/users.service';
import { InvoicesService } from '../finance/invoices/invoices.service';
import { OffersService } from '../catalog/offers/offers.service';
import { ReviewsService } from '../reviews/reviews.service';
import { CustomerAccountRepository } from './customer-account.repository';
import { CustomerSessionRepository } from './customer-session.repository';
import { CustomerPasswordResetRepository } from './customer-password-reset.repository';
import { hashToken } from '../identity/auth/token-hash.util';
import { CustomerAccountDocument } from './schemas/customer-account.schema';
import type { AuthenticatedCustomer } from './strategies/customer-jwt.strategy';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

const FORGOT_PASSWORD_RESPONSE = {
  message: 'If an account exists for this email, a reset link has been sent.',
};

const RESET_EMAIL_SUBJECT = 'Reset your password';
const RESET_EMAIL_BODY_TEMPLATE =
  '<p>We received a request to reset your password for {{orgName}}.</p>' +
  '<p><a href="{{resetUrl}}">Click here to reset your password</a>. This link expires in 30 minutes.</p>' +
  '<p>If you did not request this, you can safely ignore this email.</p>';

export interface CustomerAuthTokens {
  accessToken: string;
  refreshToken: string;
}

function toPublicCustomer(
  account: CustomerAccountDocument,
  contact: { firstName?: string; lastName?: string; phone?: string },
) {
  return {
    id: account.id as string,
    email: account.email,
    firstName: contact.firstName,
    lastName: contact.lastName,
    phone: contact.phone,
  };
}

/**
 * Auth/profile/order-history/booking-history for the storefront customer portal — a separate
 * identity system from staff auth (see CustomerAccount's class doc for why). Every method takes
 * `slug`, not `organizationId`, and re-resolves the organization itself (never trusts a caller
 * to already have the right one) — same discipline as PublicService throughout this module's
 * sibling. Every method that receives an `AuthenticatedCustomer` (from a verified JWT) also
 * re-checks `customer.organizationId` against the freshly-resolved organization's real id before
 * touching any data — a valid customer token minted for org A must never be usable against org
 * B's slug, even though both would pass CustomerJwtStrategy's signature check on their own.
 */
@Injectable()
export class CustomerAuthService {
  private readonly logger = new Logger(CustomerAuthService.name);
  private readonly refreshTtlMs: number;

  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly contactsService: ContactsService,
    private readonly ordersService: OrdersService,
    private readonly bookingsService: BookingsService,
    private readonly usersService: UsersService,
    private readonly invoicesService: InvoicesService,
    private readonly offersService: OffersService,
    private readonly reviewsService: ReviewsService,
    private readonly customerAccountRepository: CustomerAccountRepository,
    private readonly customerSessionRepository: CustomerSessionRepository,
    private readonly customerPasswordResetRepository: CustomerPasswordResetRepository,
    // Signs/verifies with CUSTOMER_JWT_SECRET, configured via this module's own
    // JwtModule.registerAsync (see customer-auth.module.ts) — a separate JwtService instance
    // from IdentityModule's, never sharing a secret or default expiresIn with staff tokens.
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {
    this.refreshTtlMs = this.parseTtlToMs(
      this.configService.get<string>('CUSTOMER_JWT_REFRESH_TTL') ?? '30d',
    );
  }

  private async resolveOrganization(
    slug: string,
  ): Promise<OrganizationDocument> {
    return this.organizationsService.getBySlug(slug);
  }

  /** Throws the same shape a nonexistent org would, rather than a distinguishable 403 — a
   *  cross-org token replay attempt should look identical to "this slug has no such session". */
  private assertSameOrganization(
    customer: AuthenticatedCustomer,
    organization: OrganizationDocument,
  ): void {
    if (customer.organizationId !== (organization.id as string)) {
      throw new UnauthorizedException({
        code: 'INVALID_CUSTOMER_TOKEN',
        message: 'Invalid customer session',
      });
    }
  }

  async register(slug: string, input: CustomerRegisterInput) {
    const organization = await this.resolveOrganization(slug);
    const organizationId = organization.id as string;

    const existing = await this.customerAccountRepository.findByOrgAndEmail(
      organizationId,
      input.email,
    );
    if (existing) {
      throw new ConflictException({
        code: 'EMAIL_TAKEN',
        message: 'An account with this email already exists',
      });
    }

    const contact = await this.contactsService.findOrCreateByEmail(
      organizationId,
      {
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
      },
    );

    const passwordHash = await this.usersService.hashPassword(input.password);
    const account = await this.customerAccountRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      contactId: new Types.ObjectId(contact.id as string),
      email: input.email,
      passwordHash,
    });

    // Best-effort, never allowed to affect the outcome — same posture as AuthService.register's
    // own email-verification send (a delivery failure must never turn a successful account
    // creation into a failed request).
    try {
      await this.emailProvider.send({
        to: account.email,
        subject: `Bienvenue chez ${organization.name}`,
        body: interpolate(
          '<p>Bonjour {{firstName}},</p>' +
            '<p>Votre compte client chez {{orgName}} a bien été créé. Vous pouvez suivre vos commandes ' +
            'et réservations à tout moment depuis votre espace client.</p>',
          { firstName: contact.firstName ?? '', orgName: organization.name },
          { escapeHtml: true },
        ),
      });
    } catch (error) {
      this.logger.error('Failed to send customer welcome email', error);
    }

    const tokens = await this.issueTokens(account, organizationId);
    return {
      customer: toPublicCustomer(account, contact),
      ...tokens,
    };
  }

  async login(slug: string, input: CustomerLoginInput) {
    const organization = await this.resolveOrganization(slug);
    const organizationId = organization.id as string;

    const account = await this.customerAccountRepository.findByOrgAndEmail(
      organizationId,
      input.email,
      true,
    );
    if (!account) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    }

    if (account.lockedUntil && account.lockedUntil.getTime() > Date.now()) {
      throw new UnauthorizedException({
        code: 'ACCOUNT_LOCKED',
        message:
          'This account is temporarily locked due to too many failed login attempts. Try again later.',
      });
    }

    const valid = await this.usersService.verifyPassword(
      account.passwordHash,
      input.password,
    );
    if (!valid) {
      const attempts =
        await this.customerAccountRepository.incrementFailedAttempts(
          account.id as string,
        );
      if (attempts >= MAX_FAILED_ATTEMPTS) {
        await this.customerAccountRepository.lockAccount(
          account.id as string,
          new Date(Date.now() + LOCKOUT_DURATION_MS),
        );
      }
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    }

    if (account.failedLoginAttempts > 0 || account.lockedUntil) {
      await this.customerAccountRepository.resetFailedAttempts(
        account.id as string,
      );
    }

    const contact = await this.contactsService.getById(
      organizationId,
      account.contactId.toString(),
    );
    const tokens = await this.issueTokens(account, organizationId);
    return {
      customer: toPublicCustomer(account, contact),
      ...tokens,
    };
  }

  async refresh(refreshToken: string): Promise<CustomerAuthTokens> {
    const tokenHash = hashToken(refreshToken);
    const session =
      await this.customerSessionRepository.revokeActiveByTokenHash(tokenHash);
    if (!session) {
      await this.detectRefreshTokenReuse(tokenHash);
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token is invalid or expired',
      });
    }

    const account = await this.customerAccountRepository.findById(
      session.customerAccountId.toString(),
    );
    if (!account) {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token is invalid or expired',
      });
    }

    return this.issueTokens(account, session.organizationId.toString());
  }

  async logout(refreshToken: string): Promise<void> {
    await this.customerSessionRepository.revokeByTokenHash(
      hashToken(refreshToken),
    );
  }

  /** Same reuse-detection reasoning as AuthService.detectRefreshTokenReuse. */
  private async detectRefreshTokenReuse(tokenHash: string): Promise<void> {
    const known =
      await this.customerSessionRepository.findByTokenHash(tokenHash);
    if (!known || known.revokedAt === null) return;
    this.logger.warn(
      `Customer refresh token reuse detected for account ${known.customerAccountId.toString()} — revoking all sessions`,
    );
    await this.customerSessionRepository.revokeAllForAccount(
      known.customerAccountId.toString(),
    );
  }

  async getProfile(slug: string, customer: AuthenticatedCustomer) {
    const organization = await this.resolveOrganization(slug);
    this.assertSameOrganization(customer, organization);

    const account = await this.customerAccountRepository.findById(
      customer.customerAccountId,
    );
    if (!account) {
      throw new NotFoundException({
        code: 'CUSTOMER_NOT_FOUND',
        message: 'Customer account not found',
      });
    }
    const contact = await this.contactsService.getById(
      organization.id as string,
      customer.contactId,
    );
    return toPublicCustomer(account, contact);
  }

  async updateProfile(
    slug: string,
    customer: AuthenticatedCustomer,
    input: CustomerUpdateProfileInput,
  ) {
    const organization = await this.resolveOrganization(slug);
    this.assertSameOrganization(customer, organization);

    const contact = await this.contactsService.update(
      organization.id as string,
      undefined,
      customer.contactId,
      input,
    );
    const account = await this.customerAccountRepository.findById(
      customer.customerAccountId,
    );
    if (!account) {
      throw new NotFoundException({
        code: 'CUSTOMER_NOT_FOUND',
        message: 'Customer account not found',
      });
    }
    return toPublicCustomer(account, contact);
  }

  async listOrders(
    slug: string,
    customer: AuthenticatedCustomer,
    query: ListCustomerHistoryQuery,
  ) {
    const organization = await this.resolveOrganization(slug);
    this.assertSameOrganization(customer, organization);

    const { data, pagination } = await this.ordersService.list(
      organization.id as string,
      { page: query.page, limit: query.limit, contactId: customer.contactId },
    );
    return {
      data: data.map((order) => ({
        id: order.id as string,
        number: order.number,
        status: order.status,
        total: order.total,
        currency: order.currency,
        createdAt: (order as unknown as { createdAt: Date }).createdAt,
      })),
      pagination,
    };
  }

  async listBookings(
    slug: string,
    customer: AuthenticatedCustomer,
    query: ListCustomerHistoryQuery,
  ) {
    const organization = await this.resolveOrganization(slug);
    this.assertSameOrganization(customer, organization);

    const { data, pagination } = await this.bookingsService.list(
      organization.id as string,
      { page: query.page, limit: query.limit, contactId: customer.contactId },
    );
    return {
      data: data.map((booking) => ({
        id: booking.id as string,
        status: booking.status,
        startAt: booking.startAt,
        endAt: booking.endAt,
        pricing: booking.pricing,
      })),
      pagination,
    };
  }

  /** Ownership check shared by every "one of my own orders" method below — a valid customer
   *  session for the right org is not by itself proof the order belongs to THIS customer, so
   *  every one of these re-checks contactId even though organizationId was already verified. */
  private assertOwnsOrder(
    order: OrderDocument,
    customer: AuthenticatedCustomer,
  ): void {
    if (order.contactId.toString() !== customer.contactId) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found',
      });
    }
  }

  private assertOwnsBooking(
    booking: BookingDocument,
    customer: AuthenticatedCustomer,
  ): void {
    if (booking.contactId.toString() !== customer.contactId) {
      throw new NotFoundException({
        code: 'BOOKING_NOT_FOUND',
        message: 'Booking not found',
      });
    }
  }

  async getOrderDetail(
    slug: string,
    customer: AuthenticatedCustomer,
    orderId: string,
  ) {
    const organization = await this.resolveOrganization(slug);
    this.assertSameOrganization(customer, organization);

    const order = await this.ordersService.getById(
      organization.id as string,
      orderId,
    );
    this.assertOwnsOrder(order, customer);

    return {
      id: order.id as string,
      number: order.number,
      status: order.status,
      items: order.items,
      subtotal: order.subtotal,
      taxTotal: order.taxTotal,
      discountTotal: order.discountTotal,
      shippingCost: order.shippingCost,
      shippingAddress: order.shippingAddress,
      total: order.total,
      currency: order.currency,
      hasInvoice: !!order.invoiceId,
      createdAt: (order as unknown as { createdAt: Date }).createdAt,
    };
  }

  /**
   * Resolves everything a PDF needs (order, its invoice, organization, contact) and verifies
   * ownership at every step — never just the order. Building the actual PDF buffer stays in the
   * controller (@Res() streaming), mirroring InvoicesController#getPdf's own split between
   * "resolve + authorize" (service-ish) and "render + stream" (controller) responsibilities.
   */
  async getOrderInvoiceForPdf(
    slug: string,
    customer: AuthenticatedCustomer,
    orderId: string,
  ) {
    const organization = await this.resolveOrganization(slug);
    this.assertSameOrganization(customer, organization);

    const order = await this.ordersService.getById(
      organization.id as string,
      orderId,
    );
    this.assertOwnsOrder(order, customer);
    if (!order.invoiceId) {
      throw new NotFoundException({
        code: 'INVOICE_NOT_FOUND',
        message: 'No invoice is available for this order',
      });
    }

    const invoice = await this.invoicesService.getById(
      organization.id as string,
      order.invoiceId.toString(),
    );
    // Belt-and-suspenders: the invoice was reached via THIS order's own invoiceId (never a
    // caller-supplied invoice id), so its contactId should always already match — re-checking
    // costs nothing and removes any doubt.
    if (invoice.contactId.toString() !== customer.contactId) {
      throw new NotFoundException({
        code: 'INVOICE_NOT_FOUND',
        message: 'No invoice is available for this order',
      });
    }

    const contact = await this.contactsService.getById(
      organization.id as string,
      customer.contactId,
    );
    return { invoice, organization, contact };
  }

  async getBookingDetail(
    slug: string,
    customer: AuthenticatedCustomer,
    bookingId: string,
  ) {
    const organization = await this.resolveOrganization(slug);
    this.assertSameOrganization(customer, organization);

    const booking = await this.bookingsService.getById(
      organization.id as string,
      bookingId,
    );
    this.assertOwnsBooking(booking, customer);

    const offer = await this.offersService.getById(
      organization.id as string,
      booking.offerId.toString(),
    );

    return {
      id: booking.id as string,
      status: booking.status,
      startAt: booking.startAt,
      endAt: booking.endAt,
      pricing: booking.pricing,
      attended: booking.attended,
      notes: booking.notes,
      offerName: offer.name,
    };
  }

  async getBookingForCertificate(
    slug: string,
    customer: AuthenticatedCustomer,
    bookingId: string,
  ): Promise<{
    booking: BookingDocument;
    organization: OrganizationDocument;
    contact: Awaited<ReturnType<ContactsService['getById']>>;
    offer: Awaited<ReturnType<OffersService['getById']>>;
  }> {
    const organization = await this.resolveOrganization(slug);
    this.assertSameOrganization(customer, organization);

    const booking = await this.bookingsService.getById(
      organization.id as string,
      bookingId,
    );
    this.assertOwnsBooking(booking, customer);
    if (booking.status !== 'completed') {
      throw new BadRequestException({
        code: 'CERTIFICATE_NOT_AVAILABLE',
        message: 'A certificate is only available for a completed booking',
      });
    }

    const [offer, contact] = await Promise.all([
      this.offersService.getById(
        organization.id as string,
        booking.offerId.toString(),
      ),
      this.contactsService.getById(
        organization.id as string,
        customer.contactId,
      ),
    ]);

    return { booking, organization, contact, offer };
  }

  /**
   * Eligibility is enforced here, not just left to the client: a review can only be left for an
   * order the customer owns AND that is genuinely fulfilled (or a booking they own AND that is
   * completed) — never a still-open/pending/cancelled one. ReviewsService.create handles the
   * one-review-per-entity race via its own unique index.
   */
  async createReview(
    slug: string,
    customer: AuthenticatedCustomer,
    input: CreateReviewInput,
  ) {
    const organization = await this.resolveOrganization(slug);
    this.assertSameOrganization(customer, organization);
    const organizationId = organization.id as string;

    if (input.entity === 'order') {
      const order = await this.ordersService.getById(
        organizationId,
        input.entityId,
      );
      this.assertOwnsOrder(order, customer);
      if (order.status !== 'fulfilled') {
        throw new BadRequestException({
          code: 'ORDER_NOT_REVIEWABLE',
          message: 'Only a fulfilled order can be reviewed',
        });
      }
    } else {
      const booking = await this.bookingsService.getById(
        organizationId,
        input.entityId,
      );
      this.assertOwnsBooking(booking, customer);
      if (booking.status !== 'completed') {
        throw new BadRequestException({
          code: 'BOOKING_NOT_REVIEWABLE',
          message: 'Only a completed booking can be reviewed',
        });
      }
    }

    return this.reviewsService.create(
      organizationId,
      customer.contactId,
      input,
    );
  }

  /** Same never-reveal-existence posture as PasswordResetService.forgotPassword. */
  async forgotPassword(
    slug: string,
    email: string,
  ): Promise<typeof FORGOT_PASSWORD_RESPONSE> {
    const organization = await this.resolveOrganization(slug);
    const account = await this.customerAccountRepository.findByOrgAndEmail(
      organization.id as string,
      email,
    );
    if (!account) {
      return FORGOT_PASSWORD_RESPONSE;
    }

    const token = randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    await this.customerPasswordResetRepository.issue(
      account._id,
      tokenHash,
      expiresAt,
    );

    const resetUrl = this.buildResetUrl(organization.slug, token);
    const body = interpolate(
      RESET_EMAIL_BODY_TEMPLATE,
      { resetUrl, orgName: organization.name },
      { escapeHtml: true },
    );

    try {
      await this.emailProvider.send({
        to: account.email,
        subject: `${RESET_EMAIL_SUBJECT} — ${organization.name}`,
        body,
      });
    } catch (error) {
      this.logger.error('Failed to send customer password reset email', error);
    }

    return FORGOT_PASSWORD_RESPONSE;
  }

  /** Same ordering discipline (hash new password → atomically consume token → persist → revoke
   *  sessions) as PasswordResetService.resetPassword; see that method's doc for the rationale. */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const tokenHash = hashToken(token);
    const newPasswordHash = await this.usersService.hashPassword(newPassword);

    const claim = await this.customerPasswordResetRepository.consume(tokenHash);
    if (!claim) {
      throw new UnauthorizedException({
        code: 'INVALID_RESET_TOKEN',
        message: 'This reset link is invalid or has expired',
      });
    }

    const customerAccountId = claim.customerAccountId.toString();
    await this.customerAccountRepository.updatePasswordHash(
      customerAccountId,
      newPasswordHash,
    );
    await this.customerSessionRepository.revokeAllForAccount(customerAccountId);
  }

  private buildResetUrl(slug: string, token: string): string {
    const storefrontUrl =
      this.configService.get<string>('STOREFRONT_URL') ??
      'http://localhost:3001';
    return `${storefrontUrl}/${slug}/account/reset-password?token=${token}`;
  }

  private async issueTokens(
    account: CustomerAccountDocument,
    organizationId: string,
  ): Promise<CustomerAuthTokens> {
    const accessToken = await this.jwtService.signAsync({
      sub: account.id as string,
      contactId: account.contactId.toString(),
      organizationId,
      typ: 'customer',
    });

    const refreshToken = randomBytes(48).toString('hex');
    await this.customerSessionRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      customerAccountId: account._id,
      refreshTokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + this.refreshTtlMs),
      revokedAt: null,
    });

    return { accessToken, refreshToken };
  }

  private parseTtlToMs(ttl: string): number {
    const match = /^(\d+)([smhd])$/.exec(ttl);
    if (!match) return 30 * 24 * 60 * 60 * 1000;
    const value = Number(match[1]);
    const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
    return value * unitMs[match[2] as keyof typeof unitMs];
  }
}
