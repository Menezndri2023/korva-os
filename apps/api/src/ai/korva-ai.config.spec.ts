import type { ConfigService } from '@nestjs/config';
import { readKorvaAiConfig } from './korva-ai.config';

function config(env: Record<string, string>): ConfigService {
  return { get: (key: string) => env[key] } as unknown as ConfigService;
}

describe('readKorvaAiConfig', () => {
  it('resolves a preset to its endpoint', () => {
    expect(
      readKorvaAiConfig(
        config({
          AI_PROVIDER: 'groq',
          AI_API_KEY: 'k',
          AI_MODEL: 'llama-3.3-70b-versatile',
        }),
      ),
    ).toMatchObject({
      provider: 'openai_compatible',
      label: 'Groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b-versatile',
    });
  });

  it('needs no key for a model KORVA hosts itself', () => {
    expect(
      readKorvaAiConfig(
        config({ AI_PROVIDER: 'ollama', AI_MODEL: 'qwen3:8b' }),
      ),
    ).toMatchObject({
      provider: 'openai_compatible',
      apiKey: undefined,
    });
  });

  it('says what is missing instead of failing', () => {
    expect(readKorvaAiConfig(config({}))).toMatchObject({
      provider: 'none',
      reason: 'AI_PROVIDER non défini',
    });
    expect(
      readKorvaAiConfig(config({ AI_PROVIDER: 'anthropic' })),
    ).toMatchObject({
      provider: 'none',
      reason: 'AI_API_KEY manquante',
    });
    expect(
      readKorvaAiConfig(config({ AI_PROVIDER: 'mistral', AI_API_KEY: 'k' })),
    ).toMatchObject({
      provider: 'none',
      reason: 'AI_MODEL manquant',
    });
    expect(
      readKorvaAiConfig(
        config({
          AI_PROVIDER: 'openai_compatible',
          AI_API_KEY: 'k',
          AI_MODEL: 'm',
        }),
      ),
    ).toMatchObject({
      provider: 'none',
      reason: 'AI_BASE_URL manquante',
    });
  });

  it('reads the budget and a declared price, free tiers included', () => {
    expect(
      readKorvaAiConfig(
        config({
          AI_PROVIDER: 'gemini',
          AI_API_KEY: 'k',
          AI_MODEL: 'gemini-flash',
          AI_MONTHLY_BUDGET_USD: '30',
          AI_PRICE_INPUT_PER_MILLION_USD: '0',
          AI_PRICE_OUTPUT_PER_MILLION_USD: '0',
        }),
      ),
    ).toMatchObject({
      monthlyBudgetUsd: 30,
      priceOverride: { input: 0, output: 0 },
    });
  });
});
