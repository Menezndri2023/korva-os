"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card } from "@korva/ui";
import { publicApiClient } from "@/lib/public-api-client";
import { formatOfferPrice } from "@/lib/offer-labels";
import { useCustomerAuth } from "@/lib/use-customer-auth";
import type { CustomerWishlistEntry } from "@/lib/public-types";
import { AccountShell } from "../account-shell";
import { useStorefrontLocale, useT } from "@/lib/storefront-locale";

export default function WishlistClient({ slug }: { slug: string }) {
  const locale = useStorefrontLocale();
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { hydrated, isAuthenticated, authFetch } = useCustomerAuth(slug);

  useEffect(() => {
    if (hydrated && !isAuthenticated) {
      router.replace(`/${slug}/account/login`);
    }
  }, [hydrated, isAuthenticated, slug, router]);

  const wishlistQuery = useQuery({
    queryKey: ["customer-wishlist", slug],
    queryFn: () =>
      authFetch((token) =>
        publicApiClient.get<CustomerWishlistEntry[]>(`/public/${slug}/account/wishlist`, token),
      ),
    enabled: hydrated && isAuthenticated,
  });

  const removeMutation = useMutation({
    mutationFn: (offerId: string) =>
      authFetch((token) =>
        publicApiClient.delete(`/public/${slug}/account/wishlist/${offerId}`, token),
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["customer-wishlist", slug] }),
  });

  return (
    <AccountShell slug={slug} title={t("Mes favoris", "My favourites")}>
      <Link href={`/${slug}/account`} className="text-sm text-text-muted hover:underline">
        {t("← Mon compte", "← My account")}
      </Link>

      {wishlistQuery.isLoading && (
        <Card className="p-6 text-center text-sm text-text-muted">{t("Chargement…", "Loading…")}</Card>
      )}

      {wishlistQuery.isSuccess && wishlistQuery.data.length === 0 && (
        <Card className="p-6 text-center text-sm text-text-muted">
          {t("Votre liste de souhaits est vide.", "Your wishlist is empty.")}
        </Card>
      )}

      {wishlistQuery.isSuccess && wishlistQuery.data.length > 0 && (
        <div className="space-y-3">
          {wishlistQuery.data.map((entry) => (
            <Card key={entry.id} className="flex items-center justify-between p-4 text-sm">
              <Link href={`/${slug}/offers/${entry.offerId}`} className="font-medium text-text hover:underline">
                {entry.offerName}
              </Link>
              <div className="flex items-center gap-3">
                <span className="font-medium text-text">
                  {formatOfferPrice(entry.pricing.amount, entry.pricing.currency, locale)}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  loading={removeMutation.isPending && removeMutation.variables === entry.offerId}
                  onClick={() => removeMutation.mutate(entry.offerId)}
                >
                  {t("Retirer", "Remove")}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </AccountShell>
  );
}
