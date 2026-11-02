"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Card } from "@korva/ui";
import { publicApiClient } from "@/lib/public-api-client";
import { formatOfferPrice } from "@/lib/offer-labels";
import { useCustomerAuth } from "@/lib/use-customer-auth";
import type { CustomerReturnRequestSummary } from "@/lib/public-types";
import type { ReturnRequestStatus } from "@korva/types";
import { AccountShell } from "../account-shell";
import { intlLocale, useStorefrontLocale, useT } from "@/lib/storefront-locale";

const STATUS_LABELS: Record<ReturnRequestStatus, [string, string]> = {
  pending: ["En attente", "Pending"],
  approved: ["Approuvé (remboursé)", "Approved (refunded)"],
  rejected: ["Refusé", "Rejected"],
};

export default function ReturnsHistoryClient({ slug }: { slug: string }) {
  const locale = useStorefrontLocale();
  const t = useT();
  const router = useRouter();
  const { hydrated, isAuthenticated, authFetch } = useCustomerAuth(slug);

  useEffect(() => {
    if (hydrated && !isAuthenticated) {
      router.replace(`/${slug}/account/login`);
    }
  }, [hydrated, isAuthenticated, slug, router]);

  const returnsQuery = useQuery({
    queryKey: ["customer-returns", slug],
    queryFn: () =>
      authFetch((token) =>
        publicApiClient.get<CustomerReturnRequestSummary[]>(
          `/public/${slug}/account/returns`,
          token,
        ),
      ),
    enabled: hydrated && isAuthenticated,
  });

  return (
    <AccountShell slug={slug} title={t("Mes retours", "My returns")}>
      <Link href={`/${slug}/account`} className="text-sm text-text-muted hover:underline">
        {t("← Mon compte", "← My account")}
      </Link>

      {returnsQuery.isLoading && (
        <Card className="p-6 text-center text-sm text-text-muted">{t("Chargement…", "Loading…")}</Card>
      )}

      {returnsQuery.isSuccess && returnsQuery.data.length === 0 && (
        <Card className="p-6 text-center text-sm text-text-muted">
          {t(
            "Vous n'avez pas encore demandé de retour. Ouvrez une commande terminée pour en demander un.",
            "You have not asked for a return yet. Open a completed order to ask for one.",
          )}
        </Card>
      )}

      {returnsQuery.isSuccess && returnsQuery.data.length > 0 && (
        <div className="space-y-3">
          {returnsQuery.data.map((returnRequest) => (
            <Link key={returnRequest.id} href={`/${slug}/account/orders/${returnRequest.orderId}`}>
              <Card className="flex items-center justify-between p-4 text-sm hover:bg-surface-muted">
                <div>
                  <p className="font-medium text-text">{returnRequest.reason}</p>
                  <p className="text-text-muted">
                    {new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium" }).format(
                      new Date(returnRequest.createdAt),
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <Badge variant={returnRequest.status === "rejected" ? "destructive" : "default"}>
                    {t(...STATUS_LABELS[returnRequest.status])}
                  </Badge>
                  <p className="mt-1 font-medium text-text">
                    {formatOfferPrice(returnRequest.refundAmount, returnRequest.currency, locale)}
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
