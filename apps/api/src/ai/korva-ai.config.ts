import type { ConfigService } from '@nestjs/config';

/**
 * KORVA IA's "brain" is chosen in .env.production, never in code — switching from a free tier
 * used to build and demo, to a paid model for real customers, to a model KORVA hosts itself, is
 * three lines and a restart:
 *
 *   AI_PROVIDER=groq | mistral | openrouter | gemini | ollama | openai_compatible | anthropic
 *   AI_API_KEY=…            (not needed for ollama)
 *   AI_MODEL=…              (required for every provider but anthropic)
 *   AI_BASE_URL=…           (only for openai_compatible, or to override a preset)
 *
 * Every provider except Anthropic speaks the OpenAI "chat completions" format, which is why one
 * client (OpenAiCompatibleAIProvider) covers them all.
 *
 *   AI_MONTHLY_BUDGET_USD=30      platform-wide cap: past it, KORVA IA pauses until next month
 *   AI_PRICE_INPUT_PER_MILLION_USD / AI_PRICE_OUTPUT_PER_MILLION_USD
 *                                 the model's price (0 and 0 on a free tier) when the built-in
 *                                 Claude table does not know it — see ai-pricing.util.ts
 */
export const OPENAI_COMPATIBLE_PRESETS = {
  groq: { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
  mistral: { label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1' },
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  gemini: {
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  },
  /** A model KORVA runs itself (Ollama exposes the same API) — no key. */
  ollama: {
    label: 'Modèle hébergé par KORVA',
    baseUrl: 'http://localhost:11434/v1',
  },
} as const;

type Preset = keyof typeof OPENAI_COMPATIBLE_PRESETS;

export type KorvaAiConfig =
  | {
      provider: 'anthropic';
      label: string;
      apiKey: string;
      model: string;
      monthlyBudgetUsd: number | null;
      priceOverride: ModelPrice | null;
    }
  | {
      provider: 'openai_compatible';
      label: string;
      baseUrl: string;
      apiKey?: string;
      model: string;
      monthlyBudgetUsd: number | null;
      priceOverride: ModelPrice | null;
    }
  | {
      provider: 'none';
      /** Why nothing is configured, for the administration's system page. */
      reason: string;
      monthlyBudgetUsd: number | null;
      priceOverride: ModelPrice | null;
    };

export interface ModelPrice {
  input: number;
  output: number;
}

function positiveNumber(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function readKorvaAiConfig(config: ConfigService): KorvaAiConfig {
  const provider = (config.get<string>('AI_PROVIDER') ?? '')
    .trim()
    .toLowerCase();
  const apiKey = config.get<string>('AI_API_KEY')?.trim() || undefined;
  const model = config.get<string>('AI_MODEL')?.trim() || undefined;
  const monthlyBudgetUsd = positiveNumber(
    config.get<string>('AI_MONTHLY_BUDGET_USD'),
  );
  const input = positiveNumber(
    config.get<string>('AI_PRICE_INPUT_PER_MILLION_USD'),
  );
  const output = positiveNumber(
    config.get<string>('AI_PRICE_OUTPUT_PER_MILLION_USD'),
  );
  const priceOverride =
    input !== null && output !== null ? { input, output } : null;
  const shared = { monthlyBudgetUsd, priceOverride };

  if (provider === 'anthropic') {
    if (!apiKey)
      return { provider: 'none', reason: 'AI_API_KEY manquante', ...shared };
    return {
      provider: 'anthropic',
      label: 'Anthropic Claude',
      apiKey,
      model: model ?? 'claude-haiku-4-5-20251001',
      ...shared,
    };
  }

  const preset =
    provider in OPENAI_COMPATIBLE_PRESETS
      ? OPENAI_COMPATIBLE_PRESETS[provider as Preset]
      : undefined;
  if (preset || provider === 'openai_compatible') {
    const baseUrl = (
      config.get<string>('AI_BASE_URL')?.trim() || preset?.baseUrl
    )?.replace(/\/+$/, '');
    if (!baseUrl)
      return { provider: 'none', reason: 'AI_BASE_URL manquante', ...shared };
    if (!model)
      return { provider: 'none', reason: 'AI_MODEL manquant', ...shared };
    if (!apiKey && provider !== 'ollama') {
      return { provider: 'none', reason: 'AI_API_KEY manquante', ...shared };
    }
    return {
      provider: 'openai_compatible',
      label: preset?.label ?? 'API compatible OpenAI',
      baseUrl,
      apiKey,
      model,
      ...shared,
    };
  }

  return {
    provider: 'none',
    reason: provider
      ? `AI_PROVIDER inconnu : « ${provider} »`
      : 'AI_PROVIDER non défini',
    ...shared,
  };
}
