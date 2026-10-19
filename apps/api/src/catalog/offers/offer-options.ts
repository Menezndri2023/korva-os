import { BadRequestException } from '@nestjs/common';
import type { OfferOptionGroup } from '@korva/types';

export interface ChosenOptions {
  /** Sum of the chosen options' price deltas, added to the line's unit price. */
  priceDelta: number;
  /** Chosen option names in group order, for the line description the kitchen reads. */
  labels: string[];
}

function invalid(message: string): never {
  throw new BadRequestException({ code: 'INVALID_OFFER_OPTIONS', message });
}

/**
 * Checks a customer's chosen options against the offer's STORED option groups and prices them.
 *
 * Everything comes from the offer: an option id the offer does not have is refused, never priced
 * at zero, and the client never sends a price. Each group's rules hold — a required group needs a
 * choice, no group takes more than its `maxChoices`, and no option counts twice.
 *
 * An offer without option groups accepts no options, and an order line without `optionIds` on an
 * offer that has groups is still checked: a required group then fails.
 */
export function resolveChosenOptions(
  offer: { name: string; optionGroups?: OfferOptionGroup[] },
  optionIds: string[] = [],
): ChosenOptions {
  const groups = offer.optionGroups ?? [];
  if (new Set(optionIds).size !== optionIds.length) {
    invalid('An option was chosen twice');
  }
  const known = new Set(
    groups.flatMap((group) => group.options.map((o) => o.id)),
  );
  const unknown = optionIds.find((id) => !known.has(id));
  if (unknown) invalid(`Unknown option ${unknown} for ${offer.name}`);

  let priceDelta = 0;
  const labels: string[] = [];
  for (const group of groups) {
    const chosen = group.options.filter((option) =>
      optionIds.includes(option.id),
    );
    if (group.required && chosen.length === 0) {
      invalid(`"${group.name}" is required for ${offer.name}`);
    }
    if (chosen.length > group.maxChoices) {
      invalid(`At most ${group.maxChoices} choice(s) for "${group.name}"`);
    }
    for (const option of chosen) {
      priceDelta += option.priceDelta;
      labels.push(option.name);
    }
  }
  return { priceDelta, labels };
}
