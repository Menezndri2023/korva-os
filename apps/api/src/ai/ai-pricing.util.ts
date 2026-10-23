/**
 * Official Claude API pricing, USD per MILLION tokens — confirmed via
 * platform.claude.com/docs/en/about-claude/pricing (fetched 2026-08-29). Deliberately only
 * covers base input/output rates: this codebase's AnthropicAIProvider uses neither prompt
 * caching nor server-side tools, so cache-write/cache-read/batch rates don't apply to any call
 * KORVA actually makes — adding them here before they're ever used would be speculative.
 *
 * An unrecognized model string (a future model this table hasn't been updated for, or a typo in
 * AI_MODEL) deliberately returns `null` from estimateCostUsd rather than falling back to some
 * other model's price — a wrong-but-plausible-looking dollar figure is worse than an honest
 * "unpriced" gap, see AiUsageLog.costUsd's own doc comment.
 */
const CLAUDE_PRICING_USD_PER_MILLION_TOKENS: Record<
  string,
  { input: number; output: number }
> = {
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'claude-fable-5': { input: 10, output: 50 },
};

/**
 * `override` is the price declared in .env.production (AI_PRICE_*_PER_MILLION_USD) for a model
 * this table does not know — any non-Claude model, and 0/0 for a free tier. It wins over the
 * table, so a negotiated or changed price can be corrected without a release.
 */
export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  override?: { input: number; output: number } | null,
): number | null {
  const pricing = override ?? CLAUDE_PRICING_USD_PER_MILLION_TOKENS[model];
  if (!pricing) return null;
  return (
    (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000
  );
}
