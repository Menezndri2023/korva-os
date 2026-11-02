import { formatOfferPrice } from "@/lib/offer-labels";
import type { PublicOffer } from "@/lib/public-types";
import { useStorefrontLocale } from "@/lib/storefront-locale";

/**
 * An offer's price, preceded by its price before promotion struck through when it has one.
 *
 * The single place every storefront card and page renders a price, so a promotion shows up
 * everywhere the offer does. `compareAtPrice` is guaranteed higher than the price by the API
 * (OffersService), so no comparison is needed here. The struck price is announced as such for
 * screen readers, which do not convey `line-through`.
 */
export function OfferPrice({ offer }: { offer: Pick<PublicOffer, "pricing" | "compareAtPrice"> }) {
  const locale = useStorefrontLocale();
  const { amount, currency } = offer.pricing;
  return (
    <>
      {offer.compareAtPrice != null && (
        <>
          <s className="mr-1.5 font-normal opacity-60" aria-hidden="true">
            {formatOfferPrice(offer.compareAtPrice, currency, locale)}
          </s>
          <span className="sr-only">
            Prix avant promotion : {formatOfferPrice(offer.compareAtPrice, currency, locale)}. Prix :{" "}
          </span>
        </>
      )}
      {formatOfferPrice(amount, currency, locale)}
    </>
  );
}
