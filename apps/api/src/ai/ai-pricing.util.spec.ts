import { estimateCostUsd } from './ai-pricing.util';

describe('estimateCostUsd', () => {
  it('prices a known model from its per-million-token input/output rates', () => {
    expect(estimateCostUsd('claude-sonnet-5', 1_000_000, 1_000_000)).toBe(12);
    expect(estimateCostUsd('claude-opus-5', 1_000_000, 1_000_000)).toBe(30);
    expect(
      estimateCostUsd('claude-haiku-4-5-20251001', 1_000_000, 1_000_000),
    ).toBe(6);
    expect(estimateCostUsd('claude-fable-5', 1_000_000, 1_000_000)).toBe(60);
  });

  it('scales linearly with token counts below one million', () => {
    expect(estimateCostUsd('claude-sonnet-5', 1000, 2000)).toBeCloseTo(
      (1000 * 2 + 2000 * 10) / 1_000_000,
    );
  });

  it('returns null for an unrecognized model rather than guessing a cost', () => {
    expect(estimateCostUsd('some-future-unreleased-model', 1000, 1000)).toBe(
      null,
    );
  });
});
