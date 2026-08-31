import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  customerRegisterSchema,
  customerLoginSchema,
  customerRefreshSchema,
  customerUpdateProfileSchema,
  customerForgotPasswordSchema,
  customerResetPasswordSchema,
  listCustomerHistoryQuerySchema,
  createReviewSchema,
  signQuoteSchema,
  createReturnRequestSchema,
  addWishlistItemSchema,
  submitQuizAttemptSchema,
  type CustomerRegisterInput,
  type CustomerLoginInput,
  type CustomerRefreshInput,
  type CustomerUpdateProfileInput,
  type CustomerForgotPasswordInput,
  type CustomerResetPasswordInput,
  type ListCustomerHistoryQuery,
  type CreateReviewInput,
  type SignQuoteInput,
  type CreateReturnRequestInput,
  type AddWishlistItemInput,
  type SubmitQuizAttemptInput,
} from '@korva/validation';
import { CustomerAuthService } from './customer-auth.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { Public } from '../common/decorators/public.decorator';
import { CustomerAuthGuard } from './guards/customer-auth.guard';
import type { AuthenticatedCustomer } from './strategies/customer-jwt.strategy';
import { DocumentRenderingService } from '../documents/rendering/document-rendering.service';
import { buildInvoiceDocumentManifest } from '../documents/templates/invoice-document.template';
import { buildCertificateDocumentManifest } from '../documents/templates/certificate-document.template';

/** Same brute-force-surface reasoning as AuthController's AUTH_THROTTLE, tightened slightly
 *  since this endpoint set has no HttpOnly-cookie layer of its own to lean on. */
const CUSTOMER_AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };
/** Same reasoning as PUBLIC_BOOKING_THROTTLE in public.controller.ts: low legitimate volume,
 *  high abuse value (email enumeration / spam). */
const CUSTOMER_FORGOT_PASSWORD_THROTTLE = {
  default: { limit: 5, ttl: 60_000 },
};

interface RequestWithCustomer extends Request {
  user?: AuthenticatedCustomer;
}

/**
 * The public storefront's customer-portal API — registration, login, profile, order/booking
 * history for an authenticated end customer. `@Public()` at class level so the global staff
 * JwtAuthGuard/TenantGuard chain skips this controller entirely (mirrors PublicController);
 * `CustomerAuthGuard` is applied explicitly per-route below for the endpoints that need a real
 * customer session. Never confused with the guest-checkout/tracking endpoints on
 * PublicController, which stay untouched and fully independent of this module.
 */
@ApiTags('customer-auth')
@Public()
@Controller('public/:organizationSlug/account')
export class CustomerAuthController {
  constructor(
    private readonly customerAuthService: CustomerAuthService,
    private readonly documentRenderingService: DocumentRenderingService,
  ) {}

  @Throttle(CUSTOMER_AUTH_THROTTLE)
  @Post('register')
  register(
    @Param('organizationSlug') slug: string,
    @Body(new ZodValidationPipe(customerRegisterSchema))
    body: CustomerRegisterInput,
  ) {
    return this.customerAuthService.register(slug, body);
  }

  @Throttle(CUSTOMER_AUTH_THROTTLE)
  @Post('login')
  login(
    @Param('organizationSlug') slug: string,
    @Body(new ZodValidationPipe(customerLoginSchema)) body: CustomerLoginInput,
  ) {
    return this.customerAuthService.login(slug, body);
  }

  @Throttle(CUSTOMER_AUTH_THROTTLE)
  @Post('refresh')
  refresh(
    @Body(new ZodValidationPipe(customerRefreshSchema))
    body: CustomerRefreshInput,
  ) {
    return this.customerAuthService.refresh(body.refreshToken);
  }

  @Post('logout')
  async logout(
    @Body(new ZodValidationPipe(customerRefreshSchema))
    body: CustomerRefreshInput,
  ) {
    await this.customerAuthService.logout(body.refreshToken);
    return { loggedOut: true };
  }

  @Throttle(CUSTOMER_FORGOT_PASSWORD_THROTTLE)
  @Post('forgot-password')
  forgotPassword(
    @Param('organizationSlug') slug: string,
    @Body(new ZodValidationPipe(customerForgotPasswordSchema))
    body: CustomerForgotPasswordInput,
  ) {
    return this.customerAuthService.forgotPassword(slug, body.email);
  }

  @Throttle(CUSTOMER_AUTH_THROTTLE)
  @Post('reset-password')
  async resetPassword(
    @Body(new ZodValidationPipe(customerResetPasswordSchema))
    body: CustomerResetPasswordInput,
  ) {
    await this.customerAuthService.resetPassword(body.token, body.password);
    return { success: true };
  }

