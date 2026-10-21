"use client";

import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card, Input, PageHeader } from "@korva/ui";
import { formatDay, type PlatformUserRow, adminApi } from "@/lib/platform-admin";

/**
 * Every account on the platform — owners, their staff, administrators — and what the KORVA team
 * can do for them: send a password reset email, or disable an account (sign-in refused, sessions
 * closed) and enable it again.
 */
export default function AdminUsersPage() {
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search.trim());
  const query = useQuery({
    queryKey: ["platform", "users", q],
    queryFn: () =>
      adminApi.get<PlatformUserRow[]>(`/platform/users${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  });

  return (
    <div>
      <PageHeader title="Utilisateurs" description="Tous les comptes de la plateforme, quelle que soit leur entreprise." />
      <Input
        type="search"
        aria-label="Rechercher un utilisateur"
        placeholder="E-mail ou nom…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="w-full sm:max-w-md"
      />

      <Card className="mt-4 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium text-text-muted">
              <tr>
                <th className="px-4 py-2.5">Utilisateur</th>
                <th className="px-4 py-2.5">Entreprises</th>
                <th className="px-4 py-2.5">Inscrit</th>
                <th className="px-4 py-2.5">Dernière activité</th>
                <th className="px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {query.isLoading && (
                <tr><td colSpan={5} className="px-4 py-6 text-text-muted">Chargement…</td></tr>
              )}
              {query.isError && (
                <tr><td colSpan={5} className="px-4 py-6 text-destructive">Impossible de charger les utilisateurs.</td></tr>
              )}
              {query.data?.map((user) => <UserRow key={user.id} user={user} />)}
              {query.data && query.data.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-text-muted">Aucun utilisateur ne correspond.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function UserRow({ user }: { user: PlatformUserRow }) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const action = useMutation({
    mutationFn: (kind: "disable" | "enable" | "password-reset") =>
      adminApi.post(`/platform/users/${user.id}/${kind}`),
    onSuccess: (_data, kind) => {
      setNotice(kind === "password-reset" ? "E-mail de réinitialisation envoyé." : null);
      void queryClient.invalidateQueries({ queryKey: ["platform", "users"] });
    },
  });
  const disabled = Boolean(user.disabledAt);

  return (
    <tr className={disabled ? "bg-destructive-soft/40" : undefined}>
      <td className="px-4 py-3">
        <p className="font-medium">{user.name ?? user.email}</p>
        {user.name && <p className="text-xs text-text-muted">{user.email}</p>}
        <div className="mt-1 flex flex-wrap gap-1">
          {disabled && <Badge variant="destructive">Désactivé</Badge>}
          {!user.emailVerified && <Badge>E-mail non vérifié</Badge>}
          {user.twoFactor && <Badge variant="success">Double authentification</Badge>}
        </div>
      </td>
      <td className="px-4 py-3">
        {user.organizations.length === 0
          ? <span className="text-text-muted">Aucune</span>
          : user.organizations.map((org) => (
              <Link key={org.id} href={`/admin/entreprises/${org.id}`} className="block hover:underline">
                {org.name}
              </Link>
            ))}
      </td>
      <td className="px-4 py-3 whitespace-nowrap">{formatDay(user.createdAt)}</td>
      <td className="px-4 py-3 whitespace-nowrap">{formatDay(user.lastActivityAt)}</td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            loading={action.isPending && action.variables === "password-reset"}
            onClick={() => action.mutate("password-reset")}
          >
            Réinitialiser le mot de passe
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className={disabled ? "" : "text-destructive"}
            loading={action.isPending && action.variables !== "password-reset"}
            onClick={() => {
              const question = disabled
                ? `Réactiver le compte ${user.email} ?`
                : `Désactiver le compte ${user.email} ? Il ne pourra plus se connecter.`;
              if (window.confirm(question)) action.mutate(disabled ? "enable" : "disable");
            }}
          >
            {disabled ? "Réactiver" : "Désactiver"}
          </Button>
        </div>
        {notice && <p className="mt-1 text-xs text-success">{notice}</p>}
        {action.isError && (
          <p className="mt-1 text-xs text-destructive">
            L&apos;action n&apos;a pas abouti.
          </p>
        )}
      </td>
    </tr>
  );
}
