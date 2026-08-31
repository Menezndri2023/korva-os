"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Card } from "@korva/ui";
import { downloadPdf, publicApiClient, PublicApiError } from "@/lib/public-api-client";
import { formatOfferPrice } from "@/lib/offer-labels";
import { useCustomerAuth } from "@/lib/use-customer-auth";
import type { CustomerOrderDetail } from "@/lib/public-types";
import type { OrderStatus } from "@korva/types";
import { AccountShell } from "../../account-shell";
import { ReviewForm } from "../../review-form";
import { ReturnRequestForm } from "../../return-request-form";

const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  open: "En cours (addition ouverte)",
  pending: "Reçue",
  confirmed: "Confirmée",
  fulfilled: "Terminée",
  cancelled: "Annulée",
};

export default function OrderDetailClient({ slug, orderId }: { slug: string; orderId: string }) {
  const router = useRouter();
  const { hydrated, isAuthenticated, authFetch } = useCustomerAuth(slug);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (hydrated && !isAuthenticated) {
      router.replace(`/${slug}/account/login`);
    }
  }, [hydrated, isAuthenticated, slug, router]);

  const orderQuery = useQuery({
    queryKey: ["customer-order", slug, orderId],
    queryFn: () =>
      authFetch((token) =>
        publicApiClient.get<CustomerOrderDetail>(`/public/${slug}/account/orders/${orderId}`, token),
      ),
    enabled: hydrated && isAuthenticated,
  });

  async function handleDownloadInvoice() {
    setDownloadError(null);
    setDownloading(true);
    try {
      await authFetch((token) =>
        downloadPdf(
          `/public/${slug}/account/orders/${orderId}/invoice-pdf`,
          token,
          `facture-${orderQuery.data?.number ?? orderId}.pdf`,
        ),
      );
    } catch (error) {
      setDownloadError(
        error instanceof PublicApiError ? error.message : "Impossible de télécharger la facture.",
      );
    } finally {
      setDownloading(false);
    }
  }

  return (
    <AccountShell slug={slug} title="Ma commande">
      <Link href={`/${slug}/account/orders`} className="text-sm text-text-muted hover:underline">
        ← Mes commandes
      </Link>

      {orderQuery.isLoading && (
        <Card className="p-6 text-center text-sm text-text-muted">Chargement…</Card>
      )}

      {orderQuery.isSuccess && (
        <>
          <Card className="space-y-4 p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-text">Commande {orderQuery.data.number}</h2>
              <Badge variant={orderQuery.data.status === "cancelled" ? "destructive" : "default"}>
                {ORDER_STATUS_LABELS[orderQuery.data.status]}
              </Badge>
            </div>

            <ul className="divide-y divide-border rounded-md border border-border">
              {orderQuery.data.items.map((item, index) => (
                <li key={index} className="px-3 py-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-text">
                      {item.description} × {item.quantity}
                    </span>
                    <span className="text-text-muted">
                      {formatOfferPrice(item.unitPrice * item.quantity, orderQuery.data.currency)}
                    </span>
                  </div>
                  {item.modifiers && item.modifiers.length > 0 && (
                    <ul className="mt-1 text-xs text-text-muted">
                      {item.modifiers.map((modifier, modifierIndex) => (
                        <li key={modifierIndex}>+ {modifier.name}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>

            <div className="space-y-1 text-right text-sm">
              {orderQuery.data.discountTotal > 0 && (
                <p className="text-text-muted">
                  Remise : -{formatOfferPrice(orderQuery.data.discountTotal, orderQuery.data.currency)}
                </p>
              )}
              {orderQuery.data.shippingCost > 0 && (
                <p className="text-text-muted">
                  Livraison : {formatOfferPrice(orderQuery.data.shippingCost, orderQuery.data.currency)}
                </p>
              )}
              <p className="font-medium text-text">
                Total : {formatOfferPrice(orderQuery.data.total, orderQuery.data.currency)}
              </p>
            </div>

            {orderQuery.data.shippingAddress && (
              <div className="border-t border-border pt-3 text-sm text-text-muted">
                <p className="font-medium text-text">Adresse de livraison</p>
                <p>{orderQuery.data.shippingAddress.line1}</p>
                {orderQuery.data.shippingAddress.line2 && <p>{orderQuery.data.shippingAddress.line2}</p>}
                <p>
                  {orderQuery.data.shippingAddress.postalCode} {orderQuery.data.shippingAddress.city}
                </p>
                <p>{orderQuery.data.shippingAddress.country}</p>
              </div>
            )}

            {orderQuery.data.hasInvoice && (
              <div className="border-t border-border pt-3">
                <Button type="button" variant="secondary" size="sm" loading={downloading} onClick={() => void handleDownloadInvoice()}>
                  Télécharger la facture
                </Button>
                {downloadError && <p className="mt-2 text-xs text-destructive">{downloadError}</p>}
              </div>
            )}
          </Card>

          {orderQuery.data.status === "fulfilled" && (
            <>
              <ReturnRequestForm
                slug={slug}
                orderId={orderId}
                items={orderQuery.data.items}
              />
              <ReviewForm slug={slug} entity="order" entityId={orderId} />
            </>
          )}
        </>
      )}
    </AccountShell>
  );
}