  @UseGuards(CustomerAuthGuard)
  @Get('me')
  me(@Param('organizationSlug') slug: string, @Req() req: RequestWithCustomer) {
    return this.customerAuthService.getProfile(slug, req.user!);
  }

  @UseGuards(CustomerAuthGuard)
  @Patch('me')
  updateMe(
    @Param('organizationSlug') slug: string,
    @Req() req: RequestWithCustomer,
    @Body(new ZodValidationPipe(customerUpdateProfileSchema))
    body: CustomerUpdateProfileInput,
  ) {
    return this.customerAuthService.updateProfile(slug, req.user!, body);
  }

  @UseGuards(CustomerAuthGuard)
  @Get('orders')
  listOrders(
    @Param('organizationSlug') slug: string,
    @Req() req: RequestWithCustomer,
    @Query(new ZodValidationPipe(listCustomerHistoryQuerySchema))
    query: ListCustomerHistoryQuery,
  ) {
    return this.customerAuthService.listOrders(slug, req.user!, query);
  }

  @UseGuards(CustomerAuthGuard)
  @Get('bookings')
  listBookings(
    @Param('organizationSlug') slug: string,
    @Req() req: RequestWithCustomer,
    @Query(new ZodValidationPipe(listCustomerHistoryQuerySchema))
    query: ListCustomerHistoryQuery,
  ) {
    return this.customerAuthService.listBookings(slug, req.user!, query);
  }

  @UseGuards(CustomerAuthGuard)
  @Get('orders/:id')
  getOrder(
    @Param('organizationSlug') slug: string,
    @Param('id') id: string,
    @Req() req: RequestWithCustomer,
  ) {
    return this.customerAuthService.getOrderDetail(slug, req.user!, id);
  }

