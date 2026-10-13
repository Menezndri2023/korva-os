"use client";

import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@korva/validation";
import { Button, Input } from "@korva/ui";
import { apiClient } from "@/lib/api-client";
import { AuthShell } from "@/components/landing/auth-shell";

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
    <AuthShell
      title="Mot de passe oublié"
      intro="Indiquez votre email pour recevoir un lien de réinitialisation."
      footer={
        <Link href="/login" className="font-medium text-text underline">
          Retour à la connexion
        </Link>
      }
    >
      {mutation.isSuccess ? (
        // Anti-énumération : ce message est strictement identique que le compte existe ou
        // non — jamais "cet email n'existe pas" ou équivalent.
        <p className="text-sm text-text">
          Si un compte existe avec cette adresse e-mail, un lien de réinitialisation a été envoyé.
        </p>
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
            <Input
              id="email"
              type="email"
              autoComplete="email"
              className="mt-1 w-full"
              error={!!errors.email}
              {...register("email")}
            />
            {errors.email && (
              <p className="mt-1 text-xs text-destructive">{errors.email.message}</p>
            )}
          </div>

          {mutation.isError && (
            <p className="text-sm text-destructive">Une erreur est survenue. Veuillez réessayer.</p>
          )}

          <Button type="submit" loading={mutation.isPending} size="lg" className="w-full">
            {mutation.isPending ? "Envoi..." : "Envoyer le lien"}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
