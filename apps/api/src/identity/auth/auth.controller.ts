import {
  Body,
  Controller,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  loginSchema,
  registerSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  type LoginInput,
  type RegisterInput,
  type ForgotPasswordInput,
  type ResetPasswordInput,
} from '@korva/validation';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Public } from '../../common/decorators/public.decorator';
import { SkipTenant } from '../../common/decorators/skip-tenant.decorator';

/** Tighter than the global 120/min — these are the brute-force/credential-stuffing surface. */
const AUTH_THROTTLE = { default: { limit: 30, ttl: 60_000 } };

/**
 * The refresh token never reaches browser JS — it lives only in this HttpOnly cookie, scoped
 * to the two routes that actually read it, so an XSS anywhere in apps/web cannot exfiltrate a
 * 30-day credential (see docs/PRODUCTION_READINESS.md P0 #8).
 */
const REFRESH_COOKIE_NAME = 'korva_refresh_token';
const REFRESH_COOKIE_PATH = '/api/v1/auth';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
    private readonly passwordResetService: PasswordResetService,
  ) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('register')
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { refreshToken, ...result } = await this.authService.register(body);
    this.setRefreshCookie(res, refreshToken);
    return result;
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { refreshToken, ...result } = await this.authService.login(body);
    this.setRefreshCookie(res, refreshToken);
    return result;
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = this.readRefreshCookie(req);
    if (!refreshToken) {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token is invalid or expired',
      });
    }
    const { refreshToken: nextRefreshToken, ...result } =
      await this.authService.refresh(refreshToken);
    this.setRefreshCookie(res, nextRefreshToken);
    return result;
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('forgot-password')
  forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema)) body: ForgotPasswordInput,
  ) {
    return this.passwordResetService.forgotPassword(body.email);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('reset-password')
  async resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordInput,
  ) {
    await this.passwordResetService.resetPassword(body.token, body.password);
    return { success: true };
  }

  @SkipTenant()
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = this.readRefreshCookie(req);
    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }
    this.clearRefreshCookie(res);
    return { loggedOut: true };
  }

  private isProduction(): boolean {
    return this.configService.get<string>('NODE_ENV') === 'production';
  }

  /**
   * SameSite=None is required (not Strict/Lax) because apps/web and apps/api are always
   * served from different origins/ports — even in local dev (localhost:3000 vs :4000) — and
   * this cookie must survive a cross-origin fetch(..., { credentials: 'include' }), which
   * SameSite=Lax does not allow. Secure is required alongside None by browsers, and is only
   * enabled in production since local dev runs over plain HTTP.
   */
  private cookieOptions(): {
    httpOnly: true;
    secure: boolean;
    sameSite: 'none' | 'lax';
    path: string;
  } {
    const isProduction = this.isProduction();
    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: REFRESH_COOKIE_PATH,
    };
  }

  private setRefreshCookie(res: Response, refreshToken: string): void {
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
      ...this.cookieOptions(),
      maxAge: this.authService.getRefreshTtlMs(),
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE_NAME, this.cookieOptions());
  }

  private readRefreshCookie(req: Request): string | undefined {
    const header = req.headers.cookie;
    if (!header) return undefined;
    for (const part of header.split(';')) {
      const separatorIndex = part.indexOf('=');
      if (separatorIndex === -1) continue;
      const name = part.slice(0, separatorIndex).trim();
      if (name === REFRESH_COOKIE_NAME) {
        const value = part.slice(separatorIndex + 1).trim();
        try {
          return decodeURIComponent(value);
        } catch {
          return undefined;
        }
      }
    }
    return undefined;
  }
}
