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
import type { Locale } from "@korva/types";
import { AUTH_TEXT } from "@/lib/auth-text";
import { useLocale, withLang } from "@/lib/locale";

interface LoginResponse {
  user: { id: string; email: string; firstName?: string; lastName?: string };
  accessToken: string;
}

export default function LoginPage() {
  const locale = useLocale();
  const t = AUTH_TEXT[locale];
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
      locale={locale}
      title={t.loginTitle}
      intro={t.loginIntro}
      aside={<LoginAside locale={locale} />}
      footer={
        <>
          {t.noAccount}{" "}
          <Link href={withLang("/register", locale)} className="font-medium text-text underline">
            {t.createAccount}
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit((data) => mutation.mutate(data))}>
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
          {errors.email && <p className="mt-1 text-xs text-destructive">{errors.email.message}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium" htmlFor="password">
            {t.password}
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
            href={withLang("/forgot-password", locale)}
            className="mt-1.5 inline-block text-xs text-text-muted underline"
          >
            {t.forgot}
          </Link>
        </div>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {loginErrorMessage(mutation.error, locale)}
          </p>
        )}

        <Button type="submit" loading={mutation.isPending} size="lg" className="w-full">
          {mutation.isPending ? t.loginPending : t.loginButton}
        </Button>
      </form>
    </AuthShell>
  );
}

/** The API's messages are written for developers, in English; the person signing in gets these. */
function loginErrorMessage(error: unknown, locale: Locale): string {
  const t = AUTH_TEXT[locale];
  if (error instanceof ApiError) return t.loginErrors[error.code] ?? error.message;
  return t.genericError;
}
