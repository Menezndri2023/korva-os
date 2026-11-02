"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Card, Input } from "@korva/ui";
import { publicApiClient, PublicApiError } from "@/lib/public-api-client";
import { AccountShell } from "../account-shell";
import { useT } from "@/lib/storefront-locale";

export default function ResetPasswordClient({ slug }: { slug: string }) {
  const t = useT();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");

  const resetMutation = useMutation({
    mutationFn: () =>
      publicApiClient.post(`/public/${slug}/account/reset-password`, { token, password }),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    resetMutation.mutate();
  }

  if (!token) {
    return (
      <AccountShell slug={slug} title={t("Réinitialiser le mot de passe", "Reset the password")}>
        <Card className="p-4 text-sm text-destructive">
          {t(
            "Ce lien de réinitialisation est invalide. Demandez-en un nouveau depuis la page de connexion.",
            "This reset link is not valid. Ask for a new one from the sign-in page.",
          )}
        </Card>
      </AccountShell>
    );
  }

  return (
    <AccountShell slug={slug} title={t("Réinitialiser le mot de passe", "Reset the password")}>
      <Card className="p-4">
        {resetMutation.isSuccess ? (
          <div className="space-y-3 text-sm">
            <p className="text-text">{t(
              "Votre mot de passe a été mis à jour.",
              "Your password has been updated.",
            )}</p>
            <Link href={`/${slug}/account/login`} className="text-sm font-medium text-text hover:underline">
              {t("Se connecter →", "Sign in →")}
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3 text-sm">
            <label className="block">
              <span className="mb-1 block text-text-muted">{t("Nouveau mot de passe", "New password")}</span>
              <Input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full"
              />
            </label>

            {resetMutation.isError && (
              <p className="text-xs text-destructive">
                {resetMutation.error instanceof PublicApiError
                  ? resetMutation.error.message
                  : t("Impossible de réinitialiser le mot de passe.", "The password could not be reset.")}
              </p>
            )}

            <Button type="submit" loading={resetMutation.isPending} className="w-full">
              {t("Mettre à jour le mot de passe", "Update the password")}
            </Button>
          </form>
        )}
      </Card>
    </AccountShell>
  );
}
