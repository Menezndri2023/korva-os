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
import { useT } from "@/lib/storefront-locale";

export default function RegisterClient({ slug }: { slug: string }) {
  const t = useT();
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
      <AccountShell slug={slug} title={t("Créer un compte", "Create an account")}>
        <Card className="space-y-2 p-6 text-sm text-text-muted">
          <p>{t(
            "Cette boutique ne propose pas encore de compte client.",
            "This shop does not offer customer accounts yet.",
          )}</p>
          <p>
            {t(
              "Vos commandes et réservations restent consultables avec votre adresse e-mail sur la page",
              "You can still look up your orders and bookings with your e-mail address on the",
            )}{" "}
            <Link href={`/${slug}/track`} className="font-medium text-text underline">
              {t("Suivre une commande", "Track an order")}
            </Link>
            .
          </p>
        </Card>
      </AccountShell>
    );
  }

  return (
    <AccountShell slug={slug} title={t("Créer un compte", "Create an account")}>
      <Card className="p-4">
        <form onSubmit={handleSubmit} className="space-y-3 text-sm">
          <label className="block">
            <span className="mb-1 block text-text-muted">{t("Prénom (optionnel)", "First name (optional)")}</span>
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} className="w-full" />
          </label>
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
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full"
            />
            <span className="mt-1 block text-xs text-text-muted">{t("8 caractères minimum.", "8 characters minimum.")}</span>
          </label>

          {registerMutation.isError && (
            <p className="text-xs text-destructive">
              {registerMutation.error instanceof PublicApiError
                ? registerMutation.error.message
                : t("Impossible de créer le compte.", "The account could not be created.")}
            </p>
          )}

          <Button type="submit" loading={registerMutation.isPending} className="w-full">
            {registerMutation.isPending ? t("Création...", "Creating...") : t("Créer mon compte", "Create my account")}
          </Button>

          <p className="text-center text-xs text-text-muted">
            {t("Déjà un compte ?", "Already have an account?")}{" "}
            <Link href={`/${slug}/account/login`} className="hover:underline">
              {t("Se connecter", "Sign in")}
            </Link>
          </p>
        </form>
      </Card>
    </AccountShell>
  );
}
