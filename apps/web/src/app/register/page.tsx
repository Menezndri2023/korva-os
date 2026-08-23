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
    onSuccess: (data) => {
      setSession(data);
      router.replace("/onboarding");
    },
  });

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">KORVA OS</h1>
          <p className="mt-1 text-sm text-zinc-500">Créez votre compte pour commencer.</p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit((data) => mutation.mutate(data))}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium" htmlFor="firstName">
                Prénom
              </label>
              <Input id="firstName" className="mt-1 w-full" {...register("firstName")} />
            </div>
            <div>
              <label className="block text-sm font-medium" htmlFor="lastName">
                Nom
              </label>
              <Input id="lastName" className="mt-1 w-full" {...register("lastName")} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium" htmlFor="email">
              Email
            </label>
            <Input
              id="email"
              type="email"
              className="mt-1 w-full"
              error={!!errors.email}
              {...register("email")}
            />
            {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium" htmlFor="password">
              Mot de passe
            </label>
            <Input
              id="password"
              type="password"
              className="mt-1 w-full"
              error={!!errors.password}
              {...register("password")}
            />
            {errors.password && <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>}
          </div>

          {mutation.isError && (
            <p className="text-sm text-red-600">
              {mutation.error instanceof ApiError ? mutation.error.message : "Une erreur est survenue."}
            </p>
          )}

          <Button type="submit" loading={mutation.isPending} className="w-full">
            {mutation.isPending ? "Création..." : "Créer mon compte"}
          </Button>
        </form>

        <p className="text-center text-sm text-zinc-500">
          Déjà un compte ?{" "}
          <Link href="/login" className="font-medium text-zinc-900 underline">
            Se connecter
          </Link>
        </p>
      </div>
    </div>
  );
}
