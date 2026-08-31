import { z } from "zod";
import { registerSchema } from "./auth.ts";

export const customerRegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(72),
  firstName: z.string().min(1).max(120).optional(),
  lastName: z.string().min(1).max(120).optional(),
  phone: z.string().min(1).max(40).optional(),
});
export type CustomerRegisterInput = z.infer<typeof customerRegisterSchema>;

export const customerLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type CustomerLoginInput = z.infer<typeof customerLoginSchema>;

export const customerRefreshSchema = z.object({
  refreshToken: z.string().min(1),
});
export type CustomerRefreshInput = z.infer<typeof customerRefreshSchema>;

export const customerUpdateProfileSchema = z.object({
  firstName: z.string().min(1).max(120).optional(),
  lastName: z.string().min(1).max(120).optional(),
  phone: z.string().min(1).max(40).optional(),
});
export type CustomerUpdateProfileInput = z.infer<
  typeof customerUpdateProfileSchema
>;

export const customerForgotPasswordSchema = z.object({
  email: z.string().email(),
});
export type CustomerForgotPasswordInput = z.infer<
  typeof customerForgotPasswordSchema
>;

export const customerResetPasswordSchema = z.object({
  token: z.string().min(1),
  password: registerSchema.shape.password,
});
export type CustomerResetPasswordInput = z.infer<
  typeof customerResetPasswordSchema
>;

export const listCustomerHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListCustomerHistoryQuery = z.infer<
  typeof listCustomerHistoryQuerySchema
>;
