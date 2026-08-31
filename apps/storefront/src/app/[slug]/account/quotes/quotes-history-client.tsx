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

const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "Brouillon",
  sent: "En attente de signature",
  viewed: "En attente de signature",
  accepted: "Signé",
  rejected: "Refusé",
  expired: "Expiré",
};

export default function QuotesHistoryClient({ slug }: { slug: string }) {
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
    <AccountShell slug={slug} title="Mes devis">
      <Link href={`/${slug}/account`} className="text-sm text-text-muted hover:underline">
        ← Mon compte
      </Link>

      {quotesQuery.isLoading && (
        <Card className="p-6 text-center text-sm text-text-muted">Chargement…</Card>
      )}

      {quotesQuery.isSuccess && quotesQuery.data.length === 0 && (
        <Card className="p-6 text-center text-sm text-text-muted">
          Vous n&apos;avez pas encore de devis.
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
                    {new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(
                      new Date(quote.createdAt),
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <Badge variant={quote.status === "rejected" ? "destructive" : quote.status === "accepted" ? "success" : "default"}>
                    {QUOTE_STATUS_LABELS[quote.status]}
                  </Badge>
                  <p className="mt-1 font-medium text-text">
                    {formatOfferPrice(quote.total, quote.currency)}
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
