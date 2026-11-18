import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { LoyaltyService } from '../crm/loyalty/loyalty.service';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import type {
  CustomerRegisterInput,
  CustomerLoginInput,
  CustomerUpdateProfileInput,
  CustomerBasketInput,
  ListCustomerHistoryQuery,
  CreateReviewInput,
  SignQuoteInput,
  CreateReturnRequestInput,
  AddWishlistItemInput,
  SubmitQuizAttemptInput,
  CreateCustomerTicketInput,
  ListCustomerTicketsQuery,
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
import { QuotesService } from '../finance/quotes/quotes.service';
import { QuoteDocument } from '../finance/quotes/schemas/quote.schema';
import { OffersService } from '../catalog/offers/offers.service';
import { ReviewsService, reviewAuthorName } from '../reviews/reviews.service';
import { ReturnRequestsService } from '../commerce/returns/return-requests.service';
import { ReturnRequestDocument } from '../commerce/returns/schemas/return-request.schema';
import { WishlistService } from '../commerce/wishlist/wishlist.service';
import { CohortsService } from '../booking/courses/cohorts.service';
import { QuizzesService } from '../booking/courses/quizzes.service';
import { TicketsService } from '../customer-service/tickets/tickets.service';
import { TicketDocument } from '../customer-service/tickets/schemas/ticket.schema';
import { CustomerAccountRepository } from './customer-account.repository';
import { CustomerSessionRepository } from './customer-session.repository';
import { CustomerPasswordResetRepository } from './customer-password-reset.repository';
import { hashToken } from '../identity/auth/token-hash.util';
import { CustomerAccountDocument } from './schemas/customer-account.schema';
import type { AuthenticatedCustomer } from './strategies/customer-jwt.strategy';
import { EntitlementsService } from '../subscriptions/entitlements.service';
import {
  BusinessAlertsService,
  customerLabel,
} from '../business-alerts/business-alerts.service';
import { orgLocale, translator } from '../shared/i18n';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

const FORGOT_PASSWORD_RESPONSE = {
  message: 'If an account exists for this email, a reset link has been sent.',
};

// In the business's language (see shared/i18n.ts): its customers read this, not KORVA's team.
const RESET_EMAIL_SUBJECT = {
  fr: 'Réinitialisez votre mot de passe',
  en: 'Reset your password',
};
const RESET_EMAIL_BODY_TEMPLATE = {
  fr:
    '<p>Nous avons reçu une demande de réinitialisation de votre mot de passe chez {{orgName}}.</p>' +
    '<p><a href="{{resetUrl}}">Cliquez ici pour choisir un nouveau mot de passe</a>. Ce lien expire dans 30 minutes.</p>' +
    "<p>Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet e-mail.</p>",
  en:
    '<p>We received a request to reset your password for {{orgName}}.</p>' +
    '<p><a href="{{resetUrl}}">Click here to reset your password</a>. This link expires in 30 minutes.</p>' +
    '<p>If you did not request this, you can safely ignore this email.</p>',
};

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

/** Until when a booking can still be cancelled for free by its customer, or undefined when its
 *  offer has no such policy or the booking is no longer open (already cancelled or completed). */
function freeCancellationDeadline(
  booking: { status: string; startAt: Date },
  offer: { cancellationHours?: number | null },
): Date | undefined {
  const hours = offer.cancellationHours;
  if (!hours) return undefined;
  if (booking.status !== 'pending' && booking.status !== 'confirmed') {
    return undefined;
  }
  return new Date(booking.startAt.getTime() - hours * 3_600_000);
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
    private readonly loyaltyService: LoyaltyService,
    private readonly ordersService: OrdersService,
    private readonly bookingsService: BookingsService,
    private readonly businessAlerts: BusinessAlertsService,
    private readonly usersService: UsersService,
    private readonly invoicesService: InvoicesService,
    private readonly quotesService: QuotesService,
    private readonly offersService: OffersService,
    private readonly reviewsService: ReviewsService,
    private readonly returnRequestsService: ReturnRequestsService,
    private readonly wishlistService: WishlistService,
    private readonly cohortsService: CohortsService,
    private readonly quizzesService: QuizzesService,
    private readonly ticketsService: TicketsService,
    private readonly customerAccountRepository: CustomerAccountRepository,
    private readonly customerSessionRepository: CustomerSessionRepository,
    private readonly customerPasswordResetRepository: CustomerPasswordResetRepository,
    // Signs/verifies with CUSTOMER_JWT_SECRET, configured via this module's own
    // JwtModule.registerAsync (see customer-auth.module.ts) — a separate JwtService instance
    // from IdentityModule's, never sharing a secret or default expiresIn with staff tokens.
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
    private readonly entitlementsService: EntitlementsService,
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
    // Customer accounts are a paid feature for NEW accounts only: customers who already have one
    // keep signing in after their shop moves to the free plan.
    await this.entitlementsService.assertFeature(
      organizationId,
      'customer_accounts',
    );

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
      // Creating the account signs the customer in.
      lastLoginAt: new Date(),
    });

    // Best-effort, never allowed to affect the outcome — same posture as AuthService.register's
    // own email-verification send (a delivery failure must never turn a successful account
    // creation into a failed request).
    try {
      const t = translator(organization.language);
      await this.emailProvider.send({
        to: account.email,
        subject: t(
          `Bienvenue chez ${organization.name}`,
          `Welcome to ${organization.name}`,
        ),
        body: interpolate(
          t(
            '<p>Bonjour {{firstName}},</p>' +
              '<p>Votre compte client chez {{orgName}} a bien été créé. Vous pouvez suivre vos commandes ' +
              'et réservations à tout moment depuis votre espace client.</p>',
            '<p>Hello {{firstName}},</p>' +
              '<p>Your customer account with {{orgName}} has been created. You can follow your orders ' +
              'and bookings at any time from your customer area.</p>',
          ),
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

    // Checked only once the password is right, so a stranger cannot learn the account exists.
    if (account.disabledAt) {
      throw new UnauthorizedException({
        code: 'ACCOUNT_DISABLED',
        message:
          'This account has been suspended by the business. Contact it to restore access.',
      });
    }

    if (account.failedLoginAttempts > 0 || account.lockedUntil) {
      await this.customerAccountRepository.resetFailedAttempts(
        account.id as string,
      );
    }

    await this.customerAccountRepository.recordLogin(account.id as string);
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
    if (!account || account.disabledAt) {
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

  /** The customer's own loyalty card at this shop. */
  async getLoyalty(slug: string, customer: AuthenticatedCustomer) {
    const organization = await this.resolveOrganization(slug);
    this.assertSameOrganization(customer, organization);
    return this.loyaltyService.forContact(
      organization.id as string,
      customer.contactId,
    );
  }

  /** The customer's basket and saved lines, kept with the account (empty until first saved). */
  async getBasket(slug: string, customer: AuthenticatedCustomer) {
    const organization = await this.resolveOrganization(slug);
    this.assertSameOrganization(customer, organization);
    return (
      (await this.customerAccountRepository.getBasket(
        customer.customerAccountId,
      )) ?? {
        cart: [],
        saved: [],
      }
    );
  }

  async saveBasket(
    slug: string,
    customer: AuthenticatedCustomer,
    input: CustomerBasketInput,
  ) {
    const organization = await this.resolveOrganization(slug);
    this.assertSameOrganization(customer, organization);
    await this.customerAccountRepository.setBasket(
      customer.customerAccountId,
      input,
    );
    return input;
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

  private assertOwnsTicket(
    ticket: TicketDocument,
    customer: AuthenticatedCustomer,
  ): void {
    if (ticket.contactId.toString() !== customer.contactId) {
      throw new NotFoundException({
        code: 'TICKET_NOT_FOUND',
        message: 'Ticket not found',
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

    const deadline = freeCancellationDeadline(booking, offer);
    return {
      id: booking.id as string,
      status: booking.status,
      startAt: booking.startAt,
      endAt: booking.endAt,
      pricing: booking.pricing,
      attended: booking.attended,
      notes: booking.notes,
      offerName: offer.name,
      cancelledBy: booking.cancelledBy,
      cancellationHours: offer.cancellationHours ?? undefined,
      // Only while it is still open: past it, the page shows the policy, not a button.
      cancellableUntil:
        deadline && deadline.getTime() > Date.now() ? deadline : undefined,
    };
  }

  /**
   * The customer cancels their own booking, within the offer's free cancellation window
   * (Offer.cancellationHours) — never past it, and never on an offer with no such policy: the
   * business then decides. Ownership is checked like every other "my booking" route.
   */
  async cancelBooking(
    slug: string,
    customer: AuthenticatedCustomer,
    bookingId: string,
  ) {
    const organization = await this.resolveOrganization(slug);
    this.assertSameOrganization(customer, organization);
    const organizationId = organization.id as string;

    const booking = await this.bookingsService.getById(
      organizationId,
      bookingId,
    );
    this.assertOwnsBooking(booking, customer);
    const offer = await this.offersService.getById(
      organizationId,
      booking.offerId.toString(),
    );
    if (booking.status !== 'pending' && booking.status !== 'confirmed') {
      throw new BadRequestException({
        code: 'BOOKING_NOT_CANCELLABLE',
        message: `A ${booking.status} booking cannot be cancelled`,
      });
    }
    const deadline = freeCancellationDeadline(booking, offer);
    if (!deadline) {
      throw new BadRequestException({
        code: 'CANCELLATION_NOT_OFFERED',
        message:
          'This booking cannot be cancelled online — please contact the business',
      });
    }
    if (Date.now() >= deadline.getTime()) {
      throw new BadRequestException({
        code: 'CANCELLATION_DEADLINE_PASSED',
        message:
          'The free cancellation period is over — please contact the business',
      });
    }

    const cancelled = await this.bookingsService.cancel(
      organizationId,
      undefined,
      bookingId,
      'customer',
    );

    const contact = await this.contactsService.getById(
      organizationId,
      customer.contactId,
    );
    // Refunds stay manual: the alert says how much was paid online and is owed back.
    const paid =
      booking.paymentStatus === 'paid'
        ? booking.pricing.amount
        : booking.paymentStatus === 'deposit_paid'
          ? booking.depositAmount
          : undefined;
    void this.businessAlerts.notify(organizationId, {
      kind: 'booking_cancelled',
      offerName: offer.name,
      startAt: booking.startAt,
      customer: customerLabel(contact),
      refund: paid
        ? { amount: paid, currency: booking.pricing.currency }
        : undefined,
    });

    return { id: cancelled.id as string, status: cancelled.status };
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

  private assertOwnsQuote(
    quote: QuoteDocument,
    customer: AuthenticatedCustomer,
  ): void {
    if (quote.contactId.toString() !== customer.contactId) {
      throw new NotFoundException({
        code: 'QUOTE_NOT_FOUND',
        message: 'Quote not found',
      });
    }
  }

  async listQuotes(
    slug: string,
    customer: AuthenticatedCustomer,
    query: ListCustomerHistoryQuery,
  ) {
    const organization = await this.resolveOrganization(slug);
    this.assertSameOrganization(customer, organization);

    const { data, pagination } = await this.quotesService.list(
      organization.id as string,
      {
        page: query.page,
        limit: query.limit,
        contactId: customer.contactId,
      },
    );
    return {
      data: data.map((quote) => ({
        id: quote.id as string,
        number: quote.number,
        status: quote.status,
        total: quote.total,
        currency: quote.currency,
        validUntil: quote.validUntil,
        createdAt: (quote as unknown as { createdAt: Date }).createdAt,
      })),
      pagination,
    };
  }

  async getQuoteDetail(
    slug: string,
    customer: AuthenticatedCustomer,
    quoteId: string,
  ) {
    const organization = await this.resolveOrganization(slug);
    this.assertSameOrganization(customer, organization);

    const quote = await this.quotesService.getById(
      organization.id as string,
      quoteId,
    );
    this.assertOwnsQuote(quote, customer);

    return {
      id: quote.id as string,
      number: quote.number,
      status: quote.status,
      items: quote.items,
      subtotal: quote.subtotal,
      taxTotal: quote.taxTotal,
      discountTotal: quote.discountTotal,
      total: quote.total,
      currency: quote.currency,
      validUntil: quote.validUntil,
      notes: quote.notes,
      signedByName: quote.signedByName,
      signedAt: quote.signedAt,
    };
  }

  /**
   * "Signing" is a typed full name, not a drawn/cryptographic signature — see Quote.signedByName's
   * doc comment in @korva/types for why this is the honest, smallest-real-version choice, same
   * philosophy as this project's one-way ICS calendar import instead of full OAuth. Eligibility
   * (ownership + a genuinely still-open quote) is enforced by QuotesService.signByCustomer itself,
   * not just checked here.
   */
  async signQuote(
    slug: string,
    customer: AuthenticatedCustomer,
    quoteId: string,
    input: SignQuoteInput,
    signerIp: string | undefined,
  ) {
    const organization = await this.resolveOrganization(slug);
    this.assertSameOrganization(customer, organization);

    const quote = await this.quotesService.getById(
      organization.id as string,
      quoteId,
    );
    this.assertOwnsQuote(quote, customer);

    return this.quotesService.signByCustomer(
      organization.id as string,
      quoteId,
      {
        signedByName: input.signerName,
        signedIp: signerIp,
      },
    );
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

    let offerId: string | undefined;

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
      offerId = this.resolveSingleOfferId(order);
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
      offerId = booking.offerId.toString();
    }

    const authorName = input.showName
      ? reviewAuthorName(
          await this.contactsService.getById(
            organizationId,
            customer.contactId,
          ),
        )
      : undefined;
    return this.reviewsService.create(
      organizationId,
      customer.contactId,
      input,
      {
        offerId,
        authorName,
      },
    );
  }

  /** An order review only attributes to a single offer when every line item shares the same
   *  offerId — a mixed-cart order (or one with free-text lines lacking an offerId at all) has no
   *  single product to attribute the review to, so it's left unset rather than guessed. */
  private resolveSingleOfferId(order: OrderDocument): string | undefined {
    const offerIds = new Set(
      order.items
        .map((item) => item.offerId?.toString())
        .filter((id): id is string => Boolean(id)),
    );
    return offerIds.size === 1 ? [...offerIds][0] : undefined;
  }

  private assertOwnsReturnRequest(
    returnRequest: ReturnRequestDocument,
    customer: AuthenticatedCustomer,
  ): void {
    if (returnRequest.contactId.toString() !== customer.contactId) {
      throw new NotFoundException({
        code: 'RETURN_REQUEST_NOT_FOUND',
        message: 'Return request not found',
      });
    }
  }

  /** Eligibility (fulfilled order, quantities not already returned) is enforced inside
   *  ReturnRequestsService.create itself — the customer's own contactId is passed as
   *  `expectedContactId` so a return can never be filed against another customer's order. */
  async createReturnRequest(
    slug: string,
    customer: AuthenticatedCustomer,
    input: CreateReturnRequestInput,
  ) {
    const organization = await this.resolveOrganization(slug);
    this.assertSameOrganization(customer, organization);

    return this.returnRequestsService.create(
      organization.id as string,
      input,
      customer.contactId,
    );
  }

  async listReturnRequests(
    slug: string,
    customer: AuthenticatedCustomer,
    query: ListCustomerHistoryQuery,
  ) {
    const organization = await this.resolveOrganization(slug);
    this.assertSameOrganization(customer, organization);

    const { data, pagination } = await this.returnRequestsService.list(
      organization.id as string,
      {
        page: query.page,
        limit: query.limit,
        contactId: customer.contactId,
      },
    );
    return {
      data: data.map((returnRequest) => ({
        id: returnRequest.id as string,
        orderId: returnRequest.orderId.toString(),
        status: returnRequest.status,
        reason: returnRequest.reason,
        refundAmount: returnRequest.refundAmount,
        currency: returnRequest.currency,
        createdAt: (returnRequest as unknown as { createdAt: Date }).createdAt,
      })),
      pagination,
    };
  }

  async getReturnRequestDetail(
    slug: string,
    customer: AuthenticatedCustomer,
    id: string,
  ) {
    const organization = await this.resolveOrganization(slug);
    this.assertSameOrganization(customer, organization);

    const returnRequest = await this.returnRequestsService.getById(
      organization.id as string,
      id,
    );
    this.assertOwnsReturnRequest(returnRequest, customer);
    return returnRequest;
  }

  async listWishlist(slug: string, customer: AuthenticatedCustomer) {
    const organization = await this.resolveOrganization(slug);
    this.assertSameOrganization(customer, organization);

    return this.wishlistService.list(
      organization.id as string,
      customer.contactId,
    );
  }

  async addToWishlist(
    slug: string,
    customer: AuthenticatedCustomer,
    input: AddWishlistItemInput,
  ) {
    const organization = await this.resolveOrganization(slug);
    this.assertSameOrganization(customer, organization);

    await this.wishlistService.add(
      organization.id as string,
      customer.contactId,
      input.offerId,
    );
  }

  async removeFromWishlist(
    slug: string,
    customer: AuthenticatedCustomer,
    offerId: string,
  ) {
    const organization = await this.resolveOrganization(slug);
    this.assertSameOrganization(customer, organization);

    await this.wishlistService.remove(
      organization.id as string,
      customer.contactId,
      offerId,
    );
  }

  /** contactId always comes from the verified JWT (`customer.contactId`), never client input —
   *  the same load-bearing ownership guarantee every other customer-portal write in this file
   *  relies on. */
  async createTicket(
    slug: string,
    customer: AuthenticatedCustomer,
    input: CreateCustomerTicketInput,
  ) {
    const organization = await this.resolveOrganization(slug);
    this.assertSameOrganization(customer, organization);

    return this.ticketsService.create(organization.id as string, undefined, {
      subject: input.subject,
      description: input.description,
      priority: 'medium',
      contactId: customer.contactId,
    });
  }

  async listTickets(
    slug: string,
    customer: AuthenticatedCustomer,
    query: ListCustomerTicketsQuery,
  ) {
    const organization = await this.resolveOrganization(slug);
    this.assertSameOrganization(customer, organization);

    return this.ticketsService.list(organization.id as string, {
      page: query.page,
      limit: query.limit,
      contactId: customer.contactId,
    });
  }

  async getTicket(slug: string, customer: AuthenticatedCustomer, id: string) {
    const organization = await this.resolveOrganization(slug);
    this.assertSameOrganization(customer, organization);

    const ticket = await this.ticketsService.getById(
      organization.id as string,
      id,
    );
    this.assertOwnsTicket(ticket, customer);
    return ticket;
  }

  /** Cohorts the customer is enrolled in — never a staff-supplied contactId, always the
   *  authenticated customer's own. */
  async listMyCohorts(slug: string, customer: AuthenticatedCustomer) {
    const organization = await this.resolveOrganization(slug);
    this.assertSameOrganization(customer, organization);

    const { data } = await this.cohortsService.list(organization.id as string, {
      page: 1,
      limit: 100,
      enrolledContactId: customer.contactId,
    });
    return data;
  }

  private assertEnrolledInCohort(
    cohort: Awaited<ReturnType<CohortsService['getById']>>,
    customer: AuthenticatedCustomer,
  ): void {
    const isEnrolled = cohort.enrolledContactIds.some(
      (id) => id.toString() === customer.contactId,
    );
    if (!isEnrolled) {
      throw new NotFoundException({
        code: 'COHORT_NOT_FOUND',
        message: 'Cohort not found',
      });
    }
  }

  async getMyCohort(
    slug: string,
    customer: AuthenticatedCustomer,
    cohortId: string,
  ) {
    const organization = await this.resolveOrganization(slug);
    this.assertSameOrganization(customer, organization);

    const cohort = await this.cohortsService.getById(
      organization.id as string,
      cohortId,
    );
    this.assertEnrolledInCohort(cohort, customer);
    return cohort;
  }

  /** Every quiz for the cohort's own course, pre-stripped of the answer key — lets a learner
   *  browse what's available without already knowing a quizId. */
  async listQuizzesForCohort(
    slug: string,
    customer: AuthenticatedCustomer,
    cohortId: string,
  ) {
    const organization = await this.resolveOrganization(slug);
    this.assertSameOrganization(customer, organization);

    const cohort = await this.cohortsService.getById(
      organization.id as string,
      cohortId,
    );
    this.assertEnrolledInCohort(cohort, customer);
    const quizzes = await this.quizzesService.listByCourse(
      organization.id as string,
      cohort.courseId.toString(),
    );
    return quizzes.map((quiz) => this.quizzesService.toPublic(quiz));
  }

  /** Only served to a customer once they're confirmed enrolled in a cohort running this quiz's
   *  course — served pre-stripped of the answer key (see QuizzesService.toPublic). */
  async getQuizForCohort(
    slug: string,
    customer: AuthenticatedCustomer,
    cohortId: string,
    quizId: string,
  ) {
    const organization = await this.resolveOrganization(slug);
    this.assertSameOrganization(customer, organization);

    const cohort = await this.cohortsService.getById(
      organization.id as string,
      cohortId,
    );
    this.assertEnrolledInCohort(cohort, customer);
    const quiz = await this.quizzesService.getById(
      organization.id as string,
      quizId,
    );
    if (quiz.courseId.toString() !== cohort.courseId.toString()) {
      throw new NotFoundException({
        code: 'QUIZ_NOT_FOUND',
        message: 'Quiz not found',
      });
    }

    const attempts = await this.quizzesService.listAttemptsForContact(
      organization.id as string,
      quizId,
      customer.contactId,
    );
    return { quiz: this.quizzesService.toPublic(quiz), attempts };
  }

  async submitQuizAttempt(
    slug: string,
    customer: AuthenticatedCustomer,
    quizId: string,
    input: SubmitQuizAttemptInput,
  ) {
    const organization = await this.resolveOrganization(slug);
    this.assertSameOrganization(customer, organization);

    return this.quizzesService.submitAttempt(
      organization.id as string,
      customer.contactId,
      quizId,
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
    const locale = orgLocale(organization.language);
    const body = interpolate(
      RESET_EMAIL_BODY_TEMPLATE[locale],
      { resetUrl, orgName: organization.name },
      { escapeHtml: true },
    );

    try {
      await this.emailProvider.send({
        to: account.email,
        subject: `${RESET_EMAIL_SUBJECT[locale]} — ${organization.name}`,
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
