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

const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  open: "En cours (addition ouverte)",
  pending: "Reçue",
  confirmed: "Confirmée",
  fulfilled: "Terminée",
  cancelled: "Annulée",
};

export default function OrdersHistoryClient({ slug }: { slug: string }) {
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
    <AccountShell slug={slug} title="Mes commandes">
      <Link href={`/${slug}/account`} className="text-sm text-text-muted hover:underline">
        ← Mon compte
      </Link>

      {ordersQuery.isLoading && (
        <Card className="p-6 text-center text-sm text-text-muted">Chargement…</Card>
      )}

      {ordersQuery.isSuccess && ordersQuery.data.length === 0 && (
        <Card className="p-6 text-center text-sm text-text-muted">
          Vous n&apos;avez pas encore de commande.
        </Card>
      )}

      {ordersQuery.isSuccess && ordersQuery.data.length > 0 && (
        <div className="space-y-3">
          {ordersQuery.data.map((order) => (
            <Card key={order.id} className="flex items-center justify-between p-4 text-sm">
              <div>
                <p className="font-medium text-text">Commande {order.number}</p>
                <p className="text-text-muted">
                  {new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(
                    new Date(order.createdAt),
                  )}
                </p>
              </div>
              <div className="text-right">
                <Badge variant={order.status === "cancelled" ? "destructive" : "default"}>
                  {ORDER_STATUS_LABELS[order.status]}
                </Badge>
                <p className="mt-1 font-medium text-text">
                  {formatOfferPrice(order.total, order.currency)}
                </p>
              </div>
            </Card>
          ))}
        </div>
      )}
    </AccountShell>
  );
}
