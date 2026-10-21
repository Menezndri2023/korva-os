"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { loginSchema, type LoginInput } from "@korva/validation";
import type { Organization } from "@korva/types";
import { Button, Input } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { AuthShell, LoginAside } from "@/components/landing/auth-shell";

interface LoginResponse {
  user: { id: string; email: string; firstName?: string; lastName?: string };
  accessToken: string;
}

export default function LoginPage() {
  const router = useRouter();
  const setSession = useAuthStore((state) => state.setSession);
  const setActiveOrganization = useAuthStore((state) => state.setActiveOrganization);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  const mutation = useMutation({
    mutationFn: (data: LoginInput) => apiClient.post<LoginResponse>("/auth/login", data, { withOrganization: false }),
    onSuccess: async (data) => {
      setSession(data);
      const organizations = await apiClient.get<Organization[]>("/organizations/me/all", {
        withOrganization: false,
      });
      if (organizations.length > 0) {
        setActiveOrganization(organizations[0]!.id);
        router.replace("/dashboard");
      } else {
        router.replace("/onboarding");
      }
    },
  });

  return (
    <AuthShell
      title="Se connecter"
      intro="Retrouvez vos clients, vos réservations et vos factures."
      aside={<LoginAside />}
      footer={
        <>
          Pas encore de compte ?{" "}
          <Link href="/register" className="font-medium text-text underline">
            Créer un compte
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit((data) => mutation.mutate(data))}>
        <div>
          <label className="block text-sm font-medium" htmlFor="email">
            Email
          </label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            className="mt-1 w-full"
            error={!!errors.email}
            {...register("email")}
          />
          {errors.email && <p className="mt-1 text-xs text-destructive">{errors.email.message}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium" htmlFor="password">
            Mot de passe
          </label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            className="mt-1 w-full"
            error={!!errors.password}
            {...register("password")}
          />
          {errors.password && (
            <p className="mt-1 text-xs text-destructive">{errors.password.message}</p>
          )}
          <Link
            href="/forgot-password"
            className="mt-1.5 inline-block text-xs text-text-muted underline"
          >
            Mot de passe oublié ?
          </Link>
        </div>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError ? mutation.error.message : "Une erreur est survenue."}
          </p>
        )}

        <Button type="submit" loading={mutation.isPending} size="lg" className="w-full">
          {mutation.isPending ? "Connexion..." : "Se connecter"}
        </Button>
      </form>
    </AuthShell>
  );
}
