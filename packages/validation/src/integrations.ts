import { z } from "zod";

/**
 * Mirrors `ConnectPaymentPayoutInput` (packages/types/src/integrations.ts) exactly — the
 * Settings → Integrations "Connect payout destination" form body for Flow B
 * (Merchant-of-Record). `payoutDetails` stays a provider-agnostic string map at this boundary
 * (see that type's own doc comment); this schema only enforces that every key/value is a
 * non-empty string and that at least one detail was actually submitted, so an empty or malformed
 * body is rejected before it ever reaches `PaymentProvider.createPayoutDestination`.
 */
export const connectPaymentPayoutSchema = z.object({
  payoutDetails: z
    .record(z.string().min(1), z.string().min(1))
    .refine((details) => Object.keys(details).length > 0, {
      message: "At least one payout detail is required",
    }),
});
export type ConnectPaymentPayoutInput = z.infer<
  typeof connectPaymentPayoutSchema
>;

/**
 * Mirrors `ConnectMessagingAccountInput` (packages/types/src/integrations.ts) exactly — the
 * Settings → Integrations "Connect WhatsApp Business Account" form body. All three fields are
 * obtained by the tenant from the BSP's own onboarding flow outside this app (see
 * docs/architecture/integrations-platform.md §5/§9), so this schema only guards against blank
 * submissions, not any provider-specific format.
 */
export const connectMessagingAccountSchema = z.object({
  wabaId: z.string().min(1),
  phoneNumberId: z.string().min(1),
  displayName: z.string().min(1),
});
export type ConnectMessagingAccountInput = z.infer<
  typeof connectMessagingAccountSchema
>;
