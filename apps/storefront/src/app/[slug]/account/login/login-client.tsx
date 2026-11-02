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
import { useT } from "@/lib/storefront-locale";

export default function LoginClient({ slug }: { slug: string }) {
  const t = useT();
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
    <AccountShell slug={slug} title={t("Se connecter", "Sign in")}>
      <Card className="p-4">
        {!showForgot ? (
          <form onSubmit={handleSubmit} className="space-y-3 text-sm">
            <label className="block">
              <span className="mb-1 block text-text-muted">{t("Adresse e-mail", "Email address")}</span>
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("vous@example.com", "you@example.com")}
                className="w-full"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-text-muted">{t("Mot de passe", "Password")}</span>
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
                  : t("Impossible de se connecter.", "Could not sign in.")}
              </p>
            )}

            <Button type="submit" loading={loginMutation.isPending} className="w-full">
              {loginMutation.isPending ? "Connexion..." : t("Se connecter", "Sign in")}
            </Button>

            <div className="flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={() => setShowForgot(true)}
                className="text-text-muted hover:underline"
              >
                {t("Mot de passe oublié ?", "Forgot your password?")}
              </button>
              {organizationQuery.data?.customerAccountsEnabled !== false && (
                <Link href={`/${slug}/account/register`} className="text-text-muted hover:underline">
                  {t("Créer un compte", "Create an account")}
                </Link>
              )}
            </div>
          </form>
        ) : forgotSent ? (
          <p className="text-sm text-text-muted">
            {t(
              "Si un compte existe pour cette adresse, un lien de réinitialisation vient de lui être envoyé.",
              "If an account exists for this address, a reset link has just been sent to it.",
            )}
          </p>
        ) : (
          <form onSubmit={handleForgotSubmit} className="space-y-3 text-sm">
            <label className="block">
              <span className="mb-1 block text-text-muted">{t("Adresse e-mail", "Email address")}</span>
              <Input
                type="email"
                required
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                placeholder={t("vous@example.com", "you@example.com")}
                className="w-full"
              />
            </label>
            <Button type="submit" loading={forgotMutation.isPending} className="w-full">
              {t("Envoyer le lien de réinitialisation", "Send the reset link")}
            </Button>
            <button
              type="button"
              onClick={() => setShowForgot(false)}
              className="text-xs text-text-muted hover:underline"
            >
              {t("← Retour à la connexion", "← Back to sign-in")}
            </button>
          </form>
        )}
      </Card>
    </AccountShell>
  );
}
