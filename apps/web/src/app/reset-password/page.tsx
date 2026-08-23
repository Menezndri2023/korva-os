"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { resetPasswordSchema, type ResetPasswordInput } from "@korva/validation";
import { ApiError, apiClient } from "@/lib/api-client";

interface ResetPasswordResponse {
  success: boolean;
}

// confirmPassword exists only for this form's own client-side validation — it is never sent to
// the backend (see the mutationFn below, which builds its own request body). resetPasswordSchema
// itself is not modified: this just adds one more field/refine on top of it.
const resetPasswordFormSchema = resetPasswordSchema
  .omit({ token: true })
  .extend({ confirmPassword: z.string().min(1, "Confirmez votre mot de passe.") })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Les mots de passe ne correspondent pas.",
    path: ["confirmPassword"],
  });

type ResetPasswordFormInput = z.infer<typeof resetPasswordFormSchema>;

function ResetPasswordForm() {
  // Read once from the URL, kept only as a local render-scoped value — never written to
  // localStorage/sessionStorage/auth-store, never logged, never echoed back into the UI.
  const token = useSearchParams().get("token");

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordFormInput>({ resolver: zodResolver(resetPasswordFormSchema) });

  const mutation = useMutation({
    // Only ever called from the form below, which the early `if (!token) return` guards
    // against rendering at all when there's no token — the non-null assertion reflects that
    // invariant, not an unchecked assumption.
    mutationFn: (data: ResetPasswordFormInput) =>
      apiClient.post<ResetPasswordResponse>(
        "/auth/reset-password",
        { token: token!, password: data.password } satisfies ResetPasswordInput,
        { withOrganization: false },
      ),
  });

  if (!token) {
    return (
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-2xl font-semibold">Lien invalide</h1>
        <p className="text-sm text-zinc-500">
          Ce lien de réinitialisation est incomplet ou invalide.
        </p>
        <Link href="/forgot-password" className="font-medium text-zinc-900 underline">
          Redemander un lien
        </Link>
      </div>
    );
  }

  if (mutation.isSuccess) {
    return (
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-2xl font-semibold">Mot de passe réinitialisé</h1>
        <p className="text-sm text-zinc-500">
          Votre mot de passe a été réinitialisé avec succès.
        </p>
        <Link href="/login" className="font-medium text-zinc-900 underline">
          Se connecter
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Nouveau mot de passe</h1>
        <p className="mt-1 text-sm text-zinc-500">Choisissez un nouveau mot de passe.</p>
      </div>

      <form
        className="space-y-4"
        // Same reasoning as the forgot-password form: Zod stays the single source of truth.
        noValidate
        onSubmit={handleSubmit((data) => mutation.mutate(data))}
      >
        <div>
          <label className="block text-sm font-medium" htmlFor="password">
            Nouveau mot de passe
          </label>
          <input
            id="password"
            type="password"
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
            {...register("password")}
          />
          {errors.password && <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium" htmlFor="confirmPassword">
            Confirmer le mot de passe
          </label>
          <input
            id="confirmPassword"
            type="password"
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
            {...register("confirmPassword")}
          />
          {errors.confirmPassword && (
            <p className="mt-1 text-xs text-red-600">{errors.confirmPassword.message}</p>
          )}
        </div>

        {mutation.isError && (
          <p className="text-sm text-red-600">
            {mutation.error instanceof ApiError && mutation.error.code === "INVALID_RESET_TOKEN"
              ? "Ce lien de réinitialisation est invalide ou a expiré."
              : "Une erreur est survenue. Veuillez réessayer."}
          </p>
        )}

        <button
          type="submit"
          disabled={mutation.isPending}
          className="w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
        >
          {mutation.isPending ? "Réinitialisation..." : "Réinitialiser le mot de passe"}
        </button>
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
