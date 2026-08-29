"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import type { AcceptInvitationInput } from "@korva/validation";
import { Button, Input } from "@korva/ui";
import { ApiError, apiClient } from "@/lib/api-client";

interface AcceptInvitationResponse {
  organizationId: string;
  membershipId: string;
  roleId: string;
  userId: string;
  email: string;
  createdNewUser: boolean;
}

// Mirrors reset-password's own form-schema pattern (confirmPassword is client-only, never sent
// to the backend), but password itself stays optional here: InvitationsService.accept only
// requires it when the invited email has no existing KORVA account yet (PASSWORD_REQUIRED —
// there is no way to know that in advance from the client, no "does this email exist" endpoint
// exists, so the form always shows the fields and lets the backend's error drive the retry).
const acceptInvitationFormSchema = z
  .object({
    password: z.union([z.string().length(0), z.string().min(8).max(72)]).optional(),
    confirmPassword: z.string().optional(),
    firstName: z.string().max(120).optional(),
    lastName: z.string().max(120).optional(),
  })
  .refine((data) => !data.password || data.password === data.confirmPassword, {
    message: "Les mots de passe ne correspondent pas.",
    path: ["confirmPassword"],
  });

type AcceptInvitationFormInput = z.infer<typeof acceptInvitationFormSchema>;

function AcceptInvitationForm() {
  // Read once from the URL, kept only as a local render-scoped value — never written to
  // localStorage/sessionStorage/auth-store, never logged, never echoed back into the UI.
  const token = useSearchParams().get("token");

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AcceptInvitationFormInput>({
    resolver: zodResolver(acceptInvitationFormSchema),
  });

  const mutation = useMutation({
    // Only ever called from the form below, which the early `if (!token) return` guards
    // against rendering at all when there's no token — the non-null assertion reflects that
    // invariant, not an unchecked assumption.
    mutationFn: (data: AcceptInvitationFormInput) =>
      apiClient.post<AcceptInvitationResponse>(
        `/invitations/${token!}/accept`,
        {
          ...(data.password ? { password: data.password } : {}),
          ...(data.firstName ? { firstName: data.firstName } : {}),
          ...(data.lastName ? { lastName: data.lastName } : {}),
        } satisfies AcceptInvitationInput,
        { withOrganization: false },
      ),
  });

  const passwordRequired =
    mutation.isError &&
    mutation.error instanceof ApiError &&
    mutation.error.code === "PASSWORD_REQUIRED";

  if (!token) {
    return (
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-2xl font-semibold">Lien invalide</h1>
        <p className="text-sm text-zinc-500">
          Ce lien d&apos;invitation est incomplet ou invalide.
        </p>
        <Link href="/login" className="font-medium text-zinc-900 underline">
          Retour à la connexion
        </Link>
      </div>
    );
  }

  if (mutation.isSuccess) {
    return (
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-2xl font-semibold">Invitation acceptée</h1>
        <p className="text-sm text-zinc-500">
          Vous avez rejoint l&apos;organisation. Vous pouvez maintenant vous connecter.
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
        <h1 className="text-2xl font-semibold">Rejoindre l&apos;organisation</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Si vous avez déjà un compte KORVA, laissez les champs ci-dessous vides.
        </p>
      </div>

      <form
        className="space-y-4"
        noValidate
        onSubmit={handleSubmit((data) => mutation.mutate(data))}
      >
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

        <div>
          <label className="block text-sm font-medium" htmlFor="password">
            Mot de passe (nouveau compte uniquement)
          </label>
          <Input
            id="password"
            type="password"
            className="mt-1 w-full"
            error={!!errors.password || passwordRequired}
            {...register("password")}
          />
          {errors.password && (
            <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>
          )}
          {passwordRequired && (
            <p className="mt-1 text-xs text-red-600">
              Un mot de passe est requis pour créer votre compte.
            </p>
          )}
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
            <p className="mt-1 text-xs text-red-600">{errors.confirmPassword.message}</p>
          )}
        </div>

        {mutation.isError && !passwordRequired && (
          <p className="text-sm text-red-600">
            {mutation.error instanceof ApiError &&
            mutation.error.code === "INVALID_INVITATION_TOKEN"
              ? "Cette invitation est invalide ou a expiré."
              : "Une erreur est survenue. Veuillez réessayer."}
          </p>
        )}

        <Button type="submit" loading={mutation.isPending} className="w-full">
          {mutation.isPending ? "Validation..." : "Rejoindre l'organisation"}
        </Button>
      </form>
    </div>
  );
}

export default function AcceptInvitationPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Suspense fallback={null}>
        <AcceptInvitationForm />
      </Suspense>
    </div>
  );
}
