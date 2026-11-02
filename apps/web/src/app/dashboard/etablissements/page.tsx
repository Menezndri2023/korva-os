"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BUSINESS_MODEL_DEFINITIONS, businessModelText, type NetworkOverview } from "@korva/types";
import { Button, Card, PageHeader, SkeletonList, Table, Td, Th } from "@korva/ui";
import { apiClient } from "@/lib/api-client";
import { formatCurrency } from "@/lib/analytics-format";
import { useAuthStore } from "@/lib/auth-store";
import { usePlanFeatures } from "@/lib/use-plan-features";
import { UpgradeCard } from "@/components/pro/upgrade-card";
import { useDashboardLocale, useT } from "@/lib/dashboard-locale";

/**
 * Business: every establishment the owner runs, side by side over 30 days, and one click to open
 * any of them. Figures stay in each establishment's own currency.
 */
export default function EstablishmentsPage() {
  const locale = useDashboardLocale();
  const t = useT();
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
        title={t("Mes établissements", "My locations")}
        description={t(
          "Tous vos points de vente et sites sur les 30 derniers jours. Chaque établissement a sa propre formule.",
          "All your outlets and sites over the last 30 days. Each location has its own plan.",
        )}
        actions={
          <Link
            href="/onboarding"
            className="inline-flex min-h-11 items-center rounded-lg border border-border-input bg-surface px-4 text-sm font-semibold text-text hover:bg-surface-muted"
          >
            {t("Ajouter un établissement", "Add a location")}
          </Link>
        }
      />

      {!included && (
        <UpgradeCard
          feature="network_overview"
          description={t(
            "Suivez tous vos établissements sur un seul écran : ventes, réservations et encaissements de chacun.",
            "Follow all your locations on one screen: each one's sales, bookings and takings.",
          )}
        />
      )}
      {isLoading && <SkeletonList rows={3} />}
      {isError && <p className="text-sm text-destructive">{t(
        "Impossible de charger vos établissements.",
        "Your locations could not be loaded.",
      )}</p>}

      {data && (
        <Card className="overflow-hidden">
          <Table caption={t("Vos établissements sur 30 jours", "Your locations over 30 days")}>
            <thead>
              <tr>
                <Th>{t("Établissement", "Location")}</Th>
                <Th align="right">{t("Ventes", "Sales")}</Th>
                <Th align="right">{t("Commandes", "Orders")}</Th>
                <Th align="right">{t("Réservations", "Bookings")}</Th>
                <Th align="right">{t("Encaissé", "Taken")}</Th>
                <Th align="right">{t("Nouveaux clients", "New customers")}</Th>
                <Th>
                  <span className="sr-only">{t("Ouvrir", "Open")}</span>
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
                        {businessModelText(BUSINESS_MODEL_DEFINITIONS[place.businessModel], locale).label}
                      </span>
                    )}
                  </Td>
                  <Td numeric>{formatCurrency(place.sales, place.currency, locale)}</Td>
                  <Td numeric>{place.orders}</Td>
                  <Td numeric>{place.bookings}</Td>
                  <Td numeric>{formatCurrency(place.collected, place.currency, locale)}</Td>
                  <Td numeric>{place.newContacts}</Td>
                  <Td align="right">
                    {place.organizationId === activeOrganizationId ? (
                      <span className="text-xs text-text-muted">{t("Ouvert", "Open")}</span>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={`Ouvrir ${place.name}`}
                        onClick={() => open(place.organizationId)}
                      >
                        {t("Ouvrir", "Open")}
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
          {t(
            "Vous n'avez qu'un établissement pour l'instant. Ajoutez-en un pour les comparer ici.",
            "You only have one location for now. Add another to compare them here.",
          )}
        </p>
      )}
    </div>
  );
}
