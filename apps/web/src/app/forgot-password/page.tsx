"use client";

import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@korva/validation";
import { apiClient } from "@/lib/api-client";

interface ForgotPasswordResponse {
  message: string;
}

export default function ForgotPasswordPage() {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordInput>({ resolver: zodResolver(forgotPasswordSchema) });

  const mutation = useMutation({
    mutationFn: (data: ForgotPasswordInput) =>
      apiClient.post<ForgotPasswordResponse>("/auth/forgot-password", data, {
        withOrganization: false,
      }),
  });

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">Mot de passe oublié</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Indiquez votre email pour recevoir un lien de réinitialisation.
          </p>
        </div>

        {mutation.isSuccess ? (
          <div className="space-y-4 text-center">
            {/* Anti-énumération : ce message est strictement identique que le compte existe ou
             * non — jamais "cet email n'existe pas" ou équivalent. */}
            <p className="text-sm text-zinc-700">
              Si un compte existe avec cette adresse e-mail, un lien de réinitialisation a été
              envoyé.
            </p>
            <Link href="/login" className="font-medium text-zinc-900 underline">
              Retour à la connexion
            </Link>
          </div>
        ) : (
          <form
            className="space-y-4"
            // Zod (via zodResolver) is the single source of validation truth for this form —
            // without this, the browser's native type="email" constraint validation can block
            // submission before React ever sees it, showing its own (inconsistent, non-French)
            // validation UI instead of the message below.
            noValidate
            onSubmit={handleSubmit((data) => mutation.mutate(data))}
          >
            <div>
              <label className="block text-sm font-medium" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
                {...register("email")}
              />
              {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
            </div>

            {mutation.isError && (
              <p className="text-sm text-red-600">Une erreur est survenue. Veuillez réessayer.</p>
            )}

            <button
              type="submit"
              disabled={mutation.isPending}
              className="w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
            >
              {mutation.isPending ? "Envoi..." : "Envoyer le lien"}
            </button>

            <p className="text-center text-sm text-zinc-500">
              <Link href="/login" className="font-medium text-zinc-900 underline">
                Retour à la connexion
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
