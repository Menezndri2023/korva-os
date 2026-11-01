"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BUSINESS_MODEL_DEFINITIONS, type NetworkOverview } from "@korva/types";
import { Button, Card, PageHeader, SkeletonList, Table, Td, Th } from "@korva/ui";
import { apiClient } from "@/lib/api-client";
import { formatCurrency } from "@/lib/analytics-format";
import { useAuthStore } from "@/lib/auth-store";
import { usePlanFeatures } from "@/lib/use-plan-features";
import { UpgradeCard } from "@/components/pro/upgrade-card";

/**
 * Business: every establishment the owner runs, side by side over 30 days, and one click to open
 * any of them. Figures stay in each establishment's own currency.
 */
export default function EstablishmentsPage() {
  const planFeatures = usePlanFeatures();
  const included = planFeatures.has("network_overview");
  const queryClient = useQueryClient();
  const activeOrganizationId = useAuthStore((state) => state.activeOrganizationId);
  const setActiveOrganization = useAuthStore((state) => state.setActiveOrganization);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["network", "overview"],
    queryFn: () => apiClient.get<NetworkOverview>("/network/overview"),
    enabled: planFeatures.planKey !== undefined && included,
  });

  function open(organizationId: string) {
    if (organizationId === activeOrganizationId) return;
    setActiveOrganization(organizationId);
    // Same as the header's switcher: nothing of the previous establishment may stay on screen.
    queryClient.clear();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mes établissements"
        description="Tous vos points de vente et sites sur les 30 derniers jours. Chaque établissement a sa propre formule."
        actions={
          <Link
            href="/onboarding"
            className="inline-flex min-h-11 items-center rounded-lg border border-border-input bg-surface px-4 text-sm font-semibold text-text hover:bg-surface-muted"
          >
            Ajouter un établissement
          </Link>
        }
      />

      {!included && (
        <UpgradeCard
          feature="network_overview"
          description="Suivez tous vos établissements sur un seul écran : ventes, réservations et encaissements de chacun."
        />
      )}
      {isLoading && <SkeletonList rows={3} />}
      {isError && <p className="text-sm text-destructive">Impossible de charger vos établissements.</p>}

      {data && (
        <Card className="overflow-hidden">
          <Table caption="Vos établissements sur 30 jours">
            <thead>
              <tr>
                <Th>Établissement</Th>
                <Th align="right">Ventes</Th>
                <Th align="right">Commandes</Th>
                <Th align="right">Réservations</Th>
                <Th align="right">Encaissé</Th>
                <Th align="right">Nouveaux clients</Th>
                <Th>
                  <span className="sr-only">Ouvrir</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {data.establishments.map((place) => (
                <tr key={place.organizationId}>
                  <Td>
                    <span className="font-medium">{place.name}</span>
                    {place.businessModel && (
                      <span className="block text-xs text-text-muted">
                        {BUSINESS_MODEL_DEFINITIONS[place.businessModel].label}
                      </span>
                    )}
                  </Td>
                  <Td numeric>{formatCurrency(place.sales, place.currency)}</Td>
                  <Td numeric>{place.orders}</Td>
                  <Td numeric>{place.bookings}</Td>
                  <Td numeric>{formatCurrency(place.collected, place.currency)}</Td>
                  <Td numeric>{place.newContacts}</Td>
                  <Td align="right">
                    {place.organizationId === activeOrganizationId ? (
                      <span className="text-xs text-text-muted">Ouvert</span>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={`Ouvrir ${place.name}`}
                        onClick={() => open(place.organizationId)}
                      >
                        Ouvrir
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      {data && data.establishments.length === 1 && (
        <p className="text-sm text-text-muted">
          Vous n&apos;avez qu&apos;un établissement pour l&apos;instant. Ajoutez-en un pour les comparer ici.
        </p>
      )}
    </div>
  );
}
