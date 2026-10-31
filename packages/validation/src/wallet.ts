import { z } from "zod";
import { MIN_PAYOUT_AMOUNT, PAYOUT_FREQUENCIES, PAYOUT_PROVIDERS } from "@korva/types";

/** Omitted = everything available. */
export const requestPayoutSchema = z.object({
  amount: z.number().positive().optional(),
});
export type RequestPayoutInput = z.infer<typeof requestPayoutSchema>;

export const setPayoutDestinationSchema = z.object({
  provider: z.enum(PAYOUT_PROVIDERS),
  account: z
    .string()
    .trim()
    .regex(/^\+[1-9][0-9 ]{7,18}$/, "Numéro au format international, ex. +225 07 07 07 07 07"),
  holderName: z.string().trim().min(2).max(120),
});
export type SetPayoutDestinationInput = z.infer<typeof setPayoutDestinationSchema>;

export const confirmPayoutDestinationSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "Le code reçu par e-mail a 6 chiffres"),
});
export type ConfirmPayoutDestinationInput = z.infer<typeof confirmPayoutDestinationSchema>;

export const updateAutoPayoutSchema = z.object({
  enabled: z.boolean(),
  frequency: z.enum(PAYOUT_FREQUENCIES).default("weekly"),
  minimum: z.number().int().min(MIN_PAYOUT_AMOUNT).max(100_000_000).default(5000),
});
export type UpdateAutoPayoutInput = z.infer<typeof updateAutoPayoutSchema>;

export const listWalletQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListWalletQuery = z.infer<typeof listWalletQuerySchema>;

export const rejectPayoutSchema = z.object({
  reason: z.string().trim().min(3).max(300),
});
export type RejectPayoutInput = z.infer<typeof rejectPayoutSchema>;

export const walletAdjustmentSchema = z.object({
  amount: z.number().refine((value) => value !== 0, "Montant non nul"),
  note: z.string().trim().min(3).max(300),
});
export type WalletAdjustmentInput = z.infer<typeof walletAdjustmentSchema>;

export const listPayoutsAdminQuerySchema = z.object({
  status: z.enum(["requested", "processing", "completed", "failed", "rejected"]).optional(),
});
export type ListPayoutsAdminQuery = z.infer<typeof listPayoutsAdminQuerySchema>;
