"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Plan, SubscriptionSummary } from "@korva/types";
import { apiClient, ApiError } from "@/lib/api-client";
import { useActiveOrganization } from "@/lib/use-active-organization";

interface MemberRow {
  id: string;
  status: string;
  userId: { id: string; email: string; firstName?: string; lastName?: string };
  roleId: { id: string; name: string; systemKey?: string };
}

const METRIC_LABELS: Record<string, string> = {
  seats: "Membres de l'équipe",
  ai_messages_per_month: "Messages IA / mois",
};

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: organization } = useActiveOrganization();
  const { data: members, isLoading } = useQuery({
    queryKey: ["organizations", "me", "members"],
    queryFn: () => apiClient.get<MemberRow[]>("/organizations/me/members"),
  });
  const { data: subscription } = useQuery({
    queryKey: ["subscriptions", "me"],
    queryFn: () => apiClient.get<SubscriptionSummary>("/subscriptions/me"),
  });
  const { data: plans } = useQuery({
    queryKey: ["plans"],
    queryFn: () => apiClient.get<Plan[]>("/plans"),
  });

  const changePlanMutation = useMutation({
    mutationFn: (planKey: string) =>
      apiClient.post("/subscriptions/change-plan", { planKey }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["subscriptions", "me"] }),
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Paramètres</h1>
        <p className="mt-1 text-sm text-zinc-500">Informations de votre organisation.</p>
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-zinc-900">Organisation</h2>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-zinc-500">Nom</dt>
            <dd className="mt-0.5">{organization?.name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Secteur</dt>
            <dd className="mt-0.5">{organization?.type ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Pays</dt>
            <dd className="mt-0.5">{organization?.country ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Devise</dt>
            <dd className="mt-0.5">{organization?.currency ?? "—"}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-zinc-900">Abonnement</h2>
        {subscription && (
          <div className="mt-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{subscription.plan.name}</p>
                <p className="text-xs text-zinc-500">
                  {subscription.plan.priceAmount} {subscription.plan.priceCurrency} / {subscription.plan.interval === "month" ? "mois" : "an"}
                </p>
              </div>
              <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                {subscription.subscription.status === "active" ? "Actif" : subscription.subscription.status}
              </span>
            </div>

            <div className="space-y-2">
              {subscription.usage.map((item) => (
                <div key={item.metric} className="text-xs">
                  <div className="mb-1 flex justify-between text-zinc-500">
                    <span>{METRIC_LABELS[item.metric] ?? item.metric}</span>
                    <span>
                      {item.used} / {item.limit === -1 ? "illimité" : item.limit}
                    </span>
                  </div>
                  {item.limit !== -1 && (
                    <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100">
                      <div
                        className="h-full rounded-full bg-zinc-900"
                        style={{ width: `${Math.min(100, (item.used / item.limit) * 100)}%` }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {changePlanMutation.isError && (
              <p className="text-xs text-red-600">
                {changePlanMutation.error instanceof ApiError
                  ? changePlanMutation.error.message
                  : "Erreur"}
              </p>
            )}

            <div className="grid grid-cols-2 gap-2 border-t border-zinc-100 pt-4 sm:grid-cols-4">
              {plans?.map((plan) => (
                <div key={plan.id} className="rounded-md border border-zinc-200 p-3 text-xs">
                  <p className="font-medium">{plan.name}</p>
                  <p className="mt-0.5 text-zinc-500">
                    {plan.priceAmount} {plan.priceCurrency}/mois
                  </p>
                  <button
                    onClick={() => changePlanMutation.mutate(plan.key)}
                    disabled={plan.key === subscription.plan.key || changePlanMutation.isPending}
                    className="mt-2 w-full rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium hover:bg-zinc-50 disabled:cursor-default disabled:opacity-50"
                  >
                    {plan.key === subscription.plan.key ? "Plan actuel" : "Choisir"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-zinc-900">Équipe</h2>
        <div className="mt-4 divide-y divide-zinc-100">
          {isLoading && <p className="py-2 text-sm text-zinc-500">Chargement...</p>}
          {members?.map((member) => (
            <div key={member.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <p className="font-medium">
                  {member.userId.firstName
                    ? `${member.userId.firstName} ${member.userId.lastName ?? ""}`.trim()
                    : member.userId.email}
                </p>
                <p className="text-xs text-zinc-500">{member.userId.email}</p>
              </div>
              <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-700">
                {member.roleId.name}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
