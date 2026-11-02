"use client";

import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@korva/validation";
import { Button, Input } from "@korva/ui";
import { apiClient } from "@/lib/api-client";
import { AuthShell } from "@/components/landing/auth-shell";
import { AUTH_TEXT } from "@/lib/auth-text";
import { useLocale, withLang } from "@/lib/locale";

interface ForgotPasswordResponse {
  message: string;
}

export default function ForgotPasswordPage() {
  const locale = useLocale();
  const t = AUTH_TEXT[locale];
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
      locale={locale}
      title={t.forgotTitle}
      intro={t.forgotIntro}
      footer={
        <Link href={withLang("/login", locale)} className="font-medium text-text underline">
          {t.backToLogin}
        </Link>
      }
    >
      {mutation.isSuccess ? (
        // Anti-énumération : ce message est strictement identique que le compte existe ou
        // non — jamais "cet email n'existe pas" ou équivalent.
        <p className="text-sm text-text">
          {locale === "en"
            ? "If an account exists with this e-mail address, a reset link has been sent."
            : "Si un compte existe avec cette adresse e-mail, un lien de réinitialisation a été envoyé."}
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
              {t.email}
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
            <p className="text-sm text-destructive">{t.forgotError}</p>
          )}

          <Button type="submit" loading={mutation.isPending} size="lg" className="w-full">
            {mutation.isPending ? t.forgotPending : t.forgotButton}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
