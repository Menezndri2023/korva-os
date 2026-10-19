import { BadRequestException } from '@nestjs/common';
import { resolveChosenOptions } from './offer-options';

const garba = {
  name: 'Garba',
  optionGroups: [
    {
      id: 'size',
      name: 'Taille',
      required: true,
      maxChoices: 1,
      options: [
        { id: 'small', name: 'Petit', priceDelta: 0 },
        { id: 'large', name: 'Grand', priceDelta: 500 },
      ],
    },
    {
      id: 'extras',
      name: 'Suppléments',
      required: false,
      maxChoices: 2,
      options: [
        { id: 'egg', name: 'Œuf', priceDelta: 200 },
        { id: 'chili', name: 'Piment', priceDelta: 0 },
        { id: 'fish', name: 'Poisson en plus', priceDelta: 700 },
      ],
    },
  ],
};

function message(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof BadRequestException) {
      const body = error.getResponse() as { code: string; message: string };
      expect(body.code).toBe('INVALID_OFFER_OPTIONS');
      return body.message;
    }
    throw error;
  }
  return undefined;
}

describe('resolveChosenOptions', () => {
  it('prices the chosen options and lists them in group order', () => {
    expect(resolveChosenOptions(garba, ['egg', 'large'])).toEqual({
      priceDelta: 700,
      labels: ['Grand', 'Œuf'],
    });
  });

  it('accepts no options for an offer that has none', () => {
    expect(resolveChosenOptions({ name: 'Eau' })).toEqual({
      priceDelta: 0,
      labels: [],
    });
  });

  it('refuses a missing required choice, too many choices, an unknown id and a duplicate', () => {
    expect(message(() => resolveChosenOptions(garba, []))).toMatch(/Taille/);
    expect(
      message(() => resolveChosenOptions(garba, ['small', 'large'])),
    ).toMatch(/At most 1/);
    expect(
      message(() =>
        resolveChosenOptions(garba, ['small', 'egg', 'chili', 'fish']),
      ),
    ).toMatch(/At most 2/);
    expect(
      message(() => resolveChosenOptions(garba, ['small', 'caviar'])),
    ).toMatch(/caviar/);
    expect(
      message(() => resolveChosenOptions(garba, ['small', 'egg', 'egg'])),
    ).toMatch(/twice/);
    expect(
      message(() => resolveChosenOptions({ name: 'Eau' }, ['egg'])),
    ).toMatch(/Unknown/);
  });
});
