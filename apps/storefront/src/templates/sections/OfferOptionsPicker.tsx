import type { OfferOptionGroup } from "@korva/types";
import { formatOfferPrice } from "@/lib/offer-labels";
import type { ChosenOptions } from "@/lib/use-cart";
import { useStorefrontLocale, useT } from "@/lib/storefront-locale";

/** The chosen ids summarised for the cart: names in group order and the added price. */
export function summarizeOptions(groups: OfferOptionGroup[], ids: string[]): ChosenOptions {
  const chosen = groups.flatMap((group) => group.options.filter((option) => ids.includes(option.id)));
  return {
    ids: chosen.map((option) => option.id),
    labels: chosen.map((option) => option.name),
    priceDelta: chosen.reduce((sum, option) => sum + option.priceDelta, 0),
  };
}

/** Names of the required groups still without a choice — the add button stays off until empty. */
export function missingRequiredGroups(groups: OfferOptionGroup[], ids: string[]): string[] {
  return groups
    .filter((group) => group.required && !group.options.some((option) => ids.includes(option.id)))
    .map((group) => group.name);
}

/**
 * Lets the customer make an offer's choices before adding it to the cart: radio buttons for a
 * single-choice group, checkboxes capped at `maxChoices` otherwise. The same rules are enforced by
 * the API when the order is placed; this only keeps the customer from hitting them.
 */
export function OfferOptionsPicker({
  groups,
  selected,
  onChange,
  currency,
}: {
  groups: OfferOptionGroup[];
  selected: string[];
  onChange: (next: string[]) => void;
  currency: string;
}) {
  const locale = useStorefrontLocale();
  const t = useT();
  function toggle(group: OfferOptionGroup, optionId: string, checked: boolean) {
    const others = selected.filter((id) => !group.options.some((option) => option.id === id));
    const inGroup = selected.filter((id) => group.options.some((option) => option.id === id));
    if (group.maxChoices === 1) {
      onChange(checked ? [...others, optionId] : others);
      return;
    }
    if (checked && inGroup.length >= group.maxChoices) return;
    onChange(checked ? [...selected, optionId] : selected.filter((id) => id !== optionId));
  }

  return (
    <div className="mt-4 space-y-3">
      {groups.map((group) => {
        const inGroup = selected.filter((id) => group.options.some((option) => option.id === id));
        return (
          <fieldset key={group.id} className="space-y-1">
            <legend className="text-sm font-medium text-text">
              {group.name}
              <span className="ml-1 text-xs font-normal text-text-muted">
                {group.required ? "obligatoire" : "facultatif"}
                {group.maxChoices > 1 ? t(` · jusqu'à ${group.maxChoices}`, ` · up to ${group.maxChoices}`) : ""}
              </span>
            </legend>
            {group.options.map((option) => {
              const checked = selected.includes(option.id);
              const full = group.maxChoices > 1 && !checked && inGroup.length >= group.maxChoices;
              return (
                <label key={option.id} className="flex items-center gap-2 text-sm text-text">
                  <input
                    type={group.maxChoices === 1 ? "radio" : "checkbox"}
                    name={`option-group-${group.id}`}
                    checked={checked}
                    disabled={full}
                    onChange={(e) => toggle(group, option.id, e.target.checked)}
                  />
                  {option.name}
                  {option.priceDelta > 0 && (
                    <span className="text-text-muted">
                      +{formatOfferPrice(option.priceDelta, currency, locale)}
                    </span>
                  )}
                </label>
              );
            })}
          </fieldset>
        );
      })}
    </div>
  );
}
