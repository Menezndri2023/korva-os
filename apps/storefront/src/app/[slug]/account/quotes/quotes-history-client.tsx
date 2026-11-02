"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Card } from "@korva/ui";
import { publicApiClient } from "@/lib/public-api-client";
import { formatOfferPrice } from "@/lib/offer-labels";
import { useCustomerAuth } from "@/lib/use-customer-auth";
import type { CustomerQuoteSummary } from "@/lib/public-types";
import type { QuoteStatus } from "@korva/types";
import { AccountShell } from "../account-shell";
import { intlLocale, useStorefrontLocale, useT } from "@/lib/storefront-locale";

const QUOTE_STATUS_LABELS: Record<QuoteStatus, [string, string]> = {
  draft: ["Brouillon", "Draft"],
  sent: ["En attente de signature", "Awaiting signature"],
  viewed: ["En attente de signature", "Awaiting signature"],
  accepted: ["Signé", "Signed"],
  rejected: ["Refusé", "Rejected"],
  expired: ["Expiré", "Expired"],
};

export default function QuotesHistoryClient({ slug }: { slug: string }) {
  const locale = useStorefrontLocale();
  const t = useT();
  const router = useRouter();
  const { hydrated, isAuthenticated, authFetch } = useCustomerAuth(slug);

  useEffect(() => {
    if (hydrated && !isAuthenticated) {
      router.replace(`/${slug}/account/login`);
    }
  }, [hydrated, isAuthenticated, slug, router]);

  const quotesQuery = useQuery({
    queryKey: ["customer-quotes", slug],
    queryFn: () =>
      authFetch((token) =>
        publicApiClient.get<CustomerQuoteSummary[]>(`/public/${slug}/account/quotes`, token),
      ),
    enabled: hydrated && isAuthenticated,
  });

  return (
    <AccountShell slug={slug} title={t("Mes devis", "My quotes")}>
      <Link href={`/${slug}/account`} className="text-sm text-text-muted hover:underline">
        {t("← Mon compte", "← My account")}
      </Link>

      {quotesQuery.isLoading && (
        <Card className="p-6 text-center text-sm text-text-muted">{t("Chargement…", "Loading…")}</Card>
      )}

      {quotesQuery.isSuccess && quotesQuery.data.length === 0 && (
        <Card className="p-6 text-center text-sm text-text-muted">
          {t("Vous n'avez pas encore de devis.", "You have no quotes yet.")}
        </Card>
      )}

      {quotesQuery.isSuccess && quotesQuery.data.length > 0 && (
        <div className="space-y-3">
          {quotesQuery.data.map((quote) => (
            <Link key={quote.id} href={`/${slug}/account/quotes/${quote.id}`}>
              <Card className="flex items-center justify-between p-4 text-sm hover:bg-surface-muted">
                <div>
                  <p className="font-medium text-text">Devis {quote.number}</p>
                  <p className="text-text-muted">
                    {new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium" }).format(
                      new Date(quote.createdAt),
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <Badge variant={quote.status === "rejected" ? "destructive" : quote.status === "accepted" ? "success" : "default"}>
                    {t(...QUOTE_STATUS_LABELS[quote.status])}
                  </Badge>
                  <p className="mt-1 font-medium text-text">
                    {formatOfferPrice(quote.total, quote.currency, locale)}
                  </p>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </AccountShell>
  );
}
