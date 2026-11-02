"use client";

import { useT } from "@/lib/storefront-locale";

/**
 * Shown when the business exists but its public site is not online — the organization has not
 * enabled (or has switched off) the `website` module, which the API answers with
 * MODULE_NOT_AVAILABLE.
 *
 * Distinct from not-found.tsx on purpose: "this address matches no shop" sends a customer away,
 * while the truth here is that the shop exists and its site is simply not published yet. A
 * visitor who was given this link should be told so, and that the business can still be reached.
 */
export function StorefrontOffline() {
  const t = useT();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-zinc-50 px-6 text-center">
      <h1 className="text-lg font-semibold text-zinc-900">
        {t("Ce site n'est pas en ligne pour le moment", "This website is not online at the moment")}
      </h1>
      <p className="max-w-md text-sm text-zinc-600">
        {t(
          "L'entreprise existe bien, mais son site public n'est pas encore publié ou a été mis en pause. Contactez-la directement, ou revenez un peu plus tard.",
          "The business does exist, but its public website is not published yet or has been paused. Contact it directly, or come back a little later.",
        )}
      </p>
    </main>
  );
}
