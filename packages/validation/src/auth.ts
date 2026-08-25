import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(72),
  firstName: z.string().min(1).max(120).optional(),
  lastName: z.string().min(1).max(120).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  /** Only required when the account has 2FA enabled — see AuthService.login. */
  totpCode: z
    .string()
    .regex(/^\d{6}$/, "totpCode must be a 6-digit code")
    .optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const totpCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "code must be a 6-digit code"),
});
export type TotpCodeInput = z.infer<typeof totpCodeSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: registerSchema.shape.password,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const verifyEmailSchema = z.object({
  token: z.string().min(1),
});
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
