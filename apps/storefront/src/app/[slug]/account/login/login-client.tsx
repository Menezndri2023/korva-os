"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Card, Input } from "@korva/ui";
import { publicApiClient, PublicApiError } from "@/lib/public-api-client";
import { useCustomerAuth } from "@/lib/use-customer-auth";
import { usePublicOrganization } from "@/lib/use-public-organization";
import { AccountShell } from "../account-shell";

export default function LoginClient({ slug }: { slug: string }) {
  const router = useRouter();
  const { login } = useCustomerAuth(slug);
  const organizationQuery = usePublicOrganization(slug);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);

  const loginMutation = useMutation({
    mutationFn: () => login({ email, password }),
    onSuccess: () => router.push(`/${slug}/account`),
  });

  const forgotMutation = useMutation({
    mutationFn: () =>
      publicApiClient.post(`/public/${slug}/account/forgot-password`, { email: forgotEmail }),
    onSuccess: () => setForgotSent(true),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    loginMutation.mutate();
  }

  function handleForgotSubmit(event: FormEvent) {
    event.preventDefault();
    forgotMutation.mutate();
  }

  return (
    <AccountShell slug={slug} title="Se connecter">
      <Card className="p-4">
        {!showForgot ? (
          <form onSubmit={handleSubmit} className="space-y-3 text-sm">
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
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full"
              />
            </label>

            {loginMutation.isError && (
              <p className="text-xs text-destructive">
                {loginMutation.error instanceof PublicApiError
                  ? loginMutation.error.message
                  : "Impossible de se connecter."}
              </p>
            )}

            <Button type="submit" loading={loginMutation.isPending} className="w-full">
              {loginMutation.isPending ? "Connexion..." : "Se connecter"}
            </Button>

            <div className="flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={() => setShowForgot(true)}
                className="text-text-muted hover:underline"
              >
                Mot de passe oublié ?
              </button>
              {organizationQuery.data?.customerAccountsEnabled !== false && (
                <Link href={`/${slug}/account/register`} className="text-text-muted hover:underline">
                  Créer un compte
                </Link>
              )}
            </div>
          </form>
        ) : forgotSent ? (
          <p className="text-sm text-text-muted">
            Si un compte existe pour cette adresse, un lien de réinitialisation vient de lui être
            envoyé.
          </p>
        ) : (
          <form onSubmit={handleForgotSubmit} className="space-y-3 text-sm">
            <label className="block">
              <span className="mb-1 block text-text-muted">Adresse e-mail</span>
              <Input
                type="email"
                required
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                placeholder="vous@example.com"
                className="w-full"
              />
            </label>
            <Button type="submit" loading={forgotMutation.isPending} className="w-full">
              Envoyer le lien de réinitialisation
            </Button>
            <button
              type="button"
              onClick={() => setShowForgot(false)}
              className="text-xs text-text-muted hover:underline"
            >
              ← Retour à la connexion
            </button>
          </form>
        )}
      </Card>
    </AccountShell>
  );
}
