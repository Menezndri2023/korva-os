"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Card } from "@korva/ui";
import { publicApiClient } from "@/lib/public-api-client";
import { formatOfferPrice } from "@/lib/offer-labels";
import { useCustomerAuth } from "@/lib/use-customer-auth";
import type { CustomerOrderSummary } from "@/lib/public-types";
import type { OrderStatus } from "@korva/types";
import { AccountShell } from "../account-shell";
import { intlLocale, useStorefrontLocale, useT } from "@/lib/storefront-locale";

const ORDER_STATUS_LABELS: Record<OrderStatus, [string, string]> = {
  open: ["En cours (addition ouverte)", "In progress (open tab)"],
  pending: ["Reçue", "Received"],
  confirmed: ["Confirmée", "Confirmed"],
  fulfilled: ["Terminée", "Completed"],
  cancelled: ["Annulée", "Cancelled"],
};

export default function OrdersHistoryClient({ slug }: { slug: string }) {
  const locale = useStorefrontLocale();
  const t = useT();
  const router = useRouter();
  const { hydrated, isAuthenticated, authFetch } = useCustomerAuth(slug);

  useEffect(() => {
    if (hydrated && !isAuthenticated) {
      router.replace(`/${slug}/account/login`);
    }
  }, [hydrated, isAuthenticated, slug, router]);

  const ordersQuery = useQuery({
    queryKey: ["customer-orders", slug],
    queryFn: () =>
      authFetch((token) =>
        publicApiClient.get<CustomerOrderSummary[]>(`/public/${slug}/account/orders`, token),
      ),
    enabled: hydrated && isAuthenticated,
  });

  return (
    <AccountShell slug={slug} title={t("Mes commandes", "My orders")}>
      <Link href={`/${slug}/account`} className="text-sm text-text-muted hover:underline">
        {t("← Mon compte", "← My account")}
      </Link>

      {ordersQuery.isLoading && (
        <Card className="p-6 text-center text-sm text-text-muted">{t("Chargement…", "Loading…")}</Card>
      )}

      {ordersQuery.isSuccess && ordersQuery.data.length === 0 && (
        <Card className="p-6 text-center text-sm text-text-muted">
          {t("Vous n'avez pas encore de commande.", "You have no orders yet.")}
        </Card>
      )}

      {ordersQuery.isSuccess && ordersQuery.data.length > 0 && (
        <div className="space-y-3">
          {ordersQuery.data.map((order) => (
            <Link key={order.id} href={`/${slug}/account/orders/${order.id}`}>
            <Card className="flex items-center justify-between p-4 text-sm hover:bg-surface-muted">
              <div>
                <p className="font-medium text-text">Commande {order.number}</p>
                <p className="text-text-muted">
                  {new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium" }).format(
                    new Date(order.createdAt),
                  )}
                </p>
              </div>
              <div className="text-right">
                <Badge variant={order.status === "cancelled" ? "destructive" : "default"}>
                  {t(...ORDER_STATUS_LABELS[order.status])}
                </Badge>
                <p className="mt-1 font-medium text-text">
                  {formatOfferPrice(order.total, order.currency, locale)}
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
