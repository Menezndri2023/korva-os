"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/auth-store";
import { LandingPage } from "@/components/landing/landing-page";

/**
 * The public home page, plus the redirect for anyone already signed in.
 *
 * BEHAVIOUR CHANGE, deliberate: this route used to redirect *every* visitor — an anonymous one
 * straight to /login — and render nothing at all. korvasuite.com therefore opened onto a bare
 * login form, with no explanation of what KORVA is, for people who had never heard of it. Now an
 * anonymous visitor gets the landing page and the redirect applies only when there is a session
 * to redirect.
 *
 * The landing markup renders unconditionally rather than behind `if (!accessToken)`, so it is in
 * the server-rendered HTML on first paint — a visitor on a slow connection reads the page while
 * the bundle is still arriving, and crawlers see it without executing anything. A signed-in
 * visitor briefly sees it before the effect fires, which is strictly better than the blank screen
 * they got before.
 */
export default function Home() {
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

  return <LandingPage />;
}
