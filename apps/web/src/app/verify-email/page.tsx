"use client";

import { Suspense, useEffect, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import type { VerifyEmailInput } from "@korva/validation";
import { ApiError, apiClient } from "@/lib/api-client";

interface VerifyEmailResponse {
  success: boolean;
}

function VerifyEmailStatus() {
  // Read once from the URL, kept only as a local render-scoped value — same posture as
  // reset-password's token handling.
  const token = useSearchParams().get("token");
  const hasStarted = useRef(false);

  const mutation = useMutation({
    mutationFn: (data: VerifyEmailInput) =>
      apiClient.post<VerifyEmailResponse>("/auth/verify-email", data, {
        withOrganization: false,
      }),
  });

  const { mutate } = mutation;
  useEffect(() => {
    if (!token || hasStarted.current) return;
    hasStarted.current = true;
    mutate({ token });
  }, [token, mutate]);

  if (!token) {
    return (
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-2xl font-semibold">Lien invalide</h1>
        <p className="text-sm text-zinc-500">
          Ce lien de vérification est incomplet ou invalide.
        </p>
        <Link href="/login" className="font-medium text-zinc-900 underline">
          Se connecter
        </Link>
      </div>
    );
  }

  if (mutation.isSuccess) {
    return (
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-2xl font-semibold">Email vérifié</h1>
        <p className="text-sm text-zinc-500">
          Votre adresse email a été vérifiée avec succès.
        </p>
        <Link href="/login" className="font-medium text-zinc-900 underline">
          Se connecter
        </Link>
      </div>
    );
  }

  if (mutation.isError) {
    return (
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-2xl font-semibold">Vérification impossible</h1>
        <p className="text-sm text-zinc-500">
          {mutation.error instanceof ApiError &&
          mutation.error.code === "INVALID_VERIFICATION_TOKEN"
            ? "Ce lien de vérification est invalide ou a expiré."
            : "Une erreur est survenue. Veuillez réessayer."}
        </p>
        <Link href="/login" className="font-medium text-zinc-900 underline">
          Se connecter
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm space-y-4 text-center">
      <h1 className="text-2xl font-semibold">Vérification en cours...</h1>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Suspense fallback={null}>
        <VerifyEmailStatus />
      </Suspense>
    </div>
  );
}
