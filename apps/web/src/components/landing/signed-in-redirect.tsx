"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/auth-store";

/**
 * Sends a signed-in visitor of the home page to their dashboard. Kept apart from the page so the
 * page itself stays a server component — the one that declares the page's metadata.
 */
export function SignedInRedirect() {
  const router = useRouter();
  const accessToken = useAuthStore((state) => state.accessToken);
  const activeOrganizationId = useAuthStore((state) => state.activeOrganizationId);
  const bootstrapped = useAuthStore((state) => state.bootstrapped);

  useEffect(() => {
    // Wait for the persisted session to be read: before bootstrap, `accessToken` is null for a
    // signed-in visitor too, and acting on it would send them to the landing page for good.
    if (!bootstrapped || !accessToken) return;
    router.replace(activeOrganizationId ? "/dashboard" : "/onboarding");
  }, [bootstrapped, accessToken, activeOrganizationId, router]);

  return null;
}
