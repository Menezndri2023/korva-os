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
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-zinc-50 px-6 text-center">
      <h1 className="text-lg font-semibold text-zinc-900">Ce site n&apos;est pas en ligne pour le moment</h1>
      <p className="max-w-md text-sm text-zinc-600">
        L&apos;entreprise existe bien, mais son site public n&apos;est pas encore publié ou a été
        mis en pause. Contactez-la directement, ou revenez un peu plus tard.
      </p>
    </main>
  );
}
