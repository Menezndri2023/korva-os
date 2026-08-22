"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/auth-store";

export default function Home() {
  const router = useRouter();
  const accessToken = useAuthStore((state) => state.accessToken);
  const activeOrganizationId = useAuthStore((state) => state.activeOrganizationId);
  const bootstrapped = useAuthStore((state) => state.bootstrapped);

  useEffect(() => {
    if (!bootstrapped) return;
    if (!accessToken) {
      router.replace("/login");
    } else if (!activeOrganizationId) {
      router.replace("/onboarding");
    } else {
      router.replace("/dashboard");
    }
  }, [bootstrapped, accessToken, activeOrganizationId, router]);

  return null;
}
