"use client";

import { useAuthStore } from "@/lib/auth-store";
import { useActiveOrganization } from "@/lib/use-active-organization";

export default function DashboardPage() {
  const user = useAuthStore((state) => state.user);
  const { data: organization, isLoading } = useActiveOrganization();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          Bienvenue{user?.firstName ? `, ${user.firstName}` : ""}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {isLoading ? "Chargement..." : `Organisation active : ${organization?.name ?? "—"}`}
        </p>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-6">
        <p className="text-sm text-zinc-600">
          Les modules que vous avez activés apparaissent dans le menu à gauche. D&apos;autres
          fonctionnalités (CRM, catalogue, réservations, finance, automatisations, IA...) seront
          disponibles au fil des prochaines phases de développement de KORVA OS.
        </p>
      </div>
    </div>
  );
}
