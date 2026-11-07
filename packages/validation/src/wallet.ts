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

export const updateSubscriptionAutopaySchema = z.object({
  enabled: z.boolean(),
});
export type UpdateSubscriptionAutopayInput = z.infer<typeof updateSubscriptionAutopaySchema>;

export const listWalletQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListWalletQuery = z.infer<typeof listWalletQuerySchema>;

export const rejectPayoutSchema = z.object({
  reason: z.string().trim().min(3).max(300),
});
export type RejectPayoutInput = z.infer<typeof rejectPayoutSchema>;

/** The administration paid a withdrawal itself (Wave, Orange Money… from KORVA's own phone or
 *  GeniusPay's dashboard) while GeniusPay's payout API is not open to KORVA. */
export const markPayoutPaidSchema = z.object({
  /** The operator's transaction reference, so the business can check it on its own phone. */
  reference: z.string().trim().min(3).max(100),
  /** What the transfer actually cost, in the withdrawal's currency. */
  fee: z.number().min(0).max(1_000_000).optional(),
});
export type MarkPayoutPaidInput = z.infer<typeof markPayoutPaidSchema>;

export const walletAdjustmentSchema = z.object({
  amount: z.number().refine((value) => value !== 0, "Montant non nul"),
  note: z.string().trim().min(3).max(300),
});
export type WalletAdjustmentInput = z.infer<typeof walletAdjustmentSchema>;

export const listPayoutsAdminQuerySchema = z.object({
  status: z.enum(["requested", "processing", "completed", "failed", "rejected"]).optional(),
});
export type ListPayoutsAdminQuery = z.infer<typeof listPayoutsAdminQuerySchema>;

/** GET /wallet/statement — one calendar month of the Solde, as JSON, CSV or PDF. */
export const walletStatementQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mois au format AAAA-MM"),
  format: z.enum(["csv", "pdf"]).default("csv"),
});
export type WalletStatementQuery = z.infer<typeof walletStatementQuerySchema>;
