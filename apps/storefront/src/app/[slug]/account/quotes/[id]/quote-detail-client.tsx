"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card, Input } from "@korva/ui";
import { publicApiClient, PublicApiError } from "@/lib/public-api-client";
import { formatOfferPrice } from "@/lib/offer-labels";
import { useCustomerAuth } from "@/lib/use-customer-auth";
import type { CustomerQuoteDetail } from "@/lib/public-types";
import type { QuoteStatus } from "@korva/types";
import { AccountShell } from "../../account-shell";
import { intlLocale, useStorefrontLocale, useT } from "@/lib/storefront-locale";

const QUOTE_STATUS_LABELS: Record<QuoteStatus, [string, string]> = {
  draft: ["Brouillon", "Draft"],
  sent: ["En attente de signature", "Awaiting signature"],
  viewed: ["En attente de signature", "Awaiting signature"],
  accepted: ["Signé", "Signed"],
  rejected: ["Refusé", "Rejected"],
  expired: ["Expiré", "Expired"],
};

export default function QuoteDetailClient({ slug, quoteId }: { slug: string; quoteId: string }) {
  const locale = useStorefrontLocale();
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { hydrated, isAuthenticated, authFetch, customer } = useCustomerAuth(slug);
  const [signerName, setSignerName] = useState("");

  useEffect(() => {
    if (hydrated && !isAuthenticated) {
      router.replace(`/${slug}/account/login`);
    }
  }, [hydrated, isAuthenticated, slug, router]);

  // Seeds the sign-form name once the customer profile is known (post-hydration) — same
  // rationale as useCart's own hydration effect: this can't be render-time initial state
  // without desyncing server/client render output.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (customer) {
      setSignerName([customer.firstName, customer.lastName].filter(Boolean).join(" "));
    }
  }, [customer]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const quoteQuery = useQuery({
    queryKey: ["customer-quote", slug, quoteId],
    queryFn: () =>
      authFetch((token) =>
        publicApiClient.get<CustomerQuoteDetail>(`/public/${slug}/account/quotes/${quoteId}`, token),
      ),
    enabled: hydrated && isAuthenticated,
  });

  const signMutation = useMutation({
    mutationFn: () =>
      authFetch((token) =>
        publicApiClient.post(
          `/public/${slug}/account/quotes/${quoteId}/sign`,
          { signerName },
          token,
        ),
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["customer-quote", slug, quoteId] }),
  });

  const canSign = quoteQuery.data?.status === "sent" || quoteQuery.data?.status === "viewed";

  return (
    <AccountShell slug={slug} title={t("Mon devis", "My quote")}>
      <Link href={`/${slug}/account/quotes`} className="text-sm text-text-muted hover:underline">
        {t("← Mes devis", "← My quotes")}
      </Link>

      {quoteQuery.isLoading && (
        <Card className="p-6 text-center text-sm text-text-muted">{t("Chargement…", "Loading…")}</Card>
      )}

      {quoteQuery.isSuccess && (
        <Card className="space-y-4 p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-text">Devis {quoteQuery.data.number}</h2>
            <Badge
              variant={
                quoteQuery.data.status === "rejected" || quoteQuery.data.status === "expired"
                  ? "destructive"
                  : quoteQuery.data.status === "accepted"
                    ? "success"
                    : "default"
              }
            >
              {t(...QUOTE_STATUS_LABELS[quoteQuery.data.status])}
            </Badge>
          </div>

          <ul className="divide-y divide-border rounded-md border border-border">
            {quoteQuery.data.items.map((item, index) => (
              <li key={index} className="flex justify-between px-3 py-2 text-sm">
                <span className="text-text">
                  {item.description} × {item.quantity}
                </span>
                <span className="text-text-muted">
                  {formatOfferPrice(item.unitPrice * item.quantity, quoteQuery.data.currency, locale)}
                </span>
              </li>
            ))}
          </ul>

          <div className="space-y-1 text-right text-sm">
            {quoteQuery.data.discountTotal > 0 && (
              <p className="text-text-muted">
                Remise : -{formatOfferPrice(quoteQuery.data.discountTotal, quoteQuery.data.currency, locale)}
              </p>
            )}
            <p className="font-medium text-text">
              Total : {formatOfferPrice(quoteQuery.data.total, quoteQuery.data.currency, locale)}
            </p>
          </div>

          {quoteQuery.data.notes && (
            <p className="border-t border-border pt-3 text-sm text-text-muted">{quoteQuery.data.notes}</p>
          )}

          {quoteQuery.data.validUntil && !canSign && quoteQuery.data.status !== "accepted" && (
            <p className="text-xs text-text-muted">
              Valide jusqu&apos;au{" "}
              {new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium" }).format(
                new Date(quoteQuery.data.validUntil),
              )}
            </p>
          )}

          {quoteQuery.data.status === "accepted" && quoteQuery.data.signedByName && (
            <p className="border-t border-border pt-3 text-sm text-text-muted">
              {t("Signé par", "Signed by")} {quoteQuery.data.signedByName}
              {quoteQuery.data.signedAt &&
                ` ${t("le", "on")} ${new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "short" }).format(
                  new Date(quoteQuery.data.signedAt),
                )}`}
            </p>
          )}

          {canSign && (
            <div className="space-y-3 border-t border-border pt-3">
              <p className="text-sm font-medium text-text">{t("Signer ce devis", "Sign this quote")}</p>
              <p className="text-xs text-text-muted">
                {t(
                  "En saisissant votre nom complet et en validant, vous acceptez ce devis dans les conditions indiquées ci-dessus.",
                  "By typing your full name and confirming, you accept this quote on the terms shown above.",
                )}
              </p>
              <Input
                value={signerName}
                onChange={(event) => setSignerName(event.target.value)}
                placeholder={t("Nom complet", "Full name")}
                className="w-full"
              />
              {signMutation.isError && (
                <p className="text-xs text-destructive">
                  {signMutation.error instanceof PublicApiError
                    ? signMutation.error.message
                    : t("Impossible de signer ce devis.", "This quote could not be signed.")}
                </p>
              )}
              <Button
                type="button"
                loading={signMutation.isPending}
                disabled={!signerName.trim()}
                onClick={() => signMutation.mutate()}
              >
                {t("Signer et accepter", "Sign and accept")}
              </Button>
            </div>
          )}
        </Card>
      )}
    </AccountShell>
  );
}
