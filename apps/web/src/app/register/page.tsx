"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { registerSchema, type RegisterInput } from "@korva/validation";
import { Button, Input } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { homeWithoutOrganization } from "@/lib/platform-admin";
import { AuthShell, RegisterAside } from "@/components/landing/auth-shell";

interface RegisterResponse {
  user: { id: string; email: string; firstName?: string; lastName?: string };
  accessToken: string;
}

export default function RegisterPage() {
  const router = useRouter();
  const setSession = useAuthStore((state) => state.setSession);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterInput>({ resolver: zodResolver(registerSchema) });

  const mutation = useMutation({
    mutationFn: (data: RegisterInput) =>
      apiClient.post<RegisterResponse>("/auth/register", data, { withOrganization: false }),
    onSuccess: async (data) => {
      setSession(data);
      router.replace(await homeWithoutOrganization());
    },
  });

  return (
    <AuthShell
      title="Créer votre compte"
      intro="Deux minutes, et votre espace est configuré pour votre métier."
      aside={<RegisterAside />}
      footer={
        <>
          Déjà un compte ?{" "}
          <Link href="/login" className="font-medium text-text underline">
            Se connecter
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit((data) => mutation.mutate(data))}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium" htmlFor="firstName">
              Prénom
            </label>
            <Input
              id="firstName"
              autoComplete="given-name"
              className="mt-1 w-full"
              error={!!errors.firstName}
              {...register("firstName", { setValueAs: (v: string) => (v === "" ? undefined : v) })}
            />
            {errors.firstName && (
              <p className="mt-1 text-xs text-destructive">{errors.firstName.message}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium" htmlFor="lastName">
              Nom
            </label>
            <Input
              id="lastName"
              autoComplete="family-name"
              className="mt-1 w-full"
              error={!!errors.lastName}
              {...register("lastName", { setValueAs: (v: string) => (v === "" ? undefined : v) })}
            />
            {errors.lastName && (
              <p className="mt-1 text-xs text-destructive">{errors.lastName.message}</p>
            )}
          </div>
        </div>

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
            autoComplete="new-password"
            className="mt-1 w-full"
            error={!!errors.password}
            {...register("password")}
          />
          {errors.password && (
            <p className="mt-1 text-xs text-destructive">{errors.password.message}</p>
          )}
        </div>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError ? mutation.error.message : "Une erreur est survenue."}
          </p>
        )}

        <Button type="submit" loading={mutation.isPending} size="lg" className="w-full">
          {mutation.isPending ? "Création..." : "Créer mon compte"}
        </Button>
      </form>
    </AuthShell>
  );
}
