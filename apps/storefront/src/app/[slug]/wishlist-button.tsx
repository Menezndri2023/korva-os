"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { publicApiClient } from "@/lib/public-api-client";
import { useCustomerAuth } from "@/lib/use-customer-auth";
import { useT } from "@/lib/storefront-locale";

/**
 * "Ajouter à ma liste de souhaits" — only rendered for a logged-in customer (a guest has no
 * wishlist to add to). Deliberately doesn't try to reflect "already saved" state on the catalog
 * grid — that would need a bulk wishlist-membership query per page load for a small convenience;
 * the full list with remove actions lives at /account/wishlist instead.
 */
export function WishlistButton({ slug, offerId }: { slug: string; offerId: string }) {
  const t = useT();
  const { isAuthenticated, authFetch } = useCustomerAuth(slug);
  const [saved, setSaved] = useState(false);

  const addMutation = useMutation({
    mutationFn: () =>
      authFetch((token) =>
        publicApiClient.post(`/public/${slug}/account/wishlist`, { offerId }, token),
      ),
    onSuccess: () => setSaved(true),
  });

  if (!isAuthenticated) return null;

  return (
    <button
      type="button"
      onClick={() => addMutation.mutate()}
      disabled={addMutation.isPending || saved}
      aria-label={saved ? t("Dans votre liste de souhaits", "In your wishlist") : t("Ajouter à ma liste de souhaits", "Add to my wishlist")}
      className="inline-flex items-center px-2 py-1.5 text-sm text-text-muted hover:text-text disabled:opacity-60"
    >
      {saved ? "♥" : "♡"}
    </button>
  );
}