  @UseGuards(CustomerAuthGuard)
  @Get('orders/:id/invoice-pdf')
  async getOrderInvoicePdf(
    @Param('organizationSlug') slug: string,
    @Param('id') id: string,
    @Req() req: RequestWithCustomer,
    @Res() res: Response,
  ): Promise<void> {
    const { invoice, organization, contact } =
      await this.customerAuthService.getOrderInvoiceForPdf(slug, req.user!, id);
    const manifest = buildInvoiceDocumentManifest(
      invoice,
      organization,
      contact,
    );
    const buffer = await this.documentRenderingService.renderPdf(manifest);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', buffer.length.toString());
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${invoice.number}.pdf"`,
    );
    res.send(buffer);
  }

  @UseGuards(CustomerAuthGuard)
  @Get('bookings/:id')
  getBooking(
    @Param('organizationSlug') slug: string,
    @Param('id') id: string,
    @Req() req: RequestWithCustomer,
  ) {
    return this.customerAuthService.getBookingDetail(slug, req.user!, id);
  }

  @UseGuards(CustomerAuthGuard)
  @Get('bookings/:id/certificate')
  async getBookingCertificate(
    @Param('organizationSlug') slug: string,
    @Param('id') id: string,
    @Req() req: RequestWithCustomer,
    @Res() res: Response,
  ): Promise<void> {
    const { booking, organization, contact, offer } =
      await this.customerAuthService.getBookingForCertificate(
        slug,
        req.user!,
        id,
      );
    const manifest = buildCertificateDocumentManifest(
      booking,
      offer,
      organization,
      contact,
    );
    const buffer = await this.documentRenderingService.renderPdf(manifest);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', buffer.length.toString());
    res.setHeader(
      'Content-Disposition',
      `inline; filename="certificat-${booking.id}.pdf"`,
    );
    res.send(buffer);
  }

  @UseGuards(CustomerAuthGuard)
  @Get('quotes')
  listQuotes(
    @Param('organizationSlug') slug: string,
    @Req() req: RequestWithCustomer,
    @Query(new ZodValidationPipe(listCustomerHistoryQuerySchema))
    query: ListCustomerHistoryQuery,
  ) {
    return this.customerAuthService.listQuotes(slug, req.user!, query);
  }

  @UseGuards(CustomerAuthGuard)
  @Get('quotes/:id')
  getQuote(
    @Param('organizationSlug') slug: string,
    @Param('id') id: string,
    @Req() req: RequestWithCustomer,
  ) {
    return this.customerAuthService.getQuoteDetail(slug, req.user!, id);
  }

  @UseGuards(CustomerAuthGuard)
  @Post('quotes/:id/sign')
  signQuote(
    @Param('organizationSlug') slug: string,
    @Param('id') id: string,
    @Req() req: RequestWithCustomer,
    @Body(new ZodValidationPipe(signQuoteSchema)) body: SignQuoteInput,
  ) {
    return this.customerAuthService.signQuote(
      slug,
      req.user!,
      id,
      body,
      req.ip,
    );
  }

  @UseGuards(CustomerAuthGuard)
  @Post('reviews')
  createReview(
    @Param('organizationSlug') slug: string,
    @Req() req: RequestWithCustomer,
    @Body(new ZodValidationPipe(createReviewSchema)) body: CreateReviewInput,
  ) {
    return this.customerAuthService.createReview(slug, req.user!, body);
  }

  @UseGuards(CustomerAuthGuard)
  @Get('returns')
  listReturns(
    @Param('organizationSlug') slug: string,
    @Req() req: RequestWithCustomer,
    @Query(new ZodValidationPipe(listCustomerHistoryQuerySchema))
    query: ListCustomerHistoryQuery,
  ) {
    return this.customerAuthService.listReturnRequests(slug, req.user!, query);
  }

  @UseGuards(CustomerAuthGuard)
  @Get('returns/:id')
  getReturn(
    @Param('organizationSlug') slug: string,
    @Param('id') id: string,
    @Req() req: RequestWithCustomer,
  ) {
    return this.customerAuthService.getReturnRequestDetail(slug, req.user!, id);
  }

  @UseGuards(CustomerAuthGuard)
  @Post('returns')
  createReturn(
    @Param('organizationSlug') slug: string,
    @Req() req: RequestWithCustomer,
    @Body(new ZodValidationPipe(createReturnRequestSchema))
    body: CreateReturnRequestInput,
  ) {
    return this.customerAuthService.createReturnRequest(slug, req.user!, body);
  }

  @UseGuards(CustomerAuthGuard)
  @Get('cohorts')
  listMyCohorts(
    @Param('organizationSlug') slug: string,
    @Req() req: RequestWithCustomer,
  ) {
    return this.customerAuthService.listMyCohorts(slug, req.user!);
  }

  @UseGuards(CustomerAuthGuard)
  @Get('cohorts/:id')
  getMyCohort(
    @Param('organizationSlug') slug: string,
    @Param('id') id: string,
    @Req() req: RequestWithCustomer,
  ) {
    return this.customerAuthService.getMyCohort(slug, req.user!, id);
  }

  @UseGuards(CustomerAuthGuard)
  @Get('cohorts/:id/quizzes')
  listQuizzesForCohort(
    @Param('organizationSlug') slug: string,
    @Param('id') id: string,
    @Req() req: RequestWithCustomer,
  ) {
    return this.customerAuthService.listQuizzesForCohort(slug, req.user!, id);
  }

  @UseGuards(CustomerAuthGuard)
  @Get('cohorts/:cohortId/quizzes/:quizId')
  getQuizForCohort(
    @Param('organizationSlug') slug: string,
    @Param('cohortId') cohortId: string,
    @Param('quizId') quizId: string,
    @Req() req: RequestWithCustomer,
  ) {
    return this.customerAuthService.getQuizForCohort(
      slug,
      req.user!,
      cohortId,
      quizId,
    );
  }

  @UseGuards(CustomerAuthGuard)
  @Post('quizzes/:quizId/attempts')
  submitQuizAttempt(
    @Param('organizationSlug') slug: string,
    @Param('quizId') quizId: string,
    @Req() req: RequestWithCustomer,
    @Body(new ZodValidationPipe(submitQuizAttemptSchema))
    body: SubmitQuizAttemptInput,
  ) {
    return this.customerAuthService.submitQuizAttempt(
      slug,
      req.user!,
      quizId,
      body,
    );
  }

  @UseGuards(CustomerAuthGuard)
  @Get('wishlist')
  listWishlist(
    @Param('organizationSlug') slug: string,
    @Req() req: RequestWithCustomer,
  ) {
    return this.customerAuthService.listWishlist(slug, req.user!);
  }

  @UseGuards(CustomerAuthGuard)
  @Post('wishlist')
  async addToWishlist(
    @Param('organizationSlug') slug: string,
    @Req() req: RequestWithCustomer,
    @Body(new ZodValidationPipe(addWishlistItemSchema))
    body: AddWishlistItemInput,
  ) {
    await this.customerAuthService.addToWishlist(slug, req.user!, body);
    return { saved: true };
  }

  @UseGuards(CustomerAuthGuard)
  @Delete('wishlist/:offerId')
  async removeFromWishlist(
    @Param('organizationSlug') slug: string,
    @Param('offerId') offerId: string,
    @Req() req: RequestWithCustomer,
  ) {
    await this.customerAuthService.removeFromWishlist(slug, req.user!, offerId);
    return { removed: true };
  }
}
