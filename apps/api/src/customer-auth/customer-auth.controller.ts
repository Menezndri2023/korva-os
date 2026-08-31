import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  customerRegisterSchema,
  customerLoginSchema,
  customerRefreshSchema,
  customerUpdateProfileSchema,
  customerForgotPasswordSchema,
  customerResetPasswordSchema,
  listCustomerHistoryQuerySchema,
  type CustomerRegisterInput,
  type CustomerLoginInput,
  type CustomerRefreshInput,
  type CustomerUpdateProfileInput,
  type CustomerForgotPasswordInput,
  type CustomerResetPasswordInput,
  type ListCustomerHistoryQuery,
} from '@korva/validation';
import { CustomerAuthService } from './customer-auth.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { Public } from '../common/decorators/public.decorator';
import { CustomerAuthGuard } from './guards/customer-auth.guard';
import type { AuthenticatedCustomer } from './strategies/customer-jwt.strategy';

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
  constructor(private readonly customerAuthService: CustomerAuthService) {}

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
}
