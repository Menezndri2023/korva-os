"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useActiveOrganization } from "@/lib/use-active-organization";

interface MemberRow {
  id: string;
  status: string;
  userId: { id: string; email: string; firstName?: string; lastName?: string };
  roleId: { id: string; name: string; systemKey?: string };
}

export default function SettingsPage() {
  const { data: organization } = useActiveOrganization();
  const { data: members, isLoading } = useQuery({
    queryKey: ["organizations", "me", "members"],
    queryFn: () => apiClient.get<MemberRow[]>("/organizations/me/members"),
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
