/**
 * Provider-agnostic webhook signature verification contract — the one seam every real provider
 * adapter (Flutterwave HMAC-SHA256, 360dialog's `X-Hub-Signature-256`, ...) plugs into, mirroring
 * how `verifySvixSignature`/Resend's own scheme is used today (see resend-webhook.controller.ts).
 * Stage 1 (this file's own wave) builds only this interface plus a fake/test implementation
 * (fake-webhook-verifier.ts) — no real provider verifier exists yet, that's Stage 2, out of
 * scope. See docs/architecture/integrations-platform.md §6/§7.
 */
export interface WebhookVerifier {
  /** Identifies which provider this verifier authenticates — e.g. 'flutterwave', '360dialog'. */
  readonly provider: string;

  /**
   * Must be checked against the exact raw request bytes the provider sent (never a
   * re-serialization of a parsed body — see verify-svix-signature.ts's own comment on why),
   * using a constant-time comparison so timing side-channels can't leak the expected signature.
   * Returns `false` for any failure mode (missing secret config, missing/malformed signature
   * header, mismatched signature) — callers must fail closed on `false`, never fail open.
   */
  verify(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): boolean;
}
