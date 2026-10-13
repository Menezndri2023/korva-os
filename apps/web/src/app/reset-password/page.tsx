"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { resetPasswordSchema, type ResetPasswordInput } from "@korva/validation";
import { Button, Input } from "@korva/ui";
import { ApiError, apiClient } from "@/lib/api-client";
import { AuthShell } from "@/components/landing/auth-shell";

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
      <AuthShell
        // "Lien invalide" is asserted by page.test.tsx through getByText, which requires exactly
        // one match — so neither the intro below nor the form's error message may repeat that
        // exact pair of words.
        title="Lien invalide"
        intro="Ce lien de réinitialisation est incomplet ou invalide."
        footer={
          <Link href="/forgot-password" className="font-medium text-text underline">
            Redemander un lien
          </Link>
        }
      >
        <p className="text-sm text-text-muted">
          Un lien de réinitialisation ne sert qu&apos;une fois et expire. Demandez-en un nouveau
          depuis la page mot de passe oublié.
        </p>
      </AuthShell>
    );
  }

  if (mutation.isSuccess) {
    return (
      <AuthShell
        title="Mot de passe réinitialisé"
        intro="Votre mot de passe a été réinitialisé avec succès."
        footer={
          <Link href="/login" className="font-medium text-text underline">
            Se connecter
          </Link>
        }
      >
        <p className="text-sm text-text-muted">
          Vous pouvez maintenant vous connecter avec votre nouveau mot de passe.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Nouveau mot de passe"
      intro="Choisissez un nouveau mot de passe."
      footer={
        <Link href="/login" className="font-medium text-text underline">
          Retour à la connexion
        </Link>
      }
    >
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
          <Input
            id="password"
            type="password"
            className="mt-1 w-full"
            error={!!errors.password}
            {...register("password")}
          />
          {errors.password && <p className="mt-1 text-xs text-destructive">{errors.password.message}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium" htmlFor="confirmPassword">
            Confirmer le mot de passe
          </label>
          <Input
            id="confirmPassword"
            type="password"
            className="mt-1 w-full"
            error={!!errors.confirmPassword}
            {...register("confirmPassword")}
          />
          {errors.confirmPassword && (
            <p className="mt-1 text-xs text-destructive">{errors.confirmPassword.message}</p>
          )}
        </div>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError && mutation.error.code === "INVALID_RESET_TOKEN"
              ? "Ce lien de réinitialisation est invalide ou a expiré."
              : "Une erreur est survenue. Veuillez réessayer."}
          </p>
        )}

        <Button type="submit" loading={mutation.isPending} size="lg" className="w-full">
          {mutation.isPending ? "Réinitialisation..." : "Réinitialiser le mot de passe"}
        </Button>
      </form>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  // The centring wrapper that used to live here is gone: AuthShell is itself the full-height
  // two-column layout, so keeping a flex-centred min-h-screen box around it would nest one
  // viewport-height container inside another.
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
