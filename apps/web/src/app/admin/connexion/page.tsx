"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Button, Card, Input } from "@korva/ui";
import { ApiError } from "@/lib/api-client";
import { adminApi, setAdminToken } from "@/lib/platform-admin";
import { KorvaTile } from "@/components/brand/korva-mark";

const ERRORS: Record<string, string> = {
  INVALID_CREDENTIALS: "Adresse ou mot de passe incorrect.",
  ACCOUNT_LOCKED: "Trop de tentatives : l'accès est bloqué 15 minutes.",
};

/**
 * The administration's own sign-in — not the businesses' /login. Administrator accounts are
 * created on the server (dist/create-platform-admin.js); there is no sign-up here.
 */
export default function AdminSignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      adminApi.post<{ accessToken: string }>("/platform/auth/login", { email, password }),
    onSuccess: ({ accessToken }) => {
      setAdminToken(accessToken);
      router.replace("/admin");
    },
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-sidebar px-4">
      <Card className="w-full max-w-sm p-8">
        <div className="flex items-center gap-3">
          <KorvaTile className="size-10" />
          <div>
            <h1 className="text-xl font-semibold">Administration</h1>
            <p className="text-sm text-text-muted">KORVA OS</p>
          </div>
        </div>
        <form
          className="mt-6 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <div>
            <label htmlFor="admin-email" className="block text-sm font-medium">Adresse e-mail</label>
            <Input
              id="admin-email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full"
            />
          </div>
          <div>
            <label htmlFor="admin-password" className="block text-sm font-medium">Mot de passe</label>
            <Input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full"
            />
          </div>
          {mutation.isError && (
            <p role="alert" className="text-sm text-destructive">
              {mutation.error instanceof ApiError
                ? (ERRORS[mutation.error.code] ?? mutation.error.message)
                : "Connexion impossible, réessayez."}
            </p>
          )}
          <Button type="submit" className="w-full" loading={mutation.isPending}>
            Se connecter
          </Button>
        </form>
        <p className="mt-6 text-xs text-text-muted">
          Accès réservé à l&apos;équipe KORVA. Les comptes administrateur sont créés sur le serveur.
        </p>
      </Card>
    </div>
  );
}
