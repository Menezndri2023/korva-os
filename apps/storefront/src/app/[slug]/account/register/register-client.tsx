"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Card, Input } from "@korva/ui";
import { PublicApiError } from "@/lib/public-api-client";
import { useCustomerAuth } from "@/lib/use-customer-auth";
import { usePublicOrganization } from "@/lib/use-public-organization";
import { AccountShell } from "../account-shell";

export default function RegisterClient({ slug }: { slug: string }) {
  const router = useRouter();
  const { register } = useCustomerAuth(slug);
  const organizationQuery = usePublicOrganization(slug);
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const registerMutation = useMutation({
    mutationFn: () => register({ email, password, firstName: firstName || undefined }),
    onSuccess: () => router.push(`/${slug}/account`),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    registerMutation.mutate();
  }

  if (organizationQuery.data?.customerAccountsEnabled === false) {
    // The API refuses new accounts here (PLAN_FEATURE_MIN_PLAN.customer_accounts); say so
    // instead of letting the visitor fill a form for nothing.
    return (
      <AccountShell slug={slug} title="Créer un compte">
        <Card className="space-y-2 p-6 text-sm text-text-muted">
          <p>Cette boutique ne propose pas encore de compte client.</p>
          <p>
            Vos commandes et réservations restent consultables avec votre adresse e-mail sur la
            page{" "}
            <Link href={`/${slug}/track`} className="font-medium text-text underline">
              Suivre une commande
            </Link>
            .
          </p>
        </Card>
      </AccountShell>
    );
  }

  return (
    <AccountShell slug={slug} title="Créer un compte">
      <Card className="p-4">
        <form onSubmit={handleSubmit} className="space-y-3 text-sm">
          <label className="block">
            <span className="mb-1 block text-text-muted">Prénom (optionnel)</span>
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} className="w-full" />
          </label>
          <label className="block">
            <span className="mb-1 block text-text-muted">Adresse e-mail</span>
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vous@example.com"
              className="w-full"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-text-muted">Mot de passe</span>
            <Input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full"
            />
            <span className="mt-1 block text-xs text-text-muted">8 caractères minimum.</span>
          </label>

          {registerMutation.isError && (
            <p className="text-xs text-destructive">
              {registerMutation.error instanceof PublicApiError
                ? registerMutation.error.message
                : "Impossible de créer le compte."}
            </p>
          )}

          <Button type="submit" loading={registerMutation.isPending} className="w-full">
            {registerMutation.isPending ? "Création..." : "Créer mon compte"}
          </Button>

          <p className="text-center text-xs text-text-muted">
            Déjà un compte ?{" "}
            <Link href={`/${slug}/account/login`} className="hover:underline">
              Se connecter
            </Link>
          </p>
        </form>
      </Card>
    </AccountShell>
  );
}
